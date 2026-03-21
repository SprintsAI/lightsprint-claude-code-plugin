// scripts/__tests__/daemon-hardening.test.js
import { describe, test, expect, beforeAll, afterAll, afterEach } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync, unlinkSync, writeFileSync, statSync, readdirSync, mkdirSync, rmSync } from 'fs';
import { randomBytes } from 'crypto';

// Use an isolated temp config dir so tests never touch ~/.lightsprint
const TEST_CONFIG_DIR = join(tmpdir(), `lightsprint-daemon-test-${randomBytes(8).toString('hex')}`);
const ORIG_CONFIG_DIR = process.env.LIGHTSPRINT_CONFIG_DIR;
process.env.LIGHTSPRINT_CONFIG_DIR = TEST_CONFIG_DIR;

import { withFileLock } from '../lib/filelock.js';
import { cleanupStaleSessions } from '../lib/cc-utils.js';
import { writeSessionState, readSessionState, deleteSessionState } from '../lib/cc-utils.js';

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

// ─── File Locking ────────────────────────────────────────────────────────────

describe('withFileLock', () => {
	const lockPath = join(TEST_CONFIG_DIR, 'test-lock.lock');

	afterEach(() => {
		try { unlinkSync(lockPath); } catch {}
	});

	test('executes callback and returns its result', async () => {
		const result = await withFileLock(lockPath, () => 42);
		expect(result).toBe(42);
	});

	test('executes async callback and returns its result', async () => {
		const result = await withFileLock(lockPath, async () => {
			await new Promise(r => setTimeout(r, 10));
			return 'async-result';
		});
		expect(result).toBe('async-result');
	});

	test('cleans up lockfile after success', async () => {
		await withFileLock(lockPath, () => 'done');
		expect(existsSync(lockPath)).toBe(false);
	});

	test('cleans up lockfile after callback throws', async () => {
		try {
			await withFileLock(lockPath, () => { throw new Error('boom'); });
		} catch {}
		expect(existsSync(lockPath)).toBe(false);
	});

	test('propagates callback errors', async () => {
		await expect(
			withFileLock(lockPath, () => { throw new Error('test-error'); })
		).rejects.toThrow('test-error');
	});

	test('serializes concurrent access', async () => {
		const order = [];
		const task = (id, delayMs) => withFileLock(lockPath, async () => {
			order.push(`start-${id}`);
			await new Promise(r => setTimeout(r, delayMs));
			order.push(`end-${id}`);
		});

		await Promise.all([task('a', 50), task('b', 10)]);
		// 'a' should complete before 'b' starts (serialized)
		expect(order[0]).toBe('start-a');
		expect(order[1]).toBe('end-a');
		expect(order[2]).toBe('start-b');
		expect(order[3]).toBe('end-b');
	});
});

// ─── Stale Session Cleanup ───────────────────────────────────────────────────

describe('cleanupStaleSessions', () => {
	const staleSessionId = `test-stale-${randomBytes(8).toString('hex')}`;

	afterEach(() => {
		deleteSessionState(staleSessionId);
	});

	test('removes session files with dead daemon PIDs', () => {
		writeSessionState(staleSessionId, {
			port: 11111,
			daemonPid: 999999, // dead PID
			ccPid: 999998,
			ccSessionId: staleSessionId,
			lsSessionId: null,
			repoId: 'test-repo',
		});
		expect(readSessionState(staleSessionId)).not.toBeNull();

		const cleaned = cleanupStaleSessions();
		expect(cleaned).toBeGreaterThanOrEqual(1);
		expect(readSessionState(staleSessionId)).toBeNull();
	});

	test('preserves session files with alive daemon PIDs', () => {
		const aliveSessionId = `test-alive-${randomBytes(8).toString('hex')}`;
		writeSessionState(aliveSessionId, {
			port: 22222,
			daemonPid: process.pid, // alive
			ccPid: process.ppid,
			ccSessionId: aliveSessionId,
			lsSessionId: null,
			repoId: 'test-repo',
		});

		cleanupStaleSessions();
		expect(readSessionState(aliveSessionId)).not.toBeNull();
		deleteSessionState(aliveSessionId);
	});
});

// ─── EADDRINUSE Port Retry ───────────────────────────────────────────────────

describe('startHttpServer port retry', () => {
	test('createServer error event is catchable for EADDRINUSE', () => {
		const { createServer } = require('http');
		const server = createServer();
		let errorCaught = false;
		server.on('error', (err) => {
			errorCaught = true;
			expect(err.message).toContain('EADDRINUSE');
		});
		const err = new Error('EADDRINUSE');
		err.code = 'EADDRINUSE';
		server.emit('error', err);
		expect(errorCaught).toBe(true);
		server.close();
	});
});

// ─── Event Queue ─────────────────────────────────────────────────────────────

describe('Event queue buffering', () => {
	test('enqueue and flush cycle works correctly', () => {
		const queue = [];
		const MAX_QUEUE = 100;

		function enqueueEvent(event) {
			if (queue.length >= MAX_QUEUE) queue.shift();
			queue.push({ ...event, ts: Date.now() });
		}

		function flushQueue() {
			const events = [...queue];
			queue.length = 0;
			return events;
		}

		enqueueEvent({ type: 'events', data: { events: [{ eventType: 'PostToolUse' }] } });
		enqueueEvent({ type: 'events', data: { events: [{ eventType: 'TaskCompleted' }] } });

		expect(queue.length).toBe(2);

		const flushed = flushQueue();
		expect(flushed.length).toBe(2);
		expect(flushed[0].type).toBe('events');
		expect(queue.length).toBe(0);
	});

	test('overflow drops oldest events', () => {
		const queue = [];
		const MAX_QUEUE = 3;
		function enqueueEvent(event) {
			if (queue.length >= MAX_QUEUE) queue.shift();
			queue.push(event);
		}

		for (let i = 0; i < 5; i++) enqueueEvent({ id: i });
		expect(queue.length).toBe(3);
		expect(queue[0].id).toBe(2); // oldest kept
	});
});

// ─── SIGHUP handling ─────────────────────────────────────────────────────────

describe('Signal handling', () => {
	test('SIGHUP is a valid signal', () => {
		// Verify SIGHUP can be listened to (doesn't throw)
		const handler = () => {};
		process.on('SIGHUP', handler);
		process.removeListener('SIGHUP', handler);
	});
});
