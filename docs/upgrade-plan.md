# Score Keeper upgrade plan: cloud-folder sync

Imported from the "score.pbefocus.com" planning chat. This plan applies to this repo (score.pbefocus.com) only, not to `antgiant/PBE_Score_Keeper`. Nothing in it is built yet.

Tags: **[APPROVED]** stated by the owner. **[PROPOSED]** suggested, not confirmed. **[OPEN]** pending question.

## Goal

Replace the WebRTC/WebSocket room sync with three storage modes: This device only, OneDrive folder, Google Drive folder.

- Keep Yjs. IndexedDB stays primary. [APPROVED]
- The app syncs periodically to a user-selected or user-created cloud folder. [APPROVED]
- The folder can be shared so several scorers use the same data. [APPROVED]
- Google gets Picker-only permissions (`drive.file`), not full Drive. [APPROVED]
- The old real-time code is removed entirely and the servers are decommissioned. [APPROVED]
- Load: typically 1-2 scorers, one question per 10-30s. Target 50 to hundreds of simultaneous scorers. Poor connectivity must be tolerated, syncing when it can. [APPROVED]

## Approved decisions

- Each session gets its own folder. Default: the user picks a parent folder and each session becomes a subfolder. If sharing is at session level, detect that and do not create a nested folder. The user chooses when it is ambiguous.
- Dropping live presence is fine.
- Relay mode is preferred for events of more than about 20 scorers.
- The owner creates the Google and Azure registrations.
- The owner confirmed in another project that Google Picker folder selection shows files added by other users.

## Architecture [PROPOSED]

- Core rule: every device writes only its own files. Cloud drives have no locks, and Yjs merges in any order.
- Per-session folder contents:
  - `pbe-session.json`: marker with session UUID, name and format version; tells the app a picked folder is a session folder.
  - `c-{clientId}.yjs`: outbox of this device's locally originated updates, merged with `Y.mergeUpdates`.
  - `snapshot-{clientId}.yjs`: occasional full state for new joiners and relay mode.
  - Small JSON presence/last-seen files, plus a header with format version and `dataVersion` for compatibility checks.
- Local flow: `doc.on('update')` appends local-origin updates (not `'remote-folder'` origin) to an outbox persisted in IndexedDB. Enabling sync seeds the outbox with full session state. A flush timer uploads when dirty and retries on failure.
- Pull flow: one `list` per cycle, compared with a stored table of known file revisions (modified time/size/ETag, for change detection only, never ordering). Download only changed files, then `Y.applyUpdate(doc, bytes, 'remote-folder')`.
- Connectivity: adaptive interval (about 15s while scoring, 60s idle, paused when the tab is hidden); exponential backoff honoring `Retry-After`; flush on `online`/`visibilitychange`/`pagehide`; "Sync now" button; status indicator (synced / N pending / offline / sign-in needed / last sync). When auth expires, scoring continues locally and a "Reconnect" banner appears.
- Sync is opt-in per session. The global session list is NOT synced to shared folders. Files for sessions the device lacks appear as "Add from shared folder". The existing session-merge and name-matching flow stays, relocated out of `app-sync.js`.
- Never delete other devices' files in a shared folder. Compaction writes snapshots only; the folder owner can clear old files after the event.
- Scale: 1-20 scorers use Standard (everyone pulls every peer's file). Beyond about 15-20 distinct client files, relay mode applies: scorers upload their own outbox and download only the latest snapshot, while 2-3 self-elected devices pull all outboxes and publish snapshots every 30-60s. Compaction is idempotent, so no locks. Expected latency 1-2 intervals. Fallback if too slow: groups of 10-15 scorers in separate folders, merged by a head-table device.
- Rough load: 100 scorers in relay mode is about 10 requests/s total. Check current Google/Microsoft project quotas before launch.

## Providers [PROPOSED]

- Google: Google Identity Services token client with `drive.file`, plus the Picker (needs an API key and Picker app ID in the same Google project). Access tokens last about 1 hour with no browser refresh token, so the Reconnect banner matters.
- Microsoft: MSAL.js (auth code + PKCE) and OneDrive File Picker v8 (can create folders). Personal accounts work with `Files.ReadWrite`. Shared folders from other users on work/school accounts need `Files.ReadWrite.All`; some tenants block `.All` without admin consent. A "paste share link" option resolves the folder via `/shares/...`.
- SDKs load lazily, only when the user picks a provider, and are not cached by the service worker.
- Registrations to create (config placeholders in `scripts/app-sync-config.js` plus a `SYNC_SETUP.md`): Google OAuth web client with `drive.file`, Picker and Drive APIs, API key restricted by referrer; Azure SPA registration with redirect URI for the app origin, personal + work accounts, `Files.ReadWrite` and `Files.ReadWrite.All`. No client IDs exist yet. Do not hard-code any.

## Removal [PROPOSED]

- Delete `scripts/app-sync.js` (about 5,000 lines: rooms, registry, awareness, large-event websocket, device-transfer migration), `scripts/app-sync-crypto.js`, `server/`, `build-yjs-sync.js`. Remove the y-webrtc, y-websocket and y-protocols deps.
- Rebuild `yjs-bundle.min.js` with only Y + IndexeddbPersistence, per CLAUDE.md.
- Edit `app-state.js`, `app-history.js`, `app.js`, `index.html` (header sync block, Collaborate fieldset, script tag) and the service-worker precache list.
- Relocate `compareSessionData`/`applyMappings`/name-matching out of `app-sync.js`; the session merge uses them.
- Room passwords go; folder permissions control access. Display names are stored locally. History attribution uses the local name. Presence becomes a "last seen" list.
- Embedding API: remove all 12 `sync:*` commands, the `sync:*` events and the `SyncManager` hooks. Recommended: no replacement `storage:*` commands, since the family plan disables cloud features when embedded. [OPEN: optional read-only state returning "disabled"]
- i18n: drop `sync.*` keys, add new ones in en, es, fr, pig. Update docs: CLAUDE.md WebRTC section, 4 READMEs, TECH.md, EMBEDDING_*.md, AGENTS/CODEX/GEMINI/OPENCODE.md. Bump the version (MINOR or MAJOR) in the `index.html` footer.
- Tests: delete the `sync-*` unit and UI tests (keep `cross-tab-sync`); add engine tests against an in-memory mock backend (random ordering, duplicates, drops, offline), a 20/50/100-client simulation, and dialog tests under `tests/ui`. `node --test` must pass; update test counts in CLAUDE.md.

## Phases [PROPOSED]

0. Spikes: Google visible-folder test (confirmation only now); OneDrive shared-folder read/write across personal and work accounts; measured request counts and quotas.
1. Engine with the mock backend and convergence tests.
2. Providers, Storage & Sync dialog, status indicator, per-session toggle, keeping existing accessibility behavior.
3. Remove old sync code, servers, tests, i18n keys and docs; bump the version.
4. Relay mode, with the 20/50/100-client simulation.

## Family-plan integration [PROPOSED, not approved]

Source: `docs/unified-storage-plan.md` in antgiant/pbefocus.com (branch `claude/pbefocus-unified-storage-6q1unp`, commit `bce8877`). Same core idea (per-device files merged on read). It plans one shared "PBE Focus" registration per provider, a hint-only cookie `pbe_account` on `.pbefocus.com`, and a shared module in `pbefocus.com/shared/storage/` vendored into each app (IIFE bundle for Score Keeper). It will adopt this plan's layout: `PBE Focus/scorekeeper/<sessionId>/c-<clientId>.yjs` plus the marker.

- Use the shared engine/auth/providers rather than a Score-only copy. Add `pickFolder()`/`setRoot()`, richer `list` metadata for change detection, and adaptive polling.
- Microsoft scopes: the shared registration allows `Files.ReadWrite.All` for Score Keeper's shared-folder picking; other apps request only `Files.ReadWrite.AppFolder`. [OPEN: owner must confirm when creating the Azure registration]
- Google uses a single shared client ID (cross-user access is per client ID).
- Do not adopt the family plan's "delete other devices' originals after N days" rule or `index.<deviceId>.json` session-list sync for shared folders.
- The family plan treats this redesign as its Fly-removal prerequisite and disables cloud features in embedding mode.
- The privacy page should say shared-folder files include scorers' display names, visible to everyone with folder access.
- The family plan puts Score Keeper last, behind Karaoke and Quiz. Recommendation: build the shared module with Score Keeper's needs in mind and proceed in parallel.

## Origin move

The old origin is `pbe-scores.wooleys.us`; this repo's CNAME is `score.pbefocus.com` (the owner picked it as the hostname for this repo). IndexedDB and PWA installs are per origin, so the family plan calls for a handoff: a final release on the old site that exports all sessions as native `.yjs` (`exportAllSessions`) and hands them to the new origin, with the existing Export/Import as fallback.

To do: add `score.pbefocus.com` to both OAuth registrations and the family `site-nav.js`; update `web+pbe://` handlers, manifest `start_url`/scope, the embedding docs' hosted URL (done) and README language links.

## Progress

- Phase 1 (engine, mock-backend tests): done.
- Phase 2 (providers, Storage & Sync dialog, status indicator): done except the items below. Setup steps are in `SYNC_SETUP.md`.
  - Not yet verified against real accounts: Google sign-in and Picker, and Microsoft sign-in, because no client IDs exist yet (`scripts/app-sync-config.js` has empty placeholders).
  - OneDrive folders are chosen by pasting a share link. The OneDrive File Picker v8 is not wired in.
  - Joining a folder that holds a different quiz adds it through the existing binary import; this path has not been exercised against a real drive.
  - The old Sync (rooms) code still runs alongside the new Storage button until phase 3.
- Phase 3 (remove old sync): done in 2.28.0.
  - Removed `scripts/app-sync.js`, `scripts/app-sync-crypto.js`, `server/`, `build-yjs-sync.js`, the old `sync-*` tests and the room/migration UI. Removed all 12 `sync:*` embedding commands and the `sync:*` events, with no replacement and no stub (decision 5).
  - The Yjs bundle was rebuilt with only Y and IndexedDB persistence (216 KB to 97 KB). The y-webrtc, y-websocket and y-protocols dependencies are gone.
  - Kept and relocated: toast, focus trap and escape helpers (`scripts/app-ui-utils.js`) and quiz-merge name matching (`scripts/app-session-matching.js`).
  - `web+pbe://join/...` links are no longer accepted.
  - History entries no longer carry a scorer name (always shown as local); there is no display-name setting any more.
  - Still to do outside this repo: shut down the Fly signaling server, and tell hosts that used the `sync:*` embedding commands.
- Phase 4 (relay mode): done in 2.29.0.
  - Above 20 distinct scorers (back to standard at 15 or fewer), ordinary devices read relay snapshots only. The 3 lowest client ids among recently active devices act as relays: they pull all outboxes and publish a snapshot at most every 30 seconds when something changed. Every device derives the same election from the folder listing, so there are no locks or messages.
  - If no relay snapshot is fresh (3 minutes) devices fall back to reading outboxes. Relays that go quiet drop out after 5 minutes and the next ids take over.
  - Simulated with 20, 40, 50 and 100 clients on the mock folder (shuffled listings, dropped writes, relay failover). Not measured against real Google or Microsoft quotas yet.
- Scorer name: while a quiz syncs, history entries carry the signed-in account's display name, or its email when the provider reports no name (Google `userinfo.profile` and `userinfo.email` scopes, Microsoft ID token). It is visible to everyone who can open a shared folder.

## Decisions (2026-10-24)

1. **[APPROVED]** Score Keeper proceeds in parallel with the shared storage module; it does not wait for Karaoke/Quiz.
2. **[APPROVED]** `score.pbefocus.com` is the final origin.
4. **[APPROVED]** The combined Microsoft scope set (owner says the registration is already done).
3. **[APPROVED]** Add a zero-setup "back up to my account" option using the private `PBE Focus` app folder, alongside shared folders. It reuses the same engine.
5. **[APPROVED]** Embedding: delete all `sync:*` commands and events with no replacement and no "disabled" stub.

## Open questions

None at the moment.
