/**
 * @fileoverview Unit tests for the host-side embedding client.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PBEScoreKeeperAPI,
  PBEScoreKeeperAPIError,
} = require('../../scripts/app-embedding-client.js');

class FakeWindow {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(handler);
  }

  removeEventListener(type, handler) {
    if (this.listeners.has(type)) {
      this.listeners.get(type).delete(handler);
    }
  }

  dispatchMessage(event) {
    const handlers = this.listeners.get('message') || [];
    for (const handler of handlers) {
      handler(event);
    }
  }
}

function createHarness(options = {}) {
  const sent = [];
  const frameWindow = {
    postMessage(message, targetOrigin) {
      sent.push({ message, targetOrigin });
    },
  };
  const iframe = {
    src: 'https://scorekeeper.example/embed?embedded=1',
    contentWindow: frameWindow,
    addEventListener(type, handler) {
      if (type === 'load') {
        this.loadHandler = handler;
      }
    },
  };
  const window = new FakeWindow();
  const api = new PBEScoreKeeperAPI(iframe, {
    window,
    targetOrigin: 'https://scorekeeper.example',
    timeoutMs: options.timeoutMs ?? 25,
    readyTimeoutMs: options.readyTimeoutMs ?? 25,
    retries: options.retries ?? 0,
    autoReady: options.autoReady,
  });
  return { api, window, iframe, frameWindow, sent };
}

function sendFromFrame(harness, data, overrides = {}) {
  harness.window.dispatchMessage({
    data,
    origin: overrides.origin || 'https://scorekeeper.example',
    source: overrides.source || harness.frameWindow,
  });
}

async function markReady(harness) {
  sendFromFrame(harness, {
    type: 'embedding:ready',
    apiVersion: 1,
    appVersion: '9.9.9-test',
  });
  return harness.api.ready();
}

test('client resolves readiness from iframe ready message', async () => {
  const harness = createHarness();

  assert.equal(harness.sent[0].message.type, 'embedding:hello');
  assert.equal(harness.sent[0].targetOrigin, 'https://scorekeeper.example');

  const ready = await markReady(harness);
  assert.equal(ready.apiVersion, 1);
  assert.equal(ready.appVersion, '9.9.9-test');
});

test('client sends commands and resolves successful responses', async () => {
  const harness = createHarness();
  await markReady(harness);

  const pending = harness.api.command('session:list', { includeCurrent: true });
  await Promise.resolve();
  const request = harness.sent.at(-1).message;

  assert.equal(request.type, 'embedding:command');
  assert.equal(request.command, 'session:list');
  assert.deepEqual(request.payload, { includeCurrent: true });

  sendFromFrame(harness, {
    type: 'embedding:response',
    id: request.id,
    command: 'session:list',
    ok: true,
    result: { sessions: [] },
  });

  assert.deepEqual(await pending, { sessions: [] });
});

test('client command wrappers send the documented command names', async () => {
  const harness = createHarness();
  await markReady(harness);

  const pending = harness.api.session.list();
  await Promise.resolve();
  const request = harness.sent.at(-1).message;

  assert.equal(request.command, 'session:list');
  sendFromFrame(harness, {
    type: 'embedding:response',
    id: request.id,
    command: 'session:list',
    ok: true,
    result: { sessions: [{ id: 's-1' }] },
  });

  assert.deepEqual(await pending, { sessions: [{ id: 's-1' }] });
});

test('client rejects command errors with structured API errors', async () => {
  const harness = createHarness();
  await markReady(harness);

  const pending = harness.api.question.next();
  await Promise.resolve();
  const request = harness.sent.at(-1).message;

  sendFromFrame(harness, {
    type: 'embedding:response',
    id: request.id,
    command: 'question:next',
    ok: false,
    error: {
      code: 'out_of_range',
      message: 'Already at the last question',
    },
  });

  await assert.rejects(
    pending,
    (error) => error instanceof PBEScoreKeeperAPIError && error.code === 'out_of_range'
  );
});

test('client dispatches subscribed events and wildcard events', async () => {
  const harness = createHarness();
  await markReady(harness);

  const received = [];
  const receivedAny = [];
  harness.api.on('question:scored', (data) => received.push(data));
  harness.api.on('*', (data, envelope) => receivedAny.push({ data, event: envelope.event }));

  await Promise.resolve();
  const subscribeRequests = harness.sent.filter((entry) => entry.message.type === 'embedding:subscribe');
  assert.equal(subscribeRequests.length, 2);

  for (const entry of subscribeRequests) {
    sendFromFrame(harness, {
      type: 'embedding:response',
      id: entry.message.id,
      command: 'embedding:subscribe',
      ok: true,
      result: { subscribed: entry.message.events },
    });
  }

  sendFromFrame(harness, {
    type: 'embedding:event',
    event: 'question:scored',
    data: { questionId: 'q-1', score: 3 },
  });

  assert.deepEqual(received, [{ questionId: 'q-1', score: 3 }]);
  assert.deepEqual(receivedAny, [{
    data: { questionId: 'q-1', score: 3 },
    event: 'question:scored',
  }]);
});

test('client ignores messages from the wrong source or origin', async () => {
  const harness = createHarness();
  await markReady(harness);

  let called = false;
  harness.api.on('session:created', () => {
    called = true;
  });

  sendFromFrame(harness, {
    type: 'embedding:event',
    event: 'session:created',
    data: { id: 's-1' },
  }, { origin: 'https://blocked.example' });

  sendFromFrame(harness, {
    type: 'embedding:event',
    event: 'session:created',
    data: { id: 's-1' },
  }, { source: { postMessage() {} } });

  assert.equal(called, false);
});

test('client times out pending command requests', async () => {
  const harness = createHarness({ timeoutMs: 5 });
  await markReady(harness);

  await assert.rejects(
    () => harness.api.command('session:list'),
    (error) => error instanceof PBEScoreKeeperAPIError && error.code === 'timeout'
  );
});

test('client resolves concurrent commands by response id', async () => {
  const harness = createHarness();
  await markReady(harness);

  const first = harness.api.command('session:list');
  const second = harness.api.command('session:list');
  await Promise.resolve();

  const firstRequest = harness.sent.at(-2).message;
  const secondRequest = harness.sent.at(-1).message;

  sendFromFrame(harness, {
    type: 'embedding:response',
    id: secondRequest.id,
    command: 'session:list',
    ok: true,
    result: { state: 'offline' },
  });
  sendFromFrame(harness, {
    type: 'embedding:response',
    id: firstRequest.id,
    command: 'session:list',
    ok: true,
    result: { sessions: [{ id: 's-1' }] },
  });

  assert.deepEqual(await first, { sessions: [{ id: 's-1' }] });
  assert.deepEqual(await second, { state: 'offline' });
});

test('client batch wrapper sends batch:run command', async () => {
  const harness = createHarness();
  await markReady(harness);

  const pending = harness.api.batch([
    { command: 'question:create', payload: { maxPoints: 5 } },
    { command: 'score:set', payload: { teamIndex: 1, score: 4 } },
  ], { atomic: true });
  await Promise.resolve();

  const request = harness.sent.at(-1).message;
  assert.equal(request.command, 'batch:run');
  assert.equal(request.payload.atomic, true);
  assert.equal(request.payload.commands.length, 2);

  sendFromFrame(harness, {
    type: 'embedding:response',
    id: request.id,
    command: 'batch:run',
    ok: true,
    result: { count: 2, results: [] },
  });

  assert.deepEqual(await pending, { count: 2, results: [] });
});

test('destroy removes listeners and rejects pending work', async () => {
  const harness = createHarness({ timeoutMs: 50 });
  await markReady(harness);

  const pending = harness.api.command('session:list');
  harness.api.destroy();

  assert.equal(harness.api.destroyed, true);
  assert.equal(harness.window.listeners.get('message').size, 0);
  await assert.rejects(
    pending,
    (error) => error instanceof PBEScoreKeeperAPIError && error.code === 'destroyed'
  );
});
