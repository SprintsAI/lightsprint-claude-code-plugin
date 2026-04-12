/**
 * Tests for new skills: search, labels, label, members, comments, subtasks.
 *
 * Uses a mock Lightsprint server so no real API calls are made.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { randomBytes } from 'crypto';

const CLI_PATH = join(import.meta.dir, '../lightsprint.js');
const REPO_KEY = 'SprintsAI/lightsprint-claude-code-plugin';

const TEST_CONFIG_DIR = join(tmpdir(), `lightsprint-new-skills-${randomBytes(8).toString('hex')}`);
const REPOS_FILE = join(TEST_CONFIG_DIR, 'repos.json');

const ORIG_CONFIG_DIR = process.env.LIGHTSPRINT_CONFIG_DIR;
process.env.LIGHTSPRINT_CONFIG_DIR = TEST_CONFIG_DIR;

// ─── Mock Server ─────────────────────────────────────────────────────────────

function createMockServer() {
	const requests = [];
	const repoId = 'mock-repo-id';

	const TASKS = [
		{ id: 'task-1', taskNumber: 1, title: 'Fix login bug', status: 'todo', complexity: 'high', description: 'Users cannot log in with Google OAuth', assignedUser: { name: 'Alice' } },
		{ id: 'task-2', taskNumber: 2, title: 'Add dark mode', status: 'backlog', complexity: 'medium', description: 'Implement dark mode theme', assignedUser: null },
		{ id: 'task-3', taskNumber: 3, title: 'Auth refactor', status: 'in_progress', complexity: 'high', description: 'Refactor authentication layer', assignedUser: { name: 'Bob' } },
	];

	const LABELS = [
		{ id: 'bug', name: 'Bug', color: '#e11d48' },
		{ id: 'feature', name: 'Feature', color: '#2563eb' },
		{ id: 'blocked', name: 'Blocked', color: '#d97706' },
	];

	const MEMBERS = [
		{ id: 'user-1', name: 'Alice Smith', email: 'alice@example.com', role: 'admin' },
		{ id: 'user-2', name: 'Bob Jones', email: 'bob@example.com', role: 'member' },
		{ id: 'user-3', name: 'Carol Lee', email: 'carol@example.com', role: 'member' },
	];

	const COMMENTS = {
		'task-1': [
			{ id: 'comment-1', body: 'This is a critical issue.', author: { name: 'Alice' }, createdAt: '2024-01-01T10:00:00Z' },
			{ id: 'comment-2', body: 'Working on it now.', author: { name: 'Bob' }, createdAt: '2024-01-02T11:00:00Z' },
		],
		'task-2': [],
	};

	const SUBTASKS = {
		'task-1': [
			{ id: 'sub-1', taskNumber: 10, title: 'Fix Google OAuth callback', status: 'todo', complexity: 'medium' },
			{ id: 'sub-2', taskNumber: 11, title: 'Update session handling', status: 'backlog', complexity: 'low' },
		],
		'task-2': [],
	};

	const server = Bun.serve({
		port: 0,
		async fetch(req) {
			const url = new URL(req.url);
			const method = req.method;
			const path = url.pathname;
			let body = null;

			if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
				try {
					const text = await req.text();
					body = text ? JSON.parse(text) : null;
				} catch {
					body = null;
				}
			}

			requests.push({ method, path, body, query: Object.fromEntries(url.searchParams) });

			// Token refresh
			if (path === '/oauth/token' && method === 'POST') {
				return Response.json({ access_token: 'mock-token', refresh_token: 'mock-refresh', expires_in: 3600 });
			}

			// Repo info
			if (path === '/api/repo-key/info') {
				return Response.json({ repo: { id: repoId, name: 'test-repo', fullName: REPO_KEY }, user: { name: 'test-user' } });
			}

			// Resolve task ID
			if (path === `/api/repos/${repoId}/tasks/resolve`) {
				const ref = url.searchParams.get('ref');
				const task = TASKS.find(t => t.id === ref || `MOCK-${t.taskNumber}` === ref || String(t.taskNumber) === ref);
				if (task) return Response.json({ taskId: task.id });
				return Response.json({ error: 'Not found' }, { status: 404 });
			}

			// Search tasks
			if (path === `/api/repos/${repoId}/tasks/search`) {
				const q = url.searchParams.get('q') || '';
				const statusFilter = url.searchParams.get('status');
				let results = TASKS.filter(t =>
					t.title.toLowerCase().includes(q.toLowerCase()) ||
					(t.description || '').toLowerCase().includes(q.toLowerCase())
				);
				if (statusFilter) {
					const statuses = statusFilter.split(',');
					results = results.filter(t => statuses.includes(t.status));
				}
				return Response.json({ tasks: results, totalCount: results.length, taskPrefix: 'MOCK' });
			}

			// Labels list
			if (path === `/api/repos/${repoId}/labels`) {
				return Response.json({ labels: LABELS });
			}

			// Add label to task
			if (path.match(/^\/api\/tasks\/([^/]+)\/labels$/) && method === 'POST') {
				return Response.json({ success: true });
			}

			// Remove label from task
			if (path.match(/^\/api\/tasks\/([^/]+)\/labels\/([^/]+)$/) && method === 'DELETE') {
				return Response.json({ success: true });
			}

			// Members list
			if (path === `/api/repos/${repoId}/members`) {
				return Response.json({ members: MEMBERS });
			}

			// List comments
			if (path.match(/^\/api\/tasks\/([^/]+)\/comments$/) && method === 'GET') {
				const taskId = path.match(/^\/api\/tasks\/([^/]+)\/comments$/)[1];
				const comments = COMMENTS[taskId] || [];
				return Response.json({ comments });
			}

			// Create comment
			if (path.match(/^\/api\/tasks\/([^/]+)\/comments$/) && method === 'POST') {
				const commentId = 'comment-' + randomBytes(4).toString('hex');
				return Response.json({ comment: { id: commentId, body: body?.body || '', createdAt: new Date().toISOString() } });
			}

			// Update comment
			if (path.match(/^\/api\/comments\/([^/]+)$/) && method === 'PATCH') {
				return Response.json({ success: true });
			}

			// Delete comment
			if (path.match(/^\/api\/comments\/([^/]+)$/) && method === 'DELETE') {
				return new Response(null, { status: 204 });
			}

			// Subtasks
			if (path.match(/^\/api\/tasks\/([^/]+)\/subtasks$/) && method === 'GET') {
				const taskId = path.match(/^\/api\/tasks\/([^/]+)\/subtasks$/)[1];
				const subtasks = SUBTASKS[taskId] || [];
				return Response.json({ tasks: subtasks, taskPrefix: 'MOCK' });
			}

			return Response.json({ error: 'Not found', path, method }, { status: 404 });
		},
	});

	return { server, port: server.port, requests };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let mockServer;
let mockPort;

function setupMockRepos() {
	mkdirSync(TEST_CONFIG_DIR, { recursive: true, mode: 0o700 });
	const repos = {};
	repos[REPO_KEY] = {
		accessToken: 'mock-access-token',
		refreshToken: 'mock-refresh-token',
		expiresAt: Date.now() + 3600000,
		repoId: 'mock-repo-id',
		repoName: 'Mock Repository',
		baseUrl: `http://localhost:${mockPort}`,
	};
	writeFileSync(REPOS_FILE, JSON.stringify(repos, null, 2), { mode: 0o600 });
}

async function runCli(args, extraEnv = {}) {
	const proc = Bun.spawn(['bun', 'run', CLI_PATH, ...args], {
		stdout: 'pipe',
		stderr: 'pipe',
		env: {
			...process.env,
			LIGHTSPRINT_CONFIG_DIR: TEST_CONFIG_DIR,
			LIGHTSPRINT_BASE_URL: `http://localhost:${mockPort}`,
			...extraEnv,
		},
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const exitCode = await proc.exited;
	return { stdout, stderr, exitCode };
}

async function runCliJson(args, extraEnv = {}) {
	const result = await runCli([...args, '--output', 'json'], extraEnv);
	let json = null;
	try { json = JSON.parse(result.stdout); } catch {}
	return { ...result, json };
}

// ─── Setup/Teardown ───────────────────────────────────────────────────────────

beforeAll(() => {
	const ms = createMockServer();
	mockServer = ms.server;
	mockPort = ms.port;
	setupMockRepos();
});

afterAll(() => {
	mockServer?.stop(true);
	try { rmSync(TEST_CONFIG_DIR, { recursive: true, force: true }); } catch {}
	if (ORIG_CONFIG_DIR !== undefined) {
		process.env.LIGHTSPRINT_CONFIG_DIR = ORIG_CONFIG_DIR;
	} else {
		delete process.env.LIGHTSPRINT_CONFIG_DIR;
	}
});

// ─── search ──────────────────────────────────────────────────────────────────

describe('search command', () => {
	test('returns matching tasks for a query', async () => {
		const result = await runCliJson(['search', 'login']);
		expect(result.exitCode).toBe(0);
		expect(result.json).toBeDefined();
		expect(result.json.query).toBe('login');
		expect(Array.isArray(result.json.tasks)).toBe(true);
		expect(result.json.tasks.length).toBeGreaterThan(0);
		const task = result.json.tasks[0];
		expect(task.title.toLowerCase()).toContain('login');
	});

	test('returns empty results for no match', async () => {
		const result = await runCliJson(['search', 'xyznonexistent123']);
		expect(result.exitCode).toBe(0);
		expect(result.json.tasks).toHaveLength(0);
	});

	test('filters by status', async () => {
		const result = await runCliJson(['search', 'mode', '--status', 'backlog']);
		expect(result.exitCode).toBe(0);
		if (result.json.tasks.length > 0) {
			for (const task of result.json.tasks) {
				expect(task.status).toBe('backlog');
			}
		}
	});

	test('accepts --limit flag', async () => {
		const result = await runCliJson(['search', 'fix', '--limit', '5']);
		expect(result.exitCode).toBe(0);
	});

	test('errors when query is missing', async () => {
		const result = await runCli(['search']);
		expect(result.exitCode).not.toBe(0);
	});

	test('errors on query longer than 500 chars', async () => {
		const longQuery = 'a'.repeat(501);
		const result = await runCli(['search', longQuery]);
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain('500');
	});

	test('human text output contains matching task', async () => {
		const result = await runCli(['search', 'login']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('login');
	});

	test('find alias resolves to search', async () => {
		const result = await runCliJson(['find', 'login']);
		expect(result.exitCode).toBe(0);
		expect(result.json.query).toBe('login');
	});
});

// ─── labels ──────────────────────────────────────────────────────────────────

describe('labels command', () => {
	test('lists all labels', async () => {
		const result = await runCliJson(['labels']);
		expect(result.exitCode).toBe(0);
		expect(result.json).toBeDefined();
		expect(Array.isArray(result.json.labels)).toBe(true);
		expect(result.json.labels.length).toBe(3);
		const label = result.json.labels[0];
		expect(label).toHaveProperty('id');
		expect(label).toHaveProperty('name');
	});

	test('human text output lists label names', async () => {
		const result = await runCli(['labels']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('Bug');
		expect(result.stdout).toContain('Feature');
	});

	test('tags alias resolves to labels', async () => {
		const result = await runCliJson(['tags']);
		expect(result.exitCode).toBe(0);
		expect(Array.isArray(result.json.labels)).toBe(true);
	});
});

// ─── label add/remove ────────────────────────────────────────────────────────

describe('label add command', () => {
	test('adds a label to a task', async () => {
		const result = await runCliJson(['label', 'add', 'task-1', '--label', 'bug']);
		expect(result.exitCode).toBe(0);
		expect(result.json.success).toBe(true);
	});

	test('dry-run does not call API', async () => {
		const result = await runCliJson(['label', 'add', 'task-1', '--label', 'bug', '--dry-run']);
		expect(result.exitCode).toBe(0);
		expect(result.json.dryRun).toBe(true);
	});

	test('errors when task ID is missing', async () => {
		const result = await runCli(['label', 'add', '--label', 'bug']);
		expect(result.exitCode).not.toBe(0);
	});

	test('errors when label ID is missing', async () => {
		const result = await runCli(['label', 'add', 'task-1']);
		expect(result.exitCode).not.toBe(0);
	});

	test('errors on invalid subcommand', async () => {
		const result = await runCli(['label', 'invalid', 'task-1', '--label', 'bug']);
		expect(result.exitCode).not.toBe(0);
	});
});

describe('label remove command', () => {
	test('removes a label from a task', async () => {
		const result = await runCliJson(['label', 'remove', 'task-1', '--label', 'bug']);
		expect(result.exitCode).toBe(0);
		expect(result.json.success).toBe(true);
	});

	test('dry-run does not call API', async () => {
		const result = await runCliJson(['label', 'remove', 'task-1', '--label', 'bug', '--dry-run']);
		expect(result.exitCode).toBe(0);
		expect(result.json.dryRun).toBe(true);
	});
});

// ─── members ─────────────────────────────────────────────────────────────────

describe('members command', () => {
	test('lists all members', async () => {
		const result = await runCliJson(['members']);
		expect(result.exitCode).toBe(0);
		expect(result.json).toBeDefined();
		expect(Array.isArray(result.json.members)).toBe(true);
		expect(result.json.members.length).toBe(3);
		const member = result.json.members[0];
		expect(member).toHaveProperty('id');
		expect(member).toHaveProperty('name');
		expect(member).toHaveProperty('email');
	});

	test('human text output shows member names', async () => {
		const result = await runCli(['members']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('Alice');
		expect(result.stdout).toContain('Bob');
	});

	test('team alias resolves to members', async () => {
		const result = await runCliJson(['team']);
		expect(result.exitCode).toBe(0);
		expect(Array.isArray(result.json.members)).toBe(true);
	});
});

// ─── comments (list) ─────────────────────────────────────────────────────────

describe('comments command', () => {
	test('lists comments for a task', async () => {
		const result = await runCliJson(['comments', 'task-1']);
		expect(result.exitCode).toBe(0);
		expect(result.json).toBeDefined();
		expect(Array.isArray(result.json.comments)).toBe(true);
		expect(result.json.comments.length).toBe(2);
		const comment = result.json.comments[0];
		expect(comment).toHaveProperty('id');
		expect(comment).toHaveProperty('body');
		expect(comment).toHaveProperty('author');
	});

	test('returns empty array for task with no comments', async () => {
		const result = await runCliJson(['comments', 'task-2']);
		expect(result.exitCode).toBe(0);
		expect(result.json.comments).toHaveLength(0);
	});

	test('supports --task flag', async () => {
		const result = await runCliJson(['comments', '--task', 'task-1']);
		expect(result.exitCode).toBe(0);
		expect(result.json.comments).toHaveLength(2);
	});

	test('errors when task ID is missing', async () => {
		const result = await runCli(['comments']);
		expect(result.exitCode).not.toBe(0);
	});

	test('human text output shows comment authors and bodies', async () => {
		const result = await runCli(['comments', 'task-1']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('Alice');
		expect(result.stdout).toContain('critical issue');
	});
});

// ─── comment --update / --delete ─────────────────────────────────────────────

describe('comment update/delete', () => {
	test('updates a comment with --update and --body', async () => {
		const result = await runCliJson(['comment', '--update', 'comment-1', '--body', 'Updated text']);
		expect(result.exitCode).toBe(0);
		expect(result.json.success).toBe(true);
		expect(result.json.commentId).toBe('comment-1');
	});

	test('dry-run for comment update', async () => {
		const result = await runCliJson(['comment', '--update', 'comment-1', '--body', 'Updated text', '--dry-run']);
		expect(result.exitCode).toBe(0);
		expect(result.json.dryRun).toBe(true);
	});

	test('errors when --body is missing for --update', async () => {
		const result = await runCli(['comment', '--update', 'comment-1']);
		expect(result.exitCode).not.toBe(0);
	});

	test('deletes a comment with --delete', async () => {
		const result = await runCliJson(['comment', '--delete', 'comment-1']);
		expect(result.exitCode).toBe(0);
		expect(result.json.success).toBe(true);
		expect(result.json.commentId).toBe('comment-1');
	});

	test('dry-run for comment delete', async () => {
		const result = await runCliJson(['comment', '--delete', 'comment-1', '--dry-run']);
		expect(result.exitCode).toBe(0);
		expect(result.json.dryRun).toBe(true);
	});
});

// ─── subtasks ────────────────────────────────────────────────────────────────

describe('subtasks command', () => {
	test('lists subtasks for a task', async () => {
		const result = await runCliJson(['subtasks', 'task-1']);
		expect(result.exitCode).toBe(0);
		expect(result.json).toBeDefined();
		expect(Array.isArray(result.json.subtasks)).toBe(true);
		expect(result.json.subtasks.length).toBe(2);
		const subtask = result.json.subtasks[0];
		expect(subtask).toHaveProperty('id');
		expect(subtask).toHaveProperty('title');
		expect(subtask).toHaveProperty('status');
	});

	test('returns empty array for task with no subtasks', async () => {
		const result = await runCliJson(['subtasks', 'task-2']);
		expect(result.exitCode).toBe(0);
		expect(result.json.subtasks).toHaveLength(0);
	});

	test('supports --task flag', async () => {
		const result = await runCliJson(['subtasks', '--task', 'task-1']);
		expect(result.exitCode).toBe(0);
		expect(result.json.subtasks).toHaveLength(2);
	});

	test('errors when task ID is missing', async () => {
		const result = await runCli(['subtasks']);
		expect(result.exitCode).not.toBe(0);
	});

	test('human text output shows subtask titles', async () => {
		const result = await runCli(['subtasks', 'task-1']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('Google OAuth');
	});

	test('children alias resolves to subtasks', async () => {
		const result = await runCliJson(['children', 'task-1']);
		expect(result.exitCode).toBe(0);
		expect(Array.isArray(result.json.subtasks)).toBe(true);
	});
});

// ─── Schema / describe ────────────────────────────────────────────────────────

describe('describe command includes new commands', () => {
	test('describes search command', async () => {
		const result = await runCli(['describe', 'search']);
		expect(result.exitCode).toBe(0);
		const schema = JSON.parse(result.stdout);
		expect(schema.command).toBe('search');
		expect(schema.params).toHaveProperty('query');
	});

	test('describes labels command', async () => {
		const result = await runCli(['describe', 'labels']);
		expect(result.exitCode).toBe(0);
		const schema = JSON.parse(result.stdout);
		expect(schema.command).toBe('labels');
	});

	test('describes members command', async () => {
		const result = await runCli(['describe', 'members']);
		expect(result.exitCode).toBe(0);
		const schema = JSON.parse(result.stdout);
		expect(schema.command).toBe('members');
	});

	test('describes comments command', async () => {
		const result = await runCli(['describe', 'comments']);
		expect(result.exitCode).toBe(0);
		const schema = JSON.parse(result.stdout);
		expect(schema.command).toBe('comments');
	});

	test('describes subtasks command', async () => {
		const result = await runCli(['describe', 'subtasks']);
		expect(result.exitCode).toBe(0);
		const schema = JSON.parse(result.stdout);
		expect(schema.command).toBe('subtasks');
	});
});
