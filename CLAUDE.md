# AI Agent Guidelines

These instructions apply to any AI assistant working in this repository.

## Testing
- All tests must always pass.
- Run the full test suite (`node --test`) after any change that could affect behavior.
- If tests cannot be run, state why and provide the closest possible validation.
- Use the summary reporter when you want a compact output (`node --test --test-reporter ./tests/helpers/table-reporter.js`).

## Versioning
- **All new features and bug fixes require incrementing the version number.**
- The version is located in `index.html` in the footer section: `<p><center>v X.X.X</center></p>`
- Use semantic versioning: MAJOR.MINOR.PATCH
  - PATCH: Bug fixes, minor improvements
  - MINOR: New features, non-breaking changes
  - MAJOR: Breaking changes, major rewrites

## Internationalization (i18n)

### Translation-Friendly Content Guidelines

**NEVER hardcode user-facing strings in JavaScript or HTML.** All text must go through the i18n system.

When writing code:
- Use `t('key.path')` for all user-visible strings
- Use `t_plural('key.path', count)` for pluralized strings
- Use `t('key.path', { var: value })` for strings with variables
- Add new translation keys to `scripts/i18n/en.js` first, then all other language files

When adding UI elements:
- Add `data-i18n="key.path"` attribute for static text content
- Add `data-i18n-placeholder="key.path"` for input placeholders
- Add `data-i18n-title="key.path"` for title/tooltip attributes
- The system auto-translates elements with these attributes on language change

String formatting guidelines:
- Use `{{variable}}` placeholders for dynamic content (e.g., `"Hello, {{name}}"`)
- Avoid concatenating translated strings; use placeholders instead
- Keep sentences whole; don't split them across multiple keys
- Provide `_one` and `_other` variants for pluralized strings

### Adding a New Language

To add a new language (e.g., German `de`):

1. **Create the language file** `scripts/i18n/de.js`:
   ```javascript
   register_i18n_language('de', {
     name: 'Deutsch',           // Language name in that language
     locale: 'de',              // Locale for number/date formatting
     rtl: false,                // Set true for right-to-left languages
     translations: {
       // Copy structure from en.js and translate all values
     }
   });
   ```

2. **Add script tag in `index.html`** (after `app-i18n.js`, before `app.js`):
   ```html
   <script src="scripts/i18n/de.js"></script>
   ```
   
   **Note:** The language dropdown is dynamically populated from registered languages, so no HTML changes are needed for the selector.

3. **Create README translation** `README.de.md`:
   - Translate the README content
   - Include the language selector at the top

4. **Update language selectors** in all README files:
   ```markdown
   🌐 [English](README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | ...
   ```

5. **Run tests** to verify all translation keys are present:
   ```bash
   node --test tests/unit/i18n.test.js
   ```

### Current Languages

| Code | Name | File | README |
|------|------|------|--------|
| `en` | English | `scripts/i18n/en.js` | `README.md` |
| `es` | Español (Spanish) | `scripts/i18n/es.js` | `README.es.md` |
| `fr` | Français (French) | `scripts/i18n/fr.js` | `README.fr.md` |
| `pig` | Secret Code (Pig Latin) | `scripts/i18n/pig.js` | `README.pig.md` |

### i18n Functions Reference

Available in `app-i18n.js`:
- `t(key, params)` - Get translated string with optional interpolation
- `t_plural(key, count, params)` - Get pluralized string
- `get_current_language()` - Get active language code
- `set_language(code)` - Change language and update UI
- `get_available_languages()` - Get map of code → display name
- `is_language_available(code)` - Check if language is loaded

## Export Requirements
**ALL EXPORTS MUST BE NATIVE YJS BINARY FORMAT**
- Exports MUST use `Y.encodeStateAsUpdate()` to create native Yjs binary format
- Exported files MUST be importable via `Y.applyUpdate()` for merging into existing documents
- File extension `.yjs` indicates native Yjs binary format that can be merged
- JSON exports are acceptable ONLY as fallback format (use `.json` extension)
- When importing, the system MUST support merging native Yjs exports without data loss

## Test Structure
- Place pure logic tests under `tests/unit/`.
- Place UI/DOM interaction tests under `tests/ui/`.
- Shared utilities belong in `tests/helpers/`.

## JavaScript Structure
- Keep browser logic split across the focused scripts in `scripts/` and only bootstrap in `app.js`.
- Update `index.html` script order when adding/removing script files.

## Yjs Library Bundle

The application uses Yjs for CRDT-based data synchronization. The Yjs libraries are bundled into a single browser-ready file at `scripts/yjs-bundle.min.js`.

### Rebuilding the Yjs Bundle

If you need to update the Yjs libraries or rebuild the bundle:

1. **Install dependencies** (if not already installed):
   ```bash
   npm install --save-dev esbuild yjs y-indexeddb
   ```

2. **Create a temporary build script** (`build-yjs.js`):
   ```javascript
   const esbuild = require('esbuild');
   const fs = require('fs');

   const yjsEntry = `
   import * as Y from 'yjs';
   import { IndexeddbPersistence } from 'y-indexeddb';

   window.Y = Y;
   window.IndexeddbPersistence = IndexeddbPersistence;
   window.yjsModulesLoaded = true;
   window.dispatchEvent(new Event('yjsModulesLoaded'));
   `;

   fs.writeFileSync('yjs-bundle-entry.js', yjsEntry);

   esbuild.build({
     entryPoints: ['yjs-bundle-entry.js'],
     bundle: true,
     format: 'iife',
     outfile: 'scripts/yjs-bundle.min.js',
     minify: true,
     platform: 'browser',
   }).then(() => {
     console.log('✓ Yjs bundle created successfully');
     fs.unlinkSync('yjs-bundle-entry.js');
   }).catch((err) => {
     console.error('Build failed:', err);
     process.exit(1);
   });
   ```

3. **Run the build**:
   ```bash
   node build-yjs.js
   ```

4. **Clean up**:
   ```bash
   rm build-yjs.js
   ```

The bundle exposes `window.Y` and `window.IndexeddbPersistence` globally and dispatches a `yjsModulesLoaded` event when ready.

## Multi-Doc Yjs Architecture (v4.0+)

### Architecture Overview

The application is a multi-doc architecture where:
- **Global metadata Y.Doc** (`pbe-score-keeper-global`): Stores only session list metadata and current session tracking
- **Per-session Y.Docs**: Each session is a separate Y.Doc for conflict-free import/export and session isolation

### Session Data Structure (v4.0 - UUID-based)

Sessions use UUID-keyed maps for teams, questions, and blocks to enable conflict-free CRDT merging:

```
Y.Doc (per session)
├── dataVersion: 5.0
├── nextQuestionNumber: N (counter for deterministic question IDs)
├── teamsById (Y.Map)
│   ├── "t-{uuid}": { id, name, deleted }
│   └── ...
├── teamOrder (Y.Array) → ["t-{uuid1}", "t-{uuid2}", ...]
├── questionsById (Y.Map)
│   ├── "q-1": { id, name, score, blockId, ignore, teamScores: {teamId: {score, extraCredit}} }
│   ├── "q-2": { ... }
│   └── ...
├── questionOrder (Y.Array) → ["q-1", "q-2", ...] (kept for v4 compatibility)
├── blocksById (Y.Map)
│   ├── "b-{uuid}": { id, name, isDefault, deleted }
│   └── ...
├── blockOrder (Y.Array) → ["b-{uuid1}", "b-{uuid2}", ...]
└── config (Y.Map)
    ├── maxPointsPerQuestion
    ├── rounding
    └── ...
```

**ID Formats:**
- Teams: `t-{uuid}` (e.g., `t-a1b2c3d4-...`) - Random UUID
- Questions: `q-{N}` (e.g., `q-1`, `q-2`, `q-3`) - Deterministic sequential numbers
- Blocks: `b-{uuid}` (e.g., `b-i9j0k1l2-...`) - Random UUID

**Deterministic Question IDs (v5.0):**
Questions use deterministic sequential IDs (`q-1`, `q-2`, `q-3`, ...) instead of random UUIDs.
This eliminates duplicate detection complexity and enables natural ordering by ID number.
The `nextQuestionNumber` counter tracks the next ID to assign.

**Soft-Delete Pattern:**
Teams and blocks use `deleted: true` field instead of physical removal from maps. 
Questions are never deleted - use `ignore: true` flag for scoring exclusion instead.

**Ordered Getter Functions:**
- `getOrderedTeams()` - Returns non-deleted teams in `teamOrder` sequence
- `getOrderedQuestions()` - Returns questions sorted by numeric ID (q-1, q-2, q-3...)
- `getOrderedBlocks()` - Returns non-deleted blocks in `blockOrder` sequence

**Legacy v3/v4 Support:**
- Sessions with `dataVersion < 4.0` use the old array-based structure (`teams`, `questions`, `blocks`)
- Sessions with `dataVersion == 4.0` use random UUID question IDs and `questionOrder` array
- The system auto-migrates v3 sessions to v4 on load when `AUTO_MIGRATE_TO_V4` is true

### DocManager Abstraction

All Y.Doc access goes through the `DocManager` object in `app-yjs.js`:
- `getGlobalDoc()` - Returns global metadata doc
- `getActiveSessionDoc()` - Returns current session's doc
- `getSessionDoc(sessionId)` - Returns specific session doc by ID
- `get_current_session_index()` - Returns 1-based session index (replaces legacy `current_session` global)
- `isUUIDSession(session)` - Check if session uses v4/v5 UUID structure
- `isDeterministicSession(session)` - Check if session uses v5.0 deterministic question IDs

### Session Management Functions

Available in `app-state.js`:
- `generateSessionId()` - Creates UUID for new session
- `createNewSession(name)` - Creates session with copied settings
- `switchSession(sessionId)` - Changes active session
- `deleteSession(sessionId)` - Removes session with safeguards
- `getAllSessions()` - Returns array of all sessions
- `updateSessionLastModified(sessionId)` - Updates timestamp for session tracking

### Export/Import Functions

Available in `app-import-export.js`:
- `exportSession(sessionNum)` - Exports single session as native Yjs binary (can be merged via Y.applyUpdate)
- `exportAllSessions()` - Exports global Y.Doc and all referenced session docs as native Yjs binary with metadata
- `downloadBinaryExport(binary, filename)` - Triggers browser download of binary file
- `importSessionData(data)` - Universal import supporting native Yjs binary (single/multi-doc) and legacy JSON

Also in `app-state.js`:
- `detectImportFormat(data)` - Auto-detect format (binary-single, binary-full, json-v3, json-legacy)

**CRITICAL: Export/Import Specifications**
- All `.yjs` exports are native Yjs binary format created via `Y.encodeStateAsUpdate()`
- `exportAllSessions()` returns `{ version, exportedAt, global: Uint8Array, sessions: {} }`
  - `global`: Encoded state of global Y.Doc (metadata and session references)
  - `sessions`: Map of individual session doc states keyed by their session UUID
- Exported files can be merged using `Y.applyUpdate(targetDoc, binaryData)` for conflict-free sync
- **Import preserves session UUIDs** for conflict-free merging of the same session across devices
- Import function handles all formats:
  - **binary-full**: Multi-doc exports with global + individual session docs (UUIDs preserved)
  - **binary-single**: Single session exports (UUID preserved if present in session doc)
  - **json-v3/json-legacy**: Legacy JSON save files from previous versions (new UUIDs generated)
- This enables conflict-free synchronization across different sessions and users

### Loading and Error Handling

Available in `app-display.js`:
- `showLoading(message)` - Show loading indicator with message
- `hideLoading()` - Hide loading indicator
- `showError(message, recoveryOptions)` - Show error with recovery options
- `disableSessionControls()` - Disable session switching during operations
- `enableSessionControls()` - Enable session switching when ready

### Key Design Decisions

1. **Session IDs**: Generated as UUIDs via `generateSessionId()`
2. **Session List Ordering**: New sessions inserted at end of array
3. **Export Format**: Binary by default (compact), JSON supported on import
4. **Import Behavior**: Always creates new sessions (no merge ambiguity)
5. **Error Handling**: Skip-and-continue for batch operations with user feedback

### Multi-Doc Architecture

The application operates in multi-doc mode with:
- **Global Y.Doc**: Stores metadata (dataVersion, currentSession) and session references
- **Per-session Y.Docs**: Each session has its own Y.Doc for isolation and independent import/export
- **DocManager**: Centralizes access to all docs via getter/setter functions

IndexedDB persistence uses separate keys for each Y.Doc (`pbe-score-keeper-global`, `pbe-score-keeper-session-{id}`).

## Cloud Folder Sync Architecture

### Overview

Optional per-quiz sync to a cloud folder (Google Drive or OneDrive) replaces the old WebRTC rooms. IndexedDB stays the primary store; the folder is a replica that several scorers can share. Plan and decisions: `docs/upgrade-plan.md`. Registration steps: `SYNC_SETUP.md`.

### Components (all lazy-loaded as the `folderSync` feature in `app.js`)

- `scripts/app-folder-sync-engine.js` - `FolderSyncEngine`: provider-independent outbox/pull engine (Yjs and the backend are injected)
- `scripts/app-folder-providers.js` - `FolderProviders`: Google Drive and OneDrive (Graph) REST backends, share-link resolution, session marker
- `scripts/app-folder-auth.js` - `FolderAuth`: browser sign-in and pickers (Google Identity Services + Picker, MSAL); SDKs load only when a provider is chosen
- `scripts/app-folder-sync.js` - `FolderSync`: per-session settings (`localStorage` key `pbe-folder-sync:{sessionId}`), polling loop, status
- `scripts/app-folder-sync-ui.js` - Storage & Sync dialog and header status button (`showStorageDialog()`)
- `scripts/app-sync-config.js` - client IDs (empty placeholders until registrations exist)

### Folder layout and rules

- One folder per session: `pbe-session.json` marker, `c-{clientId}.yjs` outbox per device, optional `snapshot-{clientId}.yjs`
- Every device writes only its own files; the app never deletes other devices' files
- Remote updates are applied with origin `'remote-folder'` and are never re-uploaded
- Revisions (modified time/size/ETag) only decide what to download, never ordering
- Sync is opt-in per session and the global session list is not synced
- Private backup uses the app's own `PBE Focus` folder; shared folders are picked (Google Picker) or resolved from a pasted share link (OneDrive)

### Connectivity

- Adaptive polling (about 15s while scoring, 60s idle, paused when the tab is hidden), exponential backoff honoring `Retry-After`
- Flush on `online`, `visibilitychange`, `pagehide`; "Sync now" button
- Status: synced / changes waiting / syncing / offline / sign-in needed / problem; expired sign-in shows Reconnect while local scoring continues
- Large events: above 20 distinct scorers (back to standard at 15 or fewer) ordinary devices read relay snapshots only; the 3 lowest client ids among recently active devices relay (pull all outboxes, publish `snapshot-{clientId}.yjs` at most every 30s when something changed). Election is derived from the folder listing (file modified times), so no locks. Without a fresh snapshot (3 min) devices read outboxes
- Scorer name: history entries carry the signed-in account's email while syncing (`FolderSync.getScorerName()`, from `FolderAuth.*.getUserEmail()`); it is visible to everyone with folder access

### Shared helpers and merge matching

- `scripts/app-ui-utils.js` - `showToast`, `trapFocus`, `escapeHtml`, `announceToScreenReader`
- `scripts/app-session-matching.js` - `compareSessionData`, `getMatchStats` used by the quiz merge flow

### Testing

- Unit tests: `tests/unit/folder-sync-engine.test.js` (mock folder backend in `tests/helpers/mock-folder-backend.js`), `tests/unit/folder-providers.test.js`, `tests/unit/session-matching.test.js`
- UI tests: `tests/ui/folder-sync-dialog.test.js` (own context; the shared DOM harness runs timers immediately)
- Real Google/OneDrive sign-in needs manual testing with real client IDs

### Session Manager

The session manager modal allows users to rename, reorder, and delete sessions from a single dialog.

#### Key Functions

Available in `app-state.js`:
- `showSessionManagerDialog()` - Opens the session manager modal
- `createSessionManagerDialogHTML(sessions, currentSessionId)` - Generates modal HTML
- `renameSession(sessionId, newName)` - Renames a session
- `reorderSessions(newOrder)` - Reorders sessions to a new order

#### Features
- Inline editing of session names
- Drag-and-drop reordering (with touch support)
- Delete sessions (disabled when only one session exists)
- Current session is highlighted
- Accessible with keyboard navigation

### Testing

- **Total Tests**: 341
- **Passing**: 341
- **Failed**: 0
- **Skipped**: 0
- **Test Files**:
  - UI tests: blocks, cross-tab-sync, exports, extra-credit, folder-sync-dialog, history-scorer-name, ignore-question, max-points, reorder, rounding, score-summaries, session-manager, session-question-jump, sessions, teams, timer, ui-mode
  - Unit tests: calculations, core, created-at-backfill, embedding (api, client, commands, events, integration), folder-providers, folder-sync-engine, header-menu, i18n, i18n-ui, import-export, multi-doc, no-duplicates, pwa-handlers, pwa-support, repair-cache, session-matching, snapshot, timer-inputs, uuid-structures

### Notes for Maintainers

- All functions fully documented with JSDoc comments
- No breaking changes to existing API
- Full backward compatibility maintained (v3 sessions auto-migrate to v4)
- IndexedDB naming: `pbe-score-keeper-global` and `pbe-score-keeper-session-{id}`
- Tests provide comprehensive coverage of new architecture
- Always use ordered getter functions (`getOrderedTeams()`, etc.) not raw maps


