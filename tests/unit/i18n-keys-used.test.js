const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const LANGS = ['en', 'es', 'fr', 'pig'];
const SKIP = /^(yjs|jquery|y-indexeddb|app-folder-auth\.js$)|\.min\.js$|\.umd\.js$|\.cjs$/;

function loadTranslations(lang) {
  let data;
  global.register_i18n_language = (code, def) => { data = def.translations; };
  delete require.cache[require.resolve(path.join(root, 'scripts/i18n', lang + '.js'))];
  require(path.join(root, 'scripts/i18n', lang + '.js'));
  return data;
}

function flatten(obj, prefix = '', out = new Set()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object') { flatten(v, key, out); } else { out.add(key); }
  }
  return out;
}

function usedKeys() {
  const keys = new Map(); // key -> first file
  const add = (key, file, plural) => {
    if (key.endsWith('_')) return; // dynamic key built at runtime (e.g. 'storage.status_' + state)
    const variants = plural ? [key + '_one', key + '_other'] : [key];
    variants.forEach((k) => { if (!keys.has(k)) keys.set(k, file); });
  };
  const files = fs.readdirSync(path.join(root, 'scripts')).filter((f) => f.endsWith('.js') && !SKIP.test(f));
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, 'scripts', f), 'utf8');
    for (const m of src.matchAll(/\bt\(\s*['"]([a-z_0-9]+(?:\.[a-z_0-9]+)+)['"]/g)) add(m[1], f, false);
    for (const m of src.matchAll(/\bt_plural\(\s*['"]([a-z_0-9]+(?:\.[a-z_0-9]+)+)['"]/g)) add(m[1], f, true);
  }
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-title|-placeholder|-aria-label)?="([a-z_0-9]+(?:\.[a-z_0-9]+)+)"/g)) add(m[1], 'index.html', false);
  return keys;
}

describe('translation keys used by the app', () => {
  const used = usedKeys();
  for (const lang of LANGS) {
    it(`every key referenced in code and index.html exists in ${lang}`, () => {
      const have = flatten(loadTranslations(lang));
      const missing = [...used].filter(([k]) => !have.has(k) && !have.has(k.replace(/_(one|other)$/, '')) && !have.has(k + '_one')).map(([k, f]) => `${k} (${f})`);
      assert.deepEqual(missing, []);
    });
  }
});

describe('dynamic translation keys', () => {
  for (const lang of LANGS) {
    it(`every storage status label exists in ${lang}`, () => {
      const have = flatten(loadTranslations(lang));
      const missing = ['off', 'synced', 'pending', 'syncing', 'offline', 'auth', 'error'].map((s) => 'storage.status_' + s).filter((k) => !have.has(k));
      assert.deepEqual(missing, []);
    });
  }
});
