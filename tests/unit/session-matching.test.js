const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../scripts/app-session-matching.js'), 'utf8'), context);
const run = (code) => JSON.parse(JSON.stringify(vm.runInContext(code, context)));

// Name arrays are 1-based: index 0 is a placeholder.
describe('session matching', () => {
  it('matches identical names case-insensitively as exact', () => {
    const r = run('compareArrays([null, "Team A", "Team B"], [null, "team b", "TEAM A"], "team")');
    assert.equal(r.matches.length, 2);
    assert.ok(r.matches.every((m) => m.confidence === 'exact'));
    assert.deepEqual(r.matches.map((m) => [m.remoteIndex, m.localIndex]).sort(), [[1, 2], [2, 1]]);
    assert.equal(r.needsReview, false);
  });

  it('pairs leftovers by position and flags them for review', () => {
    const r = run('compareArrays([null, "Alpha", "Beta"], [null, "Alpha", "Gamma"], "team")');
    const byPos = r.matches.find((m) => m.confidence === 'position');
    assert.deepEqual([byPos.remoteIndex, byPos.localIndex], [2, 2]);
    assert.equal(r.needsReview, true);
  });

  it('reports items that exist on only one side', () => {
    const r = run('compareArrays([null, "A"], [null, "A", "B"], "block")');
    assert.deepEqual(r.unmatched.remote, [{ index: 2, name: 'B' }]);
    assert.equal(r.needsReview, true);
    const r2 = run('compareArrays([null, "A", "Local only"], [null, "A"], "block")');
    assert.deepEqual(r2.unmatched.local, [{ index: 2, name: 'Local only' }]);
  });

  it('summarises matches across teams, blocks and questions', () => {
    const stats = run(`getMatchStats(compareSessionData(
      { teams: [null, "A"], blocks: [null, "B1"], questions: [null, "Q1"] },
      { teams: [null, "a", "New"], blocks: [null, "b1"], questions: [null, "Q1"] }))`);
    assert.equal(stats.teams.total, 2);
    assert.equal(stats.teams.exact, 1);
    assert.equal(stats.blocks.needsReview, false);
    assert.equal(stats.overallNeedsReview, true);
  });

  it('tolerates missing arrays', () => {
    const stats = run('getMatchStats(compareSessionData({}, {}))');
    assert.equal(stats.overallNeedsReview, false);
  });
});
