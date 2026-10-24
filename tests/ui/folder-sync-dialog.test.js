const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Y = require('yjs');

const SCRIPTS = ['app-sync-config', 'app-folder-sync-engine', 'app-folder-providers', 'app-folder-auth', 'app-folder-sync', 'app-folder-sync-ui'];

/**
 * The shared DOM harness stubs `document` and runs timers immediately, which
 * does not suit a polling controller, so this suite builds its own context
 * with real (unref'd) timers and exercises the HTML builders and controller.
 */
function createContext() {
  const store = {};
  const doc = new Y.Doc();
  const context = {
    console,
    Y,
    TextEncoder, TextDecoder, Uint8Array, Promise, JSON, Date,
    crypto: require('node:crypto').webcrypto,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      key: (i) => Object.keys(store)[i] || null,
      get length() { return Object.keys(store).length; }
    },
    setTimeout: (fn, ms) => { const h = setTimeout(fn, ms); h.unref(); return h; },
    clearTimeout,
    t: (key, params) => key + (params ? ':' + JSON.stringify(params) : ''),
    get_current_language: () => 'en',
    get_current_session_id: () => 'sess-1',
    getAllSessions: () => [{ id: 'sess-1', index: 1, name: 'Regional <b>' }],
    getSessionDoc: () => doc,
    document: { visibilityState: 'visible', createElement: () => { let v = ''; return { set textContent(x) { v = String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }, get innerHTML() { return v; } }; }, getElementById: () => null, addEventListener() {} },
    window: { addEventListener() {} },
    fetch: () => Promise.reject(new TypeError('no network'))
  };
  context.window.window = context.window;
  vm.createContext(context);
  for (const name of SCRIPTS) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../scripts', name + '.js'), 'utf8'), context, { filename: name + '.js' });
  }
  return context;
}

describe('Storage & Sync dialog markup', () => {
  let ctx, run;
  beforeEach(() => { ctx = createContext(); run = (c) => vm.runInContext(c, ctx); });

  it('renders an accessible dialog for a local-only quiz and escapes the quiz name', () => {
    const html = run('FolderSyncUI.dialogHTML()');
    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-modal="true"/);
    assert.match(html, /aria-labelledby="storage-dialog-title"/);
    assert.match(html, /role="status" aria-live="polite"/);
    assert.match(html, /value="local" checked/);
    assert.match(html, /Regional &lt;b&gt;/);
    assert.doesNotMatch(html, /Regional <b>/);
    assert.match(html, /id="storage-close"/);
  });

  it('shows a not-set-up message while client IDs are empty', () => {
    const panel = run('FolderSyncUI.providerPanelHTML("google")');
    assert.match(panel, /storage\.not_configured/);
    assert.doesNotMatch(panel, /storage-private/);
  });

  it('offers private and shared choices once a provider is configured', () => {
    run('FOLDER_SYNC_CONFIG.microsoft.clientId = "abc"');
    const ms = run('FolderSyncUI.providerPanelHTML("microsoft")');
    assert.match(ms, /id="storage-private"/);
    assert.match(ms, /id="storage-link"/);
    run('FOLDER_SYNC_CONFIG.google = { clientId: "a", apiKey: "b", appId: "c" }');
    const g = run('FolderSyncUI.providerPanelHTML("google")');
    assert.match(g, /id="storage-private"/);
    assert.doesNotMatch(g, /id="storage-link"/);
  });

  it('local choice has no provider panel', () => {
    assert.strictEqual(run('FolderSyncUI.providerPanelHTML("local")'), '');
  });

  it('shows sync controls instead of choices once enabled, with Reconnect only on auth failure', async () => {
    run(`FolderSync.writeConfig("sess-1", { provider: "google", mode: "private", folder: { folderId: "F" }, folderName: "PBE Focus", clientId: "abc" });
         FolderAuth.google.getToken = function () { return Promise.reject({ code: "auth", status: 401 }); };`);
    await run('FolderSync.startForSession("sess-1")');
    await run('FolderSync.syncNow()');
    assert.strictEqual(run('FolderSync.getStatus().state'), 'auth');
    const html = run('FolderSyncUI.dialogHTML()');
    assert.match(html, /id="storage-sync-now"/);
    assert.match(html, /id="storage-stop"/);
    assert.match(html, /id="storage-reconnect"/);
    assert.match(html, /role="alert"/);
    assert.doesNotMatch(html, /name="storage-provider"/);
    run('FolderSync.stop()');
  });
});

describe('FolderSync controller', () => {
  let ctx, run;
  beforeEach(() => { ctx = createContext(); run = (c) => vm.runInContext(c, ctx); });
  afterEach(() => { run('FolderSync.stop()'); });

  it('is off when the session has no settings', () => {
    assert.strictEqual(run('FolderSync.getStatus().state'), 'off');
    assert.strictEqual(run('FolderSync.hasAnyConfig()'), false);
  });

  it('keeps per-session settings and clears them on disable', () => {
    run('FolderSync.writeConfig("sess-1", { provider: "google", clientId: "abc" })');
    assert.strictEqual(run('FolderSync.hasAnyConfig()'), true);
    assert.strictEqual(run('FolderSync.readConfig("sess-1").clientId'), 'abc');
    run('FolderSync.disable("sess-1")');
    assert.strictEqual(run('FolderSync.readConfig("sess-1")'), null);
    assert.strictEqual(run('FolderSync.hasAnyConfig()'), false);
  });

  it('reuses the device client id when settings are saved again', async () => {
    run(`FolderAuth.google.getToken = function () { return Promise.resolve("t"); };
         FolderProviders.createGoogleBackend = function () { return { list: function () { return Promise.resolve([]); }, get: function () { return Promise.resolve(null); }, put: function () { return Promise.resolve(); } }; };`);
    await run('FolderSync.enable("sess-1", { provider: "google", mode: "private", folder: { folderId: "F" }, folderName: "x" })');
    const first = run('FolderSync.readConfig("sess-1").clientId');
    assert.match(first, /^[0-9a-f]{12}$/);
    await run('FolderSync.enable("sess-1", { provider: "google", mode: "shared", folder: { folderId: "G" }, folderName: "y" })');
    assert.strictEqual(run('FolderSync.readConfig("sess-1").clientId'), first);
  });

  it('syncs the active session and reports synced with this device\'s file uploaded', async () => {
    run(`var files = {};
         FolderAuth.google.getToken = function () { return Promise.resolve("t"); };
         FolderProviders.createGoogleBackend = function () {
           return {
             list: function () { return Promise.resolve(Object.keys(files).map(function (n) { return { name: n, rev: "1" }; })); },
             get: function () { return Promise.resolve(null); },
             put: function (n, b) { files[n] = b; return Promise.resolve(); }
           };
         };`);
    await run('FolderSync.enable("sess-1", { provider: "google", mode: "private", folder: { folderId: "F" }, folderName: "PBE Focus" })');
    await run('FolderSync.syncNow()');
    const status = run('FolderSync.getStatus()');
    assert.strictEqual(status.state, 'synced');
    assert.strictEqual(status.provider, 'google');
    assert.deepStrictEqual(Array.from(run('Object.keys(files)')), [run('"c-" + FolderSync.readConfig("sess-1").clientId + ".yjs"')]);
  });

  it('reports offline when the network is unreachable and keeps retrying with backoff info', async () => {
    run(`FolderAuth.google.getToken = function () { return Promise.resolve("t"); };`); // fetch rejects with TypeError
    await run('FolderSync.enable("sess-1", { provider: "google", mode: "private", folder: { folderId: "F" }, folderName: "x" })');
    await run('FolderSync.syncNow()');
    const status = run('FolderSync.getStatus()');
    assert.strictEqual(status.state, 'offline');
    assert.strictEqual(status.pending, true);
  });
});
