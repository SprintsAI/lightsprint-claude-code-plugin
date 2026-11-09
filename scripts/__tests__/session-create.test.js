/**
 * `session create`/`get`/`list` display the caller's personal name for a
 * session, not the (initially null) agent-written title.
 *
 * QA (LW-8710 round 2 verdict on PR #125) caught `session create --title`
 * printing `"title": null`: the server stores that text as the caller's
 * personalization `name`, and `create`'s response carries it at the top
 * level (`data.name`), not nested under `session.title` or even
 * `session.personalName` like `get`/`list` do (the session object `create`
 * returns isn't enriched with personalization). This locks in both shapes.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';

const CLI_PATH = join(import.meta.dir, '../lightsprint.js');
const TEST_CONFIG_DIR = join(tmpdir(), `lightsprint-session-create-${randomBytes(8).toString('hex')}`);

// See scripts/__tests__/session-events.test.js for why connection.json is
// written directly instead of mutating process.env at module scope.
function writeTestConnection(baseUrl) {
	mkdirSync(TEST_CONFIG_DIR, { recursive: true, mode: 0o700 });
	writeFileSync(join(TEST_CONFIG_DIR, 'connection.json'), JSON.stringify({
		workspaceId: 'ws1',
		workspaceName: 'Mock Workspace',
		accessToken: 'mock-access-token',
		refreshToken: 'mock-refresh-token',
		expiresAt: Date.now() + 3600000,
		baseUrl,
	}, null, 2), { mode: 0o600 });
}

let server;

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		fetch(req) {
			const url = new URL(req.url);
			const method = req.method;

			// POST /sessions: the real shape is { session: { ...title: null... },
			// name: <personalization>, pinned, url, transcriptPath } — the
			// personal name sits beside `session`, not inside it.
			if (method === 'POST' && url.pathname === '/api/workspaces/ws1/sessions') {
				return Response.json({
					session: {
						id: 'sess1', title: null, visibility: 'creator',
						executionStackId: 'stk1', agentProvider: null, agentModel: null,
						createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z',
						lastMessageAt: '2026-11-09T00:00:00.000Z',
					},
					name: 'Review authentication',
					pinned: false,
					url: 'https://app.lightsprint.ai/agent-sessions/sess1',
					transcriptPath: '/api/workspaces/ws1/agent-sessions/sess1/transcript',
				}, { status: 201 });
			}

			// GET /sessions/{id}: the real shape nests `personalName` inside
			// `session` (enriched via attachOne), with `title` still null.
			if (method === 'GET' && url.pathname === '/api/workspaces/ws1/sessions/sess1') {
				return Response.json({
					session: {
						id: 'sess1', title: null, personalName: 'Review authentication', visibility: 'creator',
						executionStackId: 'stk1', agentProvider: null, agentModel: null,
						createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z',
						lastMessageAt: '2026-11-09T00:00:00.000Z',
					},
				});
			}

			if (method === 'GET' && url.pathname === '/api/workspaces/ws1/sessions') {
				return Response.json({
					sessions: [
						{
							id: 'sess1', title: null, personalName: 'Review authentication', visibility: 'creator',
							executionStackId: 'stk1', agentProvider: null, agentModel: null,
							createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z',
							lastMessageAt: '2026-11-09T00:00:00.000Z',
						},
						{
							// No personalization set: falls back to the (still-null) agent title.
							id: 'sess2', title: null, personalName: null, visibility: 'creator',
							executionStackId: 'stk1', agentProvider: null, agentModel: null,
							createdAt: '2026-11-09T00:01:00.000Z', updatedAt: '2026-11-09T00:01:00.000Z',
							lastMessageAt: '2026-11-09T00:01:00.000Z',
						},
					],
					hasMore: false,
					nextOffset: null,
				});
			}

			return Response.json({ error: 'not_found', path: url.pathname }, { status: 404 });
		},
	});

	writeTestConnection(`http://127.0.0.1:${server.port}`);
});

afterAll(() => {
	server.stop();
	try { rmSync(TEST_CONFIG_DIR, { recursive: true, force: true }); } catch {}
});

async function runCli(args) {
	const proc = Bun.spawn(['bun', 'run', CLI_PATH, ...args], {
		stdout: 'pipe',
		stderr: 'pipe',
		env: { ...process.env, LIGHTSPRINT_CONFIG_DIR: TEST_CONFIG_DIR },
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const exitCode = await proc.exited;
	return { stdout, stderr, exitCode };
}

describe('session create/get/list show the personal name, not a null agent title', () => {
	test('create --title surfaces data.name (top-level), not session.title', async () => {
		const { stdout, exitCode } = await runCli(['session', 'create', '--title', 'Review authentication', '--output', 'json']);
		expect(exitCode).toBe(0);
		const result = JSON.parse(stdout);
		expect(result.session.title).toBe('Review authentication');
	});

	test('create --title prints the title in text mode too', async () => {
		const { stdout, exitCode } = await runCli(['session', 'create', '--title', 'Review authentication']);
		expect(exitCode).toBe(0);
		expect(stdout).toContain('Title: Review authentication');
	});

	test('get surfaces session.personalName, not the null agent title', async () => {
		const { stdout, exitCode } = await runCli(['session', 'get', 'sess1', '--output', 'json']);
		expect(exitCode).toBe(0);
		const result = JSON.parse(stdout);
		expect(result.session.title).toBe('Review authentication');
	});

	test('list surfaces personalName per session, falling back to the agent title when unset', async () => {
		const { stdout, exitCode } = await runCli(['session', 'list', '--output', 'json']);
		expect(exitCode).toBe(0);
		const result = JSON.parse(stdout);
		expect(result.sessions[0].title).toBe('Review authentication');
		expect(result.sessions[1].title).toBeNull();
	});
});
