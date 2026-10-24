const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('../helpers/dom');
const { createYjsDoc } = require('../helpers/yjs-seeds');

function seed() {
  return createYjsDoc({
    currentSession: 1,
    sessions: [{ name: 'Regional', maxPointsPerQuestion: 6, rounding: false, teams: ['Team 1'], blocks: ['No Block'], questions: [], currentQuestion: 1 }]
  });
}

function lastEntryUser(context) {
  const log = context.getActiveSessionDoc().getMap('session').get('historyLog');
  return log.get(log.length - 1).get('user');
}

test('history entries are local (no user) when the quiz does not sync', () => {
  const { context } = loadApp(seed());
  context.add_history_entry('edit_log.actions.rename_team', 'edit_log.details_templates.renamed', { old: 'a', new: 'b' });
  assert.ok(!lastEntryUser(context));
});

test('history entries carry the signed-in email while the quiz syncs to a cloud folder', () => {
  const { context } = loadApp(seed());
  context.FolderSync = { getScorerName: () => 'scorer@example.org' };
  context.add_history_entry('edit_log.actions.rename_team', 'edit_log.details_templates.renamed', { old: 'a', new: 'b' });
  assert.strictEqual(lastEntryUser(context), 'scorer@example.org');
});
