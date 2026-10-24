/**
 * Cloud folder sync configuration.
 *
 * Fill in the client IDs after creating the Google and Microsoft app
 * registrations (see SYNC_SETUP.md). Empty values mean "not set up": the
 * Storage & Sync dialog then shows that provider as unavailable.
 * Client IDs are public identifiers, not secrets.
 */
var FOLDER_SYNC_CONFIG = {
  google: {
    clientId: "",
    apiKey: "",
    appId: ""
  },
  microsoft: {
    clientId: "",
    authority: "https://login.microsoftonline.com/common"
  }
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = FOLDER_SYNC_CONFIG;
}
