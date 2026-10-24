# PBE Score Keeper Embedding Architecture

## Overview
This document describes the architecture for embedding PBE Score Keeper as a fully-integrated component in third-party sites, with programmatic control via PostMessage API and URL-based parameters.

## Phase 1: PWA Integration Improvements (v2.24.0)

### 1.1 File Association
- **Goal**: Direct `.yjs` and `.json` files open in the app
- **Implementation**:
  - Update `site.webmanifest` with `file_handlers` array
  - Handle `window.launchQueue` events during app startup for macOS/Android/Chrome
  - Redirect file opens to import flow with file content

### 1.2 Protocol Handler Registration
- **Goal**: Support browser-safe `web+pbe://` protocol links for deep linking
- **URL Schemes**:
  - `web+pbe://session/new` - Create new session
  - `web+pbe://import?file=BASE64_OR_URL` - Import session data

- **Implementation**:
  - Register `protocol_handlers` in manifest
  - Parse incoming URLs in app startup
  - Route to appropriate handlers (session, import)

---

## Phase 2: Embedding Architecture (v2.25.0)

### 2.1 Core Design Principles
1. **Iframe Safety**: Sandbox embedding with controlled surface area
2. **Bidirectional Communication**: PostMessage for all interaction
3. **Event-Driven**: Host listens to state changes, sends commands
4. **Graceful Degradation**: Works standalone, enhanced when embedded
5. **Version Negotiation**: API versioning for forward compatibility

### 2.2 Embedding Modes

#### 2.2.1 Standalone Mode (current)
- Full UI, all features available
- Used when opened directly or as PWA

#### 2.2.2 Embedded Mode (new)
- Minimal UI (hides header, session tabs, non-core controls)
- All features accessible via API only
- Theme inheritance from host
- Storage remains isolated to the scorekeeper origin
- Communication via `window.postMessage()`

#### 2.2.3 Hybrid Mode (future)
- Embedded with selective UI controls
- Host can show/hide specific panels

### 2.3 API Architecture

#### 2.3.1 Initialization
```javascript
// Host loads PBE Score Keeper in iframe
<iframe 
  id="pbe-scorekeeper" 
  src="https://score.pbefocus.com/?embedded=1&apiVersion=1"
  sandbox="allow-scripts allow-same-origin allow-downloads"
/>

// After iframe load, establish connection
const pbeFrame = document.getElementById('pbe-scorekeeper');
const pbeApi = new PBEScoreKeeperAPI(pbeFrame);

await pbeApi.ready(); // Waits for frame handshake
```

#### 2.3.2 Command/Response Pattern
```javascript
// Commands from host to frame
pbeApi.sendCommand(commandType, payload)
  .then(response => { /* handle */ })
  .catch(error => { /* handle */ });

// Events from frame to host
pbeApi.on('event', (eventType, data) => { 
  /* handle */ 
});
```

#### 2.3.3 State Synchronization
- Host can optionally manage session state (Yjs binary export/import)
- Frame syncs state back to host via `state:changed` event
- Allows hosts to move session state between devices

### 2.4 Command Set

#### Session Management
- `session:create` - Create new session with name
- `session:switch` - Switch to session by ID
- `session:list` - Get all sessions
- `session:rename` - Rename session
- `session:delete` - Delete session
- `session:export` - Export session (Yjs binary)
- `session:import` - Import session from binary

#### Question Navigation & Management
- `question:next` - Navigate to next question
- `question:previous` - Navigate to previous question
- `question:goto` - Jump to specific question by ID or number
- `question:create` - Create new question with name
- `question:rename` - Rename question
- `question:setMaxPoints` - Set max points for current question
- `question:setBlock` - Assign question to block
- `question:ignore` - Toggle ignore flag on question
- `question:delete` - Delete question

#### Scoring
- `score:set` - Set team score for current question
- `score:setExtraCredit` - Set extra credit for team on current question
- `score:getMaxPoints` - Get max points for current question
- `score:getTotalPoints` - Get total points for question

#### Block Management
- `block:create` - Create new block
- `block:rename` - Rename block
- `block:setDefault` - Mark block as default
- `block:delete` - Delete block
- `block:list` - Get all blocks

#### Timer Management
- `timer:enable` - Enable timer for current question
- `timer:disable` - Disable timer
- `timer:setDuration` - Set timer duration (minutes, seconds)
- `timer:setAutoStart` - Set auto-start flag
- `timer:play` - Start timer
- `timer:pause` - Pause timer
- `timer:restart` - Reset and play

#### UI Control
- `ui:setTheme` - Set light/dark theme
- `ui:setLanguage` - Set language
- `ui:show` - Show frame
- `ui:hide` - Hide frame
- `ui:focus` - Set focus on frame

### 2.5 Event Set (frame → host)

#### Session Events
- `session:created` - New session created
- `session:switched` - Active session changed
- `session:renamed` - Session renamed
- `session:deleted` - Session deleted
- `session:stateChanged` - Session data modified

#### Question Events
- `question:changed` - Current question changed
- `question:scored` - Score entered for current question
- `question:ignored` - Ignore flag toggled
- `question:block-changed` - Block assignment changed

#### UI Events
- `ui:ready` - Frame initialization complete
- `ui:themeChanged` - Theme updated
- `ui:languageChanged` - Language changed

### 2.6 Implementation Strategy

#### 2.6.1 New Files
1. `scripts/app-embedding-api.js` - Core API layer
   - Handles PostMessage handshake
   - Implements command dispatch
   - Manages event subscriptions

2. `scripts/app-embedding-commands.js` - Command handlers
   - Maps commands to app functions
   - Validates parameters
   - Returns responses

3. `scripts/app-embedding-events.js` - Event bridge
   - Observes Yjs/global app changes
   - Emits session, question, and UI events
   - Debounces high-frequency state changes

4. `scripts/app-embedding-client.js` - Host-side library (optional)
   - Convenience wrapper for embedding
   - Auto-discovery of embedded frames
   - Promise-based API
   - Type definitions in `scripts/app-embedding-client.d.ts`

#### 2.6.2 Modified Files
1. `index.html`
   - Add `?embedded=1` detection
   - Conditionally load embedding API
   - Apply embedded styling

2. `scripts/app.js`
   - Add embedding mode check
   - Initialize embedding API when needed
   - Expose key functions for command dispatch

3. `service-worker.js`
   - Precache PWA handler script and continue handling share target imports

4. `site.webmanifest`
   - Add `file_handlers` array
   - Add `protocol_handlers` array

#### 2.6.3 Configuration
```javascript
// In app-globals.js
var EMBEDDING_CONFIG = {
  enabled: false,
  apiVersion: 1,
  hostOrigin: null,
  allowedOrigins: ["*"],
  allowedHosts: [],
  maxPayloadBytes: 524288,
  rateLimit: {
    enabled: true,
    windowMs: 1000,
    maxMessages: 80,
    maxCommands: 40
  }
};
```

### 2.7 Security Model

#### 2.7.1 Origin Validation
- The iframe only responds to `postMessage` traffic from validated origins.
- Default behavior allows any first host origin with `allowedOrigins: ["*"]`, which supports GitHub Pages deployments with limited header/runtime configuration control.
- `EMBEDDING_CONFIG.allowedOrigins` accepts full host page origins.
- `EMBEDDING_CONFIG.allowedHosts` accepts hostnames or host:port values.
- The first validated host is locked into `EMBEDDING_CONFIG.hostOrigin`; later messages from other origins are ignored unless the host origin is reset intentionally.
- `*` is supported only in `allowedOrigins`. Restrict it to explicit origins for private deployments that should not accept commands from arbitrary host pages.
- The host-side `PBEScoreKeeperAPI` should set `targetOrigin` to the scorekeeper origin instead of `*` in production.

#### 2.7.2 Iframe Sandbox
```html
<iframe 
  sandbox="allow-scripts allow-same-origin allow-downloads"
/>
```

#### 2.7.3 Data Isolation
- The embedded frame uses storage for its own origin only; the host page cannot directly read that storage.
- Cross-frame state exchange happens through explicit commands, events, and Yjs binary import/export payloads.
- Native Yjs binary exports remain the required sync/import format for session data.
- Host pages should avoid granting additional sandbox flags unless a specific integration requires them.

#### 2.7.4 Rate Limiting (optional)
- `EMBEDDING_CONFIG.rateLimit` throttles rapid message and command bursts per origin.
- `EMBEDDING_CONFIG.maxPayloadBytes` rejects oversized messages before command dispatch.
- Command handlers validate numeric ranges, required IDs, supported enum values, and strip unsafe control characters from string payloads.

### 2.8 Example Integration

#### Host Page (Third-Party Site)
```html
<!DOCTYPE html>
<html>
<head>
  <script src="path/to/scripts/app-embedding-client.js"></script>
</head>
<body>
  <div id="scorekeeper-container">
    <iframe 
      id="scorekeeper"
      src="https://score.pbefocus.com/?embedded=1"
      style="width: 100%; height: 600px;"
    ></iframe>
  </div>

  <script>
    const pbeApp = new PBEScoreKeeperAPI(
      document.getElementById('scorekeeper'),
      { targetOrigin: 'https://score.pbefocus.com' }
    );

    // Wait for app ready
    await pbeApp.ready();

    // Create new session
    const session = await pbeApp.command('session:create', { 
      name: 'Bible Bowl 2024' 
    });

    // Navigate to first question
    await pbeApp.command('question:goto', { number: 1 });

    // Listen for score changes
    pbeApp.on('question:scored', (data) => {
      console.log('Scored:', data);
    });

  </script>
</body>
</html>
```

#### Embedded Frame (PBE Score Keeper)
```javascript
// In app-embedding-api.js
var embeddingAPI = {
  hostOrigin: null,
  messageId: 0,
  pendingRequests: {},

  initialize: function() {
    window.addEventListener('message', this.handleMessage.bind(this));
    window.parent.postMessage(
      { type: 'embedding:ready', apiVersion: 1 },
      '*'
    );
  },

  handleMessage: function(event) {
    if (!this.validateOrigin(event.origin)) return;
    
    const { command, payload, id } = event.data;
    
    try {
      const response = this.dispatchCommand(command, payload);
      event.source.postMessage(
        { type: 'command:response', id, response },
        event.origin
      );
    } catch (error) {
      event.source.postMessage(
        { type: 'command:error', id, error: error.message },
        event.origin
      );
    }
  }
};
```

---

## Phase 3: Enhanced Features (v2.26.0+)

### 3.1 Bidirectional State Sync
- Export/import session state via Yjs binary
- Conflict resolution UI

### 3.2 Batch Commands
- Send multiple commands in one PostMessage
- Atomic transaction support

### 3.3 Real-time Collaboration
- Shared cursor position
- Live team name updates
- Multi-user scoring

### 3.4 Custom Themes
- Host provides CSS variables
- Embedded frame applies host theme
- Dark/light mode sync

---

## Implementation Timeline

| Phase | Version | Timeline | Components |
|-------|---------|----------|-----------|
| 1     | v2.24   | ~2 weeks | File handlers, protocol handlers |
| 2     | v2.25   | ~4 weeks | Embedding API, command dispatch, client library |
| 3     | v2.26   | ~3 weeks | State sync, batch ops, theming |

---

## Migration Path

### For Standalone Users
- No changes required
- App works exactly as before
- Can opt-in to embedding if desired

### For New Embedded Users
- Host site implements embedding library
- Full feature parity with standalone
- Better UX for specific use cases (tournament scoring, classroom, events)

---

## Testing Strategy

### Unit Tests
- Command dispatch
- Event emission
- Origin validation
- State transitions

### Integration Tests
- Iframe communication
- Multi-command sequences
- Error handling and recovery
- Large session imports

### E2E Tests
- Host → embedded → host roundtrips
- Real sync scenarios
- Cross-origin blocked scenarios

---

## Backward Compatibility
- Standalone mode unaffected
- Existing URLs continue to work
- No breaking changes to localStorage or IndexedDB

## Open Questions
1. Should we support multiple embedded instances in one host page?
2. Should we allow CSS variable customization from host?
3. Should embedded frame auto-persist state to host's storage?
4. Should we publish TypeScript types for the API?
