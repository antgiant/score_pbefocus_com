# PBE Score Keeper Embedding API

PBE Score Keeper can run inside an iframe with `?embedded=1` and expose a `postMessage` API for host pages. The iframe owns scorekeeper state; the host controls it through commands and receives events.

## Host Client

Use the host-side helper when possible:

```html
<script src="scripts/app-embedding-client.js"></script>
<iframe
  id="scorekeeper"
  src="https://score.pbefocus.com/?embedded=1"
  sandbox="allow-scripts allow-same-origin allow-downloads">
</iframe>
```

```javascript
const api = new PBEScoreKeeperAPI(document.getElementById("scorekeeper"), {
  targetOrigin: "https://score.pbefocus.com"
});

await api.ready();
await api.score.set({ teamIndex: 1, score: 4 });
api.on("question:scored", (score) => console.log(score));
```

Type definitions are available at `scripts/app-embedding-client.d.ts`.

## Transport

Host to iframe:

```javascript
iframe.contentWindow.postMessage({
  type: "embedding:command",
  id: "request-1",
  command: "session:list",
  payload: {}
}, "https://score.pbefocus.com");
```

Iframe to host:

```javascript
{
  type: "embedding:response",
  id: "request-1",
  command: "session:list",
  ok: true,
  result: { sessions: [] }
}
```

Errors use:

```javascript
{
  ok: false,
  error: { code: "invalid_parameter", message: "score cannot exceed maxPoints" }
}
```

## Configuration

Embedding is enabled by `?embedded=1` or by setting `EMBEDDING_CONFIG.enabled = true` before startup.

```javascript
EmbeddingAPI.configure({
  allowedOrigins: ["*"],
  allowedHosts: [],
  maxPayloadBytes: 524288,
  rateLimit: {
    enabled: true,
    windowMs: 1000,
    maxMessages: 80,
    maxCommands: 40
  }
});
```

Default origin policy allows any first host origin, which is useful for GitHub Pages deployments where response headers and per-host runtime configuration are limited. The first validated origin is locked as `hostOrigin`, so later messages from other origins are ignored for that frame instance.

To restrict command access for a private deployment, edit `EMBEDDING_CONFIG.allowedOrigins` in `scripts/app-globals.js` before publishing and replace `["*"]` with the exact origin of each host page that should be allowed.

The host page should still set the client `targetOrigin` to the exact scorekeeper origin in production.

## Commands

Session:

| Command | Payload |
| --- | --- |
| `session:list` | none |
| `session:getCurrent` | none |
| `session:create` | `{ name? }` |
| `session:switch` | `{ sessionId }` or `{ index }` |
| `session:rename` | `{ sessionId?, name }` |
| `session:delete` | `{ sessionId }` or `{ index }` |
| `session:reorder` | `{ order: [sessionId] }` |
| `session:export` | `{ sessionId? }`; returns native Yjs update bytes |
| `session:import` | `{ bytes }`, `{ binary }`, `{ base64 }`, or `{ data }` |

Question:

| Command | Payload |
| --- | --- |
| `question:next` | `{ createIfNeeded?, name?, maxPoints? }` |
| `question:previous` | none |
| `question:goto` | `{ questionId }` or `{ number }` |
| `question:create` | `{ name?, maxPoints?, blockId?, activate? }` |
| `question:rename` | `{ questionId?, number?, name }` |
| `question:setMaxPoints` | `{ questionId?, number?, maxPoints }` |
| `question:setBlock` | `{ questionId?, number?, blockId }` or `{ blockIndex }` |
| `question:ignore` | `{ questionId?, number?, ignore? }` |
| `question:delete` | `{ questionId? }`; marks the question ignored because questions are permanent in v5 data |

Score:

| Command | Payload |
| --- | --- |
| `score:set` | `{ teamId? or teamIndex, questionId? or number?, score }` |
| `score:setExtraCredit` | `{ teamId? or teamIndex, questionId? or number?, extraCredit }` |
| `score:getMaxPoints` | `{ questionId? or number? }` |
| `score:getTotalPoints` | `{ questionId? or number? }` |

Block:

| Command | Payload |
| --- | --- |
| `block:list` | none |
| `block:create` | `{ name? }` |
| `block:rename` | `{ blockId? or blockIndex, name }` |
| `block:setDefault` | `{ blockId? or blockIndex }` |
| `block:delete` | `{ blockId? or blockIndex }` |

Timer:

| Command | Payload |
| --- | --- |
| `timer:enable` | none |
| `timer:disable` | none |
| `timer:setDuration` | `{ totalSeconds }` or `{ minutes, seconds }`; optional `{ subsequentPointSeconds, warningFlashSeconds }` |
| `timer:setAutoStart` | `{ autoStart }` |
| `timer:play` | none |
| `timer:pause` | none |
| `timer:restart` | `{ play? }` |

Sync:

| Command | Payload |
| --- | --- |
| `sync:connect` | `{ displayName, roomCode?, password?, joinChoice? }` |
| `sync:disconnect` | `{ clearSessionRoom? }` |
| `sync:getState` | none |
| `sync:getRoomCode` | none |
| `sync:joinRoom` | `{ displayName, roomCode, password? }` |
| `sync:createRoom` | `{ displayName, password? }` |
| `sync:setPassword` | `{ password? }` |
| `sync:setDisplayName` | `{ displayName }` |
| `sync:getPeers` | none |
| `sync:startParallel` | `{ sessionId? or sessionIndex?, roomCode, displayName, password?, options? }` |
| `sync:stopParallel` | `{ sessionId? or sessionIndex?, clearSessionRoom? }` |
| `sync:listParallel` | none |

`sync:getState` includes `parallelSessions` when background session sync providers are active. Parallel sync is intended for hosts that need multiple session docs connected at the same time; it does not replace the active-room UI connection.

State:

| Command | Payload |
| --- | --- |
| `state:export` | none |
| `state:previewImport` | `{ bytes? or base64? or data?, showConflictDialog? }` |
| `state:import` | `{ bytes? or base64? or data?, confirmConflicts? }` |

State export returns a native `.yjs` multi-doc container as `bytes`, `base64`, and `byteLength`. `state:previewImport` reports imported sessions and conflicts without mutating state. When `confirmConflicts` or `showConflictDialog` is true and conflicts are detected, the embedded app shows an import-conflict dialog before proceeding.

Batch:

| Command | Payload |
| --- | --- |
| `batch:run` | `{ commands: [{ command, payload? }], atomic?, haltOnError?, dryRun?, maxBatchCommands? }` |

Atomic batches validate every command envelope before execution. If validation fails, no command in the batch is run. Runtime command failures stop the batch when `haltOnError` is true.

UI:

| Command | Payload |
| --- | --- |
| `ui:setTheme` | `{ theme: "light" | "dark" | "system" }` |
| `ui:setLanguage` | `{ language }` |
| `ui:setThemeVariables` | `{ variables: { "--css-var": "value" } }` |
| `ui:clearThemeVariables` | `{ names?: ["--css-var"] }` |
| `ui:inheritTheme` | `{ theme?, variables? }` |
| `ui:show` | none |
| `ui:hide` | none |
| `ui:focus` | none |

Host-provided CSS variables must use custom-property names (`--name`) and safe values. Values containing `url(...)`, `expression(...)`, `javascript:`, or angle brackets are rejected.

## Events

Subscribe through the client:

```javascript
api.on("session:stateChanged", (state) => {});
api.on("*", (data, envelope) => {});
```

Or directly:

```javascript
iframe.contentWindow.postMessage({
  type: "embedding:subscribe",
  id: "sub-1",
  events: ["question:scored", "sync:stateChanged"]
}, "https://score.pbefocus.com");
```

Available events:

| Group | Events |
| --- | --- |
| Session | `session:created`, `session:switched`, `session:renamed`, `session:deleted`, `session:stateChanged` |
| Question | `question:changed`, `question:scored`, `question:ignored`, `question:block-changed` |
| Sync | `sync:stateChanged`, `sync:peersChanged`, `sync:errorOccurred` |
| UI | `ui:ready`, `ui:themeChanged`, `ui:languageChanged` |

High-frequency state and sync events are debounced or throttled.

`sync:getPeers` and sync peer events include peer `presence` metadata when available, including active session, active question, and recent scoring context.
