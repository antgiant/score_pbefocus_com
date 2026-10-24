/**
 * In-memory shared folder for folder sync tests. Each client gets its own
 * view so failures (offline, dropped writes, delays) can be injected per device.
 */
function createMockFolder() {
  var files = {};
  var revCounter = 0;

  function view(opts) {
    opts = opts || {};
    return {
      offline: false,
      dropRate: 0,
      calls: { list: 0, get: 0, put: 0 },
      list: function () {
        this.calls.list++;
        if (this.offline) { return Promise.reject({ offline: true }); }
        var names = Object.keys(files);
        // Cloud listings have no guaranteed order.
        if (opts.shuffle) { names.sort(function () { return opts.shuffle(); }); }
        return Promise.resolve(names.map(function (n) { return { name: n, rev: files[n].rev }; }));
      },
      get: function (name) {
        this.calls.get++;
        if (this.offline) { return Promise.reject({ offline: true }); }
        return Promise.resolve(files[name] ? files[name].bytes : null);
      },
      put: function (name, bytes) {
        this.calls.put++;
        if (this.offline) { return Promise.reject({ offline: true }); }
        if (this.dropRate && Math.random() < this.dropRate) {
          return Promise.reject({ status: 503 });
        }
        files[name] = { bytes: bytes, rev: String(++revCounter) };
        return Promise.resolve();
      }
    };
  }

  return { files: files, view: view };
}

function createMemoryStore() {
  var data = {};
  return {
    data: data,
    get: function (k) { return Promise.resolve(data[k]); },
    set: function (k, v) { data[k] = v; return Promise.resolve(); }
  };
}

module.exports = { createMockFolder, createMemoryStore };
