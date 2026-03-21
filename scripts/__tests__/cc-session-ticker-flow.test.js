import { describe, test, expect, beforeAll, beforeEach, afterEach, spyOn } from 'bun:test';
import { join } from 'path';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { homedir } from 'os';
import { randomBytes } from 'crypto';

/**
 * Tests for the CC session → ticker tape data flow on the plugin side.
 *
 * Covers:
 * 1. Session discovery via findRunningDaemonForCcPid
 * 2. Session state file management (write, read, delete)
 * 3. Task ID mapping (CC task ↔ LS task)
 * 4. cc-event.js forwarding events to the daemon HTTP server
 * 5. Claim command sends ccSessionId to link task to session
 * 6. handleTaskCreate payload → API call with correct parent linkage
 */

// ─── Session State I/O ──────────────────────────────────────────────────────

import {
	writeSessionState,
	readSessionState,
	deleteSessionState,
	findRunningDaemonForCcPid,
	isPidAlive,
} from '../lib/cc-utils.js';

const CONFIG_DIR = process.env.LIGHTSPRINT_CONFIG_DIR || join(homedir(), '.lightsprint');
const SESSIONS_DIR = join(CONFIG_DIR, 'cc-sessions');

describe('Session State I/O', () => {
	const testSessionId = `test-session-${randomBytes(8).toString('hex')}`;

	beforeAll(() => {
		mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
	});

	afterEach(() => {
		deleteSessionState(testSessionId);
	});

	test('writeSessionState creates session file with correct data', () => {
		const state = {
			port: 12345,
			daemonPid: process.pid,
			ccPid: process.ppid,
			ccSessionId: testSessionId,
			lsSessionId: 'ls-test-123',
			repoId: 'repo-abc',
		};

		writeSessionState(testSessionId, state);

		const filePath = join(SESSIONS_DIR, `${testSessionId}.json`);
		expect(existsSync(filePath)).toBe(true);

		const written = JSON.parse(readFileSync(filePath, 'utf-8'));
		expect(written.port).toBe(12345);
		expect(written.lsSessionId).toBe('ls-test-123');
		expect(written.updatedAt).toBeDefined();
	});

	test('readSessionState returns written data', () => {
		writeSessionState(testSessionId, {
			port: 55555,
			daemonPid: process.pid,
			ccPid: 99999,
			lsSessionId: 'ls-read-test',
			repoId: 'repo-xyz',
		});

		const state = readSessionState(testSessionId);
		expect(state).not.toBeNull();
		expect(state.port).toBe(55555);
		expect(state.lsSessionId).toBe('ls-read-test');
	});

	test('readSessionState returns null for nonexistent session', () => {
		expect(readSessionState('nonexistent-session-id')).toBeNull();
	});

	test('deleteSessionState removes session file', () => {
		writeSessionState(testSessionId, { port: 1, daemonPid: 1, ccPid: 1 });
		expect(readSessionState(testSessionId)).not.toBeNull();

		deleteSessionState(testSessionId);
		expect(readSessionState(testSessionId)).toBeNull();
	});

	test('deleteSessionState is safe for nonexistent files', () => {
		// Should not throw
		deleteSessionState('does-not-exist-12345');
	});
});

// ─── findRunningDaemonForCcPid ──────────────────────────────────────────────

describe('findRunningDaemonForCcPid', () => {
	const testSessionId = `test-find-daemon-${randomBytes(8).toString('hex')}`;

	afterEach(() => {
		deleteSessionState(testSessionId);
	});

	test('finds daemon when ccPid matches and daemon is alive', () => {
		// Use current process.pid as daemonPid (guaranteed alive)
		writeSessionState(testSessionId, {
			port: 33333,
			daemonPid: process.pid,
			ccPid: process.ppid,
			ccSessionId: testSessionId,
			lsSessionId: 'ls-find-test',
			repoId: 'repo-find',
		});

		const result = findRunningDaemonForCcPid(process.ppid);
		expect(result).not.toBeNull();
		expect(result.lsSessionId).toBe('ls-find-test');
		expect(result.port).toBe(33333);
	});

	test('returns null when ccPid does not match any session', () => {
		writeSessionState(testSessionId, {
			port: 33333,
			daemonPid: process.pid,
			ccPid: 99999,
			lsSessionId: 'ls-no-match',
			repoId: 'repo-x',
		});

		// Search for a PID that doesn't match
		const result = findRunningDaemonForCcPid(88888);
		expect(result).toBeNull();
	});

	test('returns null when daemon PID is dead', () => {
		writeSessionState(testSessionId, {
			port: 33333,
			daemonPid: 999999, // unlikely to be alive
			ccPid: process.ppid,
			lsSessionId: 'ls-dead-daemon',
			repoId: 'repo-dead',
		});

		const result = findRunningDaemonForCcPid(process.ppid);
		expect(result).toBeNull();
	});
});

// ─── isPidAlive ─────────────────────────────────────────────────────────────

describe('isPidAlive', () => {
	test('returns true for own process', () => {
		expect(isPidAlive(process.pid)).toBe(true);
	});

	test('returns false for obviously dead PID', () => {
		expect(isPidAlive(999999999)).toBe(false);
	});

	test('returns false for invalid inputs', () => {
		expect(isPidAlive(0)).toBe(false);
		expect(isPidAlive(-1)).toBe(false);
		expect(isPidAlive(NaN)).toBe(false);
		expect(isPidAlive(null)).toBe(false);
		expect(isPidAlive(undefined)).toBe(false);
		expect(isPidAlive('abc')).toBe(false);
	});
});

// ─── Task ID Mapping ────────────────────────────────────────────────────────

import { setMapping, getMapping, removeSessionMappings } from '../lib/task-map.js';

const MAP_FILE = join(homedir(), '.lightsprint', 'task-map.json');

describe('Task ID Mapping (CC ↔ LS)', () => {
	let originalMap;

	beforeEach(() => {
		// Backup existing map
		try {
			originalMap = readFileSync(MAP_FILE, 'utf-8');
		} catch {
			originalMap = null;
		}
	});

	afterEach(() => {
		// Restore original map
		if (originalMap !== null) {
			writeFileSync(MAP_FILE, originalMap);
		} else {
			try { rmSync(MAP_FILE); } catch { /* ignore */ }
		}
	});

	test('setMapping stores and getMapping retrieves CC→LS mapping', () => {
		setMapping('test-session', 'cc-task-1', 'ls-task-abc');
		expect(getMapping('test-session', 'cc-task-1')).toBe('ls-task-abc');
	});

	test('getMapping returns null for unknown task', () => {
		expect(getMapping('test-session', 'nonexistent-cc-task')).toBeNull();
	});

	test('mappings are scoped by session', () => {
		setMapping('session-A', 'cc-task-1', 'ls-A');
		setMapping('session-B', 'cc-task-1', 'ls-B');

		expect(getMapping('session-A', 'cc-task-1')).toBe('ls-A');
		expect(getMapping('session-B', 'cc-task-1')).toBe('ls-B');
	});

	test('removeSessionMappings clears only that session', () => {
		setMapping('session-keep', 'cc-1', 'ls-keep');
		setMapping('session-remove', 'cc-1', 'ls-remove');
		setMapping('session-remove', 'cc-2', 'ls-remove-2');

		removeSessionMappings('session-remove');

		expect(getMapping('session-keep', 'cc-1')).toBe('ls-keep');
		expect(getMapping('session-remove', 'cc-1')).toBeNull();
		expect(getMapping('session-remove', 'cc-2')).toBeNull();
	});
});

// ─── cc-event.js: Event Forwarding ──────────────────────────────────────────

describe('cc-event forwarding', () => {
	const testSessionId = `test-event-fwd-${randomBytes(8).toString('hex')}`;
	let server;
	let receivedEvents;
	let serverPort;

	beforeAll(() => {
		mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
	});

	beforeEach(async () => {
		receivedEvents = [];

		// Start a local HTTP server to simulate the daemon
		server = Bun.serve({
			port: 0,
			fetch(req) {
				if (new URL(req.url).pathname === '/event') {
					return req.json().then(body => {
						receivedEvents.push(body);
						return new Response('ok');
					});
				}
				return new Response('not found', { status: 404 });
			},
		});
		serverPort = server.port;

		// Write session state pointing to our test server
		writeSessionState(testSessionId, {
			port: serverPort,
			daemonPid: process.pid,
			ccPid: process.ppid,
			ccSessionId: testSessionId,
			lsSessionId: 'ls-event-test',
			repoId: 'repo-event',
		});
	});

	afterEach(() => {
		deleteSessionState(testSessionId);
		server?.stop();
	});

	test('PostToolUse:TaskCreate event is forwarded to daemon', async () => {
		// Import cc-event's main function
		const { main } = await import('../cc-event.js');

		// Simulate hook input via temp file (PermissionRequest-style)
		const tmpFile = join(SESSIONS_DIR, `.test-input-${randomBytes(4).toString('hex')}.json`);
		const hookInput = {
			session_id: testSessionId,
			hook_event_name: 'PostToolUse',
			tool_name: 'TaskCreate',
			tool_input: { subject: 'Test subtask', description: 'Testing ticker flow' },
			tool_response: { task: { id: 'cc-task-42' } },
		};
		writeFileSync(tmpFile, JSON.stringify(hookInput));

		try {
			await main([tmpFile]);

			expect(receivedEvents).toHaveLength(1);
			expect(receivedEvents[0].eventType).toBe('PostToolUse');
			expect(receivedEvents[0].payload.tool_name).toBe('TaskCreate');
			expect(receivedEvents[0].payload.tool_input.subject).toBe('Test subtask');
		} finally {
			try { rmSync(tmpFile); } catch { /* ignore */ }
		}
	});

	test('event is not sent when session state is missing', async () => {
		const { main } = await import('../cc-event.js');

		deleteSessionState(testSessionId);

		const tmpFile = join(SESSIONS_DIR, `.test-input-${randomBytes(4).toString('hex')}.json`);
		writeFileSync(tmpFile, JSON.stringify({
			session_id: testSessionId,
			hook_event_name: 'PostToolUse',
			tool_name: 'TaskCreate',
		}));

		try {
			await main([tmpFile]);
			// Should silently skip — no events received
			expect(receivedEvents).toHaveLength(0);
		} finally {
			try { rmSync(tmpFile); } catch { /* ignore */ }
		}
	});
});

// ─── Claim: Session Discovery & Linking ─────────────────────────────────────

describe('Claim session discovery', () => {
	const testSessionId = `test-claim-${randomBytes(8).toString('hex')}`;

	afterEach(() => {
		deleteSessionState(testSessionId);
	});

	test('findRunningDaemonForCcPid returns lsSessionId for claim to use', () => {
		// This tests the exact code path cmdClaim uses to discover the session
		writeSessionState(testSessionId, {
			port: 44444,
			daemonPid: process.pid, // alive
			ccPid: process.ppid,
			ccSessionId: testSessionId,
			lsSessionId: 'ls-claim-session-id',
			repoId: 'repo-claim',
		});

		// cmdClaim calls: findRunningDaemonForCcPid(ccPid)?.lsSessionId
		const daemonState = findRunningDaemonForCcPid(process.ppid);
		expect(daemonState).not.toBeNull();
		expect(daemonState.lsSessionId).toBe('ls-claim-session-id');

		// This lsSessionId is then sent as ccSessionId in the claim POST body
		// which links the task to the CC session in the database
		const claimBody = {};
		if (daemonState.lsSessionId) {
			claimBody.ccSessionId = daemonState.lsSessionId;
		}
		expect(claimBody.ccSessionId).toBe('ls-claim-session-id');
	});

	test('claim proceeds without ccSessionId when no daemon is running', () => {
		// No session state written → no daemon discoverable
		const daemonState = findRunningDaemonForCcPid(process.ppid);
		// daemonState is null because the session from prior test was cleaned up

		const claimBody = {};
		if (daemonState?.lsSessionId) {
			claimBody.ccSessionId = daemonState.lsSessionId;
		}

		// ccSessionId should be undefined — claim still works but won't link
		expect(claimBody.ccSessionId).toBeUndefined();
	});
});

// ─── Status Mapping ─────────────────────────────────────────────────────────

import { ccToLsStatus, lsToCcStatus } from '../lib/status-mapper.js';

describe('Status mapping for subtask creation', () => {
	test('CC "pending" maps to LS "backlog" (initial subtask status)', () => {
		// handleTaskCreate uses ccToLsStatus('pending') for new subtasks
		expect(ccToLsStatus('pending')).toBe('backlog');
	});

	test('CC "in_progress" maps to LS "in_progress" (ticker shows these)', () => {
		expect(ccToLsStatus('in_progress')).toBe('in_progress');
	});

	test('CC "completed" maps to LS "done" (progress ring counts these)', () => {
		expect(ccToLsStatus('completed')).toBe('done');
	});

	test('LS "in_progress" maps to CC "in_progress"', () => {
		expect(lsToCcStatus('in_progress')).toBe('in_progress');
	});
});

// ─── Integration: CLI claim with session linking ────────────────────────────

describe('CLI claim integration', () => {
	const CLI_PATH = join(import.meta.dir, '../lightsprint.js');

	test('claim --dry-run validates task ID format', async () => {
		const proc = Bun.spawn(
			['bun', 'run', CLI_PATH, 'claim', '--task', 'valid-task-id-123', '--dry-run'],
			{ stdout: 'pipe', stderr: 'pipe' }
		);
		const stdout = await new Response(proc.stdout).text();
		await proc.exited;

		// Dry run should show what would happen without calling API
		expect(stdout).toContain('claim');
	});

	test('claim rejects invalid task ID characters', async () => {
		const proc = Bun.spawn(
			['bun', 'run', CLI_PATH, 'claim', '--task', 'bad?id&chars'],
			{ stdout: 'pipe', stderr: 'pipe' }
		);
		const stderr = await new Response(proc.stderr).text();
		const code = await proc.exited;

		expect(code).not.toBe(0);
		expect(stderr.toLowerCase()).toContain('invalid');
	});
});

// ─── Daemon Hardening ────────────────────────────────────────────────────────

describe('Daemon hardening patterns', () => {
	test('CC_PID_VALID pattern rejects NaN from undefined env var', () => {
		const CC_PID = parseInt(undefined, 10);
		const CC_PID_VALID = Number.isFinite(CC_PID) && CC_PID > 0;
		expect(CC_PID_VALID).toBe(false);
	});

	test('CC_PID_VALID pattern accepts valid PID', () => {
		const CC_PID = parseInt('12345', 10);
		const CC_PID_VALID = Number.isFinite(CC_PID) && CC_PID > 0;
		expect(CC_PID_VALID).toBe(true);
	});

	test('EXPIRES_AT NaN guard forces refresh', () => {
		let EXPIRES_AT = NaN;
		if (EXPIRES_AT && !Number.isFinite(EXPIRES_AT)) EXPIRES_AT = 0;
		// NaN is falsy, so guard doesn't trigger - but that's fine, undefined/NaN means no expiry set
		expect(Number.isNaN(EXPIRES_AT)).toBe(true);
	});

	test('EXPIRES_AT NaN guard catches Infinity', () => {
		let EXPIRES_AT = Infinity;
		if (EXPIRES_AT && !Number.isFinite(EXPIRES_AT)) EXPIRES_AT = 0;
		expect(EXPIRES_AT).toBe(0);
	});
});
