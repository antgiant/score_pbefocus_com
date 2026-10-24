// Initialize display only after state is ready
var stateInitialized = false;
var domReadyForDisplay = false;
var displayInitialized = false;
var deferredModulesInitialized = false;

var STARTUP_LANGUAGE_SCRIPTS = {
  en: "scripts/i18n/en.js",
  es: "scripts/i18n/es.js",
  fr: "scripts/i18n/fr.js",
  pig: "scripts/i18n/pig.js"
};

var DEFERRED_SCRIPT_PATHS = {
  reorder: "scripts/app-reorder.js",
  snapshot: "scripts/app-snapshot.js",
  importExport: "scripts/app-import-export.js",
  backup: "scripts/app-backup.js",
  history: "scripts/app-history.js",
  blockManager: "scripts/app-block-manager.js",
  teamManager: "scripts/app-team-manager.js",
  folderConfig: "scripts/app-sync-config.js",
  folderEngine: "scripts/app-folder-sync-engine.js",
  folderProviders: "scripts/app-folder-providers.js",
  folderAuth: "scripts/app-folder-auth.js",
  folderSync: "scripts/app-folder-sync.js",
  folderSyncUi: "scripts/app-folder-sync-ui.js"
};

var DEFERRED_FEATURE_GROUPS = {
  reorder: ["reorder"],
  snapshot: ["snapshot"],
  importExport: ["importExport"],
  backup: ["backup"],
  history: ["history"],
  blockManager: ["blockManager"],
  teamManager: ["teamManager"],
  folderSync: ["folderConfig", "folderEngine", "folderProviders", "folderAuth", "folderSync", "folderSyncUi"],
  all: ["reorder", "snapshot", "importExport", "backup", "history", "blockManager", "teamManager", "folderSync"]
};

var _scriptLoadPromises = {};
var _featureLoadPromises = {};
var _deferredLanguageLoaded = {};

function load_script_once(src) {
  if (_scriptLoadPromises[src]) {
    return _scriptLoadPromises[src];
  }

  _scriptLoadPromises[src] = new Promise(function(resolve, reject) {
    var script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = function() {
      resolve();
    };
    script.onerror = function() {
      reject(new Error("Failed to load script: " + src));
    };
    document.head.appendChild(script);
  });

  return _scriptLoadPromises[src];
}

function detect_boot_language_code() {
  var supportedCodes = Object.keys(STARTUP_LANGUAGE_SCRIPTS);
  var savedLanguage = null;
  try {
    savedLanguage = localStorage.getItem("language_preference");
  } catch (e) {
    savedLanguage = null;
  }

  if (savedLanguage && savedLanguage !== "auto") {
    return supportedCodes.indexOf(savedLanguage) !== -1 ? savedLanguage : "en";
  }

  var browserLangs = (typeof navigator !== "undefined" && navigator.languages && navigator.languages.length)
    ? navigator.languages
    : [typeof navigator !== "undefined" ? (navigator.language || navigator.userLanguage || "en") : "en"];

  for (var i = 0; i < browserLangs.length; i++) {
    var lang = browserLangs[i];
    if (!lang) {
      continue;
    }
    var normalized = String(lang).toLowerCase();
    if (supportedCodes.indexOf(normalized) !== -1) {
      return normalized;
    }
    var base = normalized.split("-")[0];
    if (supportedCodes.indexOf(base) !== -1) {
      return base;
    }
  }

  return "en";
}

function ensure_language_loaded(code) {
  var normalizedCode = STARTUP_LANGUAGE_SCRIPTS[code] ? code : "en";
  if (_deferredLanguageLoaded[normalizedCode]) {
    return Promise.resolve();
  }
  return load_script_once(STARTUP_LANGUAGE_SCRIPTS[normalizedCode]).then(function() {
    _deferredLanguageLoaded[normalizedCode] = true;
  });
}

function ensure_feature_loaded(featureName) {
  if (_featureLoadPromises[featureName]) {
    return _featureLoadPromises[featureName];
  }

  var scriptKeys = DEFERRED_FEATURE_GROUPS[featureName];
  if (!scriptKeys || scriptKeys.length === 0) {
    return Promise.resolve();
  }

  _featureLoadPromises[featureName] = scriptKeys.reduce(function(chain, scriptKey) {
    return chain.then(function() {
      var path = DEFERRED_SCRIPT_PATHS[scriptKey];
      if (!path) {
        return Promise.resolve();
      }
      return load_script_once(path);
    });
  }, Promise.resolve());

  return _featureLoadPromises[featureName];
}

function setup_lazy_feature_shim(globalFunctionName, featureName) {
  if (typeof window[globalFunctionName] === "function") {
    return;
  }

  var shim = function() {
    var args = Array.prototype.slice.call(arguments);
    return ensure_feature_loaded(featureName)
      .then(function() {
        var loadedFn = window[globalFunctionName];
        if (typeof loadedFn === "function" && loadedFn !== shim) {
          return loadedFn.apply(window, args);
        }
      })
      .catch(function(error) {
        console.error("Failed to lazy-load feature for", globalFunctionName, error);
      });
  };

  window[globalFunctionName] = shim;
}

function refresh_language_selector_after_lazy_load() {
  if (typeof populate_language_selector !== "function" || typeof update_language_selector !== "function") {
    return;
  }
  populate_language_selector();
  var savedLanguage = null;
  try {
    savedLanguage = localStorage.getItem("language_preference");
  } catch (e) {
    savedLanguage = null;
  }
  update_language_selector(savedLanguage || "auto");
}

function initialize_deferred_modules() {
  if (deferredModulesInitialized) {
    return;
  }
  deferredModulesInitialized = true;

  ensure_feature_loaded("all")
    .then(function() {
      if (typeof initialize_block_manager === "function") {
        initialize_block_manager();
      }
      if (typeof initialize_team_manager === "function") {
        initialize_team_manager();
      }
      if (typeof initialize_reorder_controls === "function") {
        initialize_reorder_controls();
      }
      if (typeof initialize_history_viewer === "function") {
        initialize_history_viewer();
      }
      if (typeof setup_file_import === "function") {
        setup_file_import();
      }
      if (typeof handleShareTargetImport === "function") {
        handleShareTargetImport();
      }

      // Upgrade other sessions (current session upgraded in critical path)
      if (typeof upgradeAllSessionsToV5 === "function") {
        upgradeAllSessionsToV5()
          .then(function(result) {
            console.log("Deferred session migrations complete:", result);
          })
          .catch(function(error) {
            console.error("Failed to upgrade other sessions:", error);
          });
      }

      // Repair session metadata after first paint so dropdown updates can lag safely
      if (typeof maintainSessionMetadata === "function") {
        maintainSessionMetadata()
          .then(function(result) {
            console.log("Deferred session metadata maintenance complete:", result);
          })
          .catch(function(error) {
            console.error("Failed to maintain session metadata:", error);
          });
      }
    })
    .catch(function(error) {
      console.error("Failed to initialize deferred modules", error);
    });

  var bootLanguage = detect_boot_language_code();
  Object.keys(STARTUP_LANGUAGE_SCRIPTS).forEach(function(code) {
    if (code === bootLanguage) {
      return;
    }
    ensure_language_loaded(code)
      .then(function() {
        refresh_language_selector_after_lazy_load();
      })
      .catch(function(error) {
        console.error("Failed to load deferred language", code, error);
      });
  });
}

function schedule_deferred_initialization() {
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(function() {
      initialize_deferred_modules();
    }, { timeout: 1000 });
    return;
  }
  setTimeout(function() {
    initialize_deferred_modules();
  }, 100);
}

function try_initialize_display() {
  if (displayInitialized || !domReadyForDisplay || !window.stateInitialized) {
    return;
  }
  displayInitialized = true;
  initialize_feedback_link();
  initialize_display();
  schedule_deferred_initialization();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function() {
      domReadyForDisplay = true;
      try_initialize_display();
    }, { once: true });
  } else {
    domReadyForDisplay = true;
  }
}

setup_lazy_feature_shim("showImportExportDialog", "importExport");
setup_lazy_feature_shim("showChangeLogDialog", "history");
setup_lazy_feature_shim("showStorageDialog", "folderSync");
setup_lazy_feature_shim("showBackupBrowserDialog", "backup");
setup_lazy_feature_shim("showBlockManagerDialog", "blockManager");
setup_lazy_feature_shim("showTeamManagerDialog", "teamManager");

function bootstrap_critical_startup() {
  var bootLanguage = detect_boot_language_code();
  ensure_language_loaded(bootLanguage)
    .then(function() {
      initialize_language_preference();
      if (typeof translate_page === "function") {
        translate_page();
      }
      initialize_theme_preference();
      initialize_ui_mode_preference();
      initialize_storage_persistence();
      initialize_header_menu();
      initializeApp();
    })
    .catch(function(error) {
      console.error("Failed to load boot language, falling back to English", error);
      ensure_language_loaded("en").finally(function() {
        initialize_language_preference();
        if (typeof translate_page === "function") {
          translate_page();
        }
        initialize_theme_preference();
        initialize_ui_mode_preference();
        initialize_storage_persistence();
        initialize_header_menu();
        initializeApp();
      });
    });
}

function initialize_pwa_handlers() {
  if (typeof PWAHandlers !== "undefined" && PWAHandlers && typeof PWAHandlers.init === "function") {
    PWAHandlers.init();
  }
}

function initialize_embedding_mode() {
  if (typeof EmbeddingAPI !== "undefined" && EmbeddingAPI && typeof EmbeddingAPI.shouldInitialize === "function" && EmbeddingAPI.shouldInitialize()) {
    EmbeddingAPI.applyEmbeddedMode();
  }
}

function initialize_embedding_api() {
  if (typeof EmbeddingCommands !== "undefined" && EmbeddingCommands && typeof EmbeddingCommands.init === "function") {
    EmbeddingCommands.init();
  }
  if (typeof EmbeddingEvents !== "undefined" && EmbeddingEvents && typeof EmbeddingEvents.init === "function") {
    EmbeddingEvents.init();
  }
  if (typeof EmbeddingAPI !== "undefined" && EmbeddingAPI && typeof EmbeddingAPI.init === "function") {
    EmbeddingAPI.init();
  }
}

// Folder sync scripts load lazily; start them at boot only if a session uses it.
function initialize_folder_sync() {
  var enabled = false;
  try {
    for (var i = 0; i < localStorage.length; i++) {
      if (localStorage.key(i).indexOf("pbe-folder-sync:") === 0) { enabled = true; break; }
    }
  } catch (e) {}
  if (!enabled) { return; }
  ensure_feature_loaded("folderSync").then(function() {
    if (typeof initFolderSyncFeature === "function") { initFolderSyncFeature(); }
  }).catch(function(error) {
    console.error("Failed to start folder sync", error);
  });
}

// Yjs bundle loads synchronously and sets window.yjsModulesLoaded
// But just to be safe, we'll check and wait if needed
function initializeApp() {
  initialize_embedding_mode();
  initialize_yjs();  // Initialize Yjs before state
  initialize_state().finally(function() {
    try_initialize_display();
    initialize_pwa_handlers();
    initialize_embedding_api();
    initialize_folder_sync();
  });
}

function register_service_worker() {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) {
    return;
  }

  var hasRefreshedForServiceWorker = false;
  navigator.serviceWorker.addEventListener("controllerchange", function() {
    if (hasRefreshedForServiceWorker) {
      return;
    }

    var shouldReload = true;
    if (typeof should_reload_after_service_worker_update === "function") {
      shouldReload = should_reload_after_service_worker_update();
    }
    if (!shouldReload) {
      if (typeof handle_deferred_service_worker_update === "function") {
        handle_deferred_service_worker_update();
      }
      return;
    }

    hasRefreshedForServiceWorker = true;
    window.location.reload();
  });

  navigator.serviceWorker.register("service-worker.js", { scope: "./" })
    .then(function(registration) {
      if (registration.waiting) {
        if (typeof showUpdateNotification === "function" && typeof t === "function") {
          showUpdateNotification(t("advanced.update_available"), "warning");
        }
      }

      registration.addEventListener("updatefound", function() {
        var installingWorker = registration.installing;
        if (!installingWorker) {
          return;
        }

        installingWorker.addEventListener("statechange", function() {
          if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
            console.log("Service worker update installed");
            if (registration.waiting && typeof showUpdateNotification === "function" && typeof t === "function") {
              showUpdateNotification(t("advanced.update_available"), "warning");
            }
          }
        });
      });
    })
    .catch(function(error) {
      console.warn("Service worker registration failed:", error);
    });
}

if (window.yjsModulesLoaded) {
  bootstrap_critical_startup();
} else {
  // Fallback: wait for event (shouldn't be needed with sync script)
  window.addEventListener('yjsModulesLoaded', bootstrap_critical_startup, { once: true });
}

if (typeof window !== "undefined") {
  if (document.readyState === "complete") {
    register_service_worker();
  } else {
    window.addEventListener("load", register_service_worker, { once: true });
  }
}

/**
 * Update the footer feedback link with the current app version.
 * Supports Google Form prefill when data-feedback-version-entry is configured.
 */
function initialize_feedback_link() {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }

  var feedbackLink = document.getElementById('footer_feedback_link');
  if (!feedbackLink) {
    return;
  }

  var baseUrl = feedbackLink.getAttribute('data-feedback-base-url') || feedbackLink.getAttribute('href');
  if (!baseUrl) {
    return;
  }

  var versionElement = document.querySelector('[data-i18n="footer.version"]');
  if (!versionElement) {
    return;
  }

  var version = versionElement.getAttribute('data-i18n-version');
  if (!version) {
    return;
  }

  var url;
  try {
    url = new URL(baseUrl, window.location.href);
  } catch (error) {
    return;
  }

  var versionEntryField = feedbackLink.getAttribute('data-feedback-version-entry');
  if (versionEntryField) {
    url.searchParams.set(versionEntryField, version);
    url.searchParams.set('usp', 'pp_url');
  } else {
    url.searchParams.set('app_version', version);
  }

  feedbackLink.setAttribute('href', url.toString());
}
