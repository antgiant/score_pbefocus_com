const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('../helpers/dom.js');
const { buildMultiSessionSeed, buildBasicSeed } = require('../helpers/yjs-seeds.js');

// Session Manager tests - focus on the underlying data functions
// DOM dialog tests would require browser environment

test.describe('Session Manager Functions', function() {

  test('renameSession updates session name in Yjs', function() {
    const { context } = loadApp(buildMultiSessionSeed(2));
    
    const sessions = context.getAllSessions();
    const sessionId = sessions[1].id;
    const newName = 'Renamed Session';

    context.renameSession(sessionId, newName);

    const sessionDoc = context.getSessionDoc(sessionId);
    const session = sessionDoc.getMap('session');
    assert.strictEqual(session.get('name'), newName);
  });

  test('renameSession updates session name cache in global doc', function() {
    const { context } = loadApp(buildMultiSessionSeed(2));
    
    const sessions = context.getAllSessions();
    const sessionId = sessions[1].id;
    const newName = 'Renamed Session 2';

    context.renameSession(sessionId, newName);

    const meta = context.getGlobalDoc().getMap('meta');
    const sessionNames = meta.get('sessionNames');
    assert.strictEqual(sessionNames.get(sessionId), newName);
  });

  test('renameSession is reflected in getAllSessions', function() {
    const { context } = loadApp(buildMultiSessionSeed(2));
    
    const sessions = context.getAllSessions();
    const sessionId = sessions[1].id;
    const newName = 'Updated Session Name';

    context.renameSession(sessionId, newName);

    const updatedSessions = context.getAllSessions();
    const renamedSession = updatedSessions.find(s => s.id === sessionId);
    assert.strictEqual(renamedSession.name, newName);
  });

  test('reorderSessions updates sessionOrder in global doc', function() {
    const { context } = loadApp(buildMultiSessionSeed(3));
    
    const sessions = context.getAllSessions();
    const newOrder = [sessions[2].id, sessions[0].id, sessions[1].id];

    context.reorderSessions(newOrder);

    const sessionOrder = context.get_session_order();
    // Convert both to plain arrays for comparison since Yjs may return special objects
    assert.deepStrictEqual(Array.from(sessionOrder), Array.from(newOrder));
  });

  test('reorderSessions is reflected in getAllSessions order', function() {
    const { context } = loadApp(buildMultiSessionSeed(3));
    
    const originalSessions = context.getAllSessions();
    const newOrder = [originalSessions[2].id, originalSessions[0].id, originalSessions[1].id];

    context.reorderSessions(newOrder);

    const reorderedSessions = context.getAllSessions();
    assert.strictEqual(reorderedSessions[0].id, originalSessions[2].id);
    assert.strictEqual(reorderedSessions[1].id, originalSessions[0].id);
    assert.strictEqual(reorderedSessions[2].id, originalSessions[1].id);
  });

  test('reorderSessions updates session indices', function() {
    const { context } = loadApp(buildMultiSessionSeed(3));
    
    const originalSessions = context.getAllSessions();
    const newOrder = [originalSessions[2].id, originalSessions[0].id, originalSessions[1].id];

    context.reorderSessions(newOrder);

    const reorderedSessions = context.getAllSessions();
    assert.strictEqual(reorderedSessions[0].index, 1);
    assert.strictEqual(reorderedSessions[1].index, 2);
    assert.strictEqual(reorderedSessions[2].index, 3);
  });

  test('renaming current session triggers display update', function() {
    const { context } = loadApp(buildMultiSessionSeed(2));
    
    // Get current session ID
    const currentSessionId = context.DocManager.activeSessionId;
    const newName = 'Current Session Renamed';

    // Rename should not throw
    context.renameSession(currentSessionId, newName);

    // Verify the update happened
    const session = context.get_current_session();
    assert.strictEqual(session.get('name'), newName);
  });

  test('getAllSessions returns correct structure', function() {
    const { context } = loadApp(buildMultiSessionSeed(3));
    
    const sessions = context.getAllSessions();
    
    assert.ok(Array.isArray(sessions), 'Should return an array');
    assert.strictEqual(sessions.length, 3, 'Should have 3 sessions');
    
    sessions.forEach(function(session, index) {
      assert.ok(session.id, 'Session should have id');
      assert.ok(session.name, 'Session should have name');
      assert.strictEqual(session.index, index + 1, 'Session should have correct 1-based index');
    });
  });

  test('createSessionManagerDialogHTML generates valid HTML', function() {
    const { context } = loadApp(buildMultiSessionSeed(2));
    
    const sessions = context.getAllSessions();
    const currentSessionId = context.DocManager.activeSessionId;
    
    const html = context.createSessionManagerDialogHTML(sessions, currentSessionId);
    
    assert.ok(html.includes('session-manager-dialog'), 'Should have dialog class');
    assert.ok(html.includes('session-manager-list'), 'Should have list');
    assert.ok(html.includes(sessions[0].name), 'Should include first session name');
    assert.ok(html.includes(sessions[1].name), 'Should include second session name');
  });

  test('createSessionManagerDialogHTML marks current session', function() {
    const { context } = loadApp(buildMultiSessionSeed(2));
    
    const sessions = context.getAllSessions();
    const currentSessionId = context.DocManager.activeSessionId;
    
    const html = context.createSessionManagerDialogHTML(sessions, currentSessionId);
    
    assert.ok(html.includes('current-session'), 'Should have current-session class');
    assert.ok(html.includes('session-manager-current-badge'), 'Should have current badge');
  });

  test('createSessionManagerDialogHTML disables delete when only one session', function() {
    const { context } = loadApp(buildBasicSeed());
    
    const sessions = context.getAllSessions();
    const currentSessionId = context.DocManager.activeSessionId;
    
    const html = context.createSessionManagerDialogHTML(sessions, currentSessionId);
    
    assert.ok(html.includes('disabled'), 'Delete button should be disabled');
  });

  test('createSessionManagerDialogHTML enables delete with multiple sessions', function() {
    const { context } = loadApp(buildMultiSessionSeed(3));
    
    const sessions = context.getAllSessions();
    const currentSessionId = context.DocManager.activeSessionId;
    
    const html = context.createSessionManagerDialogHTML(sessions, currentSessionId);
    
    // Count disabled occurrences - should not have disabled delete buttons
    const disabledCount = (html.match(/disabled/g) || []).length;
    // There might be disabled in title attribute for info, but actual disabled attr should be 0
    const deleteButtonPattern = /session-manager-delete-btn[^>]*disabled(?!=)/;
    assert.ok(!deleteButtonPattern.test(html), 'Delete buttons should not be disabled');
  });

test('createSessionManagerDialogHTML shows cloud icon when session has a cloud folder', function() {
    const { context } = loadApp(buildMultiSessionSeed(2));
    
    const sessions = context.getAllSessions();
    const currentSessionId = context.DocManager.activeSessionId;
    
    // Cloud folder settings are kept per session on this device
    context.localStorage.setItem('pbe-folder-sync:' + sessions[0].id, JSON.stringify({ provider: 'google' }));
    
    const html = context.createSessionManagerDialogHTML(sessions, currentSessionId);
    
    assert.ok(html.includes('session-manager-sync-icon'), 'Should have cloud icon for session with cloud folder');
    assert.equal((html.match(/session-manager-sync-icon/g) || []).length, 1, 'Only the configured session gets the icon');
  });

  test('createSessionManagerDialogHTML does not show cloud icon when no cloud folder', function() {
    const { context } = loadApp(buildMultiSessionSeed(2));
    
    const sessions = context.getAllSessions();
    const currentSessionId = context.DocManager.activeSessionId;
    
    // No cloud folders configured - no icons
    const html = context.createSessionManagerDialogHTML(sessions, currentSessionId);
    
    assert.ok(!html.includes('session-manager-sync-icon'), 'Should not have cloud icon when no cloud folder');
  });
});


