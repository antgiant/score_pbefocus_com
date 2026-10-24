/**
 * @fileoverview Unit tests for iframe embedding command handlers.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('../helpers/dom');
const { createYjsDoc } = require('../helpers/yjs-seeds');

function loadEmbeddingApp() {
  const seed = createYjsDoc({
    currentSession: 1,
    sessions: [{
      name: 'Embedded Session',
      maxPointsPerQuestion: 10,
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
  });
  const { context, localStorage } = loadApp(seed);
  context.EmbeddingAPI.resetForTests();
  context.EmbeddingCommands.resetForTests();
  context.EmbeddingCommands.init();
  return { context, localStorage };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function dispatch(context, command, payload = {}) {
  return context.EmbeddingAPI.dispatchCommand(command, payload, {
    origin: 'https://app.example.test',
  });
}

test('embedding command module registers the command surface', () => {
  const { context } = loadEmbeddingApp();
  const commandNames = Array.from(context.EmbeddingCommands.commandNames);

  assert.equal(commandNames.length, 46);
  assert.equal(commandNames.some((name) => name.startsWith('sync:')), false);
  for (const command of commandNames) {
    assert.equal(typeof context.EmbeddingAPI.commandHandlers[command], 'function', command);
  }
});

test('batch command runs validated multi-command sequences', async () => {
  const { context } = loadEmbeddingApp();

  const batch = plain(await dispatch(context, 'batch:run', {
    atomic: true,
    commands: [
      {
        command: 'question:create',
        payload: { name: 'Batch Question', maxPoints: 5 },
      },
      {
        command: 'score:set',
        payload: { teamIndex: 1, score: 3 },
      },
      {
        command: 'score:getTotalPoints',
        payload: {},
      },
    ],
  }));

  assert.equal(batch.count, 3);
  assert.equal(batch.results.every((result) => result.ok), true);
  assert.equal(batch.results[0].result.name, 'Batch Question');
  assert.equal(batch.results[2].result.total, 3);
});

test('atomic batch validation prevents mutation when command list is invalid', async () => {
  const { context } = loadEmbeddingApp();

  await assert.rejects(
    () => dispatch(context, 'batch:run', {
      atomic: true,
      commands: [
        {
          command: 'score:set',
          payload: { teamIndex: 1, score: 4 },
        },
        {
          command: 'missing:command',
          payload: {},
        },
      ],
    }),
    (error) => error.code === 'unknown_command'
  );

  const totals = plain(await dispatch(context, 'score:getTotalPoints'));
  assert.equal(totals.total, 0);
});

test('session commands list, create, rename, switch, and delete sessions', async () => {
  const { context } = loadEmbeddingApp();

  const initial = plain(await dispatch(context, 'session:list'));
  assert.equal(initial.sessions.length, 1);
  assert.equal(initial.currentSessionId, 'test-session-1');

  const created = plain(await dispatch(context, 'session:create', { name: 'Created by Host' }));
  assert.equal(created.session.name, 'Created by Host');
  assert.equal(created.session.current, true);

  await dispatch(context, 'session:rename', { name: 'Renamed by Host' });
  const renamed = plain(await dispatch(context, 'session:getCurrent'));
  assert.equal(renamed.session.name, 'Renamed by Host');

  await dispatch(context, 'session:switch', { sessionId: 'test-session-1' });
  const switched = plain(await dispatch(context, 'session:getCurrent'));
  assert.equal(switched.session.id, 'test-session-1');

  await dispatch(context, 'session:delete', { sessionId: created.session.id });
  const finalList = plain(await dispatch(context, 'session:list'));
  assert.equal(finalList.sessions.length, 1);
  assert.equal(finalList.sessions[0].id, 'test-session-1');
});

test('question commands navigate and mutate current question state', async () => {
  const { context } = loadEmbeddingApp();

  const second = plain(await dispatch(context, 'question:goto', { number: 2 }));
  assert.equal(second.id, 'q-2');
  assert.equal(second.number, 2);

  const renamed = plain(await dispatch(context, 'question:rename', { name: 'Renamed Q2' }));
  assert.equal(renamed.name, 'Renamed Q2');

  const sanitized = plain(await dispatch(context, 'question:rename', { name: 'Clean\u0001Name' }));
  assert.equal(sanitized.name, 'CleanName');

  const points = plain(await dispatch(context, 'question:setMaxPoints', { maxPoints: 7 }));
  assert.equal(points.maxPoints, 7);

  const block = plain(await dispatch(context, 'question:setBlock', { blockIndex: 0 }));
  assert.equal(block.blockIndex, 0);

  const ignored = plain(await dispatch(context, 'question:ignore', { ignore: true }));
  assert.equal(ignored.ignore, true);

  const created = plain(await dispatch(context, 'question:create', {
    name: 'Host Question',
    maxPoints: 3,
  }));
  assert.equal(created.name, 'Host Question');
  assert.equal(created.number, 3);

  const previous = plain(await dispatch(context, 'question:previous'));
  assert.equal(previous.number, 2);

  const deleted = plain(await dispatch(context, 'question:delete', { questionId: 'q-2' }));
  assert.equal(deleted.ignore, true);
  assert.equal(deleted.deleteMode, 'ignored');
});

test('score commands validate max points and report totals', async () => {
  const { context } = loadEmbeddingApp();

  const score = plain(await dispatch(context, 'score:set', {
    teamIndex: 1,
    score: 4,
  }));
  assert.equal(score.questionId, 'q-1');
  assert.equal(score.teamIndex, 1);
  assert.equal(score.score, 4);

  const extraCredit = plain(await dispatch(context, 'score:setExtraCredit', {
    teamIndex: 1,
    extraCredit: 2,
  }));
  assert.equal(extraCredit.extraCredit, 2);
  assert.equal(extraCredit.total, 6);

  const totals = plain(await dispatch(context, 'score:getTotalPoints'));
  assert.equal(totals.scoreTotal, 4);
  assert.equal(totals.extraCreditTotal, 2);
  assert.equal(totals.total, 6);

  await assert.rejects(
    () => dispatch(context, 'score:set', { teamIndex: 1, score: 9 }),
    (error) => error.code === 'invalid_parameter'
  );
});

test('block commands create, rename, set default, and list blocks', async () => {
  const { context } = loadEmbeddingApp();

  const created = plain(await dispatch(context, 'block:create', { name: 'Final' }));
  assert.equal(created.name, 'Final');
  assert.equal(created.index, 2);

  const renamed = plain(await dispatch(context, 'block:rename', {
    blockId: created.id,
    name: 'Championship',
  }));
  assert.equal(renamed.name, 'Championship');

  const defaultBlock = plain(await dispatch(context, 'block:setDefault', {
    blockId: created.id,
  }));
  assert.equal(defaultBlock.isDefault, true);

  const list = plain(await dispatch(context, 'block:list'));
  assert.equal(list.blocks.length, 3);
  assert.equal(list.blocks.filter((block) => block.isDefault).length, 1);
});

test('timer commands persist local timer settings and duration config', async () => {
  const { context, localStorage } = loadEmbeddingApp();

  const disabled = plain(await dispatch(context, 'timer:disable'));
  assert.equal(disabled.enabled, false);
  assert.equal(localStorage.getItem('pbe_timer_enabled_test-session-1'), 'false');

  const enabled = plain(await dispatch(context, 'timer:enable'));
  assert.equal(enabled.enabled, true);

  const duration = plain(await dispatch(context, 'timer:setDuration', { totalSeconds: 90 }));
  assert.equal(duration.firstPointSeconds, 90);
  assert.equal(duration.subsequentPointSeconds, 0);

  const autoStart = plain(await dispatch(context, 'timer:setAutoStart', { autoStart: true }));
  assert.equal(autoStart.autoStart, true);
  assert.equal(localStorage.getItem('pbe_timer_auto_start_test-session-1'), 'true');
});

test('state import conflict dialog escapes content and resolves user choice', async () => {
  const { context } = loadEmbeddingApp();
  const preview = {
    conflicts: [{
      type: 'same-name',
      imported: { name: '<Shared & Quiz>' },
    }],
  };
  const html = context.EmbeddingCommands.createStateImportConflictDialogHTML(preview);
  assert.match(html, /&lt;Shared &amp; Quiz&gt;/);
  assert.doesNotMatch(html, /<Shared & Quiz>/);

  const buttons = {};
  let removed = false;
  context.document.body = {
    appendChild(overlay) {
      this.overlay = overlay;
    },
  };
  context.document.createElement = () => ({
    className: '',
    innerHTML: '',
    querySelector(selector) {
      return buttons[selector];
    },
    remove() {
      removed = true;
    },
  });
  context.document.addEventListener = () => {};
  context.document.removeEventListener = () => {};
  buttons['[data-state-import-action="cancel"]'] = {
    addEventListener(event, handler) {
      this.handler = handler;
    },
  };
  buttons['[data-state-import-action="import"]'] = {
    addEventListener(event, handler) {
      this.handler = handler;
    },
    focus() {},
  };

  const decision = context.EmbeddingCommands.showStateImportConflictDialog(preview);
  buttons['[data-state-import-action="import"]'].handler();
  assert.deepEqual(plain(await decision), { action: 'import', conflictCount: 1 });
  assert.equal(removed, true);
});

test('ui commands update theme, language, and embedded visibility', async () => {
  const { context, localStorage } = loadEmbeddingApp();
  const attrs = {};
  const classes = new Set();
  let focused = false;

  context.document.documentElement = {
    style: {
      values: {},
      setProperty(name, value) {
        this.values[name] = value;
      },
      removeProperty(name) {
        delete this.values[name];
      },
    },
    setAttribute(name, value) {
      attrs[name] = value;
    },
    getAttribute(name) {
      return attrs[name] || null;
    },
    removeAttribute(name) {
      delete attrs[name];
    },
  };
  context.document.body = {
    classList: {
      add(className) {
        classes.add(className);
      },
      remove(className) {
        classes.delete(className);
      },
      contains(className) {
        return classes.has(className);
      },
    },
    focus() {
      focused = true;
    },
  };
  context.window.focus = () => {
    focused = true;
  };
  context.sync_data_to_display = () => {};
  context.refresh_history_display = () => {};
  context.$ = () => ({
    length: 0,
    each() {
      return this;
    },
    attr() {
      return this;
    },
    text() {
      return this;
    },
    val() {
      return this;
    },
  });

  const theme = plain(await dispatch(context, 'ui:setTheme', { theme: 'dark' }));
  assert.equal(theme.theme, 'dark');
  assert.equal(localStorage.getItem('theme_preference'), 'dark');
  assert.equal(attrs['data-theme'], 'dark');

  const language = plain(await dispatch(context, 'ui:setLanguage', { language: 'fr' }));
  assert.equal(language.preference, 'fr');
  assert.equal(language.language, 'fr');
  assert.equal(localStorage.getItem('language_preference'), 'fr');

  const variables = plain(await dispatch(context, 'ui:setThemeVariables', {
    variables: {
      '--panel-bg': '#ffffff',
      '--accent-color': 'rgb(10, 20, 30)',
    },
  }));
  assert.deepEqual(variables.variables, {
    '--panel-bg': '#ffffff',
    '--accent-color': 'rgb(10, 20, 30)',
  });
  assert.equal(context.document.documentElement.style.values['--panel-bg'], '#ffffff');
  assert.equal(attrs['data-host-theme'], 'true');

  await assert.rejects(
    () => dispatch(context, 'ui:setThemeVariables', {
      variables: { '--bad': 'url(javascript:alert(1))' },
    }),
    (error) => error.code === 'invalid_parameter'
  );

  const cleared = plain(await dispatch(context, 'ui:clearThemeVariables', {
    names: ['--panel-bg'],
  }));
  assert.deepEqual(cleared.cleared, ['--panel-bg']);
  assert.equal(context.document.documentElement.style.values['--panel-bg'], undefined);

  const hidden = plain(await dispatch(context, 'ui:hide'));
  assert.equal(hidden.visible, false);
  assert.equal(attrs['data-embedding-visibility'], 'hidden');
  assert.equal(classes.has('pbe-embedding-hidden'), true);

  const shown = plain(await dispatch(context, 'ui:show'));
  assert.equal(shown.visible, true);
  assert.equal(classes.has('pbe-embedding-hidden'), false);

  const focus = plain(await dispatch(context, 'ui:focus'));
  assert.equal(focus.focused, true);
  assert.equal(focused, true);
});
