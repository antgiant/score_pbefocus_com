/**
 * Browser-only sign-in and folder pickers for folder sync.
 *
 * Provider SDKs are loaded lazily, only when the user picks that provider,
 * and are not cached by the service worker. Needs the client IDs in
 * app-sync-config.js; without them isConfigured() is false.
 *
 * Both providers expose getUserName(): the signed-in account's display name when
 * the provider reports one, otherwise its email. It is used as the scorer name on
 * history entries while a quiz syncs to a cloud folder.
 *
 * Google: Identity Services token client (scopes drive.file + userinfo.email + userinfo.profile) + Picker.
 *         Access tokens last about an hour and there is no browser refresh
 *         token, so getToken() fails with { code: "auth" } once it expires and
 *         the UI shows a Reconnect banner.
 * Microsoft: MSAL.js (auth code + PKCE). Private folder uses
 *         Files.ReadWrite.AppFolder; shared folders request
 *         Files.ReadWrite.All incrementally.
 */
var FolderAuth = (function () {
  var GOOGLE_SCOPE = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile";
  var GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
  var MS_SCOPE_APP = ["Files.ReadWrite.AppFolder"];
  var MS_SCOPE_SHARED = ["Files.ReadWrite.All"];
  var MSAL_URL = "https://alcdn.msauth.net/browser/2.38.3/js/msal-browser.min.js";
  var GSI_URL = "https://accounts.google.com/gsi/client";
  var GAPI_URL = "https://apis.google.com/js/api.js";

  var scriptPromises = {};

  function config() {
    return (typeof FOLDER_SYNC_CONFIG !== "undefined" && FOLDER_SYNC_CONFIG) || { google: {}, microsoft: {} };
  }

  function loadScript(url) {
    if (!scriptPromises[url]) {
      scriptPromises[url] = new Promise(function (resolve, reject) {
        var el = document.createElement("script");
        el.src = url;
        el.async = true;
        el.onload = resolve;
        el.onerror = function () {
          delete scriptPromises[url];
          reject({ offline: true });
        };
        document.head.appendChild(el);
      });
    }
    return scriptPromises[url];
  }

  // ---------------------------------------------------------------- Google

  var google = {
    id: "google",
    token: null,
    tokenExpiry: 0,
    client: null,
    email: null,
    displayName: null,

    isConfigured: function () {
      var c = config().google;
      return !!(c && c.clientId && c.apiKey && c.appId);
    },

    isSignedIn: function () {
      return !!this.token && Date.now() < this.tokenExpiry;
    },

    /** Must be called from a user gesture the first time (opens a popup). */
    signIn: function () {
      var self = this;
      return loadScript(GSI_URL).then(function () {
        return new Promise(function (resolve, reject) {
          if (!self.client) {
            self.client = window.google.accounts.oauth2.initTokenClient({
              client_id: config().google.clientId,
              scope: GOOGLE_SCOPE,
              callback: function () {}
            });
          }
          self.client.callback = function (resp) {
            if (resp.error) {
              reject({ code: "auth", status: 401, detail: resp.error });
              return;
            }
            self.token = resp.access_token;
            self.tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
            self.loadProfile().then(function () { resolve(self.token); });
          };
          self.client.requestAccessToken({ prompt: self.token ? "" : "consent" });
        });
      });
    },

    getToken: function () {
      if (this.isSignedIn()) {
        return Promise.resolve(this.token);
      }
      return Promise.reject({ code: "auth", status: 401 });
    },

    /** Fetch the account name and email once per sign-in; failures just leave them unset. */
    loadProfile: function () {
      var self = this;
      return fetch(GOOGLE_USERINFO_URL, { headers: { Authorization: "Bearer " + self.token } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (info) {
          self.email = info && info.email ? info.email : null;
          self.displayName = info && info.name ? info.name : null;
        })
        .catch(function () { self.email = null; self.displayName = null; });
    },

    /** Display name if Google reports one, else the email. */
    getUserName: function () {
      return Promise.resolve(this.displayName || this.email || null);
    },

    /** Open the Google Picker to choose a folder. Resolves { folderId, name } or null. */
    pickFolder: function () {
      var self = this;
      return self.getToken().then(function (token) {
        return loadScript(GAPI_URL).then(function () {
          return new Promise(function (resolve) { window.gapi.load("picker", resolve); });
        }).then(function () {
          return new Promise(function (resolve) {
            var picker = window.google.picker;
            var view = new picker.DocsView(picker.ViewId.FOLDERS)
              .setSelectFolderEnabled(true)
              .setMimeTypes("application/vnd.google-apps.folder");
            new picker.PickerBuilder()
              .addView(view)
              .setOAuthToken(token)
              .setDeveloperKey(config().google.apiKey)
              .setAppId(config().google.appId)
              .setCallback(function (data) {
                if (data.action === picker.Action.PICKED) {
                  resolve({ folderId: data.docs[0].id, name: data.docs[0].name });
                } else if (data.action === picker.Action.CANCEL) {
                  resolve(null);
                }
              })
              .build()
              .setVisible(true);
          });
        });
      });
    },

    signOut: function () {
      if (this.token && window.google && window.google.accounts) {
        window.google.accounts.oauth2.revoke(this.token, function () {});
      }
      this.token = null;
      this.tokenExpiry = 0;
      this.email = null;
      this.displayName = null;
    }
  };

  // ------------------------------------------------------------- Microsoft

  var microsoft = {
    id: "microsoft",
    app: null,
    account: null,
    scopes: MS_SCOPE_APP,

    isConfigured: function () {
      var c = config().microsoft;
      return !!(c && c.clientId);
    },

    isSignedIn: function () {
      return !!this.account;
    },

    getApp: function () {
      var self = this;
      return loadScript(MSAL_URL).then(function () {
        if (!self.app) {
          var c = config().microsoft;
          self.app = new window.msal.PublicClientApplication({
            auth: {
              clientId: c.clientId,
              authority: c.authority,
              redirectUri: window.location.origin + "/"
            },
            cache: { cacheLocation: "localStorage" }
          });
          return self.app.initialize().then(function () {
            var accounts = self.app.getAllAccounts();
            self.account = accounts.length ? accounts[0] : null;
            return self.app;
          });
        }
        return self.app;
      });
    },

    /**
     * @param {boolean} [shared] request Files.ReadWrite.All (shared folders)
     * Call from a user gesture; opens a popup when consent is needed.
     */
    signIn: function (shared) {
      var self = this;
      self.scopes = shared ? MS_SCOPE_SHARED : MS_SCOPE_APP;
      return self.getApp().then(function (app) {
        return app.loginPopup({ scopes: self.scopes, account: self.account || undefined }).then(function (r) {
          self.account = r.account;
          return r.accessToken;
        });
      });
    },

    getToken: function () {
      var self = this;
      return self.getApp().then(function (app) {
        if (!self.account) {
          throw { code: "auth", status: 401 };
        }
        return app.acquireTokenSilent({ scopes: self.scopes, account: self.account }).then(
          function (r) { return r.accessToken; },
          function () { throw { code: "auth", status: 401 }; }
        );
      });
    },

    /** MSAL exposes the account's display name and sign-in name (email / UPN) from the ID token. */
    getUserName: function () {
      var self = this;
      return self.getApp().then(function () {
        return self.account ? (self.account.name || self.account.username || null) : null;
      });
    },

    signOut: function () {
      if (this.app && this.account) {
        this.app.clearCache({ account: this.account });
      }
      this.account = null;
    }
  };

  return { google: google, microsoft: microsoft, get: function (id) { return id === "google" ? google : microsoft; } };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = FolderAuth;
}
