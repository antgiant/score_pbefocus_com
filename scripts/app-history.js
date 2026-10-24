// History Viewer for PBE Score Keeper
// Supports both global history (session-level events) and per-session history

var CHANGE_LOG_DIALOG_ID = "change-log-dialog-overlay";
var changeLogDialogOrigin = null;
var changeLogDialogKeyHandler = null;
var changeLogDialogObserver = null;
var changeLogDialogLastFocus = null;

function showChangeLogDialog() {
  if (typeof document === "undefined") {
    return;
  }
  var root = document.documentElement;
  if (root && root.getAttribute("data-ui-mode") !== "default") {
    return;
  }
  if (document.getElementById(CHANGE_LOG_DIALOG_ID)) {
    return;
  }

  var historyViewer = document.getElementById("history_viewer");
  if (!historyViewer) {
    return;
  }

  changeLogDialogLastFocus = document.activeElement || null;
  changeLogDialogOrigin = {
    parent: historyViewer.parentNode,
    nextSibling: historyViewer.nextSibling
  };

  var overlay = document.createElement("div");
  overlay.id = CHANGE_LOG_DIALOG_ID;
  overlay.className = "sync-dialog-overlay change-log-overlay";

  var dialog = document.createElement("div");
  dialog.className = "change-log-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");

  var header = document.createElement("div");
  header.className = "change-log-dialog-header";

  var title = document.createElement("h2");
  title.id = "change-log-dialog-title";
  title.textContent = t("edit_log.change_log");

  var closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "config-add-btn change-log-dialog-close";
  closeButton.textContent = t("edit_log.close_button");
  closeButton.addEventListener("click", closeChangeLogDialog);

  header.appendChild(title);
  header.appendChild(closeButton);

  var body = document.createElement("div");
  body.className = "change-log-dialog-body";
  body.appendChild(historyViewer);

  dialog.appendChild(header);
  dialog.appendChild(body);
  dialog.setAttribute("aria-labelledby", title.id);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  closeButton.focus();

  changeLogDialogKeyHandler = function(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeChangeLogDialog();
    }
  };
  document.addEventListener("keydown", changeLogDialogKeyHandler);

  if (typeof MutationObserver !== "undefined" && root) {
    changeLogDialogObserver = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].attributeName === "data-ui-mode") {
          if (root.getAttribute("data-ui-mode") !== "default") {
            closeChangeLogDialog();
          }
          break;
        }
      }
    });
    changeLogDialogObserver.observe(root, { attributes: true, attributeFilter: ["data-ui-mode"] });
  }
}

function closeChangeLogDialog() {
  if (typeof document === "undefined") {
    return;
  }
  var overlay = document.getElementById(CHANGE_LOG_DIALOG_ID);
  if (!overlay) {
    return;
  }

  var historyViewer = document.getElementById("history_viewer");
  if (historyViewer && changeLogDialogOrigin && changeLogDialogOrigin.parent) {
    if (changeLogDialogOrigin.nextSibling && changeLogDialogOrigin.nextSibling.parentNode === changeLogDialogOrigin.parent) {
      changeLogDialogOrigin.parent.insertBefore(historyViewer, changeLogDialogOrigin.nextSibling);
    } else {
      changeLogDialogOrigin.parent.appendChild(historyViewer);
    }
  }

  overlay.remove();

  if (changeLogDialogKeyHandler) {
    document.removeEventListener("keydown", changeLogDialogKeyHandler);
    changeLogDialogKeyHandler = null;
  }

  if (changeLogDialogObserver) {
    changeLogDialogObserver.disconnect();
    changeLogDialogObserver = null;
  }

  if (changeLogDialogLastFocus && typeof changeLogDialogLastFocus.focus === "function") {
    changeLogDialogLastFocus.focus();
  }
  changeLogDialogLastFocus = null;
  changeLogDialogOrigin = null;
}

/**
 * Initialize the history viewer
 * Sets up listeners and populates with current history
 */
function initialize_history_viewer() {
  if (!getGlobalDoc()) {
    console.warn('Yjs not initialized, history viewer unavailable');
    return;
  }

  // Listen for global doc updates
  getGlobalDoc().on('update', function(_update, origin) {
    if (origin === 'local' || origin === 'history') {
      refresh_history_display();
    }
  });

  // Populate initial history
  refresh_history_display();
}

/**
 * Set up listener for a session doc's updates
 * @param {string} sessionId - Session UUID
 */
function setupSessionHistoryListener(sessionId) {
  const sessionDoc = getSessionDoc(sessionId);
  if (!sessionDoc) return;

  // Skip if history display element doesn't exist (e.g., in tests)
  if (typeof document === 'undefined' || !document.getElementById || !document.getElementById('history_list')) {
    return;
  }

  sessionDoc.on('update', function(_update, origin) {
    if (origin === 'local' || origin === 'history') {
      refresh_history_display();
    }
  });
}

/**
 * Refresh the history display
 * Shows combined global and session history, sorted by timestamp
 */
function refresh_history_display() {
  // Skip if document or getElementById is not available (e.g., in tests)
  if (typeof document === 'undefined' || !document.getElementById) {
    return;
  }
  
  const historyList = document.getElementById('history_list');
  if (!historyList) return;

  // Clear existing history
  historyList.innerHTML = '';

  // Collect all history entries
  const allEntries = [];

  // Helper to translate history entry action/details
  // Supports both new format (keys + params) and legacy format (pre-translated strings)
  function translateEntry(entry) {
    let action, details;
    
    // Check for new format with translation keys
    const actionKey = entry.get('actionKey');
    const detailsKey = entry.get('detailsKey');
    
    if (actionKey) {
      // New format: translate using keys
      action = t(actionKey);
      const detailsParams = entry.get('detailsParams');
      details = detailsKey ? t(detailsKey, detailsParams ? JSON.parse(detailsParams) : {}) : '';
    } else {
      // Legacy format: use pre-translated strings
      action = entry.get('action') || t('edit_log.actions.change');
      details = entry.get('details') || '';
    }
    
    return { action, details };
  }

  // Get global history
  if (getGlobalDoc()) {
    const meta = getGlobalDoc().getMap('meta');
    const globalHistory = meta.get('globalHistory');
    if (globalHistory && globalHistory.length > 0) {
      for (let i = 0; i < globalHistory.length; i++) {
        const entry = globalHistory.get(i);
        if (entry) {
          const translated = translateEntry(entry);
          allEntries.push({
            timestamp: entry.get('timestamp') || 0,
            session: t('edit_log.global'),
            action: translated.action,
            details: translated.details,
            user: entry.get('user') || null,
            isGlobal: true,
            globalIndex: i
          });
        }
      }
    }
  }

  // Get session history
  const currentSession = get_current_session();
  if (currentSession) {
    const sessionName = currentSession.get('name') || t('edit_log.current_session');
    const historyLog = currentSession.get('historyLog');
    
    if (historyLog) {
      for (let i = 0; i < historyLog.length; i++) {
        const entry = historyLog.get(i);
        const translated = translateEntry(entry);
        allEntries.push({
          timestamp: entry.get('timestamp') || 0,
          session: sessionName,
          action: translated.action,
          details: translated.details,
          user: entry.get('user') || null,
          isGlobal: false,
          sessionIndex: i
        });
      }
    }
  }

  // Sort by timestamp descending (most recent first)
  allEntries.sort((a, b) => b.timestamp - a.timestamp);

  // Display entries
  if (allEntries.length === 0) {
    var noChangesText = (typeof t === 'function') ? t('edit_log.no_changes') : 'No changes recorded yet. Make some changes to see them here!';
    historyList.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: #666;">'+noChangesText+'</td></tr>';
    return;
  }

  for (const entry of allEntries) {
    const row = document.createElement('tr');
    const timeStr = entry.timestamp ? ((typeof format_time === 'function') ? format_time(entry.timestamp) : new Date(entry.timestamp).toLocaleTimeString()) : t('edit_log.unknown_time');
    
    // User display: show display name or "(local)" for local changes
    const userDisplay = entry.user || t('matching.history_local_user');

    // Style global entries differently with CSS class (not inline style)
    if (entry.isGlobal) {
      row.classList.add('history-global');
    }

    // Use translated "Global" for global entries
    const sessionDisplay = entry.isGlobal ? t('edit_log.global') : entry.session;

    row.innerHTML =
      '<td>' + timeStr + '</td>' +
      '<td>' + HTMLescape(userDisplay) + '</td>' +
      '<td>' + HTMLescape(sessionDisplay) + '</td>' +
      '<td>' + HTMLescape(entry.action) + '</td>' +
      '<td>' + HTMLescape(entry.details) + '</td>';

    historyList.appendChild(row);
  }
}



/**
 * Add a history entry to the current session's history log
 * Stores translation keys and params for language-independent history
 * @param {string} actionKey - Translation key for the action (e.g., "edit_log.actions.rename_team")
 * @param {string} detailsKey - Translation key for details (e.g., "edit_log.details_templates.renamed")
 * @param {object} detailsParams - Parameters for details interpolation (e.g., { old: "Team 1", new: "Team 2" })
 */
function add_history_entry(actionKey, detailsKey, detailsParams) {
  const sessionDoc = getActiveSessionDoc();
  if (!sessionDoc) return;

  const session = sessionDoc.getMap('session');
  if (!session) return;

  // Get or create the history log for this session
  let historyLog = session.get('historyLog');
  if (!historyLog) {
    historyLog = new Y.Array();
    session.set('historyLog', historyLog);
  }

  // While the quiz syncs to a cloud folder, entries carry the signed-in account's email;
  // otherwise they are shown as local.
  const userName = (typeof FolderSync !== 'undefined' && typeof FolderSync.getScorerName === 'function')
    ? FolderSync.getScorerName()
    : null;

  // Create a new history entry with translation keys
  const entry = new Y.Map();
  entry.set('timestamp', Date.now());
  entry.set('actionKey', actionKey);
  entry.set('detailsKey', detailsKey || '');
  entry.set('detailsParams', detailsParams ? JSON.stringify(detailsParams) : '');
  entry.set('user', userName);

  // Add to history log
  historyLog.push([entry]);

  // Update session last modified
  updateSessionLastModified();
}

/**
 * Clear session history
 * @param {string} sessionId - Optional session UUID (defaults to current)
 */
function clearSessionHistory(sessionId) {
  let sessionDoc;
  if (sessionId) {
    sessionDoc = getSessionDoc(sessionId);
  } else {
    sessionDoc = getActiveSessionDoc();
  }
  
  if (!sessionDoc) return;

  const session = sessionDoc.getMap('session');
  const historyLog = session.get('historyLog');
  
  if (historyLog && historyLog.length > 0) {
    sessionDoc.transact(function() {
      while (historyLog.length > 0) {
        historyLog.delete(0, 1);
      }
    }, 'local');
  }
}

/**
 * Clear global history
 */
function clearGlobalHistory() {
  if (!getGlobalDoc()) return;

  const meta = getGlobalDoc().getMap('meta');
  const globalHistory = meta.get('globalHistory');
  
  if (globalHistory && globalHistory.length > 0) {
    getGlobalDoc().transact(function() {
      while (globalHistory.length > 0) {
        globalHistory.delete(0, 1);
      }
    }, 'local');
  }
}

/**
 * Export history as JSON
 * @returns {object} Combined history data
 */
function exportHistory() {
  const result = {
    global: [],
    session: []
  };

  // Export global history
  if (getGlobalDoc()) {
    const meta = getGlobalDoc().getMap('meta');
    const globalHistory = meta.get('globalHistory');
    if (globalHistory && globalHistory.length > 0) {
      for (let i = 0; i < globalHistory.length; i++) {
        const entry = globalHistory.get(i);
        if (entry) {
          result.global.push({
            timestamp: entry.get('timestamp'),
            action: entry.get('action'),
            details: entry.get('details')
          });
        }
      }
    }
  }

  // Export session history
  const session = get_current_session();
  if (session) {
    const historyLog = session.get('historyLog');
    if (historyLog) {
      for (let i = 0; i < historyLog.length; i++) {
        const entry = historyLog.get(i);
        result.session.push({
          timestamp: entry.get('timestamp'),
          session: entry.get('session'),
          action: entry.get('action'),
          details: entry.get('details')
        });
      }
    }
  }

  return result;
}
