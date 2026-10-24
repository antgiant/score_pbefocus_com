/**
 * @fileoverview Unit tests for iframe embedding event emission.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { loadApp } = require('../helpers/dom');
const { createYjsDoc } = require('../helpers/yjs-seeds');

function loadEmbeddingApp() {
  const { context } = loadApp(createYjsDoc({
    currentSession: 1,
    sessions: [{
      name: 'Event Session',
      teams: ['Alpha', 'Beta'],
      blocks: ['No Block', 'Round 1'],
      questions: [
        {
          name: 'Question 1',
          score: 5,
          block: 0,
          teamScores: [{ score: 0 }, { score: 0 }],
        },
        {
          name: 'Question 2',
          score: 4,
          block: 1,
          teamScores: [{ score: 1 }, { score: 2 }],
        },
      ],
      currentQuestion: 1,
    }],
  }));

  context.EmbeddingAPI.resetForTests();
  context.EmbeddingCommands.resetForTests();
  context.EmbeddingEvents.resetForTests();
  context.EmbeddingCommands.init();
  context.EmbeddingEvents.init();
  return context;
}

function createSource() {
  return {
    messages: [],
    postMessage(message) {
      this.messages.push(message);
    },
  };
}

function subscribeAll(context) {
  const source = createSource();
  context.EmbeddingAPI.subscribe(source, 'https://host.example.test', '*');
  return source;
}

function eventNames(source) {
  return source.messages
    .filter((message) => message.type === 'embedding:event')
    .map((message) => message.event);
}

function events(source, eventName) {
  return source.messages
    .filter((message) => message.type === 'embedding:event' && message.event === eventName)
    .map((message) => JSON.parse(JSON.stringify(message.data)));
}

function runInApp(context, code) {
  return vm.runInContext(code, context);
}

test('embedding events observe session score, ignore, block, and navigation changes', () => {
  const context = loadEmbeddingApp();
  const source = subscribeAll(context);
  const sessionDoc = context.getActiveSessionDoc();
  const session = context.get_current_session();

  context.setTeamScore(sessionDoc, session, 'q-1', 't-test-1-1', 3);
  context.updateQuestionIgnore(sessionDoc, session, 'q-1', true);
  context.updateQuestionBlock(sessionDoc, session, 'q-1', 'b-test-1-2');
  context.update_data_element('next_question');

  const names = eventNames(source);
  assert.ok(names.includes('question:scored'));
  assert.ok(names.includes('question:ignored'));
  assert.ok(names.includes('question:block-changed'));
  assert.ok(names.includes('question:changed'));
  assert.ok(names.includes('session:stateChanged'));

  const scored = events(source, 'question:scored').at(-1);
  assert.equal(scored.id, 'q-1');
  assert.equal(scored.teamScores['t-test-1-1'].score, 3);

  const changed = events(source, 'question:changed').at(-1);
  assert.equal(changed.id, 'q-2');
  assert.equal(changed.reason, 'next_question');
});

test('embedding events observe global session and UI preference changes', () => {
  const context = loadEmbeddingApp();
  const source = subscribeAll(context);
  runInApp(context, `
    var globalDoc = getGlobalDoc();
    var meta = globalDoc.getMap('meta');
    var sessionNames = meta.get('sessionNames');

    globalDoc.transact(function() {
      sessionNames.set('test-session-2', 'Second Session');
      meta.set('sessionOrder', ['test-session-1', 'test-session-2']);
    }, 'test');

    globalDoc.transact(function() {
      meta.set('currentSession', 'test-session-2');
    }, 'test');

    globalDoc.transact(function() {
      sessionNames.set('test-session-2', 'Renamed Second');
      meta.set('themePreference', 'dark');
      meta.set('languagePreference', 'fr');
    }, 'test');

    globalDoc.transact(function() {
      sessionNames.delete('test-session-2');
      meta.set('sessionOrder', ['test-session-1']);
      meta.set('currentSession', 'test-session-1');
    }, 'test');
  `);

  const names = eventNames(source);
  assert.ok(names.includes('session:created'));
  assert.ok(names.includes('session:switched'));
  assert.ok(names.includes('session:renamed'));
  assert.ok(names.includes('session:deleted'));
  assert.ok(names.includes('ui:themeChanged'));
  assert.ok(names.includes('ui:languageChanged'));

  assert.equal(events(source, 'session:created')[0].id, 'test-session-2');
  assert.equal(events(source, 'session:renamed').at(-1).name, 'Renamed Second');
  assert.equal(events(source, 'ui:themeChanged').at(-1).theme, 'dark');
  assert.equal(events(source, 'ui:languageChanged').at(-1).preference, 'fr');
});

