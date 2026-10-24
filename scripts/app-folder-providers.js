/**
 * Cloud folder backends for the folder sync engine (REST layer only).
 *
 * Each backend exposes { list(), get(name), put(name, bytes) } as the engine
 * expects. Sign-in and folder pickers live in app-folder-auth.js; these
 * functions only need a fetch implementation and a getToken() promise, so they
 * can be tested without a browser or credentials.
 *
 * Errors are normalised for the engine and status indicator:
 *   { offline: true }                 network unreachable
 *   { code: "auth", status: 401 }     sign-in expired
 *   { status, retryAfter }            throttled / server error (seconds)
 */
var FolderProviders = (function () {
  var GOOGLE_API = "https://www.googleapis.com/drive/v3";
  var GOOGLE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
  var GRAPH_API = "https://graph.microsoft.com/v1.0";
  var GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder";
  var GRAPH_SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024;

  function httpError(response) {
    var retryAfter = parseInt(response.headers && response.headers.get && response.headers.get("Retry-After"), 10);
    var err = { status: response.status };
    if (response.status === 401) {
      err.code = "auth";
    }
    if (retryAfter > 0) {
      err.retryAfter = retryAfter;
    }
    return err;
  }

  /** fetch wrapper that maps failures to the error shapes above. */
  function request(fetchImpl, getToken, url, init) {
    return Promise.resolve(getToken()).then(function (token) {
      var options = Object.assign({}, init);
      options.headers = Object.assign({}, init && init.headers, { Authorization: "Bearer " + token });
      return fetchImpl(url, options).then(
        function (response) {
          if (!response.ok) {
            throw httpError(response);
          }
          return response;
        },
        function () {
          throw { offline: true };
        }
      );
    });
  }

  function toBytes(response) {
    return response.arrayBuffer().then(function (buf) {
      return new Uint8Array(buf);
    });
  }

  // ---------------------------------------------------------------- Google

  /**
   * @param {{fetch: Function, getToken: Function, folderId: string}} o
   */
  function createGoogleBackend(o) {
    var ids = {}; // file name -> id, filled by list()

    function req(url, init) {
      return request(o.fetch, o.getToken, url, init);
    }

    function listPage(pageToken, acc) {
      var q = "'" + o.folderId + "' in parents and trashed=false";
      var url = GOOGLE_API + "/files?q=" + encodeURIComponent(q) +
        "&fields=" + encodeURIComponent("nextPageToken,files(id,name,modifiedTime,size,md5Checksum)") +
        "&pageSize=1000" + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
      return req(url).then(function (r) { return r.json(); }).then(function (data) {
        (data.files || []).forEach(function (f) {
          // If duplicate names exist (race on first create) keep the first seen.
          if (!(f.name in ids)) {
            ids[f.name] = f.id;
            acc.push({ name: f.name, rev: f.md5Checksum || (f.modifiedTime + ":" + f.size) });
          }
        });
        return data.nextPageToken ? listPage(data.nextPageToken, acc) : acc;
      });
    }

    return {
      list: function () {
        ids = {};
        return listPage(null, []);
      },
      get: function (name) {
        if (!ids[name]) {
          return Promise.resolve(null);
        }
        return req(GOOGLE_API + "/files/" + ids[name] + "?alt=media").then(toBytes);
      },
      put: function (name, bytes) {
        if (ids[name]) {
          return req(GOOGLE_UPLOAD + "/files/" + ids[name] + "?uploadType=media", {
            method: "PATCH",
            headers: { "Content-Type": "application/octet-stream" },
            body: bytes
          });
        }
        var boundary = "pbe" + Math.random().toString(36).slice(2);
        var meta = JSON.stringify({ name: name, parents: [o.folderId] });
        var head = "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + meta +
          "\r\n--" + boundary + "\r\nContent-Type: application/octet-stream\r\n\r\n";
        var tail = "\r\n--" + boundary + "--";
        var enc = new TextEncoder();
        var h = enc.encode(head), t = enc.encode(tail);
        var body = new Uint8Array(h.length + bytes.length + t.length);
        body.set(h, 0); body.set(bytes, h.length); body.set(t, h.length + bytes.length);
        return req(GOOGLE_UPLOAD + "/files?uploadType=multipart&fields=id,name", {
          method: "POST",
          headers: { "Content-Type": "multipart/related; boundary=" + boundary },
          body: body
        }).then(function (r) { return r.json(); }).then(function (f) {
          ids[name] = f.id;
        });
      }
    };
  }

  /**
   * Find or create a nested folder path (e.g. ["PBE Focus","scorekeeper",id])
   * in the app's own Drive space. Returns the last folder's id.
   */
  function ensureGoogleFolderPath(o) {
    function step(parentId, index) {
      if (index >= o.path.length) {
        return Promise.resolve(parentId);
      }
      var name = o.path[index];
      var q = "name='" + name.replace(/'/g, "\\'") + "' and mimeType='" + GOOGLE_FOLDER_MIME +
        "' and '" + parentId + "' in parents and trashed=false";
      return request(o.fetch, o.getToken, GOOGLE_API + "/files?fields=files(id)&q=" + encodeURIComponent(q))
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.files && data.files.length) {
            return data.files[0].id;
          }
          return request(o.fetch, o.getToken, GOOGLE_API + "/files?fields=id", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: name, mimeType: GOOGLE_FOLDER_MIME, parents: [parentId] })
          }).then(function (r) { return r.json(); }).then(function (f) { return f.id; });
        })
        .then(function (id) { return step(id, index + 1); });
    }
    return step("root", 0);
  }

  // ----------------------------------------------------------------- Graph

  /**
   * Folder reference is one of:
   *   { driveId, itemId }   a picked or shared folder
   *   { appPath }           path under the app folder, e.g. "scorekeeper/<id>"
   */
  function graphBase(ref) {
    if (ref.appPath) {
      return GRAPH_API + "/me/drive/special/approot:/" + ref.appPath.split("/").map(encodeURIComponent).join("/");
    }
    if (ref.driveId) {
      return GRAPH_API + "/drives/" + ref.driveId + "/items/" + ref.itemId;
    }
    return GRAPH_API + "/me/drive/items/" + ref.itemId;
  }

  function createGraphBackend(o) {
    var base = graphBase(o.folder);
    var isPath = !!o.folder.appPath;
    var children = isPath ? base + ":/children" : base + "/children";
    var fileUrl = function (name) {
      return base + (isPath ? "" : ":") + "/" + encodeURIComponent(name) + ":/content";
    };

    function req(url, init) {
      return request(o.fetch, o.getToken, url, init);
    }

    function listPage(url, acc) {
      return req(url).then(function (r) { return r.json(); }).then(function (data) {
        (data.value || []).forEach(function (f) {
          if (!f.folder) {
            acc.push({ name: f.name, rev: f.eTag || (f.lastModifiedDateTime + ":" + f.size) });
          }
        });
        return data["@odata.nextLink"] ? listPage(data["@odata.nextLink"], acc) : acc;
      });
    }

    return {
      list: function () {
        var url = children + "?$select=name,eTag,size,lastModifiedDateTime,folder&$top=200";
        return listPage(url, []).catch(function (err) {
          // An app-folder path that has not been written to yet does not exist.
          if (err && err.status === 404 && isPath) { return []; }
          throw err;
        });
      },
      get: function (name) {
        return req(fileUrl(name)).then(toBytes).catch(function (err) {
          if (err && err.status === 404) { return null; }
          throw err;
        });
      },
      put: function (name, bytes) {
        if (bytes.length > GRAPH_SIMPLE_UPLOAD_LIMIT) {
          return Promise.reject({ status: 413, code: "too-large" });
        }
        return req(fileUrl(name), {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: bytes
        });
      }
    };
  }

  /** Graph /shares id for a sharing URL ("u!" + unpadded base64url). */
  function encodeShareUrl(url) {
    var b64 = typeof btoa === "function" ? btoa(unescape(encodeURIComponent(url))) : Buffer.from(url, "utf8").toString("base64");
    return "u!" + b64.replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
  }

  /** Resolve a pasted OneDrive share link to a folder reference. */
  function resolveGraphShareLink(o) {
    var url = GRAPH_API + "/shares/" + encodeShareUrl(o.url) + "/driveItem?$select=id,name,folder,parentReference";
    return request(o.fetch, o.getToken, url).then(function (r) { return r.json(); }).then(function (item) {
      if (!item.folder) {
        throw { code: "not-a-folder" };
      }
      return { driveId: item.parentReference && item.parentReference.driveId, itemId: item.id, name: item.name };
    });
  }

  // ---------------------------------------------------------------- Marker

  var MARKER_NAME = "pbe-session.json";

  function buildMarker(session) {
    return new TextEncoder().encode(JSON.stringify({
      kind: "session",
      formatVersion: 1,
      sessionId: session.sessionId,
      name: session.name
    }));
  }

  function parseMarker(bytes) {
    try {
      var m = JSON.parse(new TextDecoder().decode(bytes));
      return m && m.kind === "session" && m.sessionId ? m : null;
    } catch (e) {
      return null;
    }
  }

  return {
    createGoogleBackend: createGoogleBackend,
    ensureGoogleFolderPath: ensureGoogleFolderPath,
    createGraphBackend: createGraphBackend,
    resolveGraphShareLink: resolveGraphShareLink,
    encodeShareUrl: encodeShareUrl,
    buildMarker: buildMarker,
    parseMarker: parseMarker,
    MARKER_NAME: MARKER_NAME
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = FolderProviders;
}
