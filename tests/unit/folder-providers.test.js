const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../scripts/app-folder-providers.js');

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    for (const [match, handler] of routes) {
      if (typeof match === 'string' ? url.includes(match) : match(url, init)) {
        const r = await handler(url, init);
        return {
          ok: r.status === undefined || r.status < 400,
          status: r.status || 200,
          headers: { get: (k) => (r.headers || {})[k] || null },
          json: async () => r.json,
          arrayBuffer: async () => (r.bytes || new Uint8Array()).buffer.slice(
            (r.bytes || new Uint8Array()).byteOffset,
            (r.bytes || new Uint8Array()).byteOffset + (r.bytes || new Uint8Array()).byteLength)
        };
      }
    }
    throw new Error('unrouted ' + url);
  };
  fn.calls = calls;
  return fn;
}
const token = () => Promise.resolve('tok');

describe('error mapping', () => {
  it('maps 401, throttling and network failures', async () => {
    const f401 = fakeFetch([['', () => ({ status: 401 })]]);
    const b = P.createGoogleBackend({ fetch: f401, getToken: token, folderId: 'F' });
    await assert.rejects(b.list(), { code: 'auth', status: 401 });

    const f429 = fakeFetch([['', () => ({ status: 429, headers: { 'Retry-After': '7' } })]]);
    await assert.rejects(P.createGoogleBackend({ fetch: f429, getToken: token, folderId: 'F' }).list(), { status: 429, retryAfter: 7 });

    const fnet = async () => { throw new TypeError('Failed to fetch'); };
    await assert.rejects(P.createGoogleBackend({ fetch: fnet, getToken: token, folderId: 'F' }).list(), { offline: true });
  });
});

describe('google backend', () => {
  it('lists with paging, downloads by name, updates vs creates', async () => {
    const f = fakeFetch([
      [(u) => u.includes('/files?q=') && !u.includes('pageToken'), () => ({ json: { nextPageToken: 'n', files: [{ id: '1', name: 'c-a.yjs', md5Checksum: 'm1' }] } })],
      [(u) => u.includes('pageToken=n'), () => ({ json: { files: [{ id: '2', name: 'c-b.yjs', modifiedTime: 't', size: '5' }] } })],
      ['alt=media', () => ({ bytes: new Uint8Array([1, 2, 3]) })],
      [(u, i) => i.method === 'PATCH', () => ({ json: {} })],
      [(u, i) => i.method === 'POST', () => ({ json: { id: '9' } })]
    ]);
    const b = P.createGoogleBackend({ fetch: f, getToken: token, folderId: 'F' });
    const list = await b.list();
    assert.deepEqual(list, [{ name: 'c-a.yjs', rev: 'm1' }, { name: 'c-b.yjs', rev: 't:5' }]);
    assert.deepEqual([...await b.get('c-a.yjs')], [1, 2, 3]);
    assert.equal(await b.get('missing.yjs'), null);
    await b.put('c-a.yjs', new Uint8Array([4]));
    assert.equal(f.calls.at(-1).init.method, 'PATCH');
    assert.ok(f.calls.at(-1).url.includes('/files/1?uploadType=media'));
    await b.put('c-new.yjs', new Uint8Array([5]));
    const post = f.calls.at(-1);
    assert.equal(post.init.method, 'POST');
    assert.ok(post.init.headers['Content-Type'].startsWith('multipart/related'));
    assert.equal(post.init.headers.Authorization, 'Bearer tok');
    // next put of same name now updates
    await b.put('c-new.yjs', new Uint8Array([6]));
    assert.equal(f.calls.at(-1).init.method, 'PATCH');
  });

  it('finds or creates a folder path', async () => {
    let created = 0;
    const f = fakeFetch([
      [(u, i) => i.method === 'POST', () => { created++; return { json: { id: 'new' + created } }; }],
      [(u) => u.includes("name%3D'PBE%20Focus'"), () => ({ json: { files: [{ id: 'existing' }] } })],
      [(u) => u.includes('files?fields'), () => ({ json: { files: [] } })]
    ]);
    const id = await P.ensureGoogleFolderPath({ fetch: f, getToken: token, path: ['PBE Focus', 'scorekeeper', 'sess'] });
    assert.equal(created, 2);
    assert.equal(id, 'new2');
  });
});

describe('graph backend', () => {
  it('lists files only, follows next links, and uses eTag as revision', async () => {
    const f = fakeFetch([
      [(u) => u.includes('/drives/D/items/I/children?'), () => ({ json: { value: [{ name: 'c-a.yjs', eTag: 'e1' }, { name: 'sub', folder: {} }], '@odata.nextLink': 'https://graph.microsoft.com/next' } })],
      ['/next', () => ({ json: { value: [{ name: 'snapshot-a.yjs', lastModifiedDateTime: 'x', size: 3 }] } })]
    ]);
    const b = P.createGraphBackend({ fetch: f, getToken: token, folder: { driveId: 'D', itemId: 'I' } });
    assert.deepEqual(await b.list(), [{ name: 'c-a.yjs', rev: 'e1' }, { name: 'snapshot-a.yjs', rev: 'x:3' }]);
  });

  it('reads and writes content by name, tolerates 404 on get, rejects oversize', async () => {
    const f = fakeFetch([
      [(u, i) => i.method === 'PUT', () => ({ json: {} })],
      ['c-gone.yjs', () => ({ status: 404 })],
      [':/c-a.yjs:/content', () => ({ bytes: new Uint8Array([7]) })]
    ]);
    const b = P.createGraphBackend({ fetch: f, getToken: token, folder: { itemId: 'I' } });
    assert.deepEqual([...await b.get('c-a.yjs')], [7]);
    assert.equal(await b.get('c-gone.yjs'), null);
    await b.put('c-a.yjs', new Uint8Array([1]));
    assert.ok(f.calls.at(-1).url.includes('/me/drive/items/I:/c-a.yjs:/content'));
    await assert.rejects(b.put('big.yjs', new Uint8Array(4 * 1024 * 1024 + 1)), { code: 'too-large' });
  });

  it('app-folder paths: empty listing before first write, path-style URLs', async () => {
    const f = fakeFetch([
      ['/children', () => ({ status: 404 })],
      [(u, i) => i.method === 'PUT', () => ({ json: {} })]
    ]);
    const b = P.createGraphBackend({ fetch: f, getToken: token, folder: { appPath: 'scorekeeper/sess 1' } });
    assert.deepEqual(await b.list(), []);
    await b.put('c-a.yjs', new Uint8Array([1]));
    assert.ok(f.calls.at(-1).url.endsWith('/approot:/scorekeeper/sess%201/c-a.yjs:/content'));
  });

  it('resolves share links to folders only', async () => {
    const link = 'https://1drv.ms/f/s!abc';
    const enc = P.encodeShareUrl(link);
    assert.ok(enc.startsWith('u!') && !/[+/=]/.test(enc));
    const f = fakeFetch([
      ['/shares/', () => ({ json: { id: 'I', name: 'Event', folder: {}, parentReference: { driveId: 'D' } } })]
    ]);
    assert.deepEqual(await P.resolveGraphShareLink({ fetch: f, getToken: token, url: link }), { driveId: 'D', itemId: 'I', name: 'Event' });
    const f2 = fakeFetch([['/shares/', () => ({ json: { id: 'I', name: 'file.txt', parentReference: {} } })]]);
    await assert.rejects(P.resolveGraphShareLink({ fetch: f2, getToken: token, url: link }), { code: 'not-a-folder' });
  });
});

describe('session marker', () => {
  it('round-trips and rejects other JSON', () => {
    const bytes = P.buildMarker({ sessionId: 's-1', name: 'Regional' });
    assert.deepEqual(P.parseMarker(bytes).sessionId, 's-1');
    assert.equal(P.parseMarker(new TextEncoder().encode('{"a":1}')), null);
    assert.equal(P.parseMarker(new Uint8Array([1, 2])), null);
  });
});
