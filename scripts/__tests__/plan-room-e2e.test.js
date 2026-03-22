/**
 * E2E tests for Plan Room lifecycle.
 *
 * Validates:
 * 1. Start room → WS planRoom:start sent → ack received → HTTP 200
 * 2. Stop room → WS planRoom:end sent → HTTP 200
 * 3. Start room when already active → 409
 * 4. Stop room when none active → 404
 *
 * Uses a mock HTTP + WebSocket server so no real API calls are made.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { randomBytes } from 'crypto';
import { spawn } from 'child_process';

// ─── Constants ───────────────────────────────────────────────────────────────

const CLI_PATH = join(import.meta.dir, '../lightsprint.js');
const REPO_KEY = 'SprintsAI/lightsprint-claude-code-plugin';

const TEST_CONFIG_DIR = join(tmpdir(), `lightsprint-plan-room-e2e-${randomBytes(8).toString('hex')}`);
const REPOS_FILE = join(TEST_CONFIG_DIR, 'repos.json');
const SESSIONS_DIR = join(TEST_CONFIG_DIR, 'cc-sessions');

const ORIG_CONFIG_DIR = process.env.LIGHTSPRINT_CONFIG_DIR;
process.env.LIGHTSPRINT_CONFIG_DIR = TEST_CONFIG_DIR;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setupMockRepos(baseUrl) {
	mkdirSync(TEST_CONFIG_DIR, { recursive: true, mode: 0o700 });
	const repos = {};
	repos[REPO_KEY] = {
		accessToken: 'mock-access-token',
		refreshToken: 'mock-refresh-token',
		expiresAt: Date.now() + 3600000,
		repoId: 'mock-repo-id',
		repoName: 'Mock Repository',
		baseUrl,
	};
	writeFileSync(REPOS_FILE, JSON.stringify(repos, null, 2), { mode: 0o600 });
}

function cleanupTestConfigDir() {
	try { rmSync(TEST_CONFIG_DIR, { recursive: true, force: true }); } catch {}
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('E2E: Plan Room Lifecycle', () => {
	let mockPort;
	let mockWsMessages;
	let mockHttpServer;
	let wsConnections;
	const MOCK_PLAN_ROOM_ID = 'plan-room-' + randomBytes(4).toString('hex');

	beforeAll(() => {
		mockWsMessages = [];
		wsConnections = [];

		mockHttpServer = Bun.serve({
			port: 0,
			async fetch(req, server) {
				const url = new URL(req.url);

				// WebSocket upgrade for /cc-ws
				if (url.pathname === '/cc-ws') {
					const upgraded = server.upgrade(req, { data: { token: url.searchParams.get('token') } });
					if (upgraded) return undefined;
					return new Response('WebSocket upgrade failed', { status: 400 });
				}

				// Token refresh
				if (url.pathname === '/oauth/token') {
					return Response.json({
						access_token: 'refreshed-token',
						refresh_token: 'refreshed-refresh-token',
						expires_in: 3600,
					});
				}

				// Session task lookup
				if (url.pathname.match(/\/api\/cc-sessions\/.*\/task/)) {
					return Response.json({ task: null });
				}

				// Task endpoints for task sync
				if (url.pathname.match(/\/api\/repos\/.*\/tasks/) && req.method === 'POST') {
					const body = await req.json().catch(() => ({}));
					return Response.json({
						task: {
							id: 'created-task-' + randomBytes(4).toString('hex'),
							title: body.title || '',
							status: body.status || 'backlog',
						}
					}, { status: 201 });
				}

				if (url.pathname.match(/\/api\/tasks\/.*\/dependencies/) && req.method === 'POST') {
					return Response.json({ ok: true });
				}

				if (url.pathname.match(/\/api\/tasks\//) && req.method === 'PATCH') {
					return Response.json({ task: { id: 'patched', status: 'done' } });
				}

				// Plans
				if (url.pathname.match(/\/api\/repos\/[^/]+\/plans$/) && req.method === 'POST') {
					return Response.json({ planId: 'plan-' + randomBytes(4).toString('hex') });
				}
				if (url.pathname.match(/\/api\/plans\/[^/]+\/versions$/) && req.method === 'PUT') {
					return Response.json({ ok: true, versionId: 'ver-' + randomBytes(4).toString('hex') });
				}

				// Repo info
				if (url.pathname === '/api/repo-key/info' && req.method === 'GET') {
					return Response.json({
						repo: { id: 'mock-repo-id', name: 'test-repo' },
						project: { id: 'mock-repo-id', name: 'test-repo' },
						scopes: ['repo:read', 'repo:write'],
					});
				}

				return Response.json({ error: 'Not found' }, { status: 404 });
			},
			websocket: {
				open(ws) {
					wsConnections.push(ws);
				},
				message(ws, message) {
					const msg = JSON.parse(message);
					mockWsMessages.push(msg);

					// Respond to session:start
					if (msg.type === 'session:start') {
						ws.send(JSON.stringify({
							type: 'ack',
							id: msg.id,
							ok: true,
							sessionId: 'mock-ls-session-' + randomBytes(4).toString('hex'),
						}));
					}

					// Respond to session:end
					if (msg.type === 'session:end') {
						ws.send(JSON.stringify({
							type: 'ack',
							id: msg.id,
							ok: true,
						}));
					}

					// Respond to planRoom:start
					if (msg.type === 'planRoom:start') {
						ws.send(JSON.stringify({
							type: 'ack',
							id: msg.id,
							ok: true,
							planRoomId: MOCK_PLAN_ROOM_ID,
						}));
					}

					// Respond to planRoom:end
					if (msg.type === 'planRoom:end') {
						ws.send(JSON.stringify({
							type: 'ack',
							id: msg.id,
							ok: true,
						}));
					}
				},
				close(ws) {
					const idx = wsConnections.indexOf(ws);
					if (idx >= 0) wsConnections.splice(idx, 1);
				},
			},
		});

		mockPort = mockHttpServer.port;
		setupMockRepos(`http://localhost:${mockPort}`);
	});

	afterAll(() => {
		mockHttpServer.stop();
		cleanupTestConfigDir();
		if (ORIG_CONFIG_DIR) {
			process.env.LIGHTSPRINT_CONFIG_DIR = ORIG_CONFIG_DIR;
		} else {
			delete process.env.LIGHTSPRINT_CONFIG_DIR;
		}
	});

	beforeEach(() => {
		mockWsMessages.length = 0;
	});

	// ─── Helpers ─────────────────────────────────────────────────────────

	function spawnDaemon(sessionId, ccPid, opts = {}) {
		const credsDir = join(TEST_CONFIG_DIR, 'cc-sessions');
		mkdirSync(credsDir, { recursive: true, mode: 0o700 });
		const credsPath = join(credsDir, `.creds-e2e-${randomBytes(4).toString('hex')}.json`);
		writeFileSync(credsPath, JSON.stringify({
			accessToken: 'mock-access-token',
			refreshToken: 'mock-refresh-token',
			expiresAt: String(Date.now() + 3600000),
		}), { mode: 0o600 });

		const daemonProc = spawn(process.execPath, [CLI_PATH, 'cc-daemon'], {
			detached: true,
			stdio: 'ignore',
			env: {
				...process.env,
				LIGHTSPRINT_CONFIG_DIR: TEST_CONFIG_DIR,
				LIGHTSPRINT_NO_BROWSER: '1',
				LS_CREDS_FILE: credsPath,
				LS_BASE_URL: `http://localhost:${mockPort}`,
				LS_REPO_ID: 'mock-repo-id',
				LS_SESSION_ID: sessionId,
				LS_CWD: process.cwd(),
				LS_CC_PID: String(ccPid),
				LS_GIT_BRANCH: opts.gitBranch || 'main',
			},
		});
		daemonProc.unref();
		return { daemonProc, credsPath };
	}

	async function waitForWsMessage(predicate, timeoutMs = 8000) {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const msg = mockWsMessages.find(predicate);
			if (msg) return msg;
			await new Promise(r => setTimeout(r, 200));
		}
		return null;
	}

	async function waitForSessionState(sessionId, timeoutMs = 5000) {
		const stateFile = join(SESSIONS_DIR, `${sessionId}.json`);
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			try {
				return JSON.parse(readFileSync(stateFile, 'utf-8'));
			} catch {}
			await new Promise(r => setTimeout(r, 200));
		}
		return null;
	}

	// ─── Test: Start room ────────────────────────────────────────────────

	test('start room sends planRoom:start over WS and returns planRoomId + url', async () => {
		const testSessionId = 'plan-room-start-' + randomBytes(4).toString('hex');
		const dummyProc = spawn('sleep', ['120']);

		try {
			spawnDaemon(testSessionId, dummyProc.pid);

			// Wait for session:start (longer timeout for CI cold-start with lazy imports)
			const sessionStart = await waitForWsMessage(m => m.type === 'session:start', 20000);
			expect(sessionStart).not.toBeNull();

			// Read daemon state to get port + token
			const state = await waitForSessionState(testSessionId, 8000);
			expect(state).not.toBeNull();
			expect(state.port).toBeDefined();
			expect(state.daemonToken).toBeDefined();

			// Clear messages so we can isolate planRoom:start
			mockWsMessages.length = 0;

			// POST /start-room
			const resp = await fetch(`http://127.0.0.1:${state.port}/start-room`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${state.daemonToken}`,
				},
				body: '{}',
				signal: AbortSignal.timeout(10000),
			});

			const data = await resp.json();
			expect(resp.status).toBe(200);
			expect(data.ok).toBe(true);
			expect(data.planRoomId).toBe(MOCK_PLAN_ROOM_ID);
			expect(data.url).toContain(MOCK_PLAN_ROOM_ID);

			// Verify planRoom:start was sent over WS
			const planRoomStart = await waitForWsMessage(m => m.type === 'planRoom:start', 5000);
			expect(planRoomStart).not.toBeNull();
			expect(planRoomStart.data.ccSessionId).toBe(testSessionId);
			expect(planRoomStart.data.repoId).toBe('mock-repo-id');
		} finally {
			dummyProc.kill('SIGTERM');
			await new Promise(r => setTimeout(r, 500));
		}
	}, 25000);

	// ─── Test: Stop room ─────────────────────────────────────────────────

	test('stop room sends planRoom:end over WS and returns ok', async () => {
		const testSessionId = 'plan-room-stop-' + randomBytes(4).toString('hex');
		const dummyProc = spawn('sleep', ['120']);

		try {
			spawnDaemon(testSessionId, dummyProc.pid);

			const sessionStart = await waitForWsMessage(m => m.type === 'session:start', 15000);
			expect(sessionStart).not.toBeNull();

			const state = await waitForSessionState(testSessionId, 8000);
			expect(state).not.toBeNull();

			// Start a room first
			const startResp = await fetch(`http://127.0.0.1:${state.port}/start-room`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${state.daemonToken}`,
				},
				body: '{}',
				signal: AbortSignal.timeout(10000),
			});
			const startData = await startResp.json();
			expect(startData.ok).toBe(true);

			// Clear messages
			mockWsMessages.length = 0;

			// POST /stop-room
			const stopResp = await fetch(`http://127.0.0.1:${state.port}/stop-room`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${state.daemonToken}`,
				},
				body: '{}',
				signal: AbortSignal.timeout(10000),
			});

			const stopData = await stopResp.json();
			expect(stopResp.status).toBe(200);
			expect(stopData.ok).toBe(true);

			// Verify planRoom:end was sent over WS
			const planRoomEnd = await waitForWsMessage(m => m.type === 'planRoom:end', 5000);
			expect(planRoomEnd).not.toBeNull();
			expect(planRoomEnd.data.planRoomId).toBe(MOCK_PLAN_ROOM_ID);
		} finally {
			dummyProc.kill('SIGTERM');
			await new Promise(r => setTimeout(r, 500));
		}
	}, 25000);

	// ─── Test: Start room when already active → 409 ─────────────────────

	test('start room when already active returns 409', async () => {
		const testSessionId = 'plan-room-dup-' + randomBytes(4).toString('hex');
		const dummyProc = spawn('sleep', ['120']);

		try {
			spawnDaemon(testSessionId, dummyProc.pid);

			const sessionStart = await waitForWsMessage(m => m.type === 'session:start', 15000);
			expect(sessionStart).not.toBeNull();

			const state = await waitForSessionState(testSessionId, 8000);
			expect(state).not.toBeNull();

			const headers = {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${state.daemonToken}`,
			};

			// Start a room
			const firstResp = await fetch(`http://127.0.0.1:${state.port}/start-room`, {
				method: 'POST',
				headers,
				body: '{}',
				signal: AbortSignal.timeout(10000),
			});
			const firstData = await firstResp.json();
			expect(firstData.ok).toBe(true);

			// Try starting again → should get 409
			const secondResp = await fetch(`http://127.0.0.1:${state.port}/start-room`, {
				method: 'POST',
				headers,
				body: '{}',
				signal: AbortSignal.timeout(10000),
			});
			const secondData = await secondResp.json();
			expect(secondResp.status).toBe(409);
			expect(secondData.ok).toBe(false);
			expect(secondData.error).toBe('room_already_active');
		} finally {
			dummyProc.kill('SIGTERM');
			await new Promise(r => setTimeout(r, 500));
		}
	}, 25000);

	// ─── Test: Stop room when none active → 404 ─────────────────────────

	test('stop room when none active returns 404', async () => {
		const testSessionId = 'plan-room-no-room-' + randomBytes(4).toString('hex');
		const dummyProc = spawn('sleep', ['120']);

		try {
			spawnDaemon(testSessionId, dummyProc.pid);

			const sessionStart = await waitForWsMessage(m => m.type === 'session:start', 15000);
			expect(sessionStart).not.toBeNull();

			const state = await waitForSessionState(testSessionId, 8000);
			expect(state).not.toBeNull();

			// Try stopping without starting → should get 404
			const stopResp = await fetch(`http://127.0.0.1:${state.port}/stop-room`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${state.daemonToken}`,
				},
				body: '{}',
				signal: AbortSignal.timeout(10000),
			});
			const stopData = await stopResp.json();
			expect(stopResp.status).toBe(404);
			expect(stopData.ok).toBe(false);
			expect(stopData.error).toBe('no_active_room');
		} finally {
			dummyProc.kill('SIGTERM');
			await new Promise(r => setTimeout(r, 500));
		}
	}, 25000);

	// ─── Test: Full lifecycle start → stop → start again ─────────────────

	test('full lifecycle: start → stop → start again works', async () => {
		const testSessionId = 'plan-room-lifecycle-' + randomBytes(4).toString('hex');
		const dummyProc = spawn('sleep', ['120']);

		try {
			spawnDaemon(testSessionId, dummyProc.pid);

			const sessionStart = await waitForWsMessage(m => m.type === 'session:start', 15000);
			expect(sessionStart).not.toBeNull();

			const state = await waitForSessionState(testSessionId, 8000);
			expect(state).not.toBeNull();

			const headers = {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${state.daemonToken}`,
			};
			const fetchOpts = (body = '{}') => ({
				method: 'POST',
				headers,
				body,
				signal: AbortSignal.timeout(10000),
			});

			// 1. Start room
			const start1 = await (await fetch(`http://127.0.0.1:${state.port}/start-room`, fetchOpts())).json();
			expect(start1.ok).toBe(true);

			// 2. Stop room
			const stop1 = await (await fetch(`http://127.0.0.1:${state.port}/stop-room`, fetchOpts())).json();
			expect(stop1.ok).toBe(true);

			// 3. Start room again (should succeed, not 409)
			const start2 = await (await fetch(`http://127.0.0.1:${state.port}/start-room`, fetchOpts())).json();
			expect(start2.ok).toBe(true);
			expect(start2.planRoomId).toBe(MOCK_PLAN_ROOM_ID);
		} finally {
			dummyProc.kill('SIGTERM');
			await new Promise(r => setTimeout(r, 500));
		}
	}, 25000);
});
