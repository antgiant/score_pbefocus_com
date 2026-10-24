/**
 * Host-side client for embedding PBE Score Keeper in an iframe.
 *
 * This file is intended for host pages, not for the scorekeeper iframe itself.
 */
(function(root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    var exports = factory();
    root.PBEScoreKeeperAPI = exports.PBEScoreKeeperAPI;
    root.PBEScoreKeeperAPIError = exports.PBEScoreKeeperAPIError;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function() {
  var MESSAGE_TYPES = {
    ready: "embedding:ready",
    hello: "embedding:hello",
    command: "embedding:command",
    response: "embedding:response",
    subscribe: "embedding:subscribe",
    unsubscribe: "embedding:unsubscribe",
    event: "embedding:event"
  };

  function PBEScoreKeeperAPIError(code, message, details) {
    this.name = "PBEScoreKeeperAPIError";
    this.code = code || "api_error";
    this.message = message || this.code;
    this.details = details || null;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, PBEScoreKeeperAPIError);
    }
  }
  PBEScoreKeeperAPIError.prototype = Object.create(Error.prototype);
  PBEScoreKeeperAPIError.prototype.constructor = PBEScoreKeeperAPIError;

  function normalizeEventList(events) {
    if (!events) {
      return [];
    }
    if (typeof events === "string") {
      return [events];
    }
    if (Array.isArray(events)) {
      return events.filter(function(eventName) {
        return typeof eventName === "string" && eventName.length > 0;
      });
    }
    return [];
  }

  function createId(prefix) {
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }

  function inferTargetOrigin(frame) {
    if (!frame || !frame.src || typeof URL === "undefined") {
      return "*";
    }
    try {
      return new URL(frame.src, typeof window !== "undefined" ? window.location.href : undefined).origin;
    } catch (error) {
      return "*";
    }
  }

  function PBEScoreKeeperAPI(frame, options) {
    options = options || {};
    this.window = options.window || (typeof window !== "undefined" ? window : null);
    this.frame = this.resolveFrame(frame);
    this.targetOrigin = options.targetOrigin || inferTargetOrigin(this.frame);
    this.timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 10000;
    this.readyTimeoutMs = Number.isFinite(options.readyTimeoutMs) ? options.readyTimeoutMs : this.timeoutMs;
    this.retries = Number.isFinite(options.retries) ? options.retries : 0;
    this.pending = new Map();
    this.eventHandlers = new Map();
    this.destroyed = false;
    this.isReady = false;
    this.readyPayload = null;
    this.readyRequestId = createId("ready");
    this.readyTimer = null;
    this.messageHandler = this.handleMessage.bind(this);
    this.readyPromise = this.createReadyPromise();
    this.buildCommandWrappers();

    if (!this.window || typeof this.window.addEventListener !== "function") {
      throw new PBEScoreKeeperAPIError("environment_unavailable", "A window with postMessage support is required");
    }

    this.window.addEventListener("message", this.messageHandler);

    if (options.autoReady !== false) {
      this.startReadyHandshake();
    }
  }

  PBEScoreKeeperAPI.prototype.resolveFrame = function(frame) {
    if (typeof frame === "string") {
      if (typeof document === "undefined" || typeof document.querySelector !== "function") {
        throw new PBEScoreKeeperAPIError("environment_unavailable", "document.querySelector is unavailable");
      }
      frame = document.querySelector(frame);
    }
    if (!frame || !frame.contentWindow) {
      throw new PBEScoreKeeperAPIError("invalid_frame", "An iframe element with contentWindow is required");
    }
    return frame;
  };

  PBEScoreKeeperAPI.prototype.createReadyPromise = function() {
    var self = this;
    return new Promise(function(resolve, reject) {
      self.resolveReady = resolve;
      self.rejectReady = reject;
    });
  };

  PBEScoreKeeperAPI.prototype.startReadyHandshake = function() {
    var self = this;
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
    }
    this.readyTimer = setTimeout(function() {
      if (!self.isReady) {
        self.rejectReady(new PBEScoreKeeperAPIError("ready_timeout", "Timed out waiting for embedded app readiness"));
      }
    }, this.readyTimeoutMs);

    this.sendHello();
    if (this.frame && typeof this.frame.addEventListener === "function") {
      this.frame.addEventListener("load", function() {
        self.sendHello();
      }, { once: true });
    }
  };

  PBEScoreKeeperAPI.prototype.sendHello = function() {
    if (this.destroyed || this.isReady) {
      return false;
    }
    return this.postMessage({
      type: MESSAGE_TYPES.hello,
      id: this.readyRequestId
    });
  };

  PBEScoreKeeperAPI.prototype.ready = function() {
    return this.readyPromise;
  };

  PBEScoreKeeperAPI.prototype.command = function(commandName, payload, options) {
    var self = this;
    options = options || {};
    return this.ready().then(function() {
      return self.request({
        type: MESSAGE_TYPES.command,
        command: commandName,
        payload: payload || {}
      }, options);
    });
  };

  PBEScoreKeeperAPI.prototype.sendCommand = function(commandName, payload, options) {
    return this.command(commandName, payload, options);
  };

  PBEScoreKeeperAPI.prototype.batch = function(commands, options) {
    options = options || {};
    return this.command("batch:run", {
      commands: commands,
      atomic: options.atomic,
      haltOnError: options.haltOnError,
      dryRun: options.dryRun,
      maxBatchCommands: options.maxBatchCommands
    }, options);
  };

  PBEScoreKeeperAPI.prototype.subscribe = function(events, options) {
    var self = this;
    var eventList = normalizeEventList(events);
    return this.ready().then(function() {
      return self.request({
        type: MESSAGE_TYPES.subscribe,
        events: eventList
      }, options || {});
    });
  };

  PBEScoreKeeperAPI.prototype.unsubscribe = function(events, options) {
    var self = this;
    var eventList = normalizeEventList(events);
    return this.ready().then(function() {
      return self.request({
        type: MESSAGE_TYPES.unsubscribe,
        events: eventList
      }, options || {});
    });
  };

  PBEScoreKeeperAPI.prototype.on = function(eventName, handler) {
    if (typeof eventName !== "string" || !eventName || typeof handler !== "function") {
      throw new PBEScoreKeeperAPIError("invalid_listener", "Event name and handler are required");
    }
    if (!this.eventHandlers.has(eventName)) {
      this.eventHandlers.set(eventName, new Set());
    }
    this.eventHandlers.get(eventName).add(handler);
    this.subscribe(eventName).catch(function() {});

    var self = this;
    return function unsubscribe() {
      self.off(eventName, handler);
    };
  };

  PBEScoreKeeperAPI.prototype.once = function(eventName, handler) {
    var self = this;
    var unsubscribe = this.on(eventName, function(data, envelope) {
      unsubscribe();
      handler(data, envelope);
    });
    return unsubscribe;
  };

  PBEScoreKeeperAPI.prototype.off = function(eventName, handler) {
    if (!this.eventHandlers.has(eventName)) {
      return false;
    }
    var handlers = this.eventHandlers.get(eventName);
    if (handler) {
      handlers.delete(handler);
    } else {
      handlers.clear();
    }
    if (handlers.size === 0) {
      this.eventHandlers.delete(eventName);
      this.unsubscribe(eventName).catch(function() {});
    }
    return true;
  };

  PBEScoreKeeperAPI.prototype.request = function(message, options) {
    options = options || {};
    var retries = Number.isFinite(options.retries) ? options.retries : this.retries;
    return this.requestAttempt(message, options, 0, retries);
  };

  PBEScoreKeeperAPI.prototype.requestAttempt = function(message, options, attempt, retries) {
    var self = this;
    return this.requestOnce(message, options).catch(function(error) {
      if (attempt < retries && self.isRetryable(error)) {
        return self.requestAttempt(message, options, attempt + 1, retries);
      }
      throw error;
    });
  };

  PBEScoreKeeperAPI.prototype.requestOnce = function(message, options) {
    var self = this;
    var id = message.id || createId("cmd");
    var timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : this.timeoutMs;
    var envelope = Object.assign({}, message, { id: id });

    return new Promise(function(resolve, reject) {
      if (self.destroyed) {
        reject(new PBEScoreKeeperAPIError("destroyed", "Client has been destroyed"));
        return;
      }

      var timer = setTimeout(function() {
        self.pending.delete(id);
        reject(new PBEScoreKeeperAPIError("timeout", "Timed out waiting for embedded app response", {
          id: id,
          command: envelope.command || envelope.type
        }));
      }, timeoutMs);

      self.pending.set(id, {
        resolve: resolve,
        reject: reject,
        timer: timer,
        message: envelope
      });

      if (!self.postMessage(envelope)) {
        clearTimeout(timer);
        self.pending.delete(id);
        reject(new PBEScoreKeeperAPIError("post_message_failed", "Unable to post message to embedded app"));
      }
    });
  };

  PBEScoreKeeperAPI.prototype.isRetryable = function(error) {
    return error && (error.code === "timeout" || error.code === "post_message_failed");
  };

  PBEScoreKeeperAPI.prototype.postMessage = function(message) {
    if (!this.frame || !this.frame.contentWindow || typeof this.frame.contentWindow.postMessage !== "function") {
      return false;
    }
    try {
      this.frame.contentWindow.postMessage(message, this.targetOrigin);
      return true;
    } catch (error) {
      return false;
    }
  };

  PBEScoreKeeperAPI.prototype.handleMessage = function(event) {
    if (this.destroyed || !event || !event.data || typeof event.data !== "object") {
      return;
    }
    if (event.source !== this.frame.contentWindow) {
      return;
    }
    if (this.targetOrigin !== "*" && event.origin !== this.targetOrigin) {
      return;
    }

    var data = event.data;
    if (data.type === MESSAGE_TYPES.ready) {
      this.markReady(data);
      return;
    }

    if (data.type === MESSAGE_TYPES.event) {
      this.dispatchEvent(data.event, data.data, data);
      return;
    }

    if (data.type === MESSAGE_TYPES.response) {
      if (data.id === this.readyRequestId && data.ok) {
        this.markReady(data.result || data);
      }
      this.resolvePending(data);
    }
  };

  PBEScoreKeeperAPI.prototype.markReady = function(payload) {
    if (this.isReady) {
      return;
    }
    this.isReady = true;
    this.readyPayload = payload || {};
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
    this.resolveReady(this.readyPayload);
  };

  PBEScoreKeeperAPI.prototype.resolvePending = function(data) {
    var pending = this.pending.get(data.id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(data.id);
    if (data.ok) {
      pending.resolve(data.result === undefined ? null : data.result);
      return;
    }
    var error = data.error || {};
    pending.reject(new PBEScoreKeeperAPIError(error.code || "command_error", error.message || "Command failed", error));
  };

  PBEScoreKeeperAPI.prototype.dispatchEvent = function(eventName, data, envelope) {
    var handlers = [];
    if (this.eventHandlers.has(eventName)) {
      handlers = handlers.concat(Array.from(this.eventHandlers.get(eventName)));
    }
    if (this.eventHandlers.has("*")) {
      handlers = handlers.concat(Array.from(this.eventHandlers.get("*")));
    }
    handlers.forEach(function(handler) {
      handler(data, envelope);
    });
  };

  PBEScoreKeeperAPI.prototype.destroy = function() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    if (this.window && typeof this.window.removeEventListener === "function") {
      this.window.removeEventListener("message", this.messageHandler);
    }
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
    this.pending.forEach(function(pending) {
      clearTimeout(pending.timer);
      pending.reject(new PBEScoreKeeperAPIError("destroyed", "Client has been destroyed"));
    });
    this.pending.clear();
    this.eventHandlers.clear();
  };

  PBEScoreKeeperAPI.prototype.buildCommandWrappers = function() {
    var self = this;
    function wrap(commandName) {
      return function(payload, options) {
        return self.command(commandName, payload, options);
      };
    }

    this.session = {
      list: wrap("session:list"),
      getCurrent: wrap("session:getCurrent"),
      create: wrap("session:create"),
      switch: wrap("session:switch"),
      rename: wrap("session:rename"),
      delete: wrap("session:delete"),
      reorder: wrap("session:reorder"),
      export: wrap("session:export"),
      import: wrap("session:import")
    };

    this.question = {
      next: wrap("question:next"),
      previous: wrap("question:previous"),
      goto: wrap("question:goto"),
      create: wrap("question:create"),
      rename: wrap("question:rename"),
      setMaxPoints: wrap("question:setMaxPoints"),
      setBlock: wrap("question:setBlock"),
      ignore: wrap("question:ignore"),
      delete: wrap("question:delete")
    };

    this.score = {
      set: wrap("score:set"),
      setExtraCredit: wrap("score:setExtraCredit"),
      getMaxPoints: wrap("score:getMaxPoints"),
      getTotalPoints: wrap("score:getTotalPoints")
    };

    this.block = {
      create: wrap("block:create"),
      rename: wrap("block:rename"),
      setDefault: wrap("block:setDefault"),
      delete: wrap("block:delete"),
      list: wrap("block:list")
    };

    this.timer = {
      enable: wrap("timer:enable"),
      disable: wrap("timer:disable"),
      setDuration: wrap("timer:setDuration"),
      setAutoStart: wrap("timer:setAutoStart"),
      play: wrap("timer:play"),
      pause: wrap("timer:pause"),
      restart: wrap("timer:restart")
    };

    this.state = {
      export: wrap("state:export"),
      import: wrap("state:import"),
      previewImport: wrap("state:previewImport")
    };

    this.ui = {
      setTheme: wrap("ui:setTheme"),
      setLanguage: wrap("ui:setLanguage"),
      setThemeVariables: wrap("ui:setThemeVariables"),
      clearThemeVariables: wrap("ui:clearThemeVariables"),
      inheritTheme: wrap("ui:inheritTheme"),
      show: wrap("ui:show"),
      hide: wrap("ui:hide"),
      focus: wrap("ui:focus")
    };
  };

  return {
    PBEScoreKeeperAPI: PBEScoreKeeperAPI,
    PBEScoreKeeperAPIError: PBEScoreKeeperAPIError,
    MESSAGE_TYPES: MESSAGE_TYPES
  };
}));
