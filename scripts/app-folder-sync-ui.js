/**
 * Storage & Sync dialog and header status indicator for folder sync.
 */
var FolderSyncUI = (function () {
  var previousFocus = null;
  var busy = false;

  function esc(text) {
    var div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
  }

  function providerName(id) {
    return t(id === "google" ? "storage.provider_google" : "storage.provider_microsoft");
  }

  function currentSessionName() {
    try {
      var id = get_current_session_id();
      var sessions = typeof getAllSessions === "function" ? getAllSessions() : [];
      for (var i = 0; i < sessions.length; i++) {
        if (sessions[i].id === id) { return sessions[i].name; }
      }
    } catch (e) {}
    return "";
  }

  function toast(message) {
    var el = document.createElement("div");
    el.className = "storage-toast";
    el.setAttribute("role", "status");
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 4000);
  }

  // ------------------------------------------------------------- indicator

  var STATUS_ICON = { off: "☁️", synced: "✅", pending: "⏳", syncing: "🔄", offline: "📴", auth: "🔑", error: "⚠️" };

  function statusKey(status) {
    if (status.state === "off") { return "off"; }
    if (status.syncing) { return "syncing"; }
    return status.state;
  }

  function statusText(status) {
    var key = statusKey(status);
    return t("storage.status_" + key);
  }

  function updateIndicator() {
    var button = document.getElementById("storage_button");
    if (!button) { return; }
    var status = FolderSync.getStatus();
    var key = statusKey(status);
    button.setAttribute("data-state", key);
    var icon = button.querySelector(".storage-icon");
    var label = button.querySelector(".storage-status");
    if (icon) { icon.textContent = STATUS_ICON[key] || STATUS_ICON.off; }
    if (label) { label.textContent = key === "off" ? t("storage.button") : statusText(status); }
    button.setAttribute("title", key === "off" ? t("storage.button_tooltip") : statusText(status));
    var dialogStatus = document.getElementById("storage-dialog-status");
    if (dialogStatus) { dialogStatus.innerHTML = statusBlockHTML(status); }
  }

  function formatTime(ms) {
    try {
      return new Date(ms).toLocaleTimeString(get_current_language());
    } catch (e) {
      return new Date(ms).toLocaleTimeString();
    }
  }

  function statusBlockHTML(status) {
    if (status.state === "off") { return ""; }
    var parts = [];
    parts.push("<strong>" + esc(statusText(status)) + "</strong>");
    parts.push(esc(t("storage.connected_to", { provider: providerName(status.provider), folder: status.folderName || "" })));
    parts.push(esc(status.lastSync ? t("storage.last_sync", { time: formatTime(status.lastSync) }) : t("storage.never_synced")));
    if (status.pending) { parts.push(esc(t("storage.pending_changes"))); }
    if (status.mode === "relay") {
      parts.push(esc(t("storage.mode_large_event")));
      if (status.relay) { parts.push(esc(t("storage.mode_relay"))); }
    }
    if (status.scorerName) {
      parts.push(esc(t("storage.scorer_name", { name: status.scorerName })));
      parts.push(esc(t("storage.scorer_name_note")));
    }
    return parts.join("<br>");
  }

  // ------------------------------------------------------------- dialog

  function dialogHTML() {
    var sessionId = get_current_session_id();
    var config = FolderSync.readConfig(sessionId);
    var status = FolderSync.getStatus();
    var provider = config ? config.provider : "local";
    var html = '<div class="sync-dialog storage-dialog" role="dialog" aria-modal="true" aria-labelledby="storage-dialog-title">' +
      '<h2 id="storage-dialog-title">' + esc(t("storage.dialog_title")) + '</h2>' +
      '<p>' + esc(t("storage.current_quiz", { name: currentSessionName() })) + '</p>' +
      '<div id="storage-dialog-status" class="storage-status-block" role="status" aria-live="polite">' + statusBlockHTML(status) + '</div>';

    if (config) {
      html += '<div class="storage-actions">' +
        '<button type="button" class="config-add-btn" id="storage-sync-now">' + esc(t("storage.sync_now")) + '</button> ';
      if (status.state === "auth") {
        html += '<button type="button" class="config-add-btn" id="storage-reconnect">' + esc(t("storage.reconnect")) + '</button> ';
      }
      html += '<button type="button" class="config-add-btn" id="storage-stop">' + esc(t("storage.stop_sync")) + '</button></div>';
      if (status.state === "auth") {
        html += '<p class="storage-warning" role="alert">' + esc(t("storage.reconnect_message")) + '</p>';
      }
    } else {
      html += '<fieldset class="storage-choices"><legend>' + esc(t("storage.where_label")) + '</legend>' +
        radio("local", t("storage.opt_local"), provider) +
        radio("google", t("storage.provider_google"), provider) +
        radio("microsoft", t("storage.provider_microsoft"), provider) +
        '</fieldset><p class="storage-hint">' + esc(t("storage.local_desc")) + '</p>' +
        '<div id="storage-provider-panel"></div>';
    }
    html += '<div id="storage-dialog-message" class="storage-message" role="alert"></div>' +
      '<div class="storage-footer"><button type="button" class="config-add-btn" id="storage-close">' + esc(t("storage.close")) + '</button></div>' +
      '</div>';
    return html;
  }

  function radio(value, label, selected) {
    return '<label class="storage-radio"><input type="radio" name="storage-provider" value="' + value + '"' +
      (value === selected ? " checked" : "") + '> ' + esc(label) + '</label>';
  }

  function providerPanelHTML(provider) {
    if (provider === "local") { return ""; }
    var auth = FolderAuth.get(provider);
    if (!auth.isConfigured()) {
      return '<p class="storage-hint">' + esc(t("storage.not_configured", { provider: providerName(provider) })) + '</p>';
    }
    var html = '<p class="storage-hint">' + esc(t("storage.private_desc")) + '</p>' +
      '<button type="button" class="config-add-btn" id="storage-private">' + esc(t("storage.private_button")) + '</button>' +
      '<p class="storage-hint">' + esc(t("storage.shared_desc")) + '</p>';
    if (provider === "google") {
      html += '<button type="button" class="config-add-btn" id="storage-shared">' + esc(t("storage.shared_button")) + '</button>';
    } else {
      html += '<label for="storage-link">' + esc(t("storage.link_label")) + '</label> ' +
        '<input type="url" id="storage-link" placeholder="' + esc(t("storage.link_placeholder")) + '"> ' +
        '<button type="button" class="config-add-btn" id="storage-shared">' + esc(t("storage.link_button")) + '</button>';
    }
    return html;
  }

  function setMessage(text) {
    var el = document.getElementById("storage-dialog-message");
    if (el) { el.textContent = text || ""; }
  }

  function setBusy(on) {
    busy = on;
    var overlay = document.getElementById("storage-dialog-overlay");
    if (!overlay) { return; }
    Array.prototype.forEach.call(overlay.querySelectorAll("button, input"), function (el) {
      if (el.id !== "storage-close") { el.disabled = on; }
    });
    if (on) { setMessage(t("storage.working")); }
  }

  function errorText(err) {
    if (err && err.offline) { return t("storage.error_offline"); }
    if (err && err.code === "auth") { return t("storage.error_auth"); }
    if (err && err.code === "not-a-folder") { return t("storage.error_not_folder"); }
    if (err && err.code === "bad-link") { return t("storage.error_bad_link"); }
    return t("storage.error_generic");
  }

  function closeStorageDialog() {
    var overlay = document.getElementById("storage-dialog-overlay");
    if (overlay) { overlay.remove(); }
    document.removeEventListener("keydown", onKeydown);
    if (previousFocus && previousFocus.focus) { previousFocus.focus(); }
    previousFocus = null;
  }

  function onKeydown(e) {
    if (e.key === "Escape") { closeStorageDialog(); }
  }

  function trap(overlay) {
    overlay.addEventListener("keydown", function (e) {
      if (e.key !== "Tab") { return; }
      var items = overlay.querySelectorAll("button:not([disabled]), input:not([disabled])");
      if (!items.length) { return; }
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    });
  }

  function show() {
    var existing = document.getElementById("storage-dialog-overlay");
    if (existing) { existing.remove(); }
    previousFocus = document.activeElement;
    var overlay = document.createElement("div");
    overlay.id = "storage-dialog-overlay";
    overlay.className = "sync-dialog-overlay";
    overlay.innerHTML = dialogHTML();
    document.body.appendChild(overlay);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) { closeStorageDialog(); } });
    document.addEventListener("keydown", onKeydown);
    trap(overlay);
    wire(overlay);
    var first = overlay.querySelector("input:checked, button");
    if (first) { first.focus(); }
  }

  function rerender() {
    var overlay = document.getElementById("storage-dialog-overlay");
    if (!overlay) { return; }
    overlay.innerHTML = dialogHTML();
    wire(overlay);
    var first = overlay.querySelector("input:checked, button");
    if (first) { first.focus(); }
  }

  function wire(overlay) {
    function on(id, fn) {
      var el = overlay.querySelector("#" + id);
      if (el) { el.addEventListener("click", fn); }
    }
    on("storage-close", closeStorageDialog);

    var sessionId = get_current_session_id();
    on("storage-sync-now", function () { FolderSync.syncNow(); });
    on("storage-stop", function () { FolderSync.disable(sessionId); rerender(); updateIndicator(); });
    on("storage-reconnect", function () {
      var config = FolderSync.readConfig(sessionId);
      var shared = config && config.mode === "shared";
      var reauth = FolderAuth.get(config.provider);
      guarded(function () {
        return reauth.signIn(shared)
          .then(function () { return reauth.getUserName(); })
          .then(function (name) { FolderSync.setScorerName(sessionId, name); });
      }).then(function (ok) {
        if (ok) { FolderSync.syncNow(); rerender(); }
      });
    });

    var panel = overlay.querySelector("#storage-provider-panel");
    function selected() {
      var r = overlay.querySelector('input[name="storage-provider"]:checked');
      return r ? r.value : "local";
    }
    function renderPanel() {
      if (!panel) { return; }
      var provider = selected();
      panel.innerHTML = providerPanelHTML(provider);
      on("storage-private", function () { setupFolder(provider, "private"); });
      on("storage-shared", function () { setupFolder(provider, "shared"); });
    }
    Array.prototype.forEach.call(overlay.querySelectorAll('input[name="storage-provider"]'), function (r) {
      r.addEventListener("change", renderPanel);
    });
    renderPanel();
  }

  /** Run an async step with busy state and error reporting. Resolves true on success. */
  function guarded(fn) {
    if (busy) { return Promise.resolve(false); }
    setBusy(true);
    setMessage(t("storage.working"));
    return Promise.resolve().then(fn).then(
      function () { setBusy(false); setMessage(""); return true; },
      function (err) { setBusy(false); setMessage(errorText(err)); return false; }
    );
  }

  // ------------------------------------------------------------- folder setup

  function listHasMarker(backend) {
    return backend.list().then(function (entries) {
      var has = entries.some(function (e) { return e.name === FolderProviders.MARKER_NAME; });
      if (!has) { return null; }
      return backend.get(FolderProviders.MARKER_NAME).then(function (bytes) {
        return bytes ? FolderProviders.parseMarker(bytes) : null;
      });
    });
  }

  function backendFor(provider, folder) {
    var auth = FolderAuth.get(provider);
    var common = { fetch: function () { return fetch.apply(null, arguments); }, getToken: function () { return auth.getToken(); } };
    if (provider === "google") {
      return FolderProviders.createGoogleBackend(Object.assign({ folderId: folder.folderId }, common));
    }
    return FolderProviders.createGraphBackend(Object.assign({ folder: folder }, common));
  }

  function fetchImpl() { return fetch.apply(null, arguments); }

  function setupFolder(provider, kind) {
    var sessionId = get_current_session_id();
    var sessionName = currentSessionName();
    var auth = FolderAuth.get(provider);
    var shared = kind === "shared";
    var linkInput = document.getElementById("storage-link");
    var link = linkInput ? linkInput.value.trim() : "";
    if (provider === "microsoft" && shared && !/^https?:\/\//i.test(link)) {
      setMessage(t("storage.error_bad_link"));
      return Promise.resolve(false);
    }
    var common = function () { return { fetch: fetchImpl, getToken: function () { return auth.getToken(); } }; };
    var scorerName = null;

    return guarded(function () {
      // signIn must start inside the click handler so the popup is allowed.
      var signedIn = provider === "microsoft" ? auth.signIn(shared) : (auth.isSignedIn() ? Promise.resolve() : auth.signIn());
      return signedIn.then(function () {
        // The signed-in account's name (or email if no name is reported) becomes the scorer name on history entries.
        return auth.getUserName().then(function (name) { scorerName = name; });
      }).then(function () {
        if (kind === "private") {
          if (provider === "google") {
            return FolderProviders.ensureGoogleFolderPath(Object.assign(common(), { path: ["PBE Focus", "scorekeeper", sessionId] }))
              .then(function (id) { return { folder: { folderId: id }, folderName: "PBE Focus" }; });
          }
          return { folder: { appPath: "scorekeeper/" + sessionId }, folderName: "PBE Focus" };
        }
        if (provider === "google") {
          return auth.pickFolder().then(function (picked) {
            return picked ? { folder: { folderId: picked.folderId }, folderName: picked.name } : null;
          });
        }
        return FolderProviders.resolveGraphShareLink(Object.assign(common(), { url: link })).then(function (ref) {
          return { folder: { driveId: ref.driveId, itemId: ref.itemId }, folderName: ref.name };
        });
      }).then(function (target) {
        if (!target) { return; } // picker cancelled
        target.scorerName = scorerName;
        return finishSetup(provider, kind, sessionId, sessionName, target, common());
      });
    }).then(function (ok) {
      if (ok && FolderSync.readConfig(sessionId)) { rerender(); updateIndicator(); }
      return ok;
    });
  }

  function finishSetup(provider, kind, sessionId, sessionName, target, common) {
    var backend = backendFor(provider, target.folder);
    return listHasMarker(backend).then(function (marker) {
      if (marker && marker.sessionId !== sessionId) {
        return offerJoin(provider, kind, target, marker);
      }
      if (marker || kind === "private") {
        return commit(provider, kind, sessionId, sessionName, target, backend);
      }
      // A picked folder with no marker becomes the parent; the quiz gets its own subfolder.
      var subName = sessionName || sessionId;
      var make = provider === "google"
        ? FolderProviders.ensureGoogleSubfolder(Object.assign({ parentId: target.folder.folderId, name: subName }, common))
            .then(function (id) { return { folderId: id }; })
        : FolderProviders.createGraphSubfolder(Object.assign({ parent: target.folder, name: subName }, common))
            .then(function (ref) { return { driveId: ref.driveId, itemId: ref.itemId }; });
      return make.then(function (folder) {
        var sub = { folder: folder, folderName: target.folderName + " / " + subName, scorerName: target.scorerName };
        return commit(provider, kind, sessionId, sessionName, sub, backendFor(provider, folder));
      });
    });
  }

  function commit(provider, kind, sessionId, sessionName, target, backend) {
    return backend.put(FolderProviders.MARKER_NAME, FolderProviders.buildMarker({ sessionId: sessionId, name: sessionName })).then(function () {
      return FolderSync.enable(sessionId, { provider: provider, mode: kind, folder: target.folder, folderName: target.folderName, scorerName: target.scorerName || null });
    });
  }

  /** The folder belongs to a different quiz: offer to add it to this device. */
  function offerJoin(provider, kind, target, marker) {
    return new Promise(function (resolve) {
      var msg = document.getElementById("storage-dialog-message");
      if (!msg) { resolve(); return; }
      msg.innerHTML = '<p>' + esc(t("storage.join_message", { name: marker.name || "" })) + '</p>' +
        '<button type="button" class="config-add-btn" id="storage-join-yes">' + esc(t("storage.join_confirm")) + '</button> ' +
        '<button type="button" class="config-add-btn" id="storage-join-no">' + esc(t("storage.join_cancel")) + '</button>';
      setBusy(false);
      document.getElementById("storage-join-no").addEventListener("click", function () { msg.textContent = ""; resolve(); });
      document.getElementById("storage-join-yes").addEventListener("click", function () {
        guarded(function () { return joinFolder(provider, kind, target, marker); }).then(function (ok) {
          if (ok) { closeStorageDialog(); }
          resolve();
        });
      });
    });
  }

  /** Download every file from the folder and add it as a new quiz here, preserving its UUID. */
  function joinFolder(provider, kind, target, marker) {
    var backend = backendFor(provider, target.folder);
    return backend.list().then(function (entries) {
      var names = entries.map(function (e) { return e.name; }).filter(function (n) { return FolderSyncEngine.parseFileName(n); });
      return Promise.all(names.map(function (n) { return backend.get(n); })).then(function (files) {
        var updates = files.filter(Boolean);
        if (!updates.length) { throw { code: "empty-folder" }; }
        return importSessionData(Y.mergeUpdates(updates));
      });
    }).then(function (result) {
      if (!result || !result.success) { throw { code: "import-failed" }; }
      return FolderSync.enable(marker.sessionId, { provider: provider, mode: kind, folder: target.folder, folderName: target.folderName, scorerName: target.scorerName || null });
    }).then(function () {
      if (typeof switchSession === "function") { return switchSession(marker.sessionId); }
    }).then(function () {
      FolderSync.onSessionChanged();
      toast(t("storage.joined", { name: marker.name || "" }));
    });
  }

  return {
    show: show,
    close: closeStorageDialog,
    updateIndicator: updateIndicator,
    statusText: statusText,
    dialogHTML: dialogHTML,
    providerPanelHTML: providerPanelHTML
  };
})();

function showStorageDialog() { FolderSyncUI.show(); }

function initFolderSyncFeature() {
  FolderSync.onChange(FolderSyncUI.updateIndicator);
  FolderSync.init();
  FolderSyncUI.updateIndicator();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = FolderSyncUI;
}
