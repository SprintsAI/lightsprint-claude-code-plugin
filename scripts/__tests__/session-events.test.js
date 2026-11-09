/**
 * `session events` against the real transcript response shape.
 *
 * A bearer-token caller (every call this CLI makes) always hits the PAGED
 * branch of GET /api/workspaces/{workspaceId}/agent-sessions/{sessionId}/transcript —
 * `{ sessionId, items, nextCursor, prevCursor, hasMore }`, never the unpaged
 * `{ messages }` shape a browser session gets. QA caught the CLI reading the
 * wrong field (LW-8710 verdict on PR #125); this locks the real shape in.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';

const CLI_PATH = join(import.meta.dir, '../lightsprint.js');
const TEST_CONFIG_DIR = join(tmpdir(), `lightsprint-session-events-${randomBytes(8).toString('hex')}`);

// Write connection.json directly rather than importing `writeConnection` and
// setting `process.env.LIGHTSPRINT_CONFIG_DIR` at module scope: that env var
// is read lazily by other already-loaded modules (e.g. `cc-utils.js`'s own
// module-level `CONFIG_DIR` const), and bun runs every test file in one
// shared process, so a global mutation here can flip the directory those
// modules resolve to mid-run and break unrelated tests. `LIGHTSPRINT_CONFIG_DIR`
// is instead passed only to the spawned CLI subprocess's own env, below.
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

// A realistic transcript page: the exact shape
// `{ sessionId, ...makeTranscriptPage(items, options) }` returns, with items
// shaped `{ seq, turnId, type, time, payload }` — never `{ role, content }`.
const TRANSCRIPT_PAGE = {
	sessionId: 'sess1',
	items: [
		{ seq: 1, turnId: 'turn1', type: 'user_message', time: '2026-11-09T00:00:01.000Z', payload: { content: 'How does auth work?', senderUserId: 'user1' } },
		{ seq: 2, turnId: 'turn1', type: 'assistant_text', time: '2026-11-09T00:00:05.000Z', payload: { content: 'Auth flows through OAuth tokens refreshed on demand.' } },
		{ seq: 3, turnId: 'turn1', type: 'tool_call', time: '2026-11-09T00:00:06.000Z', payload: { name: 'grep', inputSummary: 'search for OAuth' } },
	],
	nextCursor: 3,
	prevCursor: 1,
	hasMore: true,
};

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		fetch(req) {
			const url = new URL(req.url);

			if (url.pathname === '/api/workspaces/ws1/agent-sessions/sess1/transcript') {
				const limit = url.searchParams.get('limit');
				const page = limit ? { ...TRANSCRIPT_PAGE, items: TRANSCRIPT_PAGE.items.slice(0, Number(limit)) } : TRANSCRIPT_PAGE;
				return Response.json(page);
			}
			if (url.pathname === '/api/workspaces/ws1/agent-sessions/missing/transcript') {
				return Response.json({ error: 'not_found', message: 'Session not found' }, { status: 404 });
			}
			if (url.pathname === '/api/agent-sessions/sess1/events') {
				const stream = new ReadableStream({
					start(controller) {
						const encoder = new TextEncoder();
						controller.enqueue(encoder.encode(': connected\n\n'));
						setTimeout(() => {
							controller.enqueue(encoder.encode(`event: session.content\ndata: ${JSON.stringify({ text: 'live update' })}\n\n`));
						}, 100);
						setTimeout(() => controller.close(), 400);
					},
				});
				return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
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

describe('session events (history mode, real paged shape)', () => {
	test('reads items, not messages, and prints each one', async () => {
		const { stdout, exitCode } = await runCli(['session', 'events', 'sess1']);
		expect(exitCode).toBe(0);
		expect(stdout).toContain('How does auth work?');
		expect(stdout).toContain('Auth flows through OAuth tokens refreshed on demand.');
		expect(stdout).toContain('tool: grep');
	});

	test('--output json returns the items array with pagination fields', async () => {
		const { stdout, exitCode } = await runCli(['session', 'events', 'sess1', '--output', 'json']);
		expect(exitCode).toBe(0);
		const result = JSON.parse(stdout);
		expect(result.items).toHaveLength(3);
		expect(result.items[0]).toMatchObject({ seq: 1, type: 'user_message' });
		expect(result.items[0].payload.content).toBe('How does auth work?');
		expect(result.hasMore).toBe(true);
		expect(result.nextCursor).toBe(3);
		expect(result.prevCursor).toBe(1);
		// Never the old (wrong) field this bug read from.
		expect(result.messages).toBeUndefined();
	});

	test('--last N asks the server for N items via ?limit=N, not a client-side slice', async () => {
		const { stdout } = await runCli(['session', 'events', 'sess1', '--last', '1', '--output', 'json']);
		const result = JSON.parse(stdout);
		expect(result.items).toHaveLength(1);
		expect(result.items[0].type).toBe('user_message');
	});

	test('an unknown session id is rewritten into a clear 404 message', async () => {
		const { stderr, exitCode } = await runCli(['session', 'events', 'missing', '--output', 'json']);
		expect(exitCode).toBe(1);
		const result = JSON.parse(stderr);
		expect(result.message).toContain('session list');
	});

	test('--follow still watches the live SSE stream, unaffected by the history fix', async () => {
		const { stdout, exitCode } = await runCli(['session', 'events', 'sess1', '--follow', '--timeout-ms', '1000', '--output', 'json']);
		expect(exitCode).toBe(0);
		const result = JSON.parse(stdout);
		expect(result.events.length).toBeGreaterThan(0);
		expect(result.events[0].data.text).toBe('live update');
	});
});
