# Embedding Integration Guide

This guide is for host sites that want to embed PBE Score Keeper as an iframe and control it programmatically.

## 1. Serve The App

The scorekeeper must be served from a web origin. Embedded mode is enabled with:

```text
https://score.pbefocus.com/?embedded=1
```

Use HTTPS in production so storage APIs work consistently.

## 2. Add The Iframe

Use the smallest sandbox that supports your integration:

```html
<iframe
  id="scorekeeper"
  src="https://score.pbefocus.com/?embedded=1"
  sandbox="allow-scripts allow-same-origin allow-downloads"
  style="width: 100%; height: 720px; border: 0;">
</iframe>
```

Do not add broader sandbox permissions unless the host workflow specifically needs them.

## 3. Load The Client

```html
<script src="https://score.pbefocus.com/scripts/app-embedding-client.js"></script>
```

```javascript
const pbe = new PBEScoreKeeperAPI(document.getElementById("scorekeeper"), {
  targetOrigin: "https://score.pbefocus.com",
  timeoutMs: 10000,
  retries: 1
});

await pbe.ready();
```

Set `targetOrigin` to the exact scorekeeper origin in production.

## 4. Cross-Origin Hosting

The published app defaults to allowing any first host origin to control an embedded frame. This is intended for GitHub Pages, where you usually cannot set custom frame headers or inject per-host runtime configuration into the scorekeeper origin.

```javascript
// scripts/app-globals.js
allowedOrigins: ["*"]
```

The first validated origin is locked as the active host origin for that iframe. Messages from other origins are ignored after the lock.

If you publish a private copy and want to restrict command access, edit `scripts/app-globals.js` before deploying and replace `["*"]` with the exact origin of each host page that should be allowed.

The host page cannot call `EmbeddingAPI.configure(...)` inside a cross-origin iframe after it loads. Cross-origin JavaScript access to the iframe is blocked by the browser, so allowlist changes must be baked into the scorekeeper deployment.

## 5. Control The Scorekeeper

```javascript
await pbe.session.create({ name: "Practice Round" });
await pbe.question.create({ name: "Question 1", maxPoints: 5 });
await pbe.score.set({ teamIndex: 1, score: 4 });
await pbe.score.setExtraCredit({ teamIndex: 1, extraCredit: 1 });

const totals = await pbe.score.getTotalPoints();
console.log(totals.total);
```

Run several commands together:

```javascript
await pbe.batch([
  { command: "question:create", payload: { name: "Question 2", maxPoints: 5 } },
  { command: "score:set", payload: { teamIndex: 1, score: 4 } }
], { atomic: true });
```

Atomic batches validate the whole command list before any command runs.

All exports use native Yjs update bytes:

```javascript
const exported = await pbe.session.export();
await otherPbe.session.import({ bytes: exported.bytes });
```

For all-session state transfer, use the state helpers. Preview first when the host wants to show its own conflict UI, or ask the embedded app to confirm conflicts before import:

```javascript
const stateExport = await pbe.state.export();
const preview = await otherPbe.state.previewImport({ bytes: stateExport.bytes });

if (preview.conflicts.length > 0) {
  await otherPbe.state.import({
    bytes: stateExport.bytes,
    confirmConflicts: true
  });
}
```

## 6. Listen For Events

```javascript
const unsubscribe = pbe.on("question:scored", (score) => {
  console.log("score updated", score);
});

// Later:
unsubscribe();
```

Use `session:stateChanged` when the host needs a broad refresh signal. It is debounced.

## 7. Host Theme Inheritance

Host pages can apply a small CSS-variable theme to the embedded frame:

```javascript
await pbe.ui.inheritTheme({
  theme: "dark",
  variables: {
    "--page-bg": "#111827",
    "--panel-bg": "#1f2937",
    "--text-color": "#f9fafb",
    "--accent-color": "#60a5fa"
  }
});
```

Only CSS custom properties are accepted, and unsafe values are rejected.

## 8. Error Handling

Client methods reject with `PBEScoreKeeperAPIError`.

```javascript
try {
  await pbe.score.set({ teamIndex: 1, score: 99 });
} catch (error) {
  if (error.code === "invalid_parameter") {
    // Show host-side validation feedback.
  }
}
```

Common error codes:

| Code | Meaning |
| --- | --- |
| `ready_timeout` | The iframe did not complete the handshake |
| `timeout` | A command response did not arrive |
| `invalid_parameter` | Payload validation failed |
| `not_found` | Requested session, question, team, or block was not found |
| `payload_too_large` | Message exceeded `maxPayloadBytes` |
| `rate_limited` | Message or command burst exceeded rate limits |
| `batch_failed` | A batch stopped because one command failed |

## 9. Cleanup

When the host removes the iframe:

```javascript
pbe.destroy();
```

This removes host message listeners and rejects pending commands.
