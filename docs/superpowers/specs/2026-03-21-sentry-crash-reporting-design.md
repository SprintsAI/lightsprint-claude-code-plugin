# Sentry Crash Reporting for Lightsprint Claude Code Plugin

## Overview

Add crash reporting via Sentry to the Lightsprint Claude Code plugin. Crash reporting is always-on (no opt-out) and covers the full error surface: unhandled crashes, classified errors, and daemon lifecycle issues.

Usage analytics via PostHog is deferred to a later phase.

## Architecture

### Centralized in the Daemon

Sentry is initialized once in the daemon process (`cc-daemon.js`). The daemon is the single point of contact with Sentry — all other processes (hooks, CLI commands) forward errors to the daemon via its existing local HTTP server.

**Why this approach:**
- Single Sentry init — no SDK overhead in every short-lived hook invocation
- Daemon already has user/repo context loaded
- Batching and flushing handled naturally by the long-lived process
- Hooks stay fast (fire-and-forget HTTP to localhost)

**Trade-off:** If the daemon crashes before Sentry flushes, the crash could be lost. Mitigated by wiring `process.on('uncaughtException')` to call `Sentry.captureException()` followed by `Sentry.close(2000).then(() => process.exit(1))` — this gives Sentry up to 2 seconds to flush before forcing exit.

## Sentry Initialization

A new module `scripts/lib/sentry.js` handles all Sentry concerns.

### Configuration

- **DSN** — hardcoded in `sentry.js` (not user-configurable; DSN is a write-only ingestion key, not a secret)
- **Environment** — derived from `baseUrl` (production vs staging)
- **Release** — uses `BUILD_VERSION` + `BUILD_HASH` injected at compile time. `sentry.js` must declare these build-time defines (same pattern as `review-plan.js`)

### Context (Tags & User)

Set on init, updated when session starts:

| Field | Source |
|-------|--------|
| `user.id` | SHA256 hash of Lightsprint user email (privacy-safe; raw email set as `user.email` separately, scrubable via Sentry data scrubbing settings) |
| `tags.repoId` | Current repo ID |
| `tags.sessionId` | CC session ID |
| `tags.machineId` | Existing SHA256 hostname hash |
| `tags.nodeVersion` | `process.version` |
| `tags.platform` | `process.platform` |

### Shutdown

- `Sentry.close(2000)` called in daemon's existing cleanup path (returns a Promise; await it before exiting)
- `process.on('uncaughtException')` captures the error via `Sentry.captureException()`, then calls `Sentry.close(2000).then(() => process.exit(1))` — gives Sentry up to 2s to flush before forced exit

## What Gets Captured

### Tier 1: Unhandled Crashes

Automatic once Sentry is initialized:

- `process.on('uncaughtException')` — capture, flush, exit
- `process.on('unhandledRejection')` — capture as error-level event

### Tier 2: Classified Errors

Explicit `Sentry.captureException()` calls at existing error paths:

| Location | Error Type | Extras |
|----------|-----------|--------|
| `client.js` `retryableFetch()` | API errors after retries exhausted | status, endpoint, attempt count |
| `client.js` `refreshTokenIfNeeded()` | Auth/token refresh failures | — |
| `validate.js` | Validation errors (captured as breadcrumbs, not events — these are expected behavior from agent hallucinations) | input source |
| `cc-daemon.js` | WebSocket connection failures, unexpected closes, protocol errors | reconnect attempt count |

### Tier 3: Daemon Lifecycle Breadcrumbs

`Sentry.addBreadcrumb()` calls that provide context trail for real errors:

- WebSocket connect/disconnect/reconnect attempts
- Event queue size warnings (approaching 100 limit)
- Event queue overflow (oldest events dropped)
- Stale session cleanup
- Token refresh success
- Session start/end
- Watchdog PID check failures

## Hook Error Forwarding

### Daemon Endpoint

New endpoint on the daemon's local HTTP server:

```
POST /error
Content-Type: application/json

{
  "source": "cc-event",
  "error": "TypeError",
  "message": "Cannot read property 'id' of undefined",
  "stack": "TypeError: Cannot read property...",
  "context": { "hookInput": "..." }
}
Authorization: Bearer <daemonToken>
```

The `/error` endpoint requires the daemon auth token (same as all other daemon endpoints except `/health`). Daemon calls `Sentry.captureException()` with `source` as a tag. Sentry's built-in deduplication handles repeated identical errors; no custom dedup needed.

### Hook-Side Helper

New `reportError(sessionId, error, source)` function in `cc-utils.js`:

1. Reads session state to get daemon port **and `daemonToken`**
2. POSTs to `localhost:{port}/error` with `Authorization: Bearer <daemonToken>`
3. Fire-and-forget (no waiting for response)
4. Wrapped in try-catch — if daemon unreachable, falls back to appending error to `~/.lightsprint/daemon.log` via existing `createLogger()`

Called from existing catch blocks in:
- `cc-event.js`
- `cc-start.js`
- `cc-end.js`
- `cc-pr-created.js` — note: this hook re-throws errors; `reportError()` must be called **before** the re-throw
- `review-plan.js` — only in the standalone `reviewPlanMain()` path, NOT in the daemon-internal `handlePlanReview()` path (which would create a localhost loop)

### CLI Error Forwarding

`ls-cli.js` commands that fail after validation (API errors, unexpected responses) call `reportError()` if a session is active. Session discovery: scan `~/.lightsprint/cc-sessions/` for a session file whose `ccPid` matches the current process's ancestor (walk up `$PPID` chain), or whose `repoId` matches the current repo. If no matching session exists, errors are silently dropped (this covers standalone CLI usage outside Claude Code).

## Dependency & Build

### New Dependency

- `@sentry/node` — production dependency (only new dependency)
- **Bun compatibility note:** The project compiles to a single Bun binary via `bun build --compile`. Before implementation, verify that `@sentry/node` bundles cleanly — if it pulls in native/WASM bindings that conflict with Bun's compilation, use `@sentry/core` with a custom HTTP transport instead (lighter, no native dependencies). Measure binary size impact.

### Build Changes

- `compile.sh` may need `--external` flags if Sentry has unbundleable native modules
- DSN is hardcoded, not injected
- `sentry.js` must declare `__BUILD_VERSION__` and `__BUILD_HASH__` build-time defines (same pattern as `review-plan.js`)
- No source map upload — stack traces from compiled binary reference bundled line numbers (sufficient for single-file bundle; source maps can be added later)

### Testing

- Mock `@sentry/node` in tests — no real Sentry events sent
- Test `reportError()` verifying it POSTs to the correct daemon endpoint
- Test daemon `/error` endpoint verifying it calls `Sentry.captureException()`
- Existing E2E mock server tests unchanged

## File Changes

| File | Change |
|------|--------|
| `scripts/lib/sentry.js` | **New** — init, context helpers, shutdown |
| `scripts/cc-daemon.js` | Import sentry, init on startup, add `/error` endpoint, add breadcrumbs, wire shutdown |
| `scripts/lib/cc-utils.js` | Add `reportError()` helper |
| `scripts/cc-event.js` | Call `reportError()` in catch block |
| `scripts/cc-start.js` | Call `reportError()` in catch block |
| `scripts/cc-end.js` | Call `reportError()` in catch block |
| `scripts/cc-pr-created.js` | Call `reportError()` in catch block |
| `scripts/review-plan.js` | Call `reportError()` in catch block |
| `scripts/ls-cli.js` | Call `reportError()` on API/unexpected errors |
| `package.json` | Add `@sentry/node` |

## Future Work (Not In Scope)

- PostHog usage analytics (phase 2)
- Sentry source map uploads for better stack traces
- User opt-out toggle
- Sentry performance monitoring / tracing
- Event sampling rate configuration (for cost control at scale)
