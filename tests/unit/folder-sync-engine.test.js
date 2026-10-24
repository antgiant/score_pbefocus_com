const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Y = require('yjs');
const Engine = require('../../scripts/app-folder-sync-engine.js');
const { createMockFolder, createMemoryStore } = require('../helpers/mock-folder-backend');

function makeClient(folder, id, opts) {
  const doc = new Y.Doc();
  const backend = folder.view(opts);
  const store = createMemoryStore();
  const engine = Engine.create({ Y, doc, backend, store, clientId: id });
  return { doc, backend, store, engine, id };
}

const add = (c, key, value) => c.doc.getMap('m').set(key, value);
const snapshot = (c) => JSON.stringify(Object.entries(c.doc.getMap('m').toJSON()).sort());

async function settle(clients, rounds = 3) {
  for (let i = 0; i < rounds; i++) {
    for (const c of clients) { await c.engine.sync(); }
  }
}

describe('file names', () => {
  it('parses outbox and snapshot names and rejects others', () => {
    assert.deepEqual(Engine.parseFileName('c-abc.yjs'), { kind: 'outbox', clientId: 'abc' });
    assert.deepEqual(Engine.parseFileName('snapshot-abc.yjs'), { kind: 'snapshot', clientId: 'abc' });
    assert.equal(Engine.parseFileName('pbe-session.json'), null);
    assert.equal(Engine.parseFileName('c-.yjs'), null);
    assert.equal(Engine.parseFileName('notes.yjs'), null);
  });
});

describe('backoff and polling', () => {
  it('doubles up to the cap and honors Retry-After', () => {
    assert.equal(Engine.backoffDelay(1), 1000);
    assert.equal(Engine.backoffDelay(3), 4000);
    assert.equal(Engine.backoffDelay(20), 30000);
    assert.equal(Engine.backoffDelay(1, 45), 45000);
  });
  it('polls fast when active, slow when idle, never when hidden', () => {
    assert.equal(Engine.pollInterval({ active: true }), 15000);
    assert.equal(Engine.pollInterval({ active: false }), 60000);
    assert.equal(Engine.pollInterval({ hidden: true, active: true }), null);
  });
});

describe('two devices', () => {
  it('converge and seed existing local state on first enable', async () => {
    const folder = createMockFolder();
    const a = makeClient(folder, 'a');
    add(a, 'preexisting', 1); // before sync is enabled
    await a.engine.start();
    const b = makeClient(folder, 'b');
    await b.engine.start();
    add(a, 'x', 'from-a');
    add(b, 'y', 'from-b');
    await settle([a, b]);
    assert.equal(snapshot(a), snapshot(b));
    assert.equal(b.doc.getMap('m').get('preexisting'), 1);
    assert.equal(a.doc.getMap('m').get('y'), 'from-b');
  });

  it('writes only its own files and never deletes others', async () => {
    const folder = createMockFolder();
    const a = makeClient(folder, 'a');
    const b = makeClient(folder, 'b');
    add(a, 'x', 1); add(b, 'y', 2);
    await settle([a, b]);
    await a.engine.writeSnapshot();
    assert.deepEqual(Object.keys(folder.files).sort(), ['c-a.yjs', 'c-b.yjs', 'snapshot-a.yjs']);
  });

  it('does not re-download unchanged files', async () => {
    const folder = createMockFolder();
    const a = makeClient(folder, 'a');
    const b = makeClient(folder, 'b');
    add(a, 'x', 1);
    await settle([a, b], 1);
    const gets = b.backend.calls.get;
    await b.engine.sync();
    await b.engine.sync();
    assert.equal(b.backend.calls.get, gets);
  });

  it('does not echo remote updates into its own outbox', async () => {
    const folder = createMockFolder();
    const a = makeClient(folder, 'a');
    const b = makeClient(folder, 'b');
    add(a, 'x', 1);
    await settle([a, b]);
    assert.equal(b.backend.calls.put, 1); // only the initial seed upload
    await settle([a, b]);
    assert.equal(b.backend.calls.put, 1);
    assert.equal(b.engine.getStatus().pending, false);
  });
});

describe('poor connectivity', () => {
  it('keeps scoring offline, reports status, and catches up afterwards', async () => {
    const folder = createMockFolder();
    const a = makeClient(folder, 'a');
    const b = makeClient(folder, 'b');
    await settle([a, b], 1);
    a.backend.offline = true;
    add(a, 'q1', 10);
    add(a, 'q2', 20);
    const res = await a.engine.sync();
    assert.equal(res.ok, false);
    assert.equal(res.offline, true);
    assert.equal(a.engine.getStatus().state, 'offline');
    assert.equal(a.engine.getStatus().pending, true);
    add(b, 'q3', 30);
    await b.engine.sync();
    a.backend.offline = false;
    await settle([a, b]);
    assert.equal(snapshot(a), snapshot(b));
    assert.equal(a.engine.getStatus().state, 'synced');
    assert.equal(a.doc.getMap('m').get('q3'), 30);
  });

  it('retries after dropped writes without losing updates', async () => {
    const folder = createMockFolder();
    const a = makeClient(folder, 'a');
    const b = makeClient(folder, 'b');
    a.backend.dropRate = 0.7;
    for (let i = 0; i < 10; i++) { add(a, 'k' + i, i); await a.engine.sync(); }
    a.backend.dropRate = 0;
    await settle([a, b]);
    assert.equal(snapshot(a), snapshot(b));
    assert.equal(Object.keys(b.doc.getMap('m').toJSON()).length, 10);
  });

  it('survives a restart using the persisted outbox', async () => {
    const folder = createMockFolder();
    const a = makeClient(folder, 'a');
    await a.engine.start();
    add(a, 'x', 1);
    await Promise.resolve();
    a.backend.offline = true;
    await a.engine.sync();
    // new engine + doc from the same store, as after closing the tab
    const doc2 = new Y.Doc();
    const backend2 = folder.view();
    const engine2 = Engine.create({ Y, doc: doc2, backend: backend2, store: a.store, clientId: 'a' });
    await engine2.sync();
    const b = makeClient(folder, 'b');
    await b.engine.sync();
    assert.equal(b.doc.getMap('m').get('x'), 1);
  });

  it('shares one in-flight sync between concurrent callers', async () => {
    const folder = createMockFolder();
    const a = makeClient(folder, 'a');
    add(a, 'x', 1);
    const p1 = a.engine.sync();
    const p2 = a.engine.sync();
    assert.equal(p1, p2);
    await p1;
  });

  it('keeps going when one file fails to download', async () => {
    const folder = createMockFolder();
    const a = makeClient(folder, 'a');
    const b = makeClient(folder, 'b');
    const c = makeClient(folder, 'c');
    add(a, 'x', 1); add(b, 'y', 2);
    await settle([a, b], 1);
    const realGet = c.backend.get;
    c.backend.get = function (n) {
      return n === 'c-a.yjs' ? Promise.reject({ status: 500 }) : realGet.call(this, n);
    };
    const res = await c.engine.sync();
    assert.equal(res.ok, false);
    assert.equal(c.doc.getMap('m').get('y'), 2);
    c.backend.get = realGet;
    await c.engine.sync();
    assert.equal(c.doc.getMap('m').get('x'), 1);
  });

  it('ignores corrupt files', async () => {
    const folder = createMockFolder();
    folder.files['c-bad.yjs'] = { bytes: new Uint8Array([255, 1, 2, 3]), rev: '999' };
    const a = makeClient(folder, 'a');
    add(a, 'x', 1);
    const res = await a.engine.sync();
    assert.equal(res.ok, true);
  });

  it('reports auth failures distinctly', async () => {
    const folder = createMockFolder();
    const a = makeClient(folder, 'a');
    a.backend.list = () => Promise.reject({ code: 'auth', status: 401 });
    await a.engine.sync();
    assert.equal(a.engine.getStatus().state, 'auth');
  });
});

describe('many scorers (standard mode)', () => {
  for (const n of [20, 50]) {
    it(`${n} devices converge despite shuffled listings and drops`, async () => {
      const folder = createMockFolder();
      const shuffle = () => Math.random() - 0.5;
      const clients = [];
      for (let i = 0; i < n; i++) {
        clients.push(makeClient(folder, 'c' + i, { shuffle }));
      }
      clients.forEach((c) => { c.backend.dropRate = 0.1; });
      for (let round = 0; round < 3; round++) {
        for (const c of clients) { add(c, `${c.id}-r${round}`, round); }
        await Promise.all(clients.map((c) => c.engine.sync()));
      }
      clients.forEach((c) => { c.backend.dropRate = 0; });
      await settle(clients, 2);
      const first = snapshot(clients[0]);
      clients.forEach((c) => assert.equal(snapshot(c), first));
      assert.equal(Object.keys(clients[0].doc.getMap('m').toJSON()).length, n * 3);
    });
  }
});
