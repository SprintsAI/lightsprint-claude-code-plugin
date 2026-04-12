/**
 * Tests for new skills: search, members, labels, comments (get), subtasks, archive, duplicate.
 * Also tests label management extensions to the update command.
 *
 * Uses a mock HTTP server — no real API calls are made.
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

// ─── Mock server ─────────────────────────────────────────────────────────────

function createMockServer() {
	const requests = [];
	const repoId = 'mock-repo-id';

	const tasks = new Map([
		['task-1', {
			id: 'task-1', taskNumber: 1, title: 'Fix login bug', status: 'todo',
			complexity: 'medium', assignee: null, description: 'Users cannot log in',
			creator: { name: 'test-user' }, dependencies: []
		}],
		['task-2', {
			id: 'task-2', taskNumber: 2, title: 'Add payment flow', status: 'backlog',
			complexity: 'high', assignee: null, description: 'Integrate Stripe',
			creator: { name: 'test-user' }, dependencies: []
		}],
	]);

	const members = [
		{ id: 'user-1', name: 'Alice Smith', email: 'alice@example.com', role: 'admin' },
		{ id: 'user-2', name: 'Bob Jones', email: 'bob@example.com', role: 'member' },
	];

	const labels = [
		{ id: 'lbl-001', name: 'bug', color: '#e11d48', description: 'Something is broken' },
		{ id: 'lbl-002', name: 'feature', color: '#7c3aed', description: 'New functionality' },
	];

	const comments = new Map([
		['task-1', [
			{
				id: 'cmt-1', body: 'Working on this now',
				author: { id: 'user-1', name: 'Alice Smith', email: 'alice@example.com' },
				createdAt: '2024-01-15T10:00:00Z', updatedAt: '2024-01-15T10:00:00Z'
			},
			{
				id: 'cmt-2', body: 'Found the root cause',
				author: { id: 'user-2', name: 'Bob Jones', email: 'bob@example.com' },
				createdAt: '2024-01-15T11:00:00Z', updatedAt: '2024-01-15T11:00:00Z'
			},
		]],
	]);

	const subtasks = new Map([
		['task-1', [
			{ id: 'task-3', taskNumber: 3, title: 'Write failing test', status: 'done', complexity: 'low', assignee: null },
			{ id: 'task-4', taskNumber: 4, title: 'Fix the bug', status: 'in_progress', complexity: 'medium', assignee: null },
		]],
	]);

	const server = Bun.serve({
		port: 0,
		async fetch(req) {
			const url = new URL(req.url);
			const method = req.method;
			const path = url.pathname;
			let body = null;
			if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
				try { body = JSON.parse(await req.text()); } catch { body = null; }
			}
			requests.push({ method, path, body, query: Object.fromEntries(url.searchParams) });

			// Token refresh
			if (path === '/oauth/token') return Response.json({ access_token: 'tok', refresh_token: 'ref', expires_in: 3600 });

			// Repo info
			if (path === '/api/repo-key/info') return Response.json({
				user: { name: 'test-user', email: 'test@example.com', id: 'user-1' },
				repo: { id: repoId, name: 'test-repo', fullName: REPO_KEY },
				project: { id: repoId, name: 'test-repo', fullName: REPO_KEY },
				scopes: ['repo:read', 'repo:write'],
			});

			// Resolve task
			if (path === `/api/repos/${repoId}/tasks/resolve` && method === 'GET') {
				const ref = url.searchParams.get('ref');
				const task = tasks.get(ref);
				if (task) return Response.json({ taskId: task.id });
				for (const t of tasks.values()) {
					if (String(t.taskNumber) === ref) return Response.json({ taskId: t.id });
				}
				return Response.json({ error: 'Not found' }, { status: 404 });
			}

			// Search tasks
			if (path === `/api/repos/${repoId}/tasks/search` && method === 'GET') {
				const q = (url.searchParams.get('q') || '').toLowerCase();
				const statusFilter = url.searchParams.get('status');
				let results = [...tasks.values()].filter(t =>
					t.title.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q)
				);
				if (statusFilter) {
					const statuses = statusFilter.split(',');
					results = results.filter(t => statuses.includes(t.status));
				}
				return Response.json({ tasks: results, taskPrefix: 'MOCK', totalCount: results.length });
			}

			// Members
			if (path === `/api/repos/${repoId}/members` && method === 'GET') {
				return Response.json({ members, totalCount: members.length });
			}

			// Labels
			if (path === `/api/repos/${repoId}/labels` && method === 'GET') {
				return Response.json({ labels, totalCount: labels.length });
			}

			// Task comments (GET)
			const commentsGetMatch = path.match(new RegExp(`^/api/repos/${repoId}/tasks/([^/]+)/comments$`));
			if (commentsGetMatch && method === 'GET') {
				const taskComments = comments.get(commentsGetMatch[1]) || [];
				return Response.json({ comments: taskComments, totalCount: taskComments.length });
			}

			// Subtasks
			const subtasksMatch = path.match(new RegExp(`^/api/repos/${repoId}/tasks/([^/]+)/subtasks$`));
			if (subtasksMatch && method === 'GET') {
				const taskId = subtasksMatch[1];
				const subs = subtasks.get(taskId) || [];
				return Response.json({ subtasks: subs, taskPrefix: 'MOCK', totalCount: subs.length });
			}

			// Archive
			const archiveMatch = path.match(new RegExp(`^/api/repos/${repoId}/tasks/([^/]+)/archive$`));
			if (archiveMatch && method === 'POST') {
				const task = tasks.get(archiveMatch[1]);
				if (!task) return Response.json({ error: 'Not found' }, { status: 404 });
				task.archived = true;
				return Response.json({ task });
			}

			// Unarchive
			const unarchiveMatch = path.match(new RegExp(`^/api/repos/${repoId}/tasks/([^/]+)/unarchive$`));
			if (unarchiveMatch && method === 'POST') {
				const task = tasks.get(unarchiveMatch[1]);
				if (!task) return Response.json({ error: 'Not found' }, { status: 404 });
				task.archived = false;
				return Response.json({ task });
			}

			// Duplicate
			const duplicateMatch = path.match(new RegExp(`^/api/repos/${repoId}/tasks/([^/]+)/duplicate$`));
			if (duplicateMatch && method === 'POST') {
				const source = tasks.get(duplicateMatch[1]);
				if (!source) return Response.json({ error: 'Not found' }, { status: 404 });
				const newId = 'task-dup-' + randomBytes(4).toString('hex');
				const newTask = {
					id: newId,
					taskNumber: tasks.size + 1,
					title: body?.title || source.title,
					status: body?.status || 'backlog',
					complexity: source.complexity,
					description: source.description,
					creator: source.creator,
					dependencies: [],
				};
				tasks.set(newId, newTask);
				return Response.json({ task: newTask, taskPrefix: 'MOCK' }, { status: 201 });
			}

			// Add label to task
			const addLabelMatch = path.match(new RegExp(`^/api/repos/${repoId}/tasks/([^/]+)/labels$`));
			if (addLabelMatch && method === 'POST') {
				return Response.json({ ok: true });
			}

			// Remove label from task
			const removeLabelMatch = path.match(new RegExp(`^/api/repos/${repoId}/tasks/([^/]+)/labels/([^/]+)$`));
			if (removeLabelMatch && method === 'DELETE') {
				return Response.json({ ok: true });
			}

			// Get task (for update confirmation)
			const getTaskMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
			if (getTaskMatch && method === 'GET') {
				const task = tasks.get(getTaskMatch[1]);
				if (!task) return Response.json({ error: 'Not found' }, { status: 404 });
				return Response.json({ task });
			}

			// Update task
			if (getTaskMatch && method === 'PATCH') {
				const task = tasks.get(getTaskMatch[1]);
				if (!task) return Response.json({ error: 'Not found' }, { status: 404 });
				if (body?.title) task.title = body.title;
				if (body?.status) task.status = body.status;
				return Response.json({ task });
			}

			// Dependencies
			const depMatch = path.match(/^\/api\/tasks\/([^/]+)\/dependencies$/);
			if (depMatch) return Response.json({ ok: true });

			return Response.json({ error: 'Not found', path, method }, { status: 404 });
		}
	});

	return { server, port: server.port, requests, tasks };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let mockServer;

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

async function runCli(args, opts = {}) {
	const proc = Bun.spawn(['bun', 'run', CLI_PATH, ...args], {
		stdout: 'pipe',
		stderr: 'pipe',
		cwd: opts.cwd || process.cwd(),
		env: { ...process.env, ...opts.env },
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const exitCode = await proc.exited;
	return { stdout, stderr, exitCode };
}

async function runCliJson(args, opts = {}) {
	const result = await runCli([...args, '--output', 'json'], opts);
	let json = null;
	try { json = JSON.parse(result.stdout); } catch {}
	return { ...result, json };
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('E2E: New Skills', () => {
	beforeAll(() => {
		mockServer = createMockServer();
		setupMockRepos(`http://localhost:${mockServer.port}`);
	});

	afterAll(() => {
		mockServer.server.stop();
		try { rmSync(TEST_CONFIG_DIR, { recursive: true, force: true }); } catch {}
		if (ORIG_CONFIG_DIR) {
			process.env.LIGHTSPRINT_CONFIG_DIR = ORIG_CONFIG_DIR;
		} else {
			delete process.env.LIGHTSPRINT_CONFIG_DIR;
		}
	});

	// ─── search ──────────────────────────────────────────────────────────────

	describe('CLI: search', () => {
		test('returns tasks matching query', async () => {
			const result = await runCliJson(['search', 'login']);
			expect(result.exitCode).toBe(0);
			expect(result.json).toBeDefined();
			expect(result.json.query).toBe('login');
			expect(result.json.tasks).toBeArray();
			expect(result.json.tasks.length).toBeGreaterThan(0);
			expect(result.json.tasks[0].title).toContain('login');
		});

		test('hits the search endpoint', async () => {
			mockServer.requests.length = 0;
			await runCli(['search', 'bug']);
			const searchReq = mockServer.requests.find(r =>
				r.method === 'GET' && r.path.includes('/tasks/search')
			);
			expect(searchReq).toBeDefined();
			expect(searchReq.query.q).toBe('bug');
		});

		test('passes status filter to API', async () => {
			mockServer.requests.length = 0;
			await runCli(['search', 'bug', '--status', 'todo']);
			const searchReq = mockServer.requests.find(r =>
				r.method === 'GET' && r.path.includes('/tasks/search')
			);
			expect(searchReq).toBeDefined();
			expect(searchReq.query.status).toBe('todo');
		});

		test('returns empty result when no match', async () => {
			const result = await runCliJson(['search', 'xyznonexistent']);
			expect(result.exitCode).toBe(0);
			expect(result.json.tasks).toBeArray();
			expect(result.json.tasks.length).toBe(0);
		});

		test('text output contains task titles', async () => {
			const result = await runCli(['search', 'login']);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain('login');
		});

		test('rejects missing query', async () => {
			const result = await runCli(['search']);
			expect(result.exitCode).toBe(1);
		});

		test('rejects invalid status enum', async () => {
			const result = await runCli(['search', 'bug', '--status', 'invalid_status']);
			expect(result.exitCode).toBe(1);
		});

		test('rejects query exceeding max length', async () => {
			const longQuery = 'a'.repeat(501);
			const result = await runCli(['search', longQuery]);
			expect(result.exitCode).toBe(1);
		});

		test('rejects unknown flags', async () => {
			const result = await runCli(['search', 'bug', '--unknown-flag', 'val']);
			expect(result.exitCode).toBe(1);
		});
	});

	// ─── members ─────────────────────────────────────────────────────────────

	describe('CLI: members', () => {
		test('lists workspace members', async () => {
			const result = await runCliJson(['members']);
			expect(result.exitCode).toBe(0);
			expect(result.json).toBeDefined();
			expect(result.json.members).toBeArray();
			expect(result.json.members.length).toBe(2);
		});

		test('members include name and email', async () => {
			const result = await runCliJson(['members']);
			expect(result.exitCode).toBe(0);
			const alice = result.json.members.find(m => m.name === 'Alice Smith');
			expect(alice).toBeDefined();
			expect(alice.email).toBe('alice@example.com');
			expect(alice.role).toBe('admin');
		});

		test('hits the members endpoint', async () => {
			mockServer.requests.length = 0;
			await runCli(['members']);
			const req = mockServer.requests.find(r =>
				r.method === 'GET' && r.path.includes('/members')
			);
			expect(req).toBeDefined();
		});

		test('text output contains member names', async () => {
			const result = await runCli(['members']);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain('Alice Smith');
			expect(result.stdout).toContain('Bob Jones');
		});
	});

	// ─── labels ──────────────────────────────────────────────────────────────

	describe('CLI: labels', () => {
		test('lists workspace labels', async () => {
			const result = await runCliJson(['labels']);
			expect(result.exitCode).toBe(0);
			expect(result.json).toBeDefined();
			expect(result.json.labels).toBeArray();
			expect(result.json.labels.length).toBe(2);
		});

		test('labels include id, name, color', async () => {
			const result = await runCliJson(['labels']);
			expect(result.exitCode).toBe(0);
			const bug = result.json.labels.find(l => l.name === 'bug');
			expect(bug).toBeDefined();
			expect(bug.id).toBe('lbl-001');
			expect(bug.color).toBe('#e11d48');
		});

		test('hits the labels endpoint', async () => {
			mockServer.requests.length = 0;
			await runCli(['labels']);
			const req = mockServer.requests.find(r =>
				r.method === 'GET' && r.path.includes('/labels')
			);
			expect(req).toBeDefined();
		});

		test('text output contains label names', async () => {
			const result = await runCli(['labels']);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain('bug');
			expect(result.stdout).toContain('feature');
		});
	});

	// ─── comments (get) ──────────────────────────────────────────────────────

	describe('CLI: comments', () => {
		test('lists comments on a task', async () => {
			const result = await runCliJson(['comments', '--task', 'task-1']);
			expect(result.exitCode).toBe(0);
			expect(result.json).toBeDefined();
			expect(result.json.comments).toBeArray();
			expect(result.json.comments.length).toBe(2);
		});

		test('comments include body and author', async () => {
			const result = await runCliJson(['comments', '--task', 'task-1']);
			expect(result.exitCode).toBe(0);
			const first = result.json.comments[0];
			expect(first.body).toBe('Working on this now');
			expect(first.author.name).toBe('Alice Smith');
		});

		test('positional task ID works', async () => {
			const result = await runCliJson(['comments', 'task-1']);
			expect(result.exitCode).toBe(0);
			expect(result.json.comments.length).toBe(2);
		});

		test('hits the comments endpoint', async () => {
			mockServer.requests.length = 0;
			await runCli(['comments', 'task-1']);
			const req = mockServer.requests.find(r =>
				r.method === 'GET' && r.path.includes('/comments')
			);
			expect(req).toBeDefined();
		});

		test('empty task returns empty comments', async () => {
			const result = await runCliJson(['comments', '--task', 'task-2']);
			expect(result.exitCode).toBe(0);
			expect(result.json.comments).toBeArray();
			expect(result.json.comments.length).toBe(0);
		});

		test('rejects missing task ID', async () => {
			const result = await runCli(['comments']);
			expect(result.exitCode).toBe(1);
		});

		test('text output contains comment bodies', async () => {
			const result = await runCli(['comments', 'task-1']);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain('Working on this now');
			expect(result.stdout).toContain('Found the root cause');
		});
	});

	// ─── subtasks ────────────────────────────────────────────────────────────

	describe('CLI: subtasks', () => {
		test('lists subtasks of a task', async () => {
			const result = await runCliJson(['subtasks', '--task', 'task-1']);
			expect(result.exitCode).toBe(0);
			expect(result.json).toBeDefined();
			expect(result.json.subtasks).toBeArray();
			expect(result.json.subtasks.length).toBe(2);
		});

		test('subtasks include title and status', async () => {
			const result = await runCliJson(['subtasks', '--task', 'task-1']);
			expect(result.exitCode).toBe(0);
			const failing = result.json.subtasks.find(t => t.title.includes('failing'));
			expect(failing).toBeDefined();
			expect(failing.status).toBe('done');
		});

		test('positional task ID works', async () => {
			const result = await runCliJson(['subtasks', 'task-1']);
			expect(result.exitCode).toBe(0);
			expect(result.json.subtasks.length).toBe(2);
		});

		test('hits the subtasks endpoint', async () => {
			mockServer.requests.length = 0;
			await runCli(['subtasks', 'task-1']);
			const req = mockServer.requests.find(r =>
				r.method === 'GET' && r.path.includes('/subtasks')
			);
			expect(req).toBeDefined();
		});

		test('empty task returns empty subtasks', async () => {
			const result = await runCliJson(['subtasks', '--task', 'task-2']);
			expect(result.exitCode).toBe(0);
			expect(result.json.subtasks).toBeArray();
			expect(result.json.subtasks.length).toBe(0);
		});

		test('rejects missing task ID', async () => {
			const result = await runCli(['subtasks']);
			expect(result.exitCode).toBe(1);
		});

		test('rejects invalid status filter', async () => {
			const result = await runCli(['subtasks', 'task-1', '--status', 'invalid']);
			expect(result.exitCode).toBe(1);
		});

		test('text output contains subtask titles', async () => {
			const result = await runCli(['subtasks', 'task-1']);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain('failing test');
		});
	});

	// ─── archive ─────────────────────────────────────────────────────────────

	describe('CLI: archive', () => {
		test('archives a task', async () => {
			const result = await runCliJson(['archive', '--task', 'task-1']);
			expect(result.exitCode).toBe(0);
			expect(result.json).toBeDefined();
			expect(result.json.success).toBe(true);
			expect(result.json.action).toBe('archive');
			expect(result.json.archived).toBe(true);
		});

		test('hits the archive endpoint', async () => {
			mockServer.requests.length = 0;
			await runCli(['archive', 'task-1']);
			const req = mockServer.requests.find(r =>
				r.method === 'POST' && r.path.includes('/archive')
			);
			expect(req).toBeDefined();
		});

		test('positional task ID works', async () => {
			const result = await runCliJson(['archive', 'task-1']);
			expect(result.exitCode).toBe(0);
			expect(result.json.success).toBe(true);
		});

		test('unarchive flag hits unarchive endpoint', async () => {
			mockServer.requests.length = 0;
			const result = await runCliJson(['archive', 'task-1', '--unarchive']);
			expect(result.exitCode).toBe(0);
			expect(result.json.action).toBe('unarchive');
			expect(result.json.archived).toBe(false);
			const req = mockServer.requests.find(r =>
				r.method === 'POST' && r.path.includes('/unarchive')
			);
			expect(req).toBeDefined();
		});

		test('dry-run does not hit API', async () => {
			mockServer.requests.length = 0;
			const result = await runCliJson(['archive', 'task-1', '--dry-run']);
			expect(result.exitCode).toBe(0);
			expect(result.json.dryRun).toBe(true);
			const archiveReq = mockServer.requests.find(r =>
				r.method === 'POST' && r.path.includes('/archive')
			);
			expect(archiveReq).toBeUndefined();
		});

		test('rejects missing task ID', async () => {
			const result = await runCli(['archive']);
			expect(result.exitCode).toBe(1);
		});

		test('text output confirms archive', async () => {
			const result = await runCli(['archive', 'task-1']);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain('archived');
		});
	});

	// ─── duplicate ───────────────────────────────────────────────────────────

	describe('CLI: duplicate', () => {
		test('duplicates a task', async () => {
			const result = await runCliJson(['duplicate', '--task', 'task-1']);
			expect(result.exitCode).toBe(0);
			expect(result.json).toBeDefined();
			expect(result.json.success).toBe(true);
			expect(result.json.task).toBeDefined();
			expect(result.json.task.title).toBe('Fix login bug');
		});

		test('hits the duplicate endpoint', async () => {
			mockServer.requests.length = 0;
			await runCli(['duplicate', 'task-1']);
			const req = mockServer.requests.find(r =>
				r.method === 'POST' && r.path.includes('/duplicate')
			);
			expect(req).toBeDefined();
		});

		test('positional task ID works', async () => {
			const result = await runCliJson(['duplicate', 'task-1']);
			expect(result.exitCode).toBe(0);
			expect(result.json.success).toBe(true);
		});

		test('title override is sent to API', async () => {
			mockServer.requests.length = 0;
			await runCli(['duplicate', 'task-1', '--title', 'Copy of login fix']);
			const req = mockServer.requests.find(r =>
				r.method === 'POST' && r.path.includes('/duplicate')
			);
			expect(req).toBeDefined();
			expect(req.body.title).toBe('Copy of login fix');
		});

		test('status override is sent to API', async () => {
			mockServer.requests.length = 0;
			await runCli(['duplicate', 'task-1', '--status', 'todo']);
			const req = mockServer.requests.find(r =>
				r.method === 'POST' && r.path.includes('/duplicate')
			);
			expect(req).toBeDefined();
			expect(req.body.status).toBe('todo');
		});

		test('dry-run does not hit API', async () => {
			mockServer.requests.length = 0;
			const result = await runCliJson(['duplicate', 'task-1', '--dry-run']);
			expect(result.exitCode).toBe(0);
			expect(result.json.dryRun).toBe(true);
			const dupReq = mockServer.requests.find(r =>
				r.method === 'POST' && r.path.includes('/duplicate')
			);
			expect(dupReq).toBeUndefined();
		});

		test('rejects missing task ID', async () => {
			const result = await runCli(['duplicate']);
			expect(result.exitCode).toBe(1);
		});

		test('rejects invalid status', async () => {
			const result = await runCli(['duplicate', 'task-1', '--status', 'invalid']);
			expect(result.exitCode).toBe(1);
		});

		test('new task has default backlog status', async () => {
			const result = await runCliJson(['duplicate', 'task-1']);
			expect(result.exitCode).toBe(0);
			expect(result.json.task.status).toBe('backlog');
		});

		test('text output confirms duplication', async () => {
			const result = await runCli(['duplicate', 'task-1']);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain('duplicated');
		});
	});

	// ─── update: label management ─────────────────────────────────────────────

	describe('CLI: update with label management', () => {
		test('--add-label sends POST to labels endpoint', async () => {
			mockServer.requests.length = 0;
			const result = await runCliJson(['update', 'task-1', '--add-label', 'lbl-001']);
			expect(result.exitCode).toBe(0);
			const req = mockServer.requests.find(r =>
				r.method === 'POST' && r.path.includes('/labels')
			);
			expect(req).toBeDefined();
			expect(req.body.labelId).toBe('lbl-001');
		});

		test('--remove-label sends DELETE to labels endpoint', async () => {
			mockServer.requests.length = 0;
			const result = await runCliJson(['update', 'task-1', '--remove-label', 'lbl-002']);
			expect(result.exitCode).toBe(0);
			const req = mockServer.requests.find(r =>
				r.method === 'DELETE' && r.path.includes('/labels/lbl-002')
			);
			expect(req).toBeDefined();
		});

		test('multiple --add-label flags work', async () => {
			mockServer.requests.length = 0;
			await runCli(['update', 'task-1', '--add-label', 'lbl-001', '--add-label', 'lbl-002']);
			const labelReqs = mockServer.requests.filter(r =>
				r.method === 'POST' && r.path.includes('/labels')
			);
			expect(labelReqs.length).toBe(2);
		});

		test('dry-run with labels does not hit API', async () => {
			mockServer.requests.length = 0;
			const result = await runCliJson(['update', 'task-1', '--add-label', 'lbl-001', '--dry-run']);
			expect(result.exitCode).toBe(0);
			expect(result.json.dryRun).toBe(true);
			const labelReq = mockServer.requests.find(r =>
				r.method === 'POST' && r.path.includes('/labels')
			);
			expect(labelReq).toBeUndefined();
		});

		test('rejects invalid label ID characters', async () => {
			const result = await runCli(['update', 'task-1', '--add-label', 'bad/id']);
			expect(result.exitCode).toBe(1);
		});

		test('labelsAdded in JSON output', async () => {
			const result = await runCliJson(['update', 'task-1', '--add-label', 'lbl-001']);
			expect(result.exitCode).toBe(0);
			expect(result.json.labelsAdded).toBeArray();
			expect(result.json.labelsAdded).toContain('lbl-001');
		});
	});

	// ─── describe: new commands show in schema ────────────────────────────────

	describe('CLI: describe new commands', () => {
		for (const cmd of ['search', 'members', 'labels', 'comments', 'subtasks', 'archive', 'duplicate']) {
			test(`describe ${cmd} returns valid JSON schema`, async () => {
				const result = await runCli(['describe', cmd]);
				expect(result.exitCode).toBe(0);
				let schema;
				try { schema = JSON.parse(result.stdout); } catch {
					throw new Error(`describe ${cmd} output is not valid JSON: ${result.stdout}`);
				}
				expect(schema.command).toBe(cmd);
				expect(schema.description).toBeTruthy();
			});
		}
	});
});
