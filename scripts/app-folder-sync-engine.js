/**
 * Folder sync engine (provider independent).
 *
 * Every device writes only its own files into a shared folder:
 *   c-{clientId}.yjs         merged updates that originated on that device
 *   snapshot-{clientId}.yjs  occasional full state, used by new joiners
 * Yjs merges updates in any order, so no locks or ordering are needed.
 * File revisions (modified time / size / ETag) are only used to decide
 * whether a file needs downloading again, never to order updates.
 *
 * Dependencies are injected so the engine runs in the browser and in tests:
 *   Y        Yjs namespace
 *   doc      Y.Doc of one session
 *   backend  { list(): [{name, rev}], get(name): Uint8Array|null, put(name, bytes) }
 *   store    { get(key), set(key, value) } (sync or async) for outbox + revision table
 */
var FolderSyncEngine = (function () {
  var REMOTE_ORIGIN = "remote-folder";
  var OUTBOX_PREFIX = "c-";
  var SNAPSHOT_PREFIX = "snapshot-";
  var FILE_SUFFIX = ".yjs";

  var FAST_INTERVAL_MS = 15000;
  var IDLE_INTERVAL_MS = 60000;
  var MAX_BACKOFF_MS = 30000;

  function outboxName(clientId) {
    return OUTBOX_PREFIX + clientId + FILE_SUFFIX;
  }

  function snapshotName(clientId) {
    return SNAPSHOT_PREFIX + clientId + FILE_SUFFIX;
  }

  /**
   * Parse a folder file name.
   * @returns {{kind: string, clientId: string}|null}
   */
  function parseFileName(name) {
    if (typeof name !== "string" || name.slice(-FILE_SUFFIX.length) !== FILE_SUFFIX) {
      return null;
    }
    var base = name.slice(0, -FILE_SUFFIX.length);
    if (base.indexOf(SNAPSHOT_PREFIX) === 0 && base.length > SNAPSHOT_PREFIX.length) {
      return { kind: "snapshot", clientId: base.slice(SNAPSHOT_PREFIX.length) };
    }
    if (base.indexOf(OUTBOX_PREFIX) === 0 && base.length > OUTBOX_PREFIX.length) {
      return { kind: "outbox", clientId: base.slice(OUTBOX_PREFIX.length) };
    }
    return null;
  }

  /**
   * Delay before the next attempt after consecutive failures. Honors a
   * server supplied Retry-After (seconds) when it is longer.
   */
  function backoffDelay(failures, retryAfterSeconds) {
    var delay = Math.min(MAX_BACKOFF_MS, 1000 * Math.pow(2, Math.max(0, failures - 1)));
    if (retryAfterSeconds > 0) {
      delay = Math.max(delay, retryAfterSeconds * 1000);
    }
    return delay;
  }

  /** Polling interval: fast while scoring, slow when idle, none when hidden. */
  function pollInterval(opts) {
    if (opts && opts.hidden) {
      return null;
    }
    return opts && opts.active ? FAST_INTERVAL_MS : IDLE_INTERVAL_MS;
  }

  function isErrorOffline(err) {
    return !!(err && (err.offline || err.code === "offline"));
  }

  function create(options) {
    var Y = options.Y;
    var doc = options.doc;
    var backend = options.backend;
    var store = options.store;
    var clientId = options.clientId;
    var now = options.now || Date.now;

    var started = false;
    var syncing = null;
    var failures = 0;
    var lastError = null;
    var lastSync = null;
    var dirty = false;
    var outbox = null; // merged Uint8Array of locally originated updates
    var known = {}; // file name -> last applied revision
    var knownLoaded = false;

    function onUpdate(update, origin) {
      if (origin === REMOTE_ORIGIN) {
        return;
      }
      outbox = outbox ? Y.mergeUpdates([outbox, update]) : update;
      dirty = true;
      persist();
    }

    function persist() {
      return Promise.resolve(store.set("outbox", outbox)).then(function () {
        return store.set("dirty", dirty);
      });
    }

    function persistKnown() {
      return Promise.resolve(store.set("known", known));
    }

    /**
     * Load persisted state and attach the doc listener. On first enable the
     * outbox is seeded with the full session state so the folder receives
     * everything that already exists locally.
     */
    function start() {
      if (started) {
        return Promise.resolve();
      }
      started = true;
      return Promise.all([store.get("outbox"), store.get("dirty"), store.get("known")]).then(function (v) {
        outbox = v[0] || null;
        dirty = !!v[1];
        known = v[2] || {};
        knownLoaded = true;
        if (!outbox) {
          outbox = Y.encodeStateAsUpdate(doc);
          dirty = true;
        }
        doc.on("update", onUpdate);
        return persist();
      });
    }

    function stop() {
      if (!started) {
        return;
      }
      started = false;
      doc.off("update", onUpdate);
    }

    /** Upload this device's outbox if it changed. */
    function flush() {
      if (!dirty || !outbox) {
        return Promise.resolve(false);
      }
      var bytes = outbox;
      return Promise.resolve(backend.put(outboxName(clientId), bytes)).then(function () {
        // New local updates may have landed while uploading; stay dirty then.
        if (bytes === outbox) {
          dirty = false;
        }
        return persist().then(function () {
          return true;
        });
      });
    }

    /** List the folder and apply every changed file from other devices. */
    function pull() {
      return Promise.resolve(backend.list()).then(function (entries) {
        var applied = 0;
        var chain = Promise.resolve();
        var firstError = null;
        entries.forEach(function (entry) {
          var parsed = parseFileName(entry.name);
          if (!parsed || parsed.clientId === clientId) {
            return;
          }
          if (known[entry.name] === entry.rev) {
            return;
          }
          chain = chain.then(function () {
            return Promise.resolve(backend.get(entry.name)).then(function (bytes) {
              if (!bytes) {
                return;
              }
              try {
                Y.applyUpdate(doc, bytes, REMOTE_ORIGIN);
              } catch (e) {
                // A corrupt file must not block the others; remember the revision
                // so it is not retried until it changes.
                known[entry.name] = entry.rev;
                return;
              }
              known[entry.name] = entry.rev;
              applied++;
            }).catch(function (err) {
              // Keep going; the revision stays unknown so it is retried next cycle.
              if (!firstError) {
                firstError = err;
              }
            });
          });
        });
        return chain.then(function () {
          return persistKnown().then(function () {
            if (firstError) {
              throw firstError;
            }
            return applied;
          });
        });
      });
    }

    /** Write a full-state snapshot (never deletes other devices' files). */
    function writeSnapshot() {
      return Promise.resolve(backend.put(snapshotName(clientId), Y.encodeStateAsUpdate(doc)));
    }

    /** One flush + pull cycle. Concurrent calls share the same cycle. */
    function sync() {
      if (syncing) {
        return syncing;
      }
      syncing = start()
        .then(flush)
        .then(pull)
        .then(function (applied) {
          failures = 0;
          lastError = null;
          lastSync = now();
          return { ok: true, applied: applied };
        })
        .catch(function (err) {
          failures++;
          lastError = err;
          return {
            ok: false,
            error: err,
            offline: isErrorOffline(err),
            retryInMs: backoffDelay(failures, err && err.retryAfter)
          };
        })
        .then(function (result) {
          syncing = null;
          return result;
        });
      return syncing;
    }

    /** Status for the indicator: synced / pending / offline / auth / error. */
    function getStatus() {
      var state = "synced";
      if (lastError) {
        if (isErrorOffline(lastError)) {
          state = "offline";
        } else if (lastError.code === "auth" || lastError.status === 401) {
          state = "auth";
        } else {
          state = "error";
        }
      } else if (dirty) {
        state = "pending";
      }
      return { state: state, pending: dirty, lastSync: lastSync, failures: failures };
    }

    return {
      start: start,
      stop: stop,
      flush: flush,
      pull: pull,
      sync: sync,
      writeSnapshot: writeSnapshot,
      getStatus: getStatus,
      clientId: clientId
    };
  }

  return {
    create: create,
    parseFileName: parseFileName,
    outboxName: outboxName,
    snapshotName: snapshotName,
    backoffDelay: backoffDelay,
    pollInterval: pollInterval,
    REMOTE_ORIGIN: REMOTE_ORIGIN
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = FolderSyncEngine;
}
