/**
 * App Updates & Cache Management
 * Handles:
 * - Checking for app updates
 * - Clearing cache and restarting
 * - PWA diagnostics and tooling dialog
 * - Periodic background sync for auto-updates (when installed as PWA)
 */

var APP_VERSION = "2.29.3";
var PWA_CACHE_PREFIX = "pbe-score-keeper";
var PWA_TOOLS_DIALOG_ID = "pwa-tools-dialog-overlay";
var pwaToolsDialogKeyHandler = null;
var pwaToolsDialogLastFocus = null;
var pwaDeferredReloadNotified = false;
var deferredInstallPromptEvent = null;

function isRunningAsInstalledPwa() {
  var isStandaloneDisplayMode = false;
  var isLegacyIosStandalone = false;
  var isTwa = false;

  try {
    isStandaloneDisplayMode = !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  } catch (e) {
    isStandaloneDisplayMode = false;
  }

  try {
    isLegacyIosStandalone = !!(window.navigator && window.navigator.standalone);
  } catch (e) {
    isLegacyIosStandalone = false;
  }

  try {
    isTwa = !!(document && document.referrer && document.referrer.indexOf("android-app://") === 0);
  } catch (e) {
    isTwa = false;
  }

  return isStandaloneDisplayMode || isLegacyIosStandalone || isTwa;
}

function initializePwaToolsVisibility() {
  if (typeof document === "undefined") {
    return;
  }

  var pwaToolsButton = document.getElementById("pwa_tools_button");
  var pwaActionsContainer = document.querySelector(".header-menu-pwa-actions");
  var installButton = document.getElementById("install_app_button");
  var installActionsContainer = document.querySelector(".header-menu-install-actions");

  var isInstalled = isRunningAsInstalledPwa();

  if (pwaToolsButton && pwaActionsContainer) {
    pwaActionsContainer.style.display = isInstalled ? "flex" : "none";
    pwaToolsButton.hidden = !isInstalled;
  }

  if (installButton && installActionsContainer) {
    var shouldShowInstallAction = !isInstalled;
    installActionsContainer.style.display = shouldShowInstallAction ? "flex" : "none";
    installButton.hidden = !shouldShowInstallAction;
  }
}

function getInstallFallbackMessage() {
  var userAgent = "";
  if (typeof navigator !== "undefined" && navigator.userAgent) {
    userAgent = String(navigator.userAgent).toLowerCase();
  }

  var isIos = /iphone|ipad|ipod/.test(userAgent);
  var isAndroid = /android/.test(userAgent);

  if (isIos) {
    return t("advanced.install_instructions_ios");
  }
  if (isAndroid) {
    return t("advanced.install_instructions_android");
  }
  return t("advanced.install_instructions_desktop");
}

function promptInstallApp() {
  if (isRunningAsInstalledPwa()) {
    return;
  }

  if (!deferredInstallPromptEvent || typeof deferredInstallPromptEvent.prompt !== "function") {
    showUpdateNotification(getInstallFallbackMessage(), "info");
    return;
  }

  deferredInstallPromptEvent.prompt();
  deferredInstallPromptEvent.userChoice.then(function(choiceResult) {
    if (!choiceResult || choiceResult.outcome !== "accepted") {
      showUpdateNotification(getInstallFallbackMessage(), "info");
    }
  }).catch(function() {
    showUpdateNotification(getInstallFallbackMessage(), "info");
  }).finally(function() {
    deferredInstallPromptEvent = null;
    initializePwaToolsVisibility();
  });
}

function initializeInstallPromptHandling() {
  if (typeof window === "undefined") {
    return;
  }

  window.addEventListener("beforeinstallprompt", function(event) {
    event.preventDefault();
    deferredInstallPromptEvent = event;
    initializePwaToolsVisibility();
  });

  window.addEventListener("appinstalled", function() {
    deferredInstallPromptEvent = null;
    initializePwaToolsVisibility();
    showUpdateNotification(t("advanced.install_success"), "success");
  });
}

function getPwaLastUpdateCheckIso() {
  try {
    return localStorage.getItem("pwa_last_update_check") || "";
  } catch (e) {
    return "";
  }
}

function setPwaLastUpdateCheckNow() {
  try {
    localStorage.setItem("pwa_last_update_check", new Date().toISOString());
  } catch (e) {
    // Ignore storage errors for diagnostics metadata
  }
}

function formatPwaLastUpdateCheck() {
  var iso = getPwaLastUpdateCheckIso();
  if (!iso) {
    return t("advanced.pwa_status_never");
  }

  var parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return t("advanced.pwa_status_unknown");
  }

  try {
    return new Date(parsed).toLocaleString();
  } catch (e) {
    return iso;
  }
}

function getPwaDiagnostics() {
  var diagnostics = [];
  var hasNavigator = typeof navigator !== "undefined";
  var hasServiceWorker = !!(hasNavigator && navigator.serviceWorker);
  var hasController = !!(hasNavigator && navigator.serviceWorker && navigator.serviceWorker.controller);
  var syncState = (typeof FolderSync !== "undefined" && FolderSync.getStatus) ? FolderSync.getStatus().state : "off";
  var periodicSyncSupported = false;

  diagnostics.push({
    label: t("advanced.pwa_status_installed"),
    value: isRunningAsInstalledPwa() ? t("advanced.pwa_status_yes") : t("advanced.pwa_status_no")
  });
  diagnostics.push({
    label: t("advanced.pwa_status_online"),
    value: (hasNavigator && navigator.onLine === false)
      ? t("advanced.pwa_status_no")
      : t("advanced.pwa_status_yes")
  });
  diagnostics.push({
    label: t("advanced.pwa_status_service_worker"),
    value: hasServiceWorker ? t("advanced.pwa_status_yes") : t("advanced.pwa_status_no")
  });
  diagnostics.push({
    label: t("advanced.pwa_status_service_worker_control"),
    value: hasController ? t("advanced.pwa_status_yes") : t("advanced.pwa_status_no")
  });

  diagnostics.push({
    label: t("advanced.pwa_status_sync"),
    value: syncState
  });

  if (hasNavigator && navigator.serviceWorker && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready.then(function(registration) {
      periodicSyncSupported = !!(registration && registration.periodicSync);
      var container = document.getElementById("pwa_tools_status_list");
      if (!container) {
        return;
      }
      var periodicRow = container.querySelector("[data-pwa-status='periodic-sync'] .pwa-status-value");
      if (periodicRow) {
        periodicRow.textContent = periodicSyncSupported ? t("advanced.pwa_status_yes") : t("advanced.pwa_status_no");
      }
    }).catch(function() {
      // Ignore diagnostics refresh failures
    });
  }

  diagnostics.push({
    label: t("advanced.pwa_status_periodic_sync"),
    value: t("advanced.pwa_status_unknown"),
    key: "periodic-sync"
  });
  diagnostics.push({
    label: t("advanced.pwa_status_last_update_check"),
    value: formatPwaLastUpdateCheck()
  });

  return diagnostics;
}

function createPwaStatusRowsHtml() {
  var diagnostics = getPwaDiagnostics();
  return diagnostics.map(function(item) {
    var attr = item.key ? " data-pwa-status='" + item.key + "'" : "";
    return "<div class='pwa-status-row'" + attr + "><span class='pwa-status-label'>" + item.label + "</span><span class='pwa-status-value'>" + item.value + "</span></div>";
  }).join("");
}

function showPwaToolsDialog() {
  if (typeof document === "undefined") {
    return;
  }
  if (!isRunningAsInstalledPwa()) {
    return;
  }
  if (document.getElementById(PWA_TOOLS_DIALOG_ID)) {
    return;
  }

  pwaToolsDialogLastFocus = document.activeElement || null;

  var overlay = document.createElement("div");
  overlay.id = PWA_TOOLS_DIALOG_ID;
  overlay.className = "sync-dialog-overlay";

  var dialog = document.createElement("div");
  dialog.className = "sync-dialog pwa-tools-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");

  var title = document.createElement("h2");
  title.id = "pwa-tools-title";
  title.textContent = t("advanced.pwa_tools");
  dialog.setAttribute("aria-labelledby", title.id);

  var description = document.createElement("p");
  description.className = "pwa-tools-description";
  description.textContent = t("advanced.pwa_tools_description");

  var statusPanel = document.createElement("div");
  statusPanel.className = "pwa-tools-status";
  statusPanel.innerHTML = "<h3>" + t("advanced.pwa_status_title") + "</h3><div id='pwa_tools_status_list' class='pwa-status-list'>" + createPwaStatusRowsHtml() + "</div>";

  var buttonRow = document.createElement("div");
  buttonRow.className = "button-row";

  var updateButton = document.createElement("button");
  updateButton.id = "check_updates_button";
  updateButton.type = "button";
  updateButton.textContent = t("advanced.check_updates");
  updateButton.className = "secondary";
  updateButton.addEventListener("click", function() {
    checkForUpdates();
    refreshPwaStatusPanel();
  });

  var reloadButton = document.createElement("button");
  reloadButton.id = "reload_app_button";
  reloadButton.type = "button";
  reloadButton.textContent = t("advanced.reload_app");
  reloadButton.className = "secondary";
  reloadButton.addEventListener("click", reloadAppForUpdate);

  var clearButton = document.createElement("button");
  clearButton.id = "clear_cache_button";
  clearButton.type = "button";
  clearButton.textContent = t("advanced.clear_cache");
  clearButton.className = "danger";
  clearButton.addEventListener("click", function() {
    clearCacheAndRestart();
  });

  var refreshButton = document.createElement("button");
  refreshButton.type = "button";
  refreshButton.className = "secondary";
  refreshButton.textContent = t("advanced.pwa_refresh_status");
  refreshButton.addEventListener("click", refreshPwaStatusPanel);

  var closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "primary";
  closeButton.textContent = t("advanced.close_button");
  closeButton.addEventListener("click", closePwaToolsDialog);

  buttonRow.appendChild(updateButton);
  buttonRow.appendChild(reloadButton);
  buttonRow.appendChild(clearButton);
  buttonRow.appendChild(refreshButton);
  buttonRow.appendChild(closeButton);

  dialog.appendChild(title);
  dialog.appendChild(description);
  dialog.appendChild(statusPanel);
  dialog.appendChild(buttonRow);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  closeButton.focus();

  pwaToolsDialogKeyHandler = function(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closePwaToolsDialog();
    }
  };
  document.addEventListener("keydown", pwaToolsDialogKeyHandler);
}

function refreshPwaStatusPanel() {
  if (typeof document === "undefined") {
    return;
  }
  var statusList = document.getElementById("pwa_tools_status_list");
  if (!statusList) {
    return;
  }
  statusList.innerHTML = createPwaStatusRowsHtml();
}

function closePwaToolsDialog() {
  if (typeof document === "undefined") {
    return;
  }
  var overlay = document.getElementById(PWA_TOOLS_DIALOG_ID);
  if (!overlay) {
    return;
  }
  overlay.remove();

  if (pwaToolsDialogKeyHandler) {
    document.removeEventListener("keydown", pwaToolsDialogKeyHandler);
    pwaToolsDialogKeyHandler = null;
  }

  if (pwaToolsDialogLastFocus && typeof pwaToolsDialogLastFocus.focus === "function") {
    pwaToolsDialogLastFocus.focus();
  }
  pwaToolsDialogLastFocus = null;
}

function requestServiceWorkerActivation(registration, allowImmediateReload) {
  if (!registration || !registration.waiting) {
    return;
  }
  window.__pbeAllowImmediateSwReload = !!allowImmediateReload;
  registration.waiting.postMessage({ type: "SKIP_WAITING" });
}

function reloadAppForUpdate() {
  if (typeof window === "undefined") {
    return;
  }

  if (typeof navigator !== "undefined" && navigator.serviceWorker && typeof navigator.serviceWorker.getRegistration === "function") {
    navigator.serviceWorker.getRegistration().then(function(registration) {
      requestServiceWorkerActivation(registration, true);
      setTimeout(function() {
        window.location.reload();
      }, 200);
    }).catch(function() {
      window.location.reload();
    });
    return;
  }

  window.location.reload();
}

/**
 * Check for updates by comparing service worker versions
 * Shows toast notification with update status
 */
function checkForUpdates() {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) {
    showUpdateNotification(t("advanced.no_update_available"), "info");
    return;
  }

  var statusElement = document.getElementById("check_updates_button");
  if (statusElement) {
    statusElement.textContent = t("advanced.checking_updates");
    statusElement.disabled = true;
  }

  navigator.serviceWorker.getRegistration()
    .then(function(registration) {
      if (!registration) {
        showUpdateNotification(t("advanced.no_update_available"), "info");
        resetUpdateButton();
        return;
      }

      // Force check for updates
      registration.update().then(function() {
        setPwaLastUpdateCheckNow();
        if (registration.waiting) {
          // Update is waiting to be activated
          showUpdateNotification(t("advanced.update_available"), "warning", {
            actionLabel: t("advanced.reload_now"),
            onAction: reloadAppForUpdate,
          });
        } else if (registration.installing) {
          // Update is being downloaded
          showUpdateNotification(t("advanced.checking_updates"), "info");
        } else {
          // Already on latest version
          showUpdateNotification(t("advanced.no_update_available"), "success");
        }
        resetUpdateButton();
      }).catch(function(error) {
        console.warn("Error checking for updates:", error);
        showUpdateNotification(t("advanced.no_update_available"), "info");
        resetUpdateButton();
      });
    })
    .catch(function(error) {
      console.warn("Error getting service worker registration:", error);
      showUpdateNotification(t("advanced.no_update_available"), "info");
      resetUpdateButton();
    });
}

/**
 * Clear all app caches and restart the application
 */
function clearCacheAndRestart() {
  var confirmed = confirm(
    t("advanced.clear_cache") + "\n\n" + t("advanced.clear_cache_confirm")
  );
  if (!confirmed) {
    return Promise.resolve(false);
  }

  var statusElement = document.getElementById("clear_cache_button");
  if (statusElement) {
    statusElement.textContent = t("advanced.cache_cleared");
    statusElement.disabled = true;
  }

  // Delete only this app's service-worker caches.
  return caches.keys().then(function(cacheNames) {
    var appCacheNames = cacheNames.filter(function(cacheName) {
      return typeof cacheName === "string" && cacheName.indexOf(PWA_CACHE_PREFIX) === 0;
    });

    return Promise.all(
      appCacheNames.map(function(cacheName) {
        return caches.delete(cacheName);
      })
    );
  }).then(function() {
    showUpdateNotification(t("advanced.cache_cleared"), "success");
    // Wait a moment for notification to show, then reload
    setTimeout(function() {
      window.location.reload();
    }, 1000);
    return true;
  }).catch(function(error) {
    console.warn("Error clearing cache:", error);
    resetClearCacheButton();
    return false;
  });
}

/**
 * Reset the check updates button to normal state
 */
function resetUpdateButton() {
  var statusElement = document.getElementById("check_updates_button");
  if (statusElement) {
    statusElement.textContent = t("advanced.check_updates");
    statusElement.disabled = false;
  }
}

/**
 * Reset the clear cache button to normal state
 */
function resetClearCacheButton() {
  var statusElement = document.getElementById("clear_cache_button");
  if (statusElement) {
    statusElement.textContent = t("advanced.clear_cache");
    statusElement.disabled = false;
  }
}

/**
 * Show a toast notification with update status
 * @param {string} message - The message to display
 * @param {string} type - The type of notification: 'info', 'success', 'warning', 'error'
 * @param {object=} options - Optional action button configuration
 */
function showUpdateNotification(message, type, options) {
  if (typeof document === "undefined" || !document.body) {
    return;
  }

  options = options || {};
  type = type || "info";
  
  var notification = document.createElement("div");
  if (!notification) {
    return;
  }
  notification.className = "update-notification update-notification-" + type;
  if (typeof notification.setAttribute === "function") {
    notification.setAttribute("role", "status");
    notification.setAttribute("aria-live", "polite");
  }
  notification.style.cssText = "position: fixed; bottom: 20px; right: 20px; padding: 12px 20px; background-color: var(--bg-secondary, #f5f5f5); color: var(--text-primary, #333); border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); z-index: 10000; font-size: 14px; max-width: 300px; word-wrap: break-word;";
  notification.textContent = message;

  var canAppendChildren = typeof notification.appendChild === "function";

  if (canAppendChildren && options.actionLabel && typeof options.onAction === "function") {
    var messageElement = document.createElement("div");
    messageElement.textContent = message;
    notification.textContent = "";
    notification.appendChild(messageElement);

    var actionButton = document.createElement("button");
    actionButton.type = "button";
    actionButton.textContent = options.actionLabel;
    actionButton.style.cssText = "margin-top: 8px; padding: 6px 10px; border: 1px solid currentColor; border-radius: 4px; background: transparent; color: inherit; cursor: pointer;";
    actionButton.addEventListener("click", function() {
      options.onAction();
      if (typeof notification.remove === "function") {
        notification.remove();
      }
    });
    notification.appendChild(actionButton);
  }
  
  if (type === "success") {
    notification.style.borderLeft = "4px solid #4caf50";
  } else if (type === "warning") {
    notification.style.borderLeft = "4px solid #ff9800";
  } else if (type === "error") {
    notification.style.borderLeft = "4px solid #f44336";
  } else {
    notification.style.borderLeft = "4px solid #2196f3";
  }
  
  document.body.appendChild(notification);
  
  setTimeout(function() {
    notification.style.opacity = "0";
    notification.style.transition = "opacity 0.3s ease-out";
    setTimeout(function() {
      notification.remove();
    }, 300);
  }, 4000);
}

function should_reload_after_service_worker_update() {
  if (window.__pbeAllowImmediateSwReload) {
    return true;
  }

  // Avoid reloading while changes are still waiting to be uploaded to the cloud folder.
  if (typeof FolderSync !== "undefined" && FolderSync.getStatus && FolderSync.getStatus().pending) {
    return false;
  }

  // Allow silent reload when app is in the background.
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return true;
  }

  return false;
}

function handle_deferred_service_worker_update() {
  if (pwaDeferredReloadNotified) {
    return;
  }
  pwaDeferredReloadNotified = true;
  showUpdateNotification(t("advanced.update_ready_deferred"), "info");
}

/**
 * Register for periodic background sync
 * Checks for updates every 24 hours when the app is installed as a PWA
 * This runs in the background without user interaction
 */
function registerPeriodicBackgroundSync() {
  if (typeof navigator === "undefined" || !navigator.serviceWorker || !navigator.serviceWorker.ready) {
    return;
  }

  navigator.serviceWorker.ready.then(function(registration) {
    if (!registration.periodicSync) {
      // Periodic Background Sync not supported
      return;
    }

    // Register 24-hour periodic sync
    registration.periodicSync.register("check-app-updates", {
      minInterval: 24 * 60 * 60 * 1000  // 24 hours
    }).catch(function(error) {
      console.log("Periodic sync registration failed:", error);
    });
  }).catch(function(error) {
    console.log("Service worker ready failed:", error);
  });
}

// Initialize periodic background sync on app load
if (typeof window !== "undefined" && document.readyState === "complete") {
  initializeInstallPromptHandling();
  initializePwaToolsVisibility();
  registerPeriodicBackgroundSync();
} else if (typeof window !== "undefined") {
  window.addEventListener("load", function() {
    initializeInstallPromptHandling();
    initializePwaToolsVisibility();
    registerPeriodicBackgroundSync();
  });
}

if (typeof window !== "undefined" && window.matchMedia) {
  try {
    var displayModeMatcher = window.matchMedia("(display-mode: standalone)");
    if (displayModeMatcher && typeof displayModeMatcher.addEventListener === "function") {
      displayModeMatcher.addEventListener("change", initializePwaToolsVisibility);
    }
  } catch (e) {
    // Ignore display mode listener setup errors
  }
}
