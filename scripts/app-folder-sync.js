/**
 * Folder sync controller: runs the sync engine for the active session.
 *
 * Settings are per device and per session (localStorage, never synced):
 *   pbe-folder-sync:{sessionId} = { provider, mode, folder, folderName, clientId }
 * The engine's outbox and revision table live in IndexedDB so pending local
 * changes survive closing the tab.
 */
var FolderSync = (function () {
  var CONFIG_PREFIX = "pbe-folder-sync:";
  var ACTIVE_WINDOW_MS = 2 * 60 * 1000;

  var current = null; // { sessionId, engine, timer, config }
  var listeners = [];
  var lastLocalEdit = 0;
  var envHooked = false;

  // ------------------------------------------------------------- settings

  function readConfig(sessionId) {
    try {
      var raw = localStorage.getItem(CONFIG_PREFIX + sessionId);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeConfig(sessionId, config) {
    try {
      if (config) {
        localStorage.setItem(CONFIG_PREFIX + sessionId, JSON.stringify(config));
      } else {
        localStorage.removeItem(CONFIG_PREFIX + sessionId);
      }
    } catch (e) {}
  }

  function hasAnyConfig() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        if (localStorage.key(i).indexOf(CONFIG_PREFIX) === 0) {
          return true;
        }
      }
    } catch (e) {}
    return false;
  }

  function newClientId() {
    var bytes = new Uint8Array(6);
    (typeof crypto !== "undefined" ? crypto : window.crypto).getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }

  // ------------------------------------------------------------- IndexedDB store

  function createIdbStore(name) {
    var dbPromise = null;
    function open() {
      if (!dbPromise) {
        dbPromise = new Promise(function (resolve, reject) {
          var req = indexedDB.open(name, 1);
          req.onupgradeneeded = function () { req.result.createObjectStore("kv"); };
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
        });
      }
      return dbPromise;
    }
    function run(mode, fn) {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction("kv", mode);
          var result = fn(tx.objectStore("kv"));
          tx.oncomplete = function () { resolve(result && result.result); };
          tx.onerror = function () { reject(tx.error); };
        });
      });
    }
    return {
      get: function (key) { return run("readonly", function (s) { return s.get(key); }); },
      set: function (key, value) { return run("readwrite", function (s) { return s.put(value, key); }); }
    };
  }

  function createStore(sessionId) {
    if (typeof indexedDB === "undefined") {
      var mem = {};
      return { get: function (k) { return Promise.resolve(mem[k]); }, set: function (k, v) { mem[k] = v; return Promise.resolve(); } };
    }
    return createIdbStore("pbe-folder-sync-" + sessionId);
  }

  // ------------------------------------------------------------- backend

  function buildBackend(config) {
    var auth = FolderAuth.get(config.provider);
    var common = { fetch: function () { return fetch.apply(null, arguments); }, getToken: function () { return auth.getToken(); } };
    if (config.provider === "google") {
      return FolderProviders.createGoogleBackend(Object.assign({ folderId: config.folder.folderId }, common));
    }
    return FolderProviders.createGraphBackend(Object.assign({ folder: config.folder }, common));
  }

  // ------------------------------------------------------------- status

  function notify() {
    var status = getSyncStatus();
    listeners.forEach(function (fn) {
      try { fn(status); } catch (e) {}
    });
  }

  function onChange(fn) {
    listeners.push(fn);
    return function () { listeners = listeners.filter(function (l) { return l !== fn; }); };
  }

  function getSyncStatus() {
    if (!current) {
      return { state: "off", pending: false, lastSync: null };
    }
    var s = current.engine.getStatus();
    s.syncing = !!current.syncing;
    s.provider = current.config.provider;
    s.folderName = current.config.folderName;
    return s;
  }

  // ------------------------------------------------------------- loop

  function isActive() {
    return Date.now() - lastLocalEdit < ACTIVE_WINDOW_MS;
  }

  function schedule(delay) {
    if (!current) { return; }
    clearTimeout(current.timer);
    var hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    var interval = delay != null ? delay : FolderSyncEngine.pollInterval({ hidden: hidden, active: isActive() });
    if (interval == null) { return; } // hidden: resumes on visibilitychange
    current.timer = setTimeout(function () { syncNow(); }, interval);
  }

  /** Run one cycle now (Sync now button, online, tab visible). */
  function syncNow() {
    if (!current) { return Promise.resolve(null); }
    var run = current;
    clearTimeout(run.timer);
    run.syncing = true;
    notify();
    return run.engine.sync().then(function (result) {
      run.syncing = false;
      if (current === run) {
        notify();
        schedule(result.ok ? null : result.retryInMs);
      }
      return result;
    });
  }

  function hookEnvironment() {
    if (envHooked || typeof window === "undefined") { return; }
    envHooked = true;
    document.addEventListener("visibilitychange", function () {
      if (!current) { return; }
      if (document.visibilityState === "visible") { syncNow(); } else { current.engine.flush().catch(function () {}); clearTimeout(current.timer); }
    });
    window.addEventListener("online", function () { syncNow(); });
    window.addEventListener("pagehide", function () { if (current) { current.engine.flush().catch(function () {}); } });
  }

  // ------------------------------------------------------------- lifecycle

  /** Start (or restart) syncing the given session if it has settings. */
  function startForSession(sessionId) {
    stopCurrent();
    var config = sessionId && readConfig(sessionId);
    var doc = sessionId && typeof getSessionDoc === "function" ? getSessionDoc(sessionId) : null;
    if (!config || !doc) {
      notify();
      return Promise.resolve(false);
    }
    var engine = FolderSyncEngine.create({
      Y: Y,
      doc: doc,
      backend: buildBackend(config),
      store: createStore(sessionId),
      clientId: config.clientId
    });
    current = { sessionId: sessionId, engine: engine, config: config, timer: null, syncing: false };
    var markEdit = function (u, origin) { if (origin !== FolderSyncEngine.REMOTE_ORIGIN) { lastLocalEdit = Date.now(); } };
    doc.on("update", markEdit);
    current.detach = function () { doc.off("update", markEdit); };
    hookEnvironment();
    return engine.start().then(function () {
      notify();
      syncNow();
      return true;
    });
  }

  function stopCurrent() {
    if (!current) { return; }
    clearTimeout(current.timer);
    current.engine.stop();
    if (current.detach) { current.detach(); }
    current = null;
    notify();
  }

  /**
   * Save settings for a session and start syncing it.
   * @param {{provider: string, mode: string, folder: object, folderName: string}} settings
   */
  function enable(sessionId, settings) {
    var existing = readConfig(sessionId);
    var config = Object.assign({}, settings, { clientId: (existing && existing.clientId) || newClientId() });
    writeConfig(sessionId, config);
    return startForSession(sessionId);
  }

  function disable(sessionId) {
    writeConfig(sessionId, null);
    if (current && current.sessionId === sessionId) { stopCurrent(); }
  }

  /** Call after the active session changes. */
  function onSessionChanged() {
    var id = typeof get_current_session_id === "function" ? get_current_session_id() : null;
    if (current && current.sessionId === id) { return; }
    startForSession(id);
  }

  function init() {
    onSessionChanged();
    if (typeof window !== "undefined" && typeof window.switchSession === "function" && !window.switchSession._folderSyncWrapped) {
      var original = window.switchSession;
      var wrapped = function () {
        var result = original.apply(this, arguments);
        return Promise.resolve(result).then(function (r) { onSessionChanged(); return r; });
      };
      wrapped._folderSyncWrapped = true;
      window.switchSession = wrapped;
    }
  }

  return {
    readConfig: readConfig,
    writeConfig: writeConfig,
    hasAnyConfig: hasAnyConfig,
    newClientId: newClientId,
    enable: enable,
    disable: disable,
    startForSession: startForSession,
    stop: stopCurrent,
    syncNow: syncNow,
    getStatus: getSyncStatus,
    onChange: onChange,
    onSessionChanged: onSessionChanged,
    init: init,
    getCurrentSessionId: function () { return current && current.sessionId; }
  };
})();
