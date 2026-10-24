/**
 * PWA file and protocol handler management.
 *
 * File handling is consumed from the app window via window.launchQueue. The
 * service worker still handles share targets, but browser file_handlers launch
 * data is delivered to the launched client window.
 */

var PWAHandlers = {
  initialized: false,
  launchConsumerRegistered: false,

  init: function() {
    if (typeof window === "undefined" || !window.location) {
      return false;
    }

    if (this.initialized) {
      return true;
    }

    this.initialized = true;

    if (typeof window.addEventListener === "function") {
      window.addEventListener("message", this.handleMessage.bind(this));
    }

    this.setupLaunchQueue();
    this.handleProtocolUrl();
    this.handleFileParam();
    return true;
  },

  setupLaunchQueue: function() {
    var launchQueue = (typeof window !== "undefined") ? window.launchQueue : null;
    if (this.launchConsumerRegistered || !launchQueue || typeof launchQueue.setConsumer !== "function") {
      return false;
    }

    var self = this;
    launchQueue.setConsumer(function(launchParams) {
      return self.handleLaunchParams(launchParams);
    });
    this.launchConsumerRegistered = true;
    return true;
  },

  handleLaunchParams: function(launchParams) {
    if (!launchParams || !launchParams.files || launchParams.files.length === 0) {
      return Promise.resolve([]);
    }

    var self = this;
    var tasks = Array.prototype.map.call(launchParams.files, function(fileHandle) {
      return self.handleLaunchFileHandle(fileHandle);
    });
    return Promise.all(tasks);
  },

  handleLaunchFileHandle: function(fileHandle) {
    var self = this;
    if (!fileHandle || typeof fileHandle.getFile !== "function") {
      return Promise.resolve({
        success: false,
        error: "invalid_file_handle"
      });
    }

    return fileHandle.getFile()
      .then(function(file) {
        return self.readFileContent(file).then(function(content) {
          return self.handleFileLaunch({
            name: file.name || fileHandle.name || "import.yjs",
            type: file.type || "application/octet-stream",
            content: content
          });
        });
      })
      .catch(function(error) {
        self.notifyError(self.text("pwa.file_launch_error", {
          error: error && error.message ? error.message : error
        }));
        return {
          success: false,
          error: error
        };
      });
  },

  readFileContent: function(file) {
    if (file && typeof file.arrayBuffer === "function") {
      return file.arrayBuffer();
    }

    var self = this;
    return new Promise(function(resolve, reject) {
      if (typeof FileReader === "undefined") {
        reject(new Error(self.text("pwa.file_reader_unavailable")));
        return;
      }

      var reader = new FileReader();
      reader.onload = function() {
        resolve(reader.result);
      };
      reader.onerror = function() {
        reject(reader.error || new Error(self.text("pwa.file_read_failed")));
      };
      reader.readAsArrayBuffer(file);
    });
  },

  handleMessage: function(event) {
    if (!event || !event.data || event.data.type !== "file:launch") {
      return null;
    }

    return this.handleFileLaunch(event.data.file);
  },

  handleFileLaunch: function(file) {
    var self = this;
    var payload;

    try {
      this.validateLaunchFile(file);
      payload = this.normalizeImportPayload(file);
    } catch (error) {
      this.notifyError(this.text("pwa.file_launch_error", {
        error: error && error.message ? error.message : error
      }));
      return Promise.resolve({
        success: false,
        error: error
      });
    }

    return this.importPayload(payload)
      .then(function(result) {
        self.notifySuccess(self.text("pwa.file_launch_success"));
        return result;
      })
      .catch(function(error) {
        self.notifyError(self.text("pwa.file_launch_error", {
          error: error && error.message ? error.message : error
        }));
        return {
          success: false,
          error: error
        };
      });
  },

  validateLaunchFile: function(file) {
    if (!file || !file.content) {
      throw new Error(this.text("pwa.file_launch_invalid"));
    }

    if (!this.isSupportedFileName(file.name)) {
      throw new Error(this.text("pwa.unsupported_file_type"));
    }
  },

  isSupportedFileName: function(fileName) {
    return /\.(yjs|json)$/i.test(String(fileName || ""));
  },

  isJsonFile: function(fileName, mimeType) {
    return /\.json$/i.test(String(fileName || "")) || /json/i.test(String(mimeType || ""));
  },

  normalizeImportPayload: function(file) {
    var content = file.content;

    if (this.isJsonFile(file.name, file.type)) {
      if (typeof content === "string") {
        return content;
      }
      return this.bytesToText(this.toUint8Array(content));
    }

    if (typeof content === "string") {
      return content;
    }

    return this.toUint8Array(content);
  },

  toUint8Array: function(content) {
    if (typeof Uint8Array !== "undefined" && content instanceof Uint8Array) {
      return content;
    }

    if (typeof ArrayBuffer !== "undefined" && content instanceof ArrayBuffer) {
      return new Uint8Array(content);
    }

    if (content && typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(content)) {
      return new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
    }

    throw new Error(this.text("pwa.file_launch_invalid"));
  },

  bytesToText: function(bytes) {
    if (typeof TextDecoder !== "undefined") {
      return new TextDecoder().decode(bytes);
    }

    var text = "";
    for (var i = 0; i < bytes.length; i++) {
      text += String.fromCharCode(bytes[i]);
    }
    return text;
  },

  base64ToBytes: function(base64) {
    var binary;
    if (typeof atob === "function") {
      binary = atob(base64);
    } else if (typeof Buffer !== "undefined") {
      binary = Buffer.from(base64, "base64").toString("binary");
    } else {
      throw new Error(this.text("pwa.file_launch_invalid"));
    }

    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  },

  importPayload: function(payload) {
    var self = this;
    return this.ensureFeature("importExport")
      .then(function() {
        if (typeof importSessionData !== "function") {
          throw new Error(self.text("pwa.import_unavailable"));
        }
        return importSessionData(payload);
      })
      .then(function(result) {
        if (!result || result.success === false) {
          var message = result && result.errors && result.errors.length
            ? result.errors[0]
            : self.text("pwa.unknown_import_error");
          throw new Error(message);
        }

        if (typeof sync_data_to_display === "function") {
          sync_data_to_display();
        }

        return result;
      });
  },

  handleProtocolUrl: function() {
    if (typeof URLSearchParams === "undefined" || typeof window === "undefined" || !window.location) {
      return Promise.resolve(null);
    }

    var params = new URLSearchParams(window.location.search || "");
    var protocolParam = params.get("protocol");

    if (!protocolParam) {
      return Promise.resolve(null);
    }

    var self = this;
    return this.routeProtocolHandler(protocolParam)
      .then(function(result) {
        self.removeQueryParams(["protocol"]);
        return result;
      })
      .catch(function(error) {
        self.notifyError(self.text("pwa.protocol_error_invalid"));
        self.removeQueryParams(["protocol"]);
        return {
          success: false,
          error: error
        };
      });
  },

  handleFileParam: function() {
    if (typeof URLSearchParams === "undefined" || typeof window === "undefined" || !window.location) {
      return Promise.resolve(null);
    }

    var params = new URLSearchParams(window.location.search || "");
    var fileName = params.get("file-launch");
    var fileContent = params.get("file-content");

    if (!fileName || !fileContent) {
      return Promise.resolve(null);
    }

    var self = this;
    var file;
    try {
      file = {
        name: fileName,
        type: /\.json$/i.test(fileName) ? "application/json" : "application/octet-stream",
        content: this.base64ToBytes(fileContent)
      };
    } catch (error) {
      this.notifyError(this.text("pwa.file_launch_error", {
        error: error && error.message ? error.message : error
      }));
      this.removeQueryParams(["file-launch", "file-content"]);
      return Promise.resolve({
        success: false,
        error: error
      });
    }

    return this.handleFileLaunch(file).then(function(result) {
      self.removeQueryParams(["file-launch", "file-content"]);
      return result;
    });
  },

  parseProtocolUrl: function(input) {
    if (!input) {
      return {
        valid: false,
        errorKey: "pwa.protocol_error_invalid"
      };
    }

    var raw = input && input.href ? input.href : String(input);
    var decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch (e) {
      decoded = raw;
    }

    var url;
    try {
      url = new URL(decoded);
    } catch (error) {
      return {
        valid: false,
        errorKey: "pwa.protocol_error_invalid",
        error: error
      };
    }

    var scheme = String(url.protocol || "").replace(/:$/, "").toLowerCase();
    if (scheme !== "web+pbe" && scheme !== "pbe") {
      return {
        valid: false,
        errorKey: "pwa.protocol_error_invalid"
      };
    }

    var pathParts = url.pathname.split("/").filter(Boolean).map(function(part) {
      try {
        return decodeURIComponent(part);
      } catch (e) {
        return part;
      }
    });
    var action = (url.hostname || pathParts.shift() || "").toLowerCase();

    if (!action) {
      return {
        valid: false,
        errorKey: "pwa.protocol_error_invalid"
      };
    }

    if (action === "session") {
      var sessionAction = (pathParts[0] || url.searchParams.get("action") || "").toLowerCase();
      if (!sessionAction) {
        return {
          valid: false,
          action: action,
          errorKey: "pwa.protocol_error_missing_param",
          param: "action"
        };
      }
      return {
        valid: true,
        action: action,
        sessionAction: sessionAction
      };
    }

    if (action === "import") {
      var fileValue = url.searchParams.get("file") || url.searchParams.get("url");
      if (!fileValue) {
        return {
          valid: false,
          action: action,
          errorKey: "pwa.protocol_error_missing_param",
          param: "file"
        };
      }
      return {
        valid: true,
        action: action,
        file: fileValue
      };
    }

    return {
      valid: false,
      action: action,
      errorKey: "pwa.protocol_error_invalid"
    };
  },


  routeProtocolHandler: function(input) {
    var route = input && input.valid !== undefined ? input : this.parseProtocolUrl(input);

    if (!route.valid) {
      this.notifyProtocolError(route);
      return Promise.resolve({
        success: false,
        error: route
      });
    }

    if (route.action === "session") {
      return this.handleSessionAction(route.sessionAction);
    }

    if (route.action === "import") {
      return this.handleImportAction(route.file);
    }

    this.notifyProtocolError(route);
    return Promise.resolve({
      success: false,
      error: route
    });
  },



  handleSessionAction: function(action) {
    var self = this;
    if (action !== "new") {
      this.notifyProtocolError({
        errorKey: "pwa.protocol_error_invalid"
      });
      return Promise.resolve({
        success: false,
        error: "invalid_session_action"
      });
    }

    this.notifyInfo(this.text("pwa.protocol_new_session"));

    if (typeof createNewSession !== "function") {
      this.notifyError(this.text("pwa.protocol_error_invalid"));
      return Promise.resolve({
        success: false,
        error: "createNewSession unavailable"
      });
    }

    return Promise.resolve(createNewSession())
      .then(function(sessionId) {
        if (sessionId && typeof sync_data_to_display === "function") {
          sync_data_to_display();
        }
        return {
          success: !!sessionId,
          action: "session:new",
          sessionId: sessionId || null
        };
      })
      .catch(function(error) {
        self.notifyError(self.text("pwa.protocol_error_invalid"));
        return {
          success: false,
          error: error
        };
      });
  },

  handleImportAction: function(fileValue) {
    var self = this;
    if (!fileValue) {
      this.notifyProtocolError({
        errorKey: "pwa.protocol_error_missing_param",
        param: "file"
      });
      return Promise.resolve({
        success: false,
        error: "missing_file"
      });
    }

    this.notifyInfo(this.text("pwa.protocol_import_url"));

    if (this.looksLikeBase64(fileValue)) {
      try {
        return this.importPayload(this.base64ToBytes(fileValue))
          .then(function(result) {
            self.notifySuccess(self.text("pwa.file_launch_success"));
            return result;
          })
          .catch(function(error) {
            self.notifyError(self.text("pwa.file_launch_error", {
              error: error && error.message ? error.message : error
            }));
            return {
              success: false,
              error: error
            };
          });
      } catch (error) {
        this.notifyError(this.text("pwa.file_launch_error", {
          error: error && error.message ? error.message : error
        }));
        return Promise.resolve({
          success: false,
          error: error
        });
      }
    }

    return this.fetchAndImport(fileValue);
  },

  looksLikeBase64: function(value) {
    var text = String(value || "");
    return !!text &&
      text.length % 4 === 0 &&
      text.indexOf("/") === -1 &&
      !/^https?:\/\//i.test(text) &&
      !/^\.\.?\//.test(text) &&
      /^[A-Za-z0-9+]+={0,2}$/.test(text);
  },

  fetchAndImport: function(fileUrl) {
    var self = this;
    if (typeof fetch !== "function") {
      this.notifyError(this.text("pwa.protocol_error_invalid"));
      return Promise.resolve({
        success: false,
        error: "fetch unavailable"
      });
    }

    return fetch(fileUrl)
      .then(function(response) {
        if (!response || !response.ok) {
          var status = response && response.status ? response.status : "";
          throw new Error(self.text("pwa.http_error", { status: status }));
        }

        var contentType = response.headers && typeof response.headers.get === "function"
          ? response.headers.get("content-type") || ""
          : "";
        var responseUrl = response.url || fileUrl;
        var isJson = /json/i.test(contentType) || /\.json($|[?#])/i.test(responseUrl);

        if (isJson && typeof response.text === "function") {
          return response.text();
        }

        return response.arrayBuffer().then(function(buffer) {
          return new Uint8Array(buffer);
        });
      })
      .then(function(payload) {
        return self.importPayload(payload);
      })
      .then(function(result) {
        self.notifySuccess(self.text("pwa.file_launch_success"));
        return result;
      })
      .catch(function(error) {
        self.notifyError(self.text("pwa.file_launch_error", {
          error: error && error.message ? error.message : error
        }));
        return {
          success: false,
          error: error
        };
      });
  },

  notifyProtocolError: function(route) {
    var params = route && route.param ? { param: route.param } : undefined;
    this.notifyError(this.text((route && route.errorKey) || "pwa.protocol_error_invalid", params));
  },

  notifyInfo: function(message) {
    this.notify(message, "info");
  },

  notifySuccess: function(message) {
    this.notify(message, "success");
  },

  notifyError: function(message) {
    this.notify(message, "error");
  },

  notify: function(message, type) {
    if (typeof showUpdateNotification === "function") {
      showUpdateNotification(message, type || "info");
      return;
    }

    if (type === "error" && typeof showError === "function") {
      showError(message);
      return;
    }

    if (typeof console !== "undefined" && console.log) {
      console.log(message);
    }
  },

  text: function(key, params) {
    if (typeof t === "function") {
      return t(key, params);
    }
    return key;
  },

  ensureFeature: function(featureName) {
    if (typeof load_feature_group === "function") {
      return load_feature_group(featureName);
    }
    if (typeof ensure_feature_loaded === "function") {
      return ensure_feature_loaded(featureName);
    }
    return Promise.resolve();
  },

  removeQueryParams: function(paramNames) {
    if (typeof window === "undefined" || !window.location || !window.history || !window.history.replaceState || typeof URL === "undefined") {
      return;
    }

    try {
      var url = new URL(window.location.href);
      for (var i = 0; i < paramNames.length; i++) {
        url.searchParams.delete(paramNames[i]);
      }
      var title = (typeof document !== "undefined" && document.title) ? document.title : "";
      window.history.replaceState({}, title, url.pathname + url.search + url.hash);
    } catch (e) {
      // Ignore cleanup failures.
    }
  }
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = PWAHandlers;
}
