import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createServer } from 'http';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync } from 'fs';
import { randomBytes } from 'crypto';

const TEST_CONFIG_DIR = join(tmpdir(), `lightsprint-report-error-test-${randomBytes(8).toString('hex')}`);
const ORIG_CONFIG_DIR = process.env.LIGHTSPRINT_CONFIG_DIR;
process.env.LIGHTSPRINT_CONFIG_DIR = TEST_CONFIG_DIR;

import { reportError, writeSessionState } from '../lib/cc-utils.js';

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
			port: 1,
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
