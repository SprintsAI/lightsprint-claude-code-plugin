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

**Trade-off:** If the daemon crashes before Sentry flushes, the crash could be lost. Mitigated by wiring `process.on('uncaughtException')` to do a synchronous Sentry flush before exit.

## Sentry Initialization

A new module `scripts/lib/sentry.js` handles all Sentry concerns.

### Configuration

- **DSN** — hardcoded in `sentry.js` (not user-configurable; DSN is a write-only ingestion key, not a secret)
- **Environment** — derived from `baseUrl` (production vs staging)
- **Release** — uses existing `BUILD_VERSION` + `BUILD_HASH` injected at compile time

### Context (Tags & User)

Set on init, updated when session starts:

| Field | Source |
|-------|--------|
| `user.id` | Lightsprint user email (from `repos.json`) |
| `tags.repoId` | Current repo ID |
| `tags.sessionId` | CC session ID |
| `tags.machineId` | Existing SHA256 hostname hash |
| `tags.nodeVersion` | `process.version` |
| `tags.platform` | `process.platform` |

### Shutdown

- `Sentry.close(2000)` called in daemon's existing cleanup path
- `process.on('uncaughtException')` captures the error, flushes synchronously, then re-throws

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
| `validate.js` | Validation errors (captured as warnings) | input source |
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
```

Daemon calls `Sentry.captureException()` with `source` as a tag.

### Hook-Side Helper

New `reportError(sessionId, error, source)` function in `cc-utils.js`:

1. Reads session state to get daemon port
2. POSTs to `localhost:{port}/error`
3. Fire-and-forget (no waiting for response)
4. Wrapped in try-catch — if daemon unreachable, silently fails

Called from existing catch blocks in:
- `cc-event.js`
- `cc-start.js`
- `cc-end.js`
- `cc-pr-created.js`
- `review-plan.js`

### CLI Error Forwarding

`ls-cli.js` commands that fail after validation (API errors, unexpected responses) call `reportError()` if a session is active. If no session exists, errors are silently dropped.

## Dependency & Build

### New Dependency

- `@sentry/node` — production dependency (only new dependency)

### Build Changes

- No changes to `compile.sh` — DSN is hardcoded, not injected
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
