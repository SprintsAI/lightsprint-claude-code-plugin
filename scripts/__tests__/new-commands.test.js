/**
 * Tests for new commands: search, list-comments, labels, create-label,
 * update-label, delete-label, add-label, remove-label, members,
 * relate, unrelate, relations, create-project, update-project.
 *
 * Uses a mock HTTP server (same pattern as e2e-mock-server.test.js).
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeFileSync, mkdirSync } from 'fs';
import { randomBytes } from 'crypto';

const CLI_PATH = join(import.meta.dir, '../lightsprint.js');
const REPO_KEY = 'SprintsAI/lightsprint-claude-code-plugin';

const TEST_CONFIG_DIR = join(tmpdir(), `lightsprint-new-cmds-${randomBytes(8).toString('hex')}`);
const REPOS_FILE = join(TEST_CONFIG_DIR, 'repos.json');

const ORIG_CONFIG_DIR = process.env.LIGHTSPRINT_CONFIG_DIR;
process.env.LIGHTSPRINT_CONFIG_DIR = TEST_CONFIG_DIR;

// ─── Mock Server ──────────────────────────────────────────────────────────────

function createMockServer() {
	const requests = [];
	const repoId = 'mock-repo-id';

	// Seed data
	const tasks = new Map([
		['task-1', { id: 'task-1', taskNumber: 1, title: 'Fix login bug', status: 'todo', complexity: 'high', description: 'Users cannot log in', assignedUser: null, project: null }],
		['task-2', { id: 'task-2', taskNumber: 2, title: 'Add search feature', status: 'backlog', complexity: 'medium', description: 'Implement full text search', assignedUser: null, project: null }],
	]);

	const labels = new Map([
		['label-1', { id: 'label-1', name: 'bug', color: '#FF0000', description: 'A bug' }],
		['label-2', { id: 'label-2', name: 'feature', color: '#00FF00', description: null }],
	]);

	const projects = new Map([
		['proj-1', { id: 'proj-1', name: 'Q2 Roadmap', color: '#5B8FF9', status: 'active', projectNumber: 1, taskCount: 2, repoTaskCount: 2 }],
	]);

	const relations = new Map([
		['rel-1', { id: 'rel-1', type: 'blocking', taskId: 'task-1', targetTaskId: 'task-2', targetTask: { id: 'task-2', title: 'Add search feature', status: 'backlog' } }],
	]);

	const members = [
		{ id: 'user-1', name: 'Alice', email: 'alice@example.com', role: 'admin' },
		{ id: 'user-2', name: 'Bob', email: 'bob@example.com', role: 'member' },
	];

	const comments = [
		{ id: 'comment-1', body: 'This looks good', author: { name: 'Alice' }, createdAt: '2024-01-01T00:00:00Z', updatedAt: null },
		{ id: 'comment-2', body: 'Agreed, let\'s ship it', author: { name: 'Bob' }, createdAt: '2024-01-02T00:00:00Z', updatedAt: null },
	];

	const server = Bun.serve({
		port: 0,
		async fetch(req) {
			const url = new URL(req.url);
			const method = req.method;
			const path = url.pathname;
			let body = null;

			if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
				try {
					const text = await req.text();
					body = text ? JSON.parse(text) : null;
				} catch {
					body = null;
				}
			}

			requests.push({ method, path, body, query: Object.fromEntries(url.searchParams) });

			// Token refresh
			if (path === '/oauth/token') {
				return Response.json({ access_token: 'mock-token', refresh_token: 'mock-refresh', expires_in: 3600 });
			}

			// Repo key info
			if (path === '/api/repo-key/info') {
				return Response.json({ repo: { id: repoId, name: REPO_KEY }, project: { id: repoId } });
			}

			// ─── Task resolve endpoint ─────────────────────────────────
			if (path === `/api/repos/${repoId}/tasks/resolve`) {
				const ref = url.searchParams.get('ref') || '';
				if (ref === 'task-1' || ref === 'LS-001' || ref === '1') return Response.json({ taskId: 'task-1' });
				if (ref === 'task-2' || ref === 'LS-002' || ref === '2') return Response.json({ taskId: 'task-2' });
				return new Response('Not found', { status: 404 });
			}

			// ─── Search endpoint ───────────────────────────────────────
			if (path === `/api/repos/${repoId}/tasks/search`) {
				const q = url.searchParams.get('q') || '';
				const matchingTasks = [...tasks.values()].filter(t =>
					t.title.toLowerCase().includes(q.toLowerCase()) ||
					(t.description || '').toLowerCase().includes(q.toLowerCase())
				);
				return Response.json({ tasks: matchingTasks, taskPrefix: 'LS', totalCount: matchingTasks.length });
			}

			// ─── Tasks list endpoint ───────────────────────────────────
			if (path === `/api/repos/${repoId}/tasks` && method === 'GET') {
				return Response.json({ tasks: [...tasks.values()], taskPrefix: 'LS', totalCount: tasks.size, pagination: { hasMore: false } });
			}

			// ─── Comments endpoints ────────────────────────────────────
			if (path.startsWith('/api/tasks/') && path.endsWith('/comments')) {
				const taskId = path.split('/')[3];
				if (method === 'GET') {
					if (!tasks.has(taskId)) return new Response('Not found', { status: 404 });
					return Response.json({ comments });
				}
				if (method === 'POST') {
					if (!tasks.has(taskId)) return new Response('Not found', { status: 404 });
					const newComment = { id: `comment-${Date.now()}`, body: body?.body || '', author: { name: 'Current User' }, createdAt: new Date().toISOString(), updatedAt: null };
					return Response.json({ comment: newComment });
				}
			}

			// ─── Labels endpoints ──────────────────────────────────────
			if (path === `/api/repos/${repoId}/labels`) {
				if (method === 'GET') {
					return Response.json({ labels: [...labels.values()] });
				}
				if (method === 'POST') {
					const newLabel = { id: `label-${Date.now()}`, name: body?.name, color: body?.color || null, description: body?.description || null };
					labels.set(newLabel.id, newLabel);
					return Response.json({ label: newLabel });
				}
			}

			if (path.startsWith('/api/labels/')) {
				const labelId = path.split('/')[3];
				if (method === 'PATCH') {
					const existing = labels.get(labelId) || { id: labelId };
					const updated = { ...existing, ...body };
					labels.set(labelId, updated);
					return Response.json({ label: updated });
				}
				if (method === 'DELETE') {
					labels.delete(labelId);
					return new Response(null, { status: 204 });
				}
			}

			// Task labels
			if (path.match(/^\/api\/tasks\/[^/]+\/labels$/) && method === 'POST') {
				return Response.json({ added: true });
			}
			if (path.match(/^\/api\/tasks\/[^/]+\/labels\/[^/]+$/) && method === 'DELETE') {
				return new Response(null, { status: 204 });
			}

			// ─── Members endpoint ──────────────────────────────────────
			if (path === `/api/repos/${repoId}/members`) {
				return Response.json({ members });
			}

			// ─── Relations endpoints ───────────────────────────────────
			if (path.match(/^\/api\/tasks\/[^/]+\/relations$/) && method === 'GET') {
				const taskId = path.split('/')[3];
				const taskRelations = [...relations.values()].filter(r => r.taskId === taskId);
				return Response.json({ relations: taskRelations });
			}
			if (path.match(/^\/api\/tasks\/[^/]+\/relations$/) && method === 'POST') {
				const taskId = path.split('/')[3];
				const newRelation = { id: `rel-${Date.now()}`, type: body?.type, taskId, targetTaskId: body?.targetTaskId };
				relations.set(newRelation.id, newRelation);
				return Response.json({ relation: newRelation });
			}
			if (path.match(/^\/api\/tasks\/[^/]+\/relations\/[^/]+$/) && method === 'DELETE') {
				const parts = path.split('/');
				const relId = parts[5];
				relations.delete(relId);
				return new Response(null, { status: 204 });
			}

			// ─── Projects endpoints ────────────────────────────────────
			if (path === `/api/repos/${repoId}/projects` && method === 'GET') {
				return Response.json({ projects: [...projects.values()] });
			}
			if (path === `/api/repos/${repoId}/projects` && method === 'POST') {
				const newProject = { id: `proj-${Date.now()}`, name: body?.name, color: body?.color || null, description: body?.description || null, status: 'active', projectNumber: projects.size + 1, taskCount: 0, repoTaskCount: 0 };
				projects.set(newProject.id, newProject);
				return Response.json({ project: newProject });
			}
			if (path.match(/^\/api\/repos\/projects\/[^/]+$/) && method === 'PATCH') {
				const projectId = path.split('/')[4];
				const existing = projects.get(projectId) || { id: projectId };
				const updated = { ...existing, ...body };
				projects.set(projectId, updated);
				return Response.json({ project: updated });
			}

			// ─── Task get endpoint ─────────────────────────────────────
			if (path.match(/^\/api\/tasks\/[^/]+$/) && method === 'GET') {
				const taskId = path.split('/')[3];
				const task = tasks.get(taskId);
				if (!task) return new Response('Not found', { status: 404 });
				return Response.json({ task: { ...task, githubPullRequests: [] } });
			}

			return new Response('Not found', { status: 404 });
		}
	});

	return { server, requests, repoId };
}

// ─── CLI runner ───────────────────────────────────────────────────────────────

async function runCli(serverPort, ...args) {
	// Insert --output json after the command (first arg), not before it
	const [cmd, ...restArgs] = args;
	const fullArgs = cmd ? [cmd, '--output', 'json', ...restArgs] : ['--output', 'json'];
	const proc = Bun.spawn(['bun', 'run', CLI_PATH, ...fullArgs], {
		stdout: 'pipe',
		stderr: 'pipe',
		env: { ...process.env, LIGHTSPRINT_CONFIG_DIR: TEST_CONFIG_DIR }
	});
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	await proc.exited;
	return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: proc.exitCode };
}

async function runCliText(serverPort, ...args) {
	const proc = Bun.spawn(['bun', 'run', CLI_PATH, ...args], {
		stdout: 'pipe',
		stderr: 'pipe',
		env: { ...process.env, LIGHTSPRINT_CONFIG_DIR: TEST_CONFIG_DIR }
	});
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	await proc.exited;
	return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: proc.exitCode };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

let mockServer;
let mockRequests;
let mockPort;

beforeAll(() => {
	mkdirSync(TEST_CONFIG_DIR, { recursive: true });
	const { server, requests } = createMockServer();
	mockServer = server;
	mockRequests = requests;
	mockPort = server.port;

	writeFileSync(REPOS_FILE, JSON.stringify({
		[REPO_KEY]: {
			accessToken: 'mock-access-token',
			refreshToken: 'mock-refresh-token',
			expiresAt: Date.now() + 3600_000,
			baseUrl: `http://localhost:${mockPort}`,
			repo: REPO_KEY,
			repoId: 'mock-repo-id'
		}
	}));
});

afterAll(() => {
	process.env.LIGHTSPRINT_CONFIG_DIR = ORIG_CONFIG_DIR;
	mockServer?.stop();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('search command', () => {
	test('search with positional query returns matching tasks', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'search', 'login');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toHaveProperty('query', 'login');
		expect(data).toHaveProperty('tasks');
		expect(Array.isArray(data.tasks)).toBe(true);
	});

	test('search with --query flag returns matching tasks', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'search', '--query', 'search');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data.query).toBe('search');
		expect(data.tasks).toBeDefined();
	});

	test('search requires a query argument', async () => {
		const { exitCode, stderr } = await runCli(mockPort, 'search');
		expect(exitCode).toBe(1);
		expect(stderr).toMatch(/query|Usage/i);
	});

	test('search rejects control characters in query', async () => {
		const { exitCode, stderr } = await runCli(mockPort, 'search', 'bad\x01query');
		expect(exitCode).toBe(1);
		expect(stderr).toMatch(/control characters/i);
	});

	test('search text output lists matching tasks', async () => {
		const { stdout, exitCode } = await runCliText(mockPort, 'search', 'login');
		expect(exitCode).toBe(0);
		expect(stdout).toMatch(/login|Fix/i);
	});
});

describe('list-comments command', () => {
	test('lists comments with positional taskId', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'list-comments', 'task-1');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toHaveProperty('comments');
		expect(Array.isArray(data.comments)).toBe(true);
		expect(data.comments.length).toBeGreaterThan(0);
	});

	test('lists comments with --task flag', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'list-comments', '--task', 'task-1');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data.comments[0]).toHaveProperty('body');
		expect(data.comments[0]).toHaveProperty('author');
	});

	test('requires taskId argument', async () => {
		const { exitCode, stderr } = await runCli(mockPort, 'list-comments');
		expect(exitCode).toBe(1);
		expect(stderr).toMatch(/Usage|taskId/i);
	});

	test('text output shows comment content', async () => {
		const { stdout, exitCode } = await runCliText(mockPort, 'list-comments', 'task-1');
		expect(exitCode).toBe(0);
		expect(stdout).toMatch(/comment|This looks good/i);
	});
});

describe('labels command', () => {
	test('lists all labels', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'labels');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toHaveProperty('labels');
		expect(Array.isArray(data.labels)).toBe(true);
		expect(data.labels[0]).toHaveProperty('id');
		expect(data.labels[0]).toHaveProperty('name');
	});

	test('text output shows label names', async () => {
		const { stdout, exitCode } = await runCliText(mockPort, 'labels');
		expect(exitCode).toBe(0);
		expect(stdout).toMatch(/bug|feature/i);
	});
});

describe('create-label command', () => {
	test('creates label with --name flag', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'create-label', '--name', 'test-label', '--color', '#AABBCC');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toHaveProperty('id');
		expect(data).toHaveProperty('name', 'test-label');
		expect(data).toHaveProperty('color', '#AABBCC');
	});

	test('requires --name', async () => {
		const { exitCode, stderr } = await runCli(mockPort, 'create-label');
		expect(exitCode).toBe(1);
		expect(stderr).toMatch(/name.*required|Usage/i);
	});

	test('rejects invalid color format', async () => {
		const { exitCode, stderr } = await runCli(mockPort, 'create-label', '--name', 'x', '--color', 'red');
		expect(exitCode).toBe(1);
		expect(stderr).toMatch(/Invalid color|hex/i);
	});

	test('rejects name with control characters', async () => {
		const { exitCode, stderr } = await runCli(mockPort, 'create-label', '--name', 'bad\x01name');
		expect(exitCode).toBe(1);
		expect(stderr).toMatch(/control characters/i);
	});

	test('dry-run does not call API', async () => {
		const requestsBefore = mockRequests.length;
		const { stdout, exitCode } = await runCli(mockPort, 'create-label', '--name', 'dry-test', '--dry-run');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data.dryRun).toBe(true);
		// No new POST requests to labels
		const newRequests = mockRequests.slice(requestsBefore);
		const labelPosts = newRequests.filter(r => r.method === 'POST' && r.path.includes('/labels'));
		expect(labelPosts.length).toBe(0);
	});
});

describe('update-label command', () => {
	test('updates label with positional ID', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'update-label', 'label-1', '--name', 'critical-bug');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toHaveProperty('name', 'critical-bug');
	});

	test('requires at least one update field', async () => {
		const { exitCode, stderr } = await runCli(mockPort, 'update-label', 'label-1');
		expect(exitCode).toBe(1);
		expect(stderr).toMatch(/required/i);
	});

	test('requires label ID', async () => {
		const { exitCode } = await runCli(mockPort, 'update-label');
		expect(exitCode).toBe(1);
	});

	test('dry-run does not call API', async () => {
		const requestsBefore = mockRequests.length;
		const { stdout, exitCode } = await runCli(mockPort, 'update-label', 'label-1', '--name', 'dry', '--dry-run');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data.dryRun).toBe(true);
		const newRequests = mockRequests.slice(requestsBefore);
		const patchReqs = newRequests.filter(r => r.method === 'PATCH');
		expect(patchReqs.length).toBe(0);
	});
});

describe('delete-label command', () => {
	test('deletes label with positional ID', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'delete-label', 'label-2');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toHaveProperty('deleted', true);
	});

	test('requires label ID', async () => {
		const { exitCode } = await runCli(mockPort, 'delete-label');
		expect(exitCode).toBe(1);
	});

	test('dry-run shows what would be deleted', async () => {
		const requestsBefore = mockRequests.length;
		const { stdout, exitCode } = await runCli(mockPort, 'delete-label', 'label-1', '--dry-run');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data.dryRun).toBe(true);
		const newRequests = mockRequests.slice(requestsBefore);
		const deleteReqs = newRequests.filter(r => r.method === 'DELETE');
		expect(deleteReqs.length).toBe(0);
	});
});

describe('add-label command', () => {
	test('adds label to task with positional args', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'add-label', 'task-1', 'label-1');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toHaveProperty('added', true);
	});

	test('adds label with --task and --label flags', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'add-label', '--task', 'task-1', '--label', 'label-1');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toHaveProperty('taskId');
		expect(data).toHaveProperty('labelId', 'label-1');
	});

	test('requires both taskId and labelId', async () => {
		const { exitCode } = await runCli(mockPort, 'add-label', 'task-1');
		expect(exitCode).toBe(1);
	});

	test('dry-run does not call API', async () => {
		const requestsBefore = mockRequests.length;
		const { stdout, exitCode } = await runCli(mockPort, 'add-label', '--task', 'task-1', '--label', 'label-1', '--dry-run');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data.dryRun).toBe(true);
		const newRequests = mockRequests.slice(requestsBefore);
		const postReqs = newRequests.filter(r => r.method === 'POST' && r.path.includes('/labels'));
		expect(postReqs.length).toBe(0);
	});
});

describe('remove-label command', () => {
	test('removes label with positional args', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'remove-label', 'task-1', 'label-1');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toHaveProperty('removed', true);
	});

	test('removes label with --task and --label flags', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'remove-label', '--task', 'task-1', '--label', 'label-1');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toHaveProperty('removed', true);
	});

	test('requires both taskId and labelId', async () => {
		const { exitCode } = await runCli(mockPort, 'remove-label', 'task-1');
		expect(exitCode).toBe(1);
	});

	test('dry-run does not call API', async () => {
		const requestsBefore = mockRequests.length;
		const { stdout, exitCode } = await runCli(mockPort, 'remove-label', '--task', 'task-1', '--label', 'label-1', '--dry-run');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data.dryRun).toBe(true);
		const newRequests = mockRequests.slice(requestsBefore);
		const deleteReqs = newRequests.filter(r => r.method === 'DELETE' && r.path.includes('/labels'));
		expect(deleteReqs.length).toBe(0);
	});
});

describe('members command', () => {
	test('lists workspace members', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'members');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toHaveProperty('members');
		expect(Array.isArray(data.members)).toBe(true);
		expect(data.members[0]).toHaveProperty('name');
		expect(data.members[0]).toHaveProperty('email');
	});

	test('text output shows member names', async () => {
		const { stdout, exitCode } = await runCliText(mockPort, 'members');
		expect(exitCode).toBe(0);
		expect(stdout).toMatch(/Alice|Bob/);
	});

	test('rejects unknown flags', async () => {
		const { exitCode, stderr } = await runCli(mockPort, 'members', '--unknown');
		expect(exitCode).toBe(1);
		expect(stderr).toMatch(/Unknown argument/i);
	});
});

describe('relate command', () => {
	test('creates a blocking relation', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'relate', 'task-1', '--type', 'blocking', '--target', 'task-2');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toHaveProperty('type', 'blocking');
		expect(data).toHaveProperty('taskId', 'task-1');
		expect(data).toHaveProperty('targetTaskId', 'task-2');
	});

	test('creates a related relation with --task flag', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'relate', '--task', 'task-1', '--type', 'related', '--target', 'task-2');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toHaveProperty('type', 'related');
	});

	test('requires --type flag', async () => {
		const { exitCode, stderr } = await runCli(mockPort, 'relate', 'task-1', '--target', 'task-2');
		expect(exitCode).toBe(1);
		expect(stderr).toMatch(/--type.*required|type is required/i);
	});

	test('requires --target flag', async () => {
		const { exitCode, stderr } = await runCli(mockPort, 'relate', 'task-1', '--type', 'blocking');
		expect(exitCode).toBe(1);
		expect(stderr).toMatch(/--target.*required|target is required/i);
	});

	test('rejects invalid relation type', async () => {
		const { exitCode, stderr } = await runCli(mockPort, 'relate', 'task-1', '--type', 'invalid', '--target', 'task-2');
		expect(exitCode).toBe(1);
		expect(stderr).toMatch(/Invalid.*relation type|blocking.*related.*duplicate/i);
	});

	test('rejects self-relation', async () => {
		const { exitCode, stderr } = await runCli(mockPort, 'relate', 'task-1', '--type', 'related', '--target', 'task-1');
		expect(exitCode).toBe(1);
		expect(stderr).toMatch(/cannot be related to itself/i);
	});

	test('dry-run does not call API', async () => {
		const requestsBefore = mockRequests.length;
		const { stdout, exitCode } = await runCli(mockPort, 'relate', 'task-1', '--type', 'related', '--target', 'task-2', '--dry-run');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data.dryRun).toBe(true);
		const newRequests = mockRequests.slice(requestsBefore);
		const postReqs = newRequests.filter(r => r.method === 'POST' && r.path.includes('/relations'));
		expect(postReqs.length).toBe(0);
	});

	test('all valid relation types are accepted', async () => {
		for (const type of ['blocking', 'related', 'duplicate']) {
			const { exitCode } = await runCli(mockPort, 'relate', 'task-1', '--type', type, '--target', 'task-2');
			expect(exitCode).toBe(0);
		}
	});
});

describe('unrelate command', () => {
	test('removes a relation with relation-id', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'unrelate', 'task-1', '--relation-id', 'rel-1');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toHaveProperty('removed', true);
		expect(data).toHaveProperty('relationId', 'rel-1');
	});

	test('requires task ID', async () => {
		const { exitCode } = await runCli(mockPort, 'unrelate');
		expect(exitCode).toBe(1);
	});

	test('requires --relation-id', async () => {
		const { exitCode, stderr } = await runCli(mockPort, 'unrelate', 'task-1');
		expect(exitCode).toBe(1);
		expect(stderr).toMatch(/--relation-id.*required/i);
	});

	test('rejects invalid relation ID', async () => {
		const { exitCode, stderr } = await runCli(mockPort, 'unrelate', 'task-1', '--relation-id', 'bad/id');
		expect(exitCode).toBe(1);
		expect(stderr).toMatch(/Invalid Relation ID/i);
	});

	test('dry-run does not call API', async () => {
		const requestsBefore = mockRequests.length;
		const { stdout, exitCode } = await runCli(mockPort, 'unrelate', 'task-1', '--relation-id', 'rel-1', '--dry-run');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data.dryRun).toBe(true);
		const newRequests = mockRequests.slice(requestsBefore);
		const deleteReqs = newRequests.filter(r => r.method === 'DELETE' && r.path.includes('/relations'));
		expect(deleteReqs.length).toBe(0);
	});
});

describe('relations command', () => {
	test('lists relations for a task', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'relations', 'task-1');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toHaveProperty('taskId', 'task-1');
		expect(data).toHaveProperty('relations');
		expect(Array.isArray(data.relations)).toBe(true);
	});

	test('lists relations with --task flag', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'relations', '--task', 'task-1');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data.relations).toBeDefined();
	});

	test('requires taskId', async () => {
		const { exitCode } = await runCli(mockPort, 'relations');
		expect(exitCode).toBe(1);
	});

	test('text output shows relation types', async () => {
		const { stdout, exitCode } = await runCliText(mockPort, 'relations', 'task-1');
		expect(exitCode).toBe(0);
		expect(stdout).toMatch(/blocking|related|duplicate|No relations/i);
	});
});

describe('create-project command', () => {
	test('creates project with --name flag', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'create-project', '--name', 'New Project');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toHaveProperty('name', 'New Project');
		expect(data).toHaveProperty('id');
	});

	test('creates project with color', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'create-project', '--name', 'Colored Project', '--color', '#FF5733');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toHaveProperty('color', '#FF5733');
	});

	test('requires --name', async () => {
		const { exitCode, stderr } = await runCli(mockPort, 'create-project');
		expect(exitCode).toBe(1);
		expect(stderr).toMatch(/Usage|name.*required/i);
	});

	test('rejects invalid color', async () => {
		const { exitCode, stderr } = await runCli(mockPort, 'create-project', '--name', 'Test', '--color', 'blue');
		expect(exitCode).toBe(1);
		expect(stderr).toMatch(/Invalid color|hex/i);
	});

	test('dry-run does not call API', async () => {
		const requestsBefore = mockRequests.length;
		const { stdout, exitCode } = await runCli(mockPort, 'create-project', '--name', 'Dry Project', '--dry-run');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data.dryRun).toBe(true);
		const newRequests = mockRequests.slice(requestsBefore);
		const postReqs = newRequests.filter(r => r.method === 'POST' && r.path.includes('/projects'));
		expect(postReqs.length).toBe(0);
	});

	test('text output shows project name', async () => {
		const { stdout, exitCode } = await runCliText(mockPort, 'create-project', '--name', 'Text Test Project');
		expect(exitCode).toBe(0);
		expect(stdout).toMatch(/Project created|Text Test Project/i);
	});
});

describe('update-project command', () => {
	test('updates project with positional ID', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'update-project', 'proj-1', '--status', 'completed');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toHaveProperty('status', 'completed');
	});

	test('updates project with --project flag', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'update-project', '--project', 'proj-1', '--name', 'Renamed');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toHaveProperty('name', 'Renamed');
	});

	test('requires project ID', async () => {
		const { exitCode } = await runCli(mockPort, 'update-project');
		expect(exitCode).toBe(1);
	});

	test('requires at least one update field', async () => {
		const { exitCode, stderr } = await runCli(mockPort, 'update-project', 'proj-1');
		expect(exitCode).toBe(1);
		expect(stderr).toMatch(/at least one/i);
	});

	test('rejects invalid status', async () => {
		const { exitCode, stderr } = await runCli(mockPort, 'update-project', 'proj-1', '--status', 'invalid');
		expect(exitCode).toBe(1);
		expect(stderr).toMatch(/Invalid.*project status|active.*completed.*archived/i);
	});

	test('rejects invalid color', async () => {
		const { exitCode, stderr } = await runCli(mockPort, 'update-project', 'proj-1', '--color', 'red');
		expect(exitCode).toBe(1);
		expect(stderr).toMatch(/Invalid color/i);
	});

	test('dry-run does not call API', async () => {
		const requestsBefore = mockRequests.length;
		const { stdout, exitCode } = await runCli(mockPort, 'update-project', 'proj-1', '--name', 'Dry', '--dry-run');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data.dryRun).toBe(true);
		const newRequests = mockRequests.slice(requestsBefore);
		const patchReqs = newRequests.filter(r => r.method === 'PATCH');
		expect(patchReqs.length).toBe(0);
	});
});

describe('command aliases', () => {
	test('"comments" alias resolves to list-comments', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'comments', 'task-1');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toHaveProperty('comments');
	});

	test('"label" alias resolves to labels', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'label');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toHaveProperty('labels');
	});

	test('"team" alias resolves to members', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'team');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toHaveProperty('members');
	});

	test('"tags" alias resolves to labels', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'tags');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toHaveProperty('labels');
	});

	test('"new-project" alias resolves to create-project', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'new-project', '--name', 'Alias Test');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toHaveProperty('name', 'Alias Test');
	});

	test('"relation" alias resolves to relations', async () => {
		const { stdout, exitCode } = await runCli(mockPort, 'relation', 'task-1');
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toHaveProperty('relations');
	});
});

describe('schema/describe command includes new commands', () => {
	test('describe search shows params', async () => {
		const { stdout } = await runCliText(mockPort, 'describe', 'search');
		const data = JSON.parse(stdout);
		expect(data.command).toBe('search');
		expect(data.params).toHaveProperty('query');
		expect(data.params).toHaveProperty('status');
	});

	test('describe list-comments shows params', async () => {
		const { stdout } = await runCliText(mockPort, 'describe', 'list-comments');
		const data = JSON.parse(stdout);
		expect(data.command).toBe('list-comments');
		expect(data.params).toHaveProperty('taskId');
	});

	test('describe labels shows params', async () => {
		const { stdout } = await runCliText(mockPort, 'describe', 'labels');
		const data = JSON.parse(stdout);
		expect(data.command).toBe('labels');
	});

	test('describe create-label shows required name param', async () => {
		const { stdout } = await runCliText(mockPort, 'describe', 'create-label');
		const data = JSON.parse(stdout);
		expect(data.params.name.required).toBe(true);
		expect(data.supportsDryRun).toBe(true);
	});

	test('describe relate shows valid types', async () => {
		const { stdout } = await runCliText(mockPort, 'describe', 'relate');
		const data = JSON.parse(stdout);
		expect(data.params.type.values).toContain('blocking');
		expect(data.params.type.values).toContain('related');
		expect(data.params.type.values).toContain('duplicate');
	});

	test('describe members is listed', async () => {
		const { stdout } = await runCliText(mockPort, 'describe', 'members');
		const data = JSON.parse(stdout);
		expect(data.command).toBe('members');
	});

	test('describe create-project shows dry-run support', async () => {
		const { stdout } = await runCliText(mockPort, 'describe', 'create-project');
		const data = JSON.parse(stdout);
		expect(data.supportsDryRun).toBe(true);
		expect(data.params.name.required).toBe(true);
	});
});
