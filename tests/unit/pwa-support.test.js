const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const updatesScript = fs.readFileSync(
  path.join(__dirname, '..', '..', 'scripts', 'app-updates.js'),
  'utf8',
);
const serviceWorkerScript = fs.readFileSync(
  path.join(__dirname, '..', '..', 'service-worker.js'),
  'utf8',
);

test('clearCacheAndRestart uses translated confirmation text', () => {
  let confirmMessage = '';
  const deletedCaches = [];

  const context = {
    window: {
      location: { reload() {} },
      addEventListener() {},
      matchMedia() {
        return { matches: false, addEventListener() {} };
      },
      navigator: { standalone: false },
    },
    document: {
      readyState: 'loading',
      addEventListener() {},
      removeEventListener() {},
      getElementById() { return null; },
      querySelector() { return null; },
      createElement() {
        return { style: {}, remove() {} };
      },
      body: { appendChild() {} },
    },
    navigator: {},
    caches: {
      keys() {
        return Promise.resolve([
          'pbe-score-keeper-shell-2.22.0',
          'pbe-score-keeper-static-2.22.0',
          'unrelated-origin-cache'
        ]);
      },
      delete(cacheName) {
        deletedCaches.push(cacheName);
        return Promise.resolve(true);
      },
    },
    localStorage: {
      getItem() { return null; },
      setItem() {},
    },
    setTimeout(fn) {
      fn();
      return 1;
    },
    clearTimeout() {},
    t(key) {
      const map = {
        'advanced.clear_cache': 'Clear Cache & Restart',
        'advanced.clear_cache_confirm': 'Translated confirmation',
        'advanced.cache_cleared': 'Cache cleared',
      };
      return map[key] || key;
    },
    confirm(msg) {
      confirmMessage = msg;
      return false;
    },
    console,
  };

  vm.createContext(context);
  vm.runInContext(updatesScript, context);

  context.clearCacheAndRestart();

  assert.equal(confirmMessage, 'Clear Cache & Restart\n\nTranslated confirmation');
  assert.deepEqual(deletedCaches, []);

  context.confirm = function() {
    return true;
  };

  return context.clearCacheAndRestart().then(function() {
    assert.deepEqual(deletedCaches, [
      'pbe-score-keeper-shell-2.22.0',
      'pbe-score-keeper-static-2.22.0'
    ]);
  });
});

test('initializePwaToolsVisibility only shows tools when installed as PWA', () => {
  const pwaButton = { hidden: true };
  const pwaContainer = { style: { display: '' } };
  let displayModeMatches = true;

  const context = {
    window: {
      addEventListener() {},
      matchMedia() {
        return { matches: displayModeMatches, addEventListener() {} };
      },
      navigator: { standalone: false },
    },
    navigator: { standalone: false },
    document: {
      readyState: 'loading',
      addEventListener() {},
      removeEventListener() {},
      referrer: '',
      getElementById(id) {
        if (id === 'pwa_tools_button') {
          return pwaButton;
        }
        return null;
      },
      querySelector(selector) {
        if (selector === '.header-menu-pwa-actions') {
          return pwaContainer;
        }
        return null;
      },
      createElement() {
        return { style: {}, remove() {} };
      },
      body: { appendChild() {} },
    },
    localStorage: {
      getItem() { return null; },
      setItem() {},
    },
    setTimeout() { return 1; },
    clearTimeout() {},
    t(key) { return key; },
    console,
  };

  vm.createContext(context);
  vm.runInContext(updatesScript, context);

  context.initializePwaToolsVisibility();
  assert.equal(pwaContainer.style.display, 'flex');
  assert.equal(pwaButton.hidden, false);

  displayModeMatches = false;
  context.initializePwaToolsVisibility();
  assert.equal(pwaContainer.style.display, 'none');
  assert.equal(pwaButton.hidden, true);
});

test('should_reload_after_service_worker_update defers reload while sync is active', () => {
  const context = {
    window: {
      __pbeAllowImmediateSwReload: false,
      addEventListener() {},
      matchMedia() {
        return { matches: false, addEventListener() {} };
      },
      navigator: { standalone: false },
    },
    document: {
      readyState: 'loading',
      visibilityState: 'visible',
      addEventListener() {},
      removeEventListener() {},
      getElementById() { return null; },
      querySelector() { return null; },
      createElement() {
        return { style: {}, remove() {} };
      },
      body: { appendChild() {} },
      referrer: '',
    },
    navigator: {
      serviceWorker: null,
      standalone: false,
    },
    localStorage: {
      getItem() { return null; },
      setItem() {},
    },
    getSyncState() {
      return 'connected';
    },
    setTimeout() { return 1; },
    clearTimeout() {},
    t(key) { return key; },
    console,
  };

  vm.createContext(context);
  vm.runInContext(updatesScript, context);

  assert.equal(context.should_reload_after_service_worker_update(), false);
});

test('service worker stores and consumes share-target payload once', async () => {
  const shareCache = new Map();
  const listeners = {};

  const context = {
    console,
    URL,
    Headers,
    Response,
    File,
    Blob,
    Promise,
    Date,
    Number,
    setTimeout,
    clearTimeout,
    fetch() {
      return Promise.reject(new Error('fetch not expected in this test'));
    },
    caches: {
      open() {
        return Promise.resolve({
          put(key, value) {
            shareCache.set(key, value);
            return Promise.resolve();
          },
          match(key) {
            return Promise.resolve(shareCache.get(key));
          },
          delete(key) {
            return Promise.resolve(shareCache.delete(key));
          },
        });
      },
      keys() {
        return Promise.resolve([]);
      },
    },
    self: {
      location: {
        origin: 'https://example.com',
        pathname: '/',
      },
      addEventListener(name, handler) {
        listeners[name] = handler;
      },
      clients: {
        claim() {
          return Promise.resolve();
        },
      },
      registration: {
        navigationPreload: {
          enable() {
            return Promise.resolve();
          },
        },
      },
      skipWaiting() {},
    },
  };

  vm.createContext(context);
  vm.runInContext(serviceWorkerScript, context);

  const sharedFile = new File(['{"dataVersion":"5.0"}'], 'shared.json', { type: 'application/json' });
  const shareResponse = await context.handleShareTargetPost({
    formData() {
      return Promise.resolve({
        get(name) {
          return name === 'session' ? sharedFile : null;
        },
      });
    },
  });

  assert.equal(shareResponse.status, 303);
  assert.ok((shareResponse.headers.get('location') || '').includes('share-target=1'));

  const consumedOnce = await context.consumeShareTargetImportPayload();
  assert.equal(consumedOnce.ok, true);
  assert.equal(await consumedOnce.text(), '{"dataVersion":"5.0"}');

  const consumedTwice = await context.consumeShareTargetImportPayload();
  assert.equal(consumedTwice.ok, false);
});

test('index.html activates a waiting service worker on load, at most once a minute', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  assert.match(html, /SKIP_WAITING/);
  assert.match(html, /pbe-sw-auto-activate/);
  assert.match(html, /< 60000/);
});

test('service worker precaches with the HTTP cache bypassed', () => {
  const sw = fs.readFileSync(path.join(__dirname, '..', '..', 'service-worker.js'), 'utf8');
  assert.match(sw, /new Request\(url, \{ cache: "reload" \}\)/);
});
