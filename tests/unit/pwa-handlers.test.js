/**
 * @fileoverview Unit tests for PWA file handlers and protocol handlers.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { TextEncoder, TextDecoder } = require('node:util');

const handlerCode = fs.readFileSync(
  path.join(__dirname, '../../scripts/app-pwa-handlers.js'),
  'utf8'
);

function createElement(id) {
  return {
    id,
    checked: false,
    value: '',
    style: {},
    focus() {},
  };
}

function createContext() {
  const elements = new Map();
  const listeners = {};
  const notifications = [];
  const importedPayloads = [];
  const loadedFeatures = [];
  let launchConsumer = null;
  let displaySynced = false;

  function getElement(id) {
    if (!elements.has(id)) {
      elements.set(id, createElement(id));
    }
    return elements.get(id);
  }

  const windowStub = {
    location: {
      href: 'https://example.test/app/',
      search: '',
    },
    history: {
      replacedUrl: null,
      replaceState(_state, _title, url) {
        this.replacedUrl = url;
      },
    },
    addEventListener(event, handler) {
      listeners[event] = handler;
    },
    launchQueue: {
      setConsumer(consumer) {
        launchConsumer = consumer;
      },
    },
  };

  const documentStub = {
    title: 'PBE Score Keeper',
    readyState: 'loading',
    addEventListener() {},
    getElementById: getElement,
    querySelector() {
      return null;
    },
  };

  const context = {
    console: {
      log() {},
      warn() {},
      error() {},
    },
    window: windowStub,
    document: documentStub,
    URL,
    URLSearchParams,
    Promise,
    Uint8Array,
    ArrayBuffer,
    TextDecoder,
    atob(value) {
      return Buffer.from(value, 'base64').toString('binary');
    },
    t(key, params) {
      if (key === 'pwa.file_launch_success') return 'Imported quiz from file';
      if (key === 'pwa.file_launch_error') return `Failed to import file: ${params.error}`;
      if (key === 'pwa.file_launch_invalid') return 'Invalid file launch data';
      if (key === 'pwa.unsupported_file_type') return 'Only .yjs and .json files can be imported';
      if (key === 'pwa.protocol_new_session') return 'Creating new quiz...';
      if (key === 'pwa.protocol_import_url') return 'Importing quiz from link...';
      if (key === 'pwa.protocol_error_invalid') return 'Invalid protocol link';
      if (key === 'pwa.protocol_error_missing_param') return `Missing required parameter: ${params.param}`;
      return key;
    },
    showUpdateNotification(message, type) {
      notifications.push({ message, type });
    },
    load_feature_group(featureName) {
      loadedFeatures.push(featureName);
      return Promise.resolve();
    },
    importSessionData(payload) {
      importedPayloads.push(payload);
      return Promise.resolve({ success: true, importedCount: 1 });
    },
    sync_data_to_display() {
      displaySynced = true;
    },
    createNewSession() {
      return Promise.resolve('created-session-id');
    },
  };

  vm.createContext(context);
  vm.runInContext(handlerCode, context);

  return {
    context,
    elements,
    listeners,
    notifications,
    importedPayloads,
    loadedFeatures,
    get launchConsumer() {
      return launchConsumer;
    },
    get displaySynced() {
      return displaySynced;
    },
  };
}

test('parseProtocolUrl rejects the removed join-room links', () => {
  const { context } = createContext();

  const route = context.PWAHandlers.parseProtocolUrl('web+pbe://join/abc123?password=SECRET');

  assert.equal(route.valid, false);
  assert.equal(route.errorKey, 'pwa.protocol_error_invalid');
});

test('parseProtocolUrl parses pbe session links', () => {
  const { context } = createContext();

  const route = context.PWAHandlers.parseProtocolUrl('pbe://session/new');

  assert.equal(route.valid, true);
  assert.equal(route.action, 'session');
  assert.equal(route.sessionAction, 'new');
});

test('parseProtocolUrl parses import links with file parameter', () => {
  const { context } = createContext();
  const fileUrl = 'https://example.test/session.yjs';

  const route = context.PWAHandlers.parseProtocolUrl(`web+pbe://import?file=${encodeURIComponent(fileUrl)}`);

  assert.equal(route.valid, true);
  assert.equal(route.action, 'import');
  assert.equal(route.file, fileUrl);
});

test('routeProtocolHandler reports join links as invalid without loading features', async () => {
  const harness = createContext();
  const { context, loadedFeatures } = harness;

  const result = await context.PWAHandlers.routeProtocolHandler('web+pbe://join/ABC123?password=SECRET');

  assert.equal(result.success, false);
  assert.deepEqual(loadedFeatures, []);
});

test('routeProtocolHandler creates a new session for session/new links', async () => {
  const harness = createContext();
  const { context } = harness;

  const result = await context.PWAHandlers.routeProtocolHandler('web+pbe://session/new');

  assert.equal(result.success, true);
  assert.equal(result.sessionId, 'created-session-id');
  assert.equal(harness.displaySynced, true);
});

test('handleFileLaunch imports JSON files as text', async () => {
  const { context, importedPayloads, loadedFeatures } = createContext();
  const content = new TextEncoder().encode('{"dataVersion":3.0,"sessions":[]}').buffer;

  const result = await context.PWAHandlers.handleFileLaunch({
    name: 'session.json',
    type: 'application/json',
    content,
  });

  assert.equal(result.success, true);
  assert.deepEqual(loadedFeatures, ['importExport']);
  assert.equal(importedPayloads.length, 1);
  assert.equal(importedPayloads[0], '{"dataVersion":3.0,"sessions":[]}');
});

test('handleFileLaunch imports Yjs files as Uint8Array', async () => {
  const { context, importedPayloads } = createContext();
  const bytes = new Uint8Array([1, 2, 3, 4]);

  const result = await context.PWAHandlers.handleFileLaunch({
    name: 'session.yjs',
    type: 'application/octet-stream',
    content: bytes.buffer,
  });

  assert.equal(result.success, true);
  assert.equal(importedPayloads.length, 1);
  assert.ok(importedPayloads[0] instanceof Uint8Array);
  assert.deepEqual(Array.from(importedPayloads[0]), [1, 2, 3, 4]);
});

test('handleFileLaunch rejects unsupported file extensions', async () => {
  const { context, importedPayloads, notifications } = createContext();

  const result = await context.PWAHandlers.handleFileLaunch({
    name: 'notes.txt',
    type: 'text/plain',
    content: 'not an import',
  });

  assert.equal(result.success, false);
  assert.equal(importedPayloads.length, 0);
  assert.equal(notifications.at(-1).type, 'error');
});

test('setupLaunchQueue registers and consumes file handler launches', async () => {
  const harness = createContext();
  const { context, importedPayloads } = harness;

  assert.equal(context.PWAHandlers.setupLaunchQueue(), true);
  assert.equal(typeof harness.launchConsumer, 'function');

  await harness.launchConsumer({
    files: [
      {
        getFile() {
          return Promise.resolve({
            name: 'launched.yjs',
            type: 'application/octet-stream',
            arrayBuffer() {
              return Promise.resolve(new Uint8Array([7, 8, 9]).buffer);
            },
          });
        },
      },
    ],
  });

  assert.equal(importedPayloads.length, 1);
  assert.deepEqual(Array.from(importedPayloads[0]), [7, 8, 9]);
});

test('handleProtocolUrl routes protocol query parameter and preserves unrelated URL state', async () => {
  const harness = createContext();
  const { context } = harness;
  const protocol = encodeURIComponent('web+pbe://session/new');
  context.window.location.href = `https://example.test/app/?protocol=${protocol}&keep=1#scores`;
  context.window.location.search = `?protocol=${protocol}&keep=1`;

  const result = await context.PWAHandlers.handleProtocolUrl();

  assert.equal(result.success, true);
  assert.equal(context.window.history.replacedUrl, '/app/?keep=1#scores');
});

test('handleImportAction fetches URL imports and routes JSON by content type', async () => {
  const { context, importedPayloads } = createContext();
  let fetchedUrl = null;
  context.fetch = function(url) {
    fetchedUrl = url;
    return Promise.resolve({
      ok: true,
      url,
      headers: {
        get(name) {
          return name === 'content-type' ? 'application/json' : null;
        },
      },
      text() {
        return Promise.resolve('{"dataVersion":3.0,"sessions":[]}');
      },
    });
  };

  const result = await context.PWAHandlers.handleImportAction('https://example.test/session.json');

  assert.equal(result.success, true);
  assert.equal(fetchedUrl, 'https://example.test/session.json');
  assert.equal(importedPayloads[0], '{"dataVersion":3.0,"sessions":[]}');
});

test('ensureFeature uses the app lazy loader when the compatibility name is absent', async () => {
  const { context, loadedFeatures } = createContext();
  delete context.load_feature_group;
  context.ensure_feature_loaded = function(featureName) {
    loadedFeatures.push(featureName);
    return Promise.resolve();
  };

  await context.PWAHandlers.ensureFeature('importExport');

  assert.deepEqual(loadedFeatures, ['importExport']);
});

test('init degrades cleanly when browser APIs are missing', () => {
  const { context } = createContext();
  context.window.launchQueue = null;

  assert.equal(context.PWAHandlers.init(), true);
  assert.equal(context.PWAHandlers.launchConsumerRegistered, false);
});
