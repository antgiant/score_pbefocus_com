const APP_VERSION = "2.29.3";
const CACHE_PREFIX = "pbe-score-keeper";
const SHELL_CACHE_NAME = `${CACHE_PREFIX}-shell-${APP_VERSION}`;
const STATIC_RUNTIME_CACHE_NAME = `${CACHE_PREFIX}-static-${APP_VERSION}`;
const IMAGE_RUNTIME_CACHE_NAME = `${CACHE_PREFIX}-images-${APP_VERSION}`;
const DYNAMIC_RUNTIME_CACHE_NAME = `${CACHE_PREFIX}-dynamic-${APP_VERSION}`;
const NAVIGATION_RUNTIME_CACHE_NAME = `${CACHE_PREFIX}-navigation-${APP_VERSION}`;
const SHARE_RUNTIME_CACHE_NAME = `${CACHE_PREFIX}-share-target`;
const SHARE_IMPORT_CACHE_KEY = "./__share-target-import__";

const PRECACHE_REQUIRED_URLS = [
  "./",
  "index.html",
  "site.webmanifest",
  "css/jquery-ui.min.css",
  "css/styles.css",
  "scripts/jquery-3.7.1.min.js",
  "scripts/jquery-ui.min.js",
  "scripts/yjs-bundle.min.js",
  "scripts/app-globals.js",
  "scripts/app-yjs.js",
  "scripts/app-i18n.js",
  "scripts/app-theme.js",
  "scripts/app-ui-mode.js",
  "scripts/app-header-menu.js",
  "scripts/app-ui-utils.js",
  "scripts/app-session-matching.js",
  "scripts/app-state.js",
  "scripts/app-data.js",
  "scripts/app-summaries.js",
  "scripts/app-display.js",
  "scripts/app-storage.js",
  "scripts/app-pwa-handlers.js",
  "scripts/app-embedding-api.js",
  "scripts/app-embedding-commands.js",
  "scripts/app-embedding-events.js",
  "scripts/app.js",
  "scripts/i18n/en.js",
  "scripts/i18n/es.js",
  "scripts/i18n/fr.js",
  "scripts/i18n/pig.js",
  "apple-touch-icon.png",
  "android-chrome-192x192.png",
  "android-chrome-512x512.png",
  "favicon-16x16.png",
  "favicon-32x32.png"
];

const PRECACHE_OPTIONAL_URLS = [
  "scripts/app-embedding-client.js",
  "scripts/app-embedding-client.d.ts",
  "scripts/app-reorder.js",
  "scripts/app-snapshot.js",
  "scripts/app-import-export.js",
  "scripts/app-backup.js",
  "scripts/app-history.js",
  "scripts/app-block-manager.js",
  "scripts/app-team-manager.js",
  "scripts/app-sync-config.js",
  "scripts/app-folder-sync-engine.js",
  "scripts/app-folder-providers.js",
  "scripts/app-folder-auth.js",
  "scripts/app-folder-sync.js",
  "scripts/app-folder-sync-ui.js",
  "images/ui-icons_444444_256x240.png",
  "images/ui-icons_555555_256x240.png",
  "images/ui-icons_777620_256x240.png",
  "images/ui-icons_777777_256x240.png",
  "images/ui-icons_cc0000_256x240.png",
  "images/ui-icons_ffffff_256x240.png",
  "images/main_screen_screenshot.jpg",
  "images/score_screenshot.jpg"
];

const CACHE_POLICIES = {
  static: {
    maxEntries: 120,
    maxAgeMs: 30 * 24 * 60 * 60 * 1000
  },
  images: {
    maxEntries: 100,
    maxAgeMs: 14 * 24 * 60 * 60 * 1000
  },
  dynamic: {
    maxEntries: 80,
    maxAgeMs: 24 * 60 * 60 * 1000
  },
  navigation: {
    maxEntries: 30,
    maxAgeMs: 24 * 60 * 60 * 1000
  }
};

const NAVIGATION_TIMEOUT_MS = 4000;

self.addEventListener("install", function(event) {
  event.waitUntil(
    caches.open(SHELL_CACHE_NAME).then(function(cache) {
      return precacheUrls(cache, PRECACHE_REQUIRED_URLS, true).then(function() {
        return precacheUrls(cache, PRECACHE_OPTIONAL_URLS, false);
      });
    })
  );
});

self.addEventListener("activate", function(event) {
  event.waitUntil(
    Promise.all([
      cleanupOldCaches(),
      enableNavigationPreload()
    ]).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener("message", function(event) {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("periodicsync", function(event) {
  if (event.tag === "check-app-updates") {
    event.waitUntil(
      fetch("./", { method: "HEAD" })
        .then(function(response) {
          // Periodic sync completed - updates will be checked on next page load
          console.log("Periodic sync: App update check completed");
        })
        .catch(function(error) {
          console.log("Periodic sync: Failed to check for updates:", error);
        })
    );
  }
});

function isSameOrigin(requestUrl) {
  return requestUrl.origin === self.location.origin;
}

function isNavigationRequest(request) {
  return request.mode === "navigate" || (request.method === "GET" && request.headers.get("accept") && request.headers.get("accept").includes("text/html"));
}

function isCacheableResponse(response) {
  return !!(response && response.ok && (response.type === "basic" || response.type === "default"));
}

function getRequestCategory(request) {
  if (isNavigationRequest(request)) {
    return "navigation";
  }

  if (request.destination === "script" || request.destination === "style" || request.destination === "font") {
    return "static";
  }

  if (request.destination === "image") {
    return "images";
  }

  return "dynamic";
}

function getResponseAgeMs(response) {
  if (!response || !response.headers) {
    return 0;
  }

  var dateHeader = response.headers.get("date");
  if (!dateHeader) {
    return 0;
  }

  var responseTimestamp = Date.parse(dateHeader);
  if (Number.isNaN(responseTimestamp)) {
    return 0;
  }

  return Date.now() - responseTimestamp;
}

function isResponseExpired(response, maxAgeMs) {
  if (!maxAgeMs || !response) {
    return false;
  }

  return getResponseAgeMs(response) > maxAgeMs;
}

function precacheUrls(cache, urls, isRequired) {
  return Promise.allSettled(
    urls.map(function(url) {
      // Bypass the browser HTTP cache so a new version never precaches stale copies of its own files.
      return cache.add(new Request(url, { cache: "reload" }));
    })
  ).then(function(results) {
    if (!isRequired) {
      return;
    }

    var failedRequired = results.filter(function(result) {
      return result.status === "rejected";
    });

    if (failedRequired.length > 0) {
      throw new Error("Failed to precache required URLs");
    }
  });
}

function cleanupOldCaches() {
  var activeCaches = [
    SHELL_CACHE_NAME,
    STATIC_RUNTIME_CACHE_NAME,
    IMAGE_RUNTIME_CACHE_NAME,
    DYNAMIC_RUNTIME_CACHE_NAME,
    NAVIGATION_RUNTIME_CACHE_NAME,
    SHARE_RUNTIME_CACHE_NAME
  ];

  return caches.keys().then(function(cacheNames) {
    return Promise.all(
      cacheNames.map(function(cacheName) {
        if (cacheName.indexOf(CACHE_PREFIX) === 0 && activeCaches.indexOf(cacheName) === -1) {
          return caches.delete(cacheName);
        }
        return Promise.resolve();
      })
    );
  });
}

function enableNavigationPreload() {
  if (!self.registration || !self.registration.navigationPreload) {
    return Promise.resolve();
  }

  return self.registration.navigationPreload.enable().catch(function() {
    return Promise.resolve();
  });
}

function trimCacheByCount(cacheName, maxEntries) {
  if (!maxEntries || maxEntries < 1) {
    return Promise.resolve();
  }

  return caches.open(cacheName).then(function(cache) {
    return cache.keys().then(function(keys) {
      if (keys.length <= maxEntries) {
        return;
      }

      var keysToDelete = keys.slice(0, keys.length - maxEntries);
      return Promise.all(
        keysToDelete.map(function(request) {
          return cache.delete(request);
        })
      ).then(function() {
        return trimCacheByCount(cacheName, maxEntries);
      });
    });
  });
}

function pruneExpiredEntries(cacheName, maxAgeMs) {
  if (!maxAgeMs || maxAgeMs < 1) {
    return Promise.resolve();
  }

  return caches.open(cacheName).then(function(cache) {
    return cache.keys().then(function(keys) {
      return Promise.all(
        keys.map(function(request) {
          return cache.match(request).then(function(response) {
            if (isResponseExpired(response, maxAgeMs)) {
              return cache.delete(request);
            }
            return Promise.resolve();
          });
        })
      );
    });
  });
}

function enforceCachePolicy(cacheName, policy) {
  return pruneExpiredEntries(cacheName, policy.maxAgeMs).then(function() {
    return trimCacheByCount(cacheName, policy.maxEntries);
  });
}

function putInRuntimeCache(cacheName, request, response, policy) {
  return caches.open(cacheName).then(function(cache) {
    return cache.put(request, response.clone());
  }).then(function() {
    return enforceCachePolicy(cacheName, policy);
  });
}

function fetchWithTimeout(request, timeoutMs) {
  if (!timeoutMs || timeoutMs < 1) {
    return fetch(request);
  }

  return new Promise(function(resolve, reject) {
    var settled = false;
    var timeoutId = setTimeout(function() {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error("Network timeout"));
    }, timeoutMs);

    fetch(request).then(function(response) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      resolve(response);
    }).catch(function(error) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      reject(error);
    });
  });
}

function isShareTargetPostRequest(request, requestUrl) {
  if (request.method !== "POST") {
    return false;
  }

  var contentType = request.headers.get("content-type") || "";
  if (contentType.indexOf("multipart/form-data") === -1) {
    return false;
  }

  // Match root, ./, and index navigation endpoints.
  var pathname = requestUrl.pathname;
  if (pathname === self.location.pathname || pathname === "/" || pathname.endsWith("/index.html")) {
    return true;
  }

  return false;
}

function isShareImportReadRequest(requestUrl) {
  return requestUrl.pathname.endsWith("/__share-target-import__") || requestUrl.pathname === "/__share-target-import__";
}

function buildShareRedirectUrl(query) {
  var baseHref = (self.location && self.location.href)
    ? self.location.href
    : (self.location.origin + (self.location.pathname || "/"));
  return new URL(query, baseHref).toString();
}

function handleShareTargetPost(request) {
  return request.formData().then(function(formData) {
    var sharedFile = formData.get("session");
    if (!sharedFile) {
      return Response.redirect(buildShareRedirectUrl("./?share-target=empty"), 303);
    }

    var fileName = sharedFile.name || "shared-session.yjs";
    var responseHeaders = new Headers();
    responseHeaders.set("content-type", sharedFile.type || "application/octet-stream");
    responseHeaders.set("x-shared-filename", encodeURIComponent(fileName));

    return caches.open(SHARE_RUNTIME_CACHE_NAME).then(function(cache) {
      return cache.put(
        SHARE_IMPORT_CACHE_KEY,
        new Response(sharedFile, { headers: responseHeaders })
      );
    }).then(function() {
      return Response.redirect(buildShareRedirectUrl("./?share-target=1"), 303);
    });
  }).catch(function() {
    return Response.redirect(buildShareRedirectUrl("./?share-target=error"), 303);
  });
}

function consumeShareTargetImportPayload() {
  return caches.open(SHARE_RUNTIME_CACHE_NAME).then(function(cache) {
    return cache.match(SHARE_IMPORT_CACHE_KEY).then(function(response) {
      if (!response) {
        return Response.error();
      }

      return cache.delete(SHARE_IMPORT_CACHE_KEY).then(function() {
        return response;
      });
    });
  });
}

function cacheFirst(request, cacheName, policy, event) {
  return caches.match(request).then(function(cachedResponse) {
    if (cachedResponse && !isResponseExpired(cachedResponse, policy.maxAgeMs)) {
      return cachedResponse;
    }

    return fetch(request).then(function(networkResponse) {
      if (isCacheableResponse(networkResponse)) {
        event.waitUntil(putInRuntimeCache(cacheName, request, networkResponse, policy));
      }
      return networkResponse;
    }).catch(function() {
      if (cachedResponse) {
        return cachedResponse;
      }
      return Response.error();
    });
  });
}

function staleWhileRevalidate(request, cacheName, policy, event) {
  return caches.match(request).then(function(cachedResponse) {
    // Revalidate with the server (conditional request) instead of trusting the HTTP cache.
    var networkPromise = fetch(request, { cache: "no-cache" }).then(function(networkResponse) {
      if (isCacheableResponse(networkResponse)) {
        event.waitUntil(putInRuntimeCache(cacheName, request, networkResponse, policy));
      }
      return networkResponse;
    });

    if (cachedResponse && !isResponseExpired(cachedResponse, policy.maxAgeMs)) {
      event.waitUntil(networkPromise.catch(function() {
        return Promise.resolve();
      }));
      return cachedResponse;
    }

    return networkPromise.catch(function() {
      return cachedResponse || Response.error();
    });
  });
}

function networkFirst(request, options, event) {
  var fallbackUrl = options.fallbackUrl || null;
  var preloadResponsePromise = options.useNavigationPreload && event.preloadResponse
    ? event.preloadResponse
    : Promise.resolve(null);

  return preloadResponsePromise.then(function(preloadResponse) {
    if (isCacheableResponse(preloadResponse)) {
      event.waitUntil(putInRuntimeCache(options.cacheName, request, preloadResponse, options.policy));
      return preloadResponse;
    }

    return fetchWithTimeout(request, options.timeoutMs).then(function(networkResponse) {
      if (isCacheableResponse(networkResponse)) {
        event.waitUntil(putInRuntimeCache(options.cacheName, request, networkResponse, options.policy));
      }
      return networkResponse;
    });
  }).catch(function() {
    return caches.match(request).then(function(cachedResponse) {
      if (cachedResponse) {
        return cachedResponse;
      }

      if (!fallbackUrl) {
        return Response.error();
      }

      return caches.match(fallbackUrl).then(function(fallbackResponse) {
        return fallbackResponse || Response.error();
      });
    });
  });
}

self.addEventListener("fetch", function(event) {
  var requestUrl = new URL(event.request.url);

  if (!isSameOrigin(requestUrl)) {
    return;
  }

  if (isShareImportReadRequest(requestUrl) && event.request.method === "GET") {
    event.respondWith(consumeShareTargetImportPayload());
    return;
  }

  if (isShareTargetPostRequest(event.request, requestUrl)) {
    event.respondWith(handleShareTargetPost(event.request));
    return;
  }

  if (event.request.method !== "GET") {
    return;
  }

  var category = getRequestCategory(event.request);

  if (category === "navigation") {
    // Serve the page from this version's precached shell so the HTML always matches the
    // scripts and translations this service worker serves. A newer page is picked up when
    // the new service worker activates (see the update notification), never half-way.
    event.respondWith(
      caches.open(SHELL_CACHE_NAME).then(function(shellCache) {
        return shellCache.match("index.html", { ignoreSearch: true });
      }).then(function(shellResponse) {
        if (shellResponse) {
          return shellResponse;
        }
        return networkFirst(
          event.request,
          {
            cacheName: NAVIGATION_RUNTIME_CACHE_NAME,
            policy: CACHE_POLICIES.navigation,
            fallbackUrl: "index.html",
            timeoutMs: NAVIGATION_TIMEOUT_MS,
            useNavigationPreload: true
          },
          event
        );
      })
    );
    return;
  }

  if (category === "static") {
    event.respondWith(
      staleWhileRevalidate(
        event.request,
        STATIC_RUNTIME_CACHE_NAME,
        CACHE_POLICIES.static,
        event
      )
    );
    return;
  }

  if (category === "images") {
    event.respondWith(
      cacheFirst(
        event.request,
        IMAGE_RUNTIME_CACHE_NAME,
        CACHE_POLICIES.images,
        event
      )
    );
    return;
  }

  event.respondWith(
    networkFirst(
      event.request,
      {
        cacheName: DYNAMIC_RUNTIME_CACHE_NAME,
        policy: CACHE_POLICIES.dynamic,
        timeoutMs: 3000,
        useNavigationPreload: false
      },
      event
    )
  );
});
