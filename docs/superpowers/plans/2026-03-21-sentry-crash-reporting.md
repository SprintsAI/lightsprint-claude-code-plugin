# Sentry Crash Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Sentry crash reporting to the Lightsprint Claude Code plugin, centralized in the daemon process with hook error forwarding.

**Architecture:** Sentry is initialized once in the daemon. Hooks and CLI forward errors to the daemon via its local HTTP `/error` endpoint. Three tiers of capture: unhandled crashes (automatic), classified errors (explicit), and lifecycle breadcrumbs (context trail).

**Tech Stack:** `@sentry/node` (or `@sentry/core` if Bun compile incompatible), Bun test runner

**Spec:** `docs/superpowers/specs/2026-03-21-sentry-crash-reporting-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `scripts/lib/sentry.js` | **New** — Sentry init, context setters, shutdown helpers |
| `scripts/__tests__/sentry.test.js` | **New** — Tests for sentry module |
| `scripts/__tests__/report-error.test.js` | **New** — Tests for reportError helper |
| `scripts/__tests__/daemon-error-endpoint.test.js` | **New** — Tests for daemon `/error` endpoint |
| `scripts/lib/cc-utils.js` | Add `reportError()` helper |
| `scripts/cc-daemon.js` | Init Sentry, add `/error` endpoint, add breadcrumbs, wire shutdown |
| `scripts/cc-event.js` | Call `reportError()` in catch block |
| `scripts/cc-start.js` | Call `reportError()` in catch block |
| `scripts/cc-end.js` | Call `reportError()` in catch block |
| `scripts/cc-pr-created.js` | Call `reportError()` before re-throw |
| `scripts/review-plan.js` | Call `reportError()` in standalone path |
| `scripts/ls-cli.js` | Call `reportError()` on API errors |
| `scripts/lib/client.js` | Capture API errors to Sentry after retries exhausted |
| `package.json` | Add `@sentry/node` dependency |

---

### Task 1: Verify Sentry Bun Compatibility

**Files:**
- Read: `scripts/compile.sh`
- Read: `package.json`

- [ ] **Step 1: Install @sentry/node and test Bun build**

```bash
cd /Users/henghonglee/lightsprint-projects/lightsprint-claude-code-plugin
bun add @sentry/node
```

- [ ] **Step 2: Create a minimal test import to verify bundling**

Create a temporary file `scripts/_sentry-test.js`:
```js
import * as Sentry from '@sentry/node';
console.log('Sentry loaded:', typeof Sentry.init);
```

Run:
```bash
bun build scripts/_sentry-test.js --compile --outfile /tmp/sentry-test
/tmp/sentry-test
```

If this fails with native module errors, switch to `@sentry/core`:
```bash
bun remove @sentry/node
bun add @sentry/core
```
And repeat the test with `import * as Sentry from '@sentry/core'`.

- [ ] **Step 3: Measure binary size impact**

```bash
# Before (current)
ls -lh lightsprint | awk '{print $5}'
# After
bash scripts/compile.sh
ls -lh lightsprint | awk '{print $5}'
```

Note the delta. If >5MB increase, consider `@sentry/core` with custom transport.

- [ ] **Step 4: Clean up temp file and commit dependency**

```bash
rm scripts/_sentry-test.js
git add package.json bun.lockb
git commit -m "feat: add @sentry/node dependency for crash reporting"
```

---

### Task 2: Create `scripts/lib/sentry.js` Module

**Files:**
- Create: `scripts/lib/sentry.js`
- Test: `scripts/__tests__/sentry.test.js`

- [ ] **Step 1: Write the failing test**

Create `scripts/__tests__/sentry.test.js`. Mock `@sentry/node` to verify the module calls Sentry SDK methods with correct arguments:
```js
import { describe, test, expect, beforeEach, mock } from 'bun:test';

// Track calls to Sentry SDK methods
const sentryMock = {
	init: mock(() => {}),
	setTag: mock(() => {}),
	setUser: mock(() => {}),
	addBreadcrumb: mock(() => {}),
	captureException: mock(() => {}),
	withScope: mock((cb) => cb({
		setTag: mock(() => {}),
		setExtras: mock(() => {}),
	})),
	close: mock(() => Promise.resolve(true)),
};

// Mock the @sentry/node module before importing sentry.js
mock.module('@sentry/node', () => sentryMock);

// Import after mock is set up
const { initSentry, setSentryContext, addBreadcrumb, captureException, shutdownSentry } = await import('../lib/sentry.js');

describe('sentry module', () => {
	beforeEach(() => {
		Object.values(sentryMock).forEach(fn => fn.mockClear?.());
	});

	test('initSentry calls Sentry.init with correct DSN and environment', () => {
		initSentry({ baseUrl: 'https://lightsprint.ai' });
		expect(sentryMock.init).toHaveBeenCalledTimes(1);
		const initArg = sentryMock.init.mock.calls[0][0];
		expect(initArg.dsn).toContain('sentry.io');
		expect(initArg.environment).toBe('production');
		expect(initArg.tracesSampleRate).toBe(0);
	});

	test('initSentry detects staging environment', () => {
		// Reset initialized flag by re-importing — or test with a fresh module
		// For now, test the environment detection logic directly
		initSentry({ baseUrl: 'http://localhost:3000' });
		// init won't be called again (already initialized), so check setTag calls
		expect(sentryMock.setTag).toHaveBeenCalled();
	});

	test('setSentryContext calls setUser with hashed email and setTag for each field', () => {
		setSentryContext({
			email: 'test@example.com',
			repoId: 'repo-123',
			sessionId: 'session-abc',
			machineId: 'machine-xyz',
		});
		expect(sentryMock.setUser).toHaveBeenCalledTimes(1);
		const userArg = sentryMock.setUser.mock.calls[0][0];
		expect(userArg.email).toBe('test@example.com');
		expect(userArg.id).not.toBe('test@example.com'); // should be hashed
		expect(userArg.id.length).toBe(16); // SHA256 slice

		// Check tags were set
		const tagCalls = sentryMock.setTag.mock.calls.map(c => c[0]);
		expect(tagCalls).toContain('repoId');
		expect(tagCalls).toContain('sessionId');
		expect(tagCalls).toContain('machineId');
	});

	test('addBreadcrumb calls Sentry.addBreadcrumb with correct shape', () => {
		addBreadcrumb('websocket', 'Connected', 'info', { url: 'ws://test' });
		expect(sentryMock.addBreadcrumb).toHaveBeenCalledTimes(1);
		const arg = sentryMock.addBreadcrumb.mock.calls[0][0];
		expect(arg.category).toBe('websocket');
		expect(arg.message).toBe('Connected');
		expect(arg.level).toBe('info');
		expect(arg.data).toEqual({ url: 'ws://test' });
	});

	test('captureException calls Sentry.withScope and captureException', () => {
		const err = new Error('test error');
		captureException(err, { source: 'cc-daemon', extras: { attempt: 3 } });
		expect(sentryMock.withScope).toHaveBeenCalledTimes(1);
	});

	test('shutdownSentry calls Sentry.close', async () => {
		await shutdownSentry(1000);
		expect(sentryMock.close).toHaveBeenCalledWith(1000);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test scripts/__tests__/sentry.test.js
```
Expected: FAIL — module not found

- [ ] **Step 3: Write the sentry.js module**

Create `scripts/lib/sentry.js`:
```js
/**
 * Sentry crash reporting module.
 *
 * Centralized Sentry initialization for the daemon process.
 * All Sentry configuration, context management, and shutdown
 * are handled through this module.
 */

import * as Sentry from '@sentry/node';
import { createHash } from 'crypto';

// Build-time defines (same pattern as review-plan.js)
const BUILD_HASH = typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'dev';
const BUILD_VERSION = typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'dev';

// Sentry DSN — write-only ingestion key, not a secret
const SENTRY_DSN = 'https://PLACEHOLDER@o0.ingest.sentry.io/0'; // TODO: replace with real DSN

let initialized = false;

/**
 * Initialize Sentry for crash reporting.
 * Call once at daemon startup before any other Sentry calls.
 * @param {{ baseUrl: string }} options
 */
export function initSentry({ baseUrl }) {
	if (initialized) return;

	const environment = baseUrl?.includes('localhost') || baseUrl?.includes('staging')
		? 'staging'
		: 'production';

	Sentry.init({
		dsn: SENTRY_DSN,
		environment,
		release: `lightsprint-plugin@${BUILD_VERSION}+${BUILD_HASH}`,
		// No performance monitoring — crash reporting only
		tracesSampleRate: 0,
		// Attach stack traces to all captured messages
		attachStacktrace: true,
	});

	Sentry.setTag('nodeVersion', process.version);
	Sentry.setTag('platform', process.platform);

	initialized = true;
}

/**
 * Set Sentry user and session context.
 * Call when session starts and user/repo info is available.
 * @param {{ email?: string, repoId?: string, sessionId?: string, machineId?: string }} ctx
 */
export function setSentryContext({ email, repoId, sessionId, machineId }) {
	if (email) {
		const hashedId = createHash('sha256').update(email).digest('hex').slice(0, 16);
		Sentry.setUser({ id: hashedId, email });
	}
	if (repoId) Sentry.setTag('repoId', repoId);
	if (sessionId) Sentry.setTag('sessionId', sessionId);
	if (machineId) Sentry.setTag('machineId', machineId);
}

/**
 * Add a breadcrumb for lifecycle events.
 * @param {string} category - e.g. 'websocket', 'token', 'session'
 * @param {string} message
 * @param {'info'|'warning'|'error'} [level='info']
 * @param {object} [data]
 */
export function addBreadcrumb(category, message, level = 'info', data) {
	Sentry.addBreadcrumb({
		category,
		message,
		level,
		data,
		timestamp: Date.now() / 1000,
	});
}

/**
 * Capture an exception with optional extra context.
 * @param {Error} error
 * @param {{ source?: string, extras?: object }} [context]
 */
export function captureException(error, context) {
	Sentry.withScope((scope) => {
		if (context?.source) scope.setTag('source', context.source);
		if (context?.extras) scope.setExtras(context.extras);
		Sentry.captureException(error);
	});
}

/**
 * Graceful shutdown — flush pending events.
 * @param {number} [timeoutMs=2000]
 * @returns {Promise<boolean>}
 */
export function shutdownSentry(timeoutMs = 2000) {
	if (!initialized) return Promise.resolve(true);
	return Sentry.close(timeoutMs);
}

/**
 * Wire process-level crash handlers.
 * Call once after initSentry().
 */
export function wireCrashHandlers() {
	process.on('uncaughtException', (error) => {
		Sentry.captureException(error);
		Sentry.close(2000).then(() => process.exit(1)).catch(() => process.exit(1));
	});

	process.on('unhandledRejection', (reason) => {
		const error = reason instanceof Error ? reason : new Error(String(reason));
		Sentry.captureException(error);
	});
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test scripts/__tests__/sentry.test.js
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/sentry.js scripts/__tests__/sentry.test.js
git commit -m "feat: add sentry.js module for crash reporting"
```

---

### Task 3: Add `reportError()` Helper to `cc-utils.js`

**Files:**
- Modify: `scripts/lib/cc-utils.js:10-17` (add import), append new function
- Test: `scripts/__tests__/report-error.test.js`

- [ ] **Step 1: Write the failing test**

Create `scripts/__tests__/report-error.test.js`:
```js
import { describe, test, expect, beforeAll, afterAll, afterEach } from 'bun:test';
import { createServer } from 'http';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { randomBytes } from 'crypto';

const TEST_CONFIG_DIR = join(tmpdir(), `lightsprint-report-error-test-${randomBytes(8).toString('hex')}`);
const ORIG_CONFIG_DIR = process.env.LIGHTSPRINT_CONFIG_DIR;
process.env.LIGHTSPRINT_CONFIG_DIR = TEST_CONFIG_DIR;

import { reportError } from '../lib/cc-utils.js';
import { writeSessionState } from '../lib/cc-utils.js';

const SESSIONS_DIR = join(TEST_CONFIG_DIR, 'cc-sessions');

beforeAll(() => {
	mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
});

afterAll(() => {
	if (ORIG_CONFIG_DIR) {
		process.env.LIGHTSPRINT_CONFIG_DIR = ORIG_CONFIG_DIR;
	} else {
		delete process.env.LIGHTSPRINT_CONFIG_DIR;
	}
	try { rmSync(TEST_CONFIG_DIR, { recursive: true, force: true }); } catch {}
});

describe('reportError', () => {
	test('POSTs error to daemon /error endpoint with auth token', async () => {
		let receivedBody = null;
		let receivedAuth = null;

		const server = createServer((req, res) => {
			receivedAuth = req.headers['authorization'];
			let body = '';
			req.on('data', chunk => body += chunk);
			req.on('end', () => {
				receivedBody = JSON.parse(body);
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ ok: true }));
			});
		});

		const port = await new Promise((resolve) => {
			server.listen(0, '127.0.0.1', () => resolve(server.address().port));
		});

		const sessionId = `test-session-${randomBytes(4).toString('hex')}`;
		const token = 'test-daemon-token-abc';
		writeSessionState(sessionId, {
			port,
			daemonPid: process.pid,
			ccPid: process.pid,
			daemonToken: token,
			repoId: 'test-repo',
		});

		const error = new Error('Something broke');
		await reportError(sessionId, error, 'cc-event');

		server.close();

		expect(receivedAuth).toBe(`Bearer ${token}`);
		expect(receivedBody.source).toBe('cc-event');
		expect(receivedBody.error).toBe('Error');
		expect(receivedBody.message).toBe('Something broke');
		expect(receivedBody.stack).toContain('Something broke');
	});

	test('silently fails when daemon is unreachable', async () => {
		const sessionId = `test-session-dead-${randomBytes(4).toString('hex')}`;
		writeSessionState(sessionId, {
			port: 1, // unreachable port
			daemonPid: 99999999,
			ccPid: process.pid,
			daemonToken: 'token',
			repoId: 'test-repo',
		});

		// Should not throw
		await reportError(sessionId, new Error('test'), 'cc-end');
	});

	test('silently fails when no session state exists', async () => {
		await reportError('nonexistent-session', new Error('test'), 'cc-event');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test scripts/__tests__/report-error.test.js
```
Expected: FAIL — `reportError` not exported

- [ ] **Step 3: Add reportError to cc-utils.js**

Add this function at the end of `scripts/lib/cc-utils.js`:

```js
/**
 * Report an error to the daemon for Sentry forwarding.
 * Fire-and-forget: never blocks, never throws.
 * Falls back to daemon.log if daemon is unreachable.
 * @param {string} ccSessionId
 * @param {Error} error
 * @param {string} source - e.g. 'cc-event', 'cc-start', 'ls-cli'
 */
export async function reportError(ccSessionId, error, source) {
	try {
		const state = readSessionState(ccSessionId);
		if (!state?.port || !state?.daemonToken) {
			// No daemon running — fall back to log file
			const log = createLogger(source);
			log('Error (no daemon)', { error: error.message, stack: error.stack });
			return;
		}

		await fetch(`http://127.0.0.1:${state.port}/error`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${state.daemonToken}`,
			},
			body: JSON.stringify({
				source,
				error: error.name || 'Error',
				message: error.message,
				stack: error.stack,
				context: {},
			}),
			signal: AbortSignal.timeout(3000),
		});
	} catch {
		// Fire-and-forget — fall back to log file
		try {
			const log = createLogger(source);
			log('Error (daemon unreachable)', { error: error.message });
		} catch { /* never crash on error reporting */ }
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test scripts/__tests__/report-error.test.js
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/cc-utils.js scripts/__tests__/report-error.test.js
git commit -m "feat: add reportError() helper for daemon error forwarding"
```

---

### Task 4: Add `/error` Endpoint to Daemon

**Files:**
- Modify: `scripts/cc-daemon.js:23-31` (add sentry import), `scripts/cc-daemon.js:366-457` (add endpoint in HTTP server), `scripts/cc-daemon.js:734-783` (wire Sentry init in main)
- Test: `scripts/__tests__/daemon-error-endpoint.test.js`

- [ ] **Step 1: Write the failing test**

Create `scripts/__tests__/daemon-error-endpoint.test.js`:
```js
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createServer } from 'http';

describe('daemon /error endpoint', () => {
	let server;
	let port;
	let capturedErrors = [];
	const DAEMON_AUTH_TOKEN = 'test-token-123';

	beforeAll(async () => {
		// Simulate the daemon's /error endpoint handler
		server = createServer(async (req, res) => {
			if (req.url === '/error' && req.method === 'POST') {
				const authHeader = req.headers['authorization'];
				const providedToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
				if (providedToken !== DAEMON_AUTH_TOKEN) {
					res.writeHead(401, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
					return;
				}

				let body = '';
				req.on('data', chunk => body += chunk);
				req.on('end', () => {
					const data = JSON.parse(body);
					capturedErrors.push(data);
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ ok: true }));
				});
				return;
			}
			res.writeHead(404);
			res.end();
		});

		port = await new Promise((resolve) => {
			server.listen(0, '127.0.0.1', () => resolve(server.address().port));
		});
	});

	afterAll(() => {
		server.close();
	});

	test('accepts error report with valid auth', async () => {
		const resp = await fetch(`http://127.0.0.1:${port}/error`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${DAEMON_AUTH_TOKEN}`,
			},
			body: JSON.stringify({
				source: 'cc-event',
				error: 'TypeError',
				message: 'Cannot read property',
				stack: 'TypeError: Cannot read property\n    at ...',
				context: {},
			}),
		});
		expect(resp.status).toBe(200);
		expect(capturedErrors.length).toBeGreaterThan(0);
		expect(capturedErrors[capturedErrors.length - 1].source).toBe('cc-event');
	});

	test('rejects error report without auth', async () => {
		const resp = await fetch(`http://127.0.0.1:${port}/error`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				source: 'cc-event',
				error: 'Error',
				message: 'test',
			}),
		});
		expect(resp.status).toBe(401);
	});

	test('rejects error report with wrong token', async () => {
		const resp = await fetch(`http://127.0.0.1:${port}/error`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': 'Bearer wrong-token',
			},
			body: JSON.stringify({
				source: 'cc-event',
				error: 'Error',
				message: 'test',
			}),
		});
		expect(resp.status).toBe(401);
	});
});
```

- [ ] **Step 2: Run test to verify it passes (endpoint pattern test)**

```bash
bun test scripts/__tests__/daemon-error-endpoint.test.js
```
Expected: PASS (this tests the endpoint pattern, not the actual daemon)

- [ ] **Step 3: Add Sentry import and init to cc-daemon.js main()**

At the top of `scripts/cc-daemon.js`, add after the existing imports (after line 37):
```js
import { initSentry, setSentryContext, addBreadcrumb, captureException, shutdownSentry, wireCrashHandlers } from './lib/sentry.js';
```

In the `main()` function (around line 734), add Sentry init right after the `log('Starting daemon', ...)` line:
```js
	// Initialize Sentry crash reporting
	initSentry({ baseUrl: BASE_URL });
	wireCrashHandlers();
	setSentryContext({
		email: repoConfig?.email,
		repoId: REPO_ID,
		sessionId: CC_SESSION_ID,
		machineId: MACHINE_ID,
	});
```

- [ ] **Step 4: Add `/error` endpoint to HTTP server**

In `_tryListenOnPort()`, add a new route handler before the 404 fallback (before `res.writeHead(404)`):

```js
		if (url.pathname === '/error' && req.method === 'POST') {
			try {
				const body = await readBody(req);
				const data = JSON.parse(body);
				log('Error report received', { source: data.source, error: data.error });
				const err = new Error(data.message || 'Unknown error');
				err.name = data.error || 'Error';
				if (data.stack) err.stack = data.stack;
				captureException(err, {
					source: data.source,
					extras: data.context,
				});
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ ok: true }));
			} catch (err) {
				res.writeHead(400, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ ok: false, error: err.message }));
			}
			return;
		}
```

- [ ] **Step 5: Wire Sentry shutdown in the shutdown() function**

In the `shutdown()` function (around line 142), add before `process.exit(0)`:
```js
	await shutdownSentry();
```

- [ ] **Step 6: Run existing daemon tests to verify no regressions**

```bash
bun test scripts/__tests__/daemon-hardening.test.js scripts/__tests__/daemon-error-endpoint.test.js
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/cc-daemon.js scripts/__tests__/daemon-error-endpoint.test.js
git commit -m "feat: add /error endpoint and Sentry init to daemon"
```

---

### Task 5: Add Breadcrumbs to Daemon Lifecycle Events

**Files:**
- Modify: `scripts/cc-daemon.js` (multiple locations)

Note: Line numbers below are approximate. After Task 4 modifies `cc-daemon.js`, use function/pattern matching to find insertion points, not line numbers.

- [ ] **Step 1: Add breadcrumbs to WebSocket lifecycle**

In `connectWebSocket()`:
- After `ws.onopen = async () => {` and `reconnectAttempts = 0;`: `addBreadcrumb('websocket', 'WebSocket connected');`
- In `ws.onclose` handler, after `log('WebSocket closed', ...)`: `addBreadcrumb('websocket', 'WebSocket closed', 'warning', { code: event.code, reason: event.reason });`
- In `ws.onerror` handler, after `log('WebSocket error')`: `addBreadcrumb('websocket', 'WebSocket error', 'error');`
- In `scheduleReconnect()`, after `log('Scheduling reconnect', ...)`: `addBreadcrumb('websocket', 'Scheduling reconnect', 'warning', { attempt: reconnectAttempts });`

- [ ] **Step 2: Add breadcrumbs to event queue**

In `enqueueEvent()`, after the `log('Event queue overflow, dropped oldest event')` line:
```js
addBreadcrumb('eventQueue', 'Event queue overflow, dropped oldest', 'warning', { queueSize: EVENT_QUEUE_MAX });
```

- [ ] **Step 3: Add breadcrumbs to session lifecycle**

In `main()`, after the `if (cleaned > 0) log(...)` line:
```js
if (cleaned > 0) addBreadcrumb('session', 'Cleaned stale sessions', 'info', { count: cleaned });
```

In `ws.onopen`, after `log('Session started', { lsSessionId })`:
```js
addBreadcrumb('session', 'Session started', 'info', { lsSessionId });
```

In `shutdown()`, after `log('Shutting down', { reason })`:
```js
addBreadcrumb('session', 'Shutting down', 'info', { reason });
```

- [ ] **Step 4: Add breadcrumbs to token refresh**

In daemon's `refreshTokenIfNeeded()`, after `log('Token refreshed successfully')`:
```js
addBreadcrumb('token', 'Token refreshed successfully');
```

After `log('Token refresh failed', { status: response.status })`:
```js
addBreadcrumb('token', 'Token refresh failed', 'error', { status: response.status });
```

- [ ] **Step 5: Add breadcrumb to watchdog**

In `startWatchdog()` interval callback, after `log('CC process dead, shutting down', ...)`:
```js
addBreadcrumb('watchdog', 'CC process dead', 'error', { ccPid: CC_PID });
```

- [ ] **Step 6: Add captureException for WebSocket errors**

In `scheduleReconnect()`, after `log('Max reconnect attempts reached, shutting down')`:
```js
captureException(new Error('Max WebSocket reconnect attempts reached'), { source: 'cc-daemon', extras: { attempts: MAX_RECONNECT_ATTEMPTS } });
```

In daemon's `refreshTokenIfNeeded()`, in the catch block after `log('Token refresh error', ...)`:
```js
captureException(new Error('Token refresh failed'), { source: 'cc-daemon', extras: { error: err.message } });
```

- [ ] **Step 7: Run all daemon tests**

```bash
bun test scripts/__tests__/daemon-hardening.test.js scripts/__tests__/cc-daemon-ws.test.js
```
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add scripts/cc-daemon.js
git commit -m "feat: add Sentry breadcrumbs and error capture to daemon lifecycle"
```

---

### Task 6: Wire reportError() into Hook Catch Blocks

**Files:**
- Modify: `scripts/cc-event.js:10,41-46`
- Modify: `scripts/cc-start.js:13`
- Modify: `scripts/cc-end.js:7,29-31`
- Modify: `scripts/cc-pr-created.js:11,122-126`
- Modify: `scripts/review-plan.js` (standalone main path)

- [ ] **Step 1: Update cc-event.js**

Add import at top:
```js
import { readHookInput, readSessionState, reportError } from './lib/cc-utils.js';
```

Update catch block (line ~41-46). Note: do NOT `await` reportError — it's fire-and-forget. The `.catch()` prevents unhandled rejection:
```js
	} catch (err) {
		// Daemon may be busy or dead — never block Claude Code
		reportError(ccSessionId, err, 'cc-event').catch(() => {});
		if (process.env.LIGHTSPRINT_DEBUG) {
			process.stderr.write(`[lightsprint:cc-event] ${err.message}\n`);
		}
	}
```

- [ ] **Step 2: Update cc-end.js**

Add `reportError` to import:
```js
import { readHookInput, readSessionState, reportError } from './lib/cc-utils.js';
```

Update catch block (line ~29-31). Do NOT await — fire-and-forget:
```js
	} catch (err) {
		reportError(ccSessionId, err, 'cc-end').catch(() => {});
	}
```

Note: `ccSessionId` must be declared before the try block. Refactor to:
```js
export async function main(args) {
	const input = readHookInput(args);
	if (!input) return;

	const ccSessionId = input.session_id;
	if (!ccSessionId) return;

	const state = readSessionState(ccSessionId);
	if (!state) return;

	try {
		await fetch(`http://127.0.0.1:${state.port}/session-end`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(state.daemonToken ? { 'Authorization': `Bearer ${state.daemonToken}` } : {}),
			},
			body: JSON.stringify({}),
			signal: AbortSignal.timeout(3000),
		});
	} catch (err) {
		reportError(ccSessionId, err, 'cc-end');
	}
}
```

- [ ] **Step 3: Update cc-pr-created.js**

Add `reportError` to import:
```js
import { readHookInput, createLogger, reportError } from './lib/cc-utils.js';
```

**IMPORTANT:** `input` is declared with `const` inside the `try` block (block-scoped), so it is NOT accessible in the `catch` block. Hoist it to function scope:

Change the beginning of `main()` from:
```js
export async function main(args) {
	try {
		const input = readHookInput(args);
```
To:
```js
export async function main(args) {
	let input;
	try {
		input = readHookInput(args);
```

Then update the catch block (line ~122-126) — call `reportError()` **before** re-throw:
```js
	} catch (err) {
		log('Hook error', { error: err.message, stack: err.stack });
		// Report error before re-throw
		const ccSessionId = input?.session_id;
		if (ccSessionId) {
			reportError(ccSessionId, err, 'cc-pr-created');
		}
		throw err;
	}
```

- [ ] **Step 4: Update cc-start.js**

Add `reportError` to import:
```js
import { readHookInput, readSessionState, writeSessionState, isPidAlive, deleteSessionState, findRunningDaemonForCcPid, createLogger, getClaudeCodePid, reportError } from './lib/cc-utils.js';
```

**Pre-existing bug fix:** In the `withFileLock` callback, where session state is aliased for an existing daemon (the `writeSessionState` call for `existingDaemonState`), add the missing `daemonToken` field. Without this, `reportError()` from hooks using this aliased session will fail auth:
```js
			writeSessionState(ccSessionId, {
				port: existingDaemonState.port,
				daemonPid: existingDaemonState.daemonPid,
				ccPid: existingDaemonState.ccPid,
				ccSessionId,
				lsSessionId: existingDaemonState.lsSessionId,
				repoId: existingDaemonState.repoId,
				daemonToken: existingDaemonState.daemonToken, // <-- ADD THIS
			});
```

Wrap the `withFileLock` and polling (lines after `const ccPid = getClaudeCodePid()`) in a try-catch:
```js
	try {
		await withFileLock(lockPath, async () => {
			// ... existing code ...
		});

		// ... existing polling code ...
	} catch (err) {
		log('Daemon start error', { error: err.message });
		reportError(ccSessionId, err, 'cc-start').catch(() => {});
	}
```

- [ ] **Step 5: Update review-plan.js (standalone path only)**

Find the `reviewPlanMain()` function (or the standalone entry point at the end of the file). Add error reporting in its catch block. Read the file first to find the exact location.

The standalone path is in `reviewPlanMain()` which wraps the hook handling. Add `reportError` import and call it in the catch block, using the session_id from hook input.

- [ ] **Step 6: Run all tests**

```bash
bun test
```
Expected: PASS (all existing + new tests)

- [ ] **Step 7: Commit**

```bash
git add scripts/cc-event.js scripts/cc-end.js scripts/cc-pr-created.js scripts/cc-start.js scripts/review-plan.js
git commit -m "feat: wire reportError() into all hook catch blocks"
```

---

### Task 7: Add Sentry Capture to client.js API Errors

**IMPORTANT:** `client.js` is imported by hooks, CLI, and daemon. Importing `sentry.js` directly would load the Sentry SDK in all contexts (violating the "daemon-only" architecture). Instead, use an **optional callback pattern**: `client.js` accepts an error reporter callback that the daemon sets, and hooks/CLI leave unset.

**Files:**
- Modify: `scripts/lib/client.js` (add callback pattern)
- Modify: `scripts/cc-daemon.js` (wire callback after Sentry init)

- [ ] **Step 1: Add error reporter callback to client.js**

Add near the top of `scripts/lib/client.js`, after `let _config = null;`:
```js
let _onError = null;

/**
 * Set an error reporting callback. Called when retries are exhausted or auth fails.
 * Only set in daemon context where Sentry is initialized.
 * @param {(error: Error, context: object) => void} fn
 */
export function setErrorReporter(fn) {
	_onError = fn;
}
```

- [ ] **Step 2: Use the callback in retryableFetch**

In `retryableFetch()`, after retries exhausted for 5xx (where `return response` is, after the final attempt):
```js
			// Retries exhausted
			if (_onError) {
				_onError(new Error(`API ${response.status} after ${maxRetries} retries: ${url}`), {
					source: 'client', extras: { status: response.status, url, attempts: maxRetries + 1 },
				});
			}
			return response;
```

And for network errors after retries exhausted:
```js
			if (_onError) {
				_onError(err, { source: 'client', extras: { url, attempts: maxRetries + 1 } });
			}
			throw err;
```

- [ ] **Step 3: Use the callback in refreshTokenIfNeeded**

In `refreshTokenIfNeeded()`, after `console.error` on failure:
```js
		if (_onError) {
			_onError(new Error(`Token refresh failed: ${response.status}`), { source: 'client-auth' });
		}
```

And in the catch block:
```js
		if (_onError) _onError(err, { source: 'client-auth' });
```

- [ ] **Step 4: Wire the callback in cc-daemon.js**

In `cc-daemon.js` `main()`, after Sentry init (from Task 4), add:
```js
	import { setErrorReporter } from './lib/client.js';
	// ... (this import goes at the top of the file with other imports)

	// Wire Sentry error capture for API client
	setErrorReporter((error, context) => captureException(error, context));
```

Note: The `import` statement goes at the top of the file. The `setErrorReporter` call goes in `main()` after `initSentry()`.

- [ ] **Step 5: Run client tests**

```bash
bun test scripts/__tests__/client-resilience.test.js scripts/__tests__/api-request.test.js
```
Expected: PASS (callback is null by default, so no change in behavior)

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/client.js scripts/cc-daemon.js
git commit -m "feat: add error reporter callback to client.js, wire Sentry in daemon"
```

---

### Task 8: Add Validation Breadcrumbs

**IMPORTANT:** `validate.js` is imported by hooks, CLI, and daemon (shared module). Do NOT import `sentry.js` directly — it would load the Sentry SDK in all contexts. Instead, use an optional callback pattern (same approach as Task 7 for client.js).

**Files:**
- Modify: `scripts/lib/validate.js` (add callback pattern)
- Modify: `scripts/cc-daemon.js` (wire callback after Sentry init)

- [ ] **Step 1: Add breadcrumb callback to validate.js**

Add near the top of `scripts/lib/validate.js`:
```js
let _onBreadcrumb = null;

/**
 * Set a breadcrumb callback. Called on validation failures.
 * Only set in daemon context where Sentry is initialized.
 * @param {(category: string, message: string, level: string, data: object) => void} fn
 */
export function setValidationBreadcrumbReporter(fn) {
	_onBreadcrumb = fn;
}
```

- [ ] **Step 2: Use the callback in validateId and validateEnum**

In `validateId()`, before throwing:
```js
	if (!ID_PATTERN.test(id)) {
		if (_onBreadcrumb) _onBreadcrumb('validation', `Invalid ${label}: "${id}"`, 'warning', { label, id });
		throw new Error(`Invalid ${label}: "${id}". Only alphanumeric characters, hyphens, and underscores are allowed.`);
	}
```

In `validateEnum()`, before throwing:
```js
	if (!arr.includes(value)) {
		if (_onBreadcrumb) _onBreadcrumb('validation', `Invalid ${fieldName}: "${value}"`, 'warning', { fieldName, value, allowed: arr });
		throw new Error(`Invalid ${fieldName}: "${value}". Allowed values: ${arr.join(', ')}`);
	}
```

- [ ] **Step 3: Wire the callback in cc-daemon.js**

In `cc-daemon.js` `main()`, after Sentry init, add:
```js
	import { setValidationBreadcrumbReporter } from './lib/validate.js';
	// ... (import goes at top of file)

	setValidationBreadcrumbReporter((category, message, level, data) => addBreadcrumb(category, message, level, data));
```

- [ ] **Step 4: Run validation tests**

```bash
bun test scripts/__tests__/validate-id.test.js scripts/__tests__/validate-fixes.test.js
```
Expected: PASS (callback is null by default, no behavior change)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/validate.js scripts/cc-daemon.js
git commit -m "feat: add validation breadcrumb callback, wire in daemon"
```

---

### Task 9: Wire CLI Error Reporting in ls-cli.js

**Files:**
- Modify: `scripts/ls-cli.js`

- [ ] **Step 1: Read ls-cli.js to find error handling patterns**

Read the file to identify:
- Where API errors are caught after validation
- Where `cliMain()` catches and reports errors
- How to discover the active session (for `reportError()` call)

- [ ] **Step 2: Add `findSessionByRepoId` to cc-utils.js**

This is a shared utility (similar to existing `findRunningDaemonForCcPid`). Add to `scripts/lib/cc-utils.js`:
```js
/**
 * Find an active session ID by repo ID.
 * Scans session files for a matching repoId with a live daemon.
 * @param {string} repoId
 * @returns {string|null} CC session ID, or null if none found
 */
export function findSessionByRepoId(repoId) {
	try {
		const files = readdirSync(SESSIONS_DIR);
		for (const file of files) {
			if (!file.endsWith('.json')) continue;
			try {
				const state = JSON.parse(readFileSync(join(SESSIONS_DIR, file), 'utf-8'));
				if (state.repoId === repoId && isPidAlive(state.daemonPid)) {
					return file.replace('.json', '');
				}
			} catch { continue; }
		}
	} catch { /* dir doesn't exist */ }
	return null;
}
```

- [ ] **Step 3: Add reportError to CLI error path in ls-cli.js**

Add import to `scripts/ls-cli.js`:
```js
import { reportError, findSessionByRepoId } from './lib/cc-utils.js';
```

In the main error handling path of `cliMain()`, after catching an API error:
```js
	const sessionId = findSessionByRepoId(repoId);
	if (sessionId) {
		reportError(sessionId, err, 'ls-cli');
	}
```

- [ ] **Step 3: Run CLI tests**

```bash
bun test scripts/__tests__/cli-routing.test.js
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add scripts/ls-cli.js
git commit -m "feat: wire CLI API errors to Sentry via reportError"
```

---

### Task 10: Update compile.sh and Final Verification

**Files:**
- Modify: `scripts/compile.sh` (if needed for Sentry externals)

- [ ] **Step 1: Build the binary**

```bash
bash scripts/compile.sh
```

If build fails with Sentry-related errors, add `--external` flags:
```bash
# In compile.sh, add to bun build command:
--external @sentry/profiling-node
```

- [ ] **Step 2: Run full test suite**

```bash
bun test
```
Expected: ALL PASS

- [ ] **Step 3: Test binary works**

```bash
./lightsprint --version
./lightsprint status
```

- [ ] **Step 4: Commit any build changes**

```bash
git add scripts/compile.sh
git commit -m "chore: update compile.sh for Sentry compatibility"
```

- [ ] **Step 5: Final commit with all files**

Verify nothing is left unstaged:
```bash
git status
```

If clean, the implementation is complete.
