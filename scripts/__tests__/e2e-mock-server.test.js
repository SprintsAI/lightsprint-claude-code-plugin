/**
 * E2E tests with a mock Lightsprint server.
 *
 * Validates key flows:
 * 1. CLI commands (tasks, create, update, get, claim, comment)
 * 2. Session lifecycle (start → daemon → events → end)
 * 3. Daemon survives CC kill, then shuts down gracefully
 * 4. Various start/stop session permutations
 *
 * Uses a mock HTTP + WebSocket server so no real API calls are made.
 * Must pass on both main branch and current branch.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { randomBytes } from 'crypto';
import { spawn } from 'child_process';
import { writeConnection } from '../lib/connection.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const CLI_PATH = join(import.meta.dir, '../lightsprint.js');
const REPO_KEY = 'SprintsAI/lightsprint-claude-code-plugin'; // matches git remote

// Use an isolated temp config dir so tests never touch ~/.lightsprint
const TEST_CONFIG_DIR = join(tmpdir(), `lightsprint-e2e-${randomBytes(8).toString('hex')}`);
const REPOS_FILE = join(TEST_CONFIG_DIR, 'repos.json');
const SESSIONS_DIR = join(TEST_CONFIG_DIR, 'cc-sessions');

// Set env var so all config/session code uses our temp dir
const ORIG_CONFIG_DIR = process.env.LIGHTSPRINT_CONFIG_DIR;
process.env.LIGHTSPRINT_CONFIG_DIR = TEST_CONFIG_DIR;

// ─── Mock Server ─────────────────────────────────────────────────────────────

/**
 * Creates a mock Lightsprint HTTP server that records all requests.
 * Returns the server, port, and request log.
 */
function createMockServer() {
	const requests = [];
	const tasks = new Map();
	const repoId = 'mock-repo-id';
	let sessionCounter = 0;

	// Seed some tasks
	tasks.set('task-1', {
		id: 'task-1',
		displayId: 'MOCK-1',
		title: 'E2E Test Task 1',
		status: 'todo',
		complexity: 'medium',
		assignee: null,
		description: 'First test task',
		creator: { name: 'test-user' },
		dependencies: [],
	});
	tasks.set('task-2', {
		id: 'task-2',
		displayId: 'MOCK-2',
		title: 'E2E Test Task 2',
		status: 'backlog',
		complexity: 'low',
		assignee: null,
		description: 'Second test task',
		creator: { name: 'test-user' },
		dependencies: [],
	});

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

			// ─── Route matching ──────────────────────────────────────

			// Token refresh
			if (path === '/oauth/token' && method === 'POST') {
				return Response.json({
					access_token: 'refreshed-token-' + Date.now(),
					refresh_token: 'refreshed-refresh-token',
					expires_in: 3600,
				});
			}

			// Repo info
			if (path === '/api/repo-key/info' && method === 'GET') {
				return Response.json({
					user: { name: 'test-user', email: 'test@example.com', id: 'user-1' },
					repo: { id: repoId, name: 'lightsprint-claude-code-plugin', fullName: REPO_KEY, workspaceId: 'mock-workspace-id' },
					project: { id: repoId, name: 'lightsprint-claude-code-plugin', fullName: REPO_KEY, workspaceId: 'mock-workspace-id' },
					scopes: ['repo:read', 'repo:write'],
				});
			}

			// Resolve task ID (display ID → raw ID) — workspace-scoped
			const resolveMatch = path.match(/^\/api\/workspaces\/[^/]+\/tasks\/resolve$/);
			if (resolveMatch && method === 'GET') {
				const ref = url.searchParams.get('ref');
				// If ref is already a raw task ID, return it directly
				const task = tasks.get(ref);
				if (task) return Response.json({ taskId: task.id });
				// Try matching by displayId
				for (const t of tasks.values()) {
					if (t.displayId === ref) return Response.json({ taskId: t.id });
				}
				return Response.json({ error: 'Not found' }, { status: 404 });
			}

			// List tasks (workspace board). Mirrors the REAL server shape:
			//  - layoutType=list (no sectionId) → { listSectionsWithTasks: [{ id, name, status, tasks }] }
			//  - layoutType=list&sectionId=X    → { tasks, totalCount }  (one section, paginated)
			if (path.match(/^\/api\/workspaces\/[^/]+\/board$/) && method === 'GET') {
				const allTasks = [...tasks.values()];
				const sectionId = url.searchParams.get('sectionId');
				if (sectionId) {
					// Single-section paginated path used by --page-all.
					const offset = parseInt(url.searchParams.get('offset') || '0', 10) || 0;
					const limit = parseInt(url.searchParams.get('limit') || '100', 10) || 100;
					// All seeded tasks live in the single 'sec-todo' section here.
					const sectionTasks = sectionId === 'sec-todo' ? allTasks : [];
					return Response.json({
						tasks: sectionTasks.slice(offset, offset + limit),
						totalCount: sectionTasks.length,
					});
				}
				return Response.json({
					listSectionsWithTasks: [
						{ id: 'sec-todo', name: 'Todo', status: 'todo', tasks: allTasks },
					],
				});
			}

			// List stacks (workspace-scoped)
			if (path.match(/^\/api\/workspaces\/[^/]+\/stacks$/) && method === 'GET') {
				return Response.json({
					stacks: [
						{ id: 'stk_1', name: 'Eng', taskPrefix: 'ENG', memberRepoIds: ['r1'] },
					],
				});
			}

			// Get a single stack + member repos (workspace-scoped)
			const stackGetMatch = path.match(/^\/api\/workspaces\/[^/]+\/stacks\/([^/]+)$/);
			if (stackGetMatch && method === 'GET') {
				const stackId = stackGetMatch[1];
				return Response.json({
					stack: { id: stackId, name: 'Eng', taskPrefix: 'ENG' },
					members: [
						{ stackId, repoId: 'r1' },
					],
					memberRepos: [
						{ id: 'r1', name: 'core', fullName: 'SprintsAI/core' },
					],
				});
			}

			// Create default-stack task
			if (path === '/api/tasks' && method === 'POST') {
				const newId = 'task-' + randomBytes(4).toString('hex');
				const newTask = {
					id: newId,
					displayId: 'MOCK-' + (tasks.size + 1),
					taskNumber: tasks.size + 1,
					title: body?.title || 'Untitled',
					status: body?.status || 'backlog',
					complexity: body?.complexity || 'medium',
					repoId: null,
					stackId: 'mock-default-stack-id',
					workspaceId: body?.workspaceId || 'mock-workspace-id',
					assignee: null,
					description: body?.description || '',
					creator: { name: 'test-user' },
					dependencies: [],
				};
				tasks.set(newId, newTask);
				return Response.json({ task: newTask, taskPrefix: body?.scope === 'stack' ? 'ENG' : 'MOCK' }, { status: 201 });
			}

			// Launch the native Lightsprint managed agent
			const launchMatch = path.match(/^\/api\/tasks\/([^/]+)\/cloud-agents\/lightsprint$/);
			if (launchMatch && method === 'POST') {
				return Response.json({
					id: 'session-handoff-1',
					externalId: 'session-handoff-1',
					status: 'RUNNING',
					branchName: 'ls/mock-handoff',
					agentUrl: '/agent-sessions/session-handoff-1',
				});
			}

			// Managed session status
			if (path === '/api/agent-sessions/session-handoff-1/status' && method === 'GET') {
				return Response.json({
					status: {
						sessionId: 'session-handoff-1',
						sessionStatus: 'idle',
						phase: 'idle',
						branchName: 'ls/mock-handoff',
						prUrl: 'https://github.com/SprintsAI/lightsprint-claude-code-plugin/pull/123',
						errorMessage: null,
					},
				});
			}

			// Get task
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
				if (body?.complexity) task.complexity = body.complexity;
				if (body?.assignee) task.assignee = body.assignee;
				if (body?.description) task.description = body.description;
				return Response.json({ task });
			}

			// Claim task
			const claimMatch = path.match(/^\/api\/tasks\/([^/]+)\/claim$/);
			if (claimMatch && method === 'POST') {
				const task = tasks.get(claimMatch[1]);
				if (!task) return Response.json({ error: 'Not found' }, { status: 404 });
				task.status = 'in_progress';
				task.assignee = { name: 'test-user', email: 'test@example.com' };
				return Response.json({ task, ccSessionLinked: !!body?.ccSessionId });
			}

			// Add dependency
			const depMatch = path.match(/^\/api\/tasks\/([^/]+)\/dependencies$/);
			if (depMatch && method === 'POST') {
				return Response.json({ ok: true });
			}
			if (depMatch && method === 'DELETE') {
				return Response.json({ ok: true });
			}
			if (depMatch && method === 'GET') {
				return Response.json({ dependencies: [] });
			}

			// Comment (handles both /comment and /comments)
			const commentMatch = path.match(/^\/api\/tasks\/([^/]+)\/comments?$/);
			if (commentMatch && method === 'POST') {
				return Response.json({
					comment: {
						id: 'comment-' + randomBytes(4).toString('hex'),
						body: body?.body || '',
						createdAt: new Date().toISOString(),
					}
				});
			}

			// Session task lookup
			const sessionTaskMatch = path.match(/^\/api\/cc-sessions\/([^/]+)\/task$/);
			if (sessionTaskMatch && method === 'GET') {
				return Response.json({ task: null });
			}

			// Workspace details (for whoami)
			const wsGetMatch = path.match(/^\/api\/workspaces\/([^/]+)$/);
			if (wsGetMatch && method === 'GET') {
				return Response.json({
					workspace: {
						id: wsGetMatch[1],
						name: 'Mock Workspace',
						defaultStackId: 'stk_1',
						repos: [{ id: 'r1', fullName: REPO_KEY }],
					},
				});
			}

			// User profile (for whoami)
			if (path === '/api/user/profile' && method === 'GET') {
				return Response.json({ name: 'test-user', email: 'test@example.com', id: 'user-1' });
			}

			return Response.json({ error: 'Not found', path, method }, { status: 404 });
		},
	});

	return { server, port: server.port, requests, tasks, repoId };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let mockServer;

function setupMockRepos(baseUrl) {
	mkdirSync(TEST_CONFIG_DIR, { recursive: true, mode: 0o700 });
	// Workspace-scoped connection model: the CLI reads connection.json (not repos.json).
	writeConnection({
		workspaceId: 'mock-workspace-id',
		workspaceName: 'Mock Workspace',
		accessToken: 'mock-access-token',
		refreshToken: 'mock-refresh-token',
		expiresAt: Date.now() + 3600000, // 1 hour from now
		baseUrl,
	});
}

function cleanupTestConfigDir() {
	try { rmSync(TEST_CONFIG_DIR, { recursive: true, force: true }); } catch {}
}

/**
 * Run a CLI command and return { stdout, stderr, exitCode }.
 */
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

/**
 * Run a CLI command with JSON output.
 */
async function runCliJson(args, opts = {}) {
	const result = await runCli([...args, '--output', 'json'], opts);
	let json = null;
	try {
		json = JSON.parse(result.stdout);
	} catch {}
	return { ...result, json };
}

/**
 * Clean up session files created during tests.
 */
function cleanupTestSessions(prefix) {
	try {
		const files = readdirSync(SESSIONS_DIR);
		for (const f of files) {
			if (f.startsWith(prefix)) {
				try { unlinkSync(join(SESSIONS_DIR, f)); } catch {}
			}
		}
	} catch {}
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('E2E: Mock Server', () => {
	beforeAll(() => {
		mockServer = createMockServer();
		setupMockRepos(`http://localhost:${mockServer.port}`);
	});

	afterAll(() => {
		mockServer.server.stop();
		cleanupTestConfigDir();
		if (ORIG_CONFIG_DIR) {
			process.env.LIGHTSPRINT_CONFIG_DIR = ORIG_CONFIG_DIR;
		} else {
			delete process.env.LIGHTSPRINT_CONFIG_DIR;
		}
	});

	beforeEach(() => {
		mockServer.requests.length = 0;
	});

	// ─── CLI: tasks ──────────────────────────────────────────────────────

	describe('CLI: tasks', () => {
		test('lists tasks from mock server', async () => {
			const result = await runCliJson(['tasks']);
			if (result.exitCode !== 0) {
				console.error('CLI tasks --output json failed:', { stderr: result.stderr, stdout: result.stdout });
			}
			expect(result.exitCode).toBe(0);
			expect(result.json).toBeDefined();
			expect(result.json.tasks).toBeArray();
			expect(result.json.tasks.length).toBe(2);
			// Confirm tasks were flattened out of listSectionsWithTasks[].tasks.
			const ids = result.json.tasks.map(t => t.id);
			expect(ids).toContain('task-1');
			expect(ids).toContain('task-2');
			const displayIds = result.json.tasks.map(t => t.displayId);
			expect(displayIds).toContain('MOCK-1');
		});

		test('lists tasks in text mode', async () => {
			const result = await runCli(['tasks']);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain('E2E Test Task 1');
			expect(result.stdout).toContain('E2E Test Task 2');
		});

		test('API request hits correct endpoint', async () => {
			await runCliJson(['tasks']);
			const tasksReq = mockServer.requests.find(r => /\/api\/workspaces\/[^/]+\/board/.test(r.path) && r.method === 'GET');
			expect(tasksReq).toBeDefined();
		});
	});

	// ─── CLI: create ─────────────────────────────────────────────────────

	describe('CLI: create', () => {
		test('creates a task via mock server', async () => {
			const result = await runCliJson(['create', '--title', 'New E2E Task', '--description', 'Test description']);
			expect(result.exitCode).toBe(0);
			expect(result.json).toBeDefined();
			expect(result.json.task).toBeDefined();
			expect(result.json.task.title).toBe('New E2E Task');
		});

		test('create sends correct payload to API', async () => {
			await runCliJson(['create', '--title', 'Payload Test', '--status', 'todo', '--complexity', 'high']);
			const createReq = mockServer.requests.find(r => r.path === '/api/tasks' && r.method === 'POST');
			expect(createReq).toBeDefined();
			expect(createReq.body.scope).toBe('default');
			expect(createReq.body.workspaceId).toBe('mock-workspace-id');
			expect(createReq.body.title).toBe('Payload Test');
			expect(createReq.body.status).toBe('todo');
			expect(createReq.body.complexity).toBe('high');
		});

		test('create --dry-run does not hit API', async () => {
			const result = await runCliJson(['create', '--title', 'Dry Run Task', '--dry-run']);
			expect(result.exitCode).toBe(0);
			// Dry-run should not create an API request to create tasks
			const createReq = mockServer.requests.find(r => r.method === 'POST' && r.path.includes('/tasks'));
			expect(createReq).toBeUndefined();
		});

		test('create rejects missing title', async () => {
			const result = await runCli(['create']);
			expect(result.exitCode).not.toBe(0);
		});
	});

	describe('CLI: handoff', () => {
		test('creates a stack task and launches a Lightsprint managed session', async () => {
			const result = await runCliJson([
				'handoff',
				'create',
				'--task',
				'Fix the flaky authentication test',
				'--context',
				'Failure is isolated to session.test.ts',
				'--no-diff',
			]);

			expect(result.exitCode).toBe(0);
			expect(result.json.task.title).toBe('Fix the flaky authentication test');
			expect(result.json.context.repo).toBe(REPO_KEY);
			expect(result.json.context.stack.id).toBe('stk_1');
			expect(result.json.context.stack.selection).toBe('repository-match');
			expect(result.json.taskUrl).toContain('/workspaces/mock-workspace-id/tasks/ENG-');
			expect(result.json.agent.id).toBe('session-handoff-1');
			expect(result.json.agent.sessionUrl).toContain('/agent-sessions/session-handoff-1');

			const createReq = mockServer.requests.find(r => r.path === '/api/tasks' && r.method === 'POST');
			expect(createReq.body.scope).toBe('stack');
			expect(createReq.body.stackId).toBe('stk_1');
			expect(createReq.body.description).toContain(`Repository: ${REPO_KEY}`);
			expect(createReq.body.description).toContain('Failure is isolated to session.test.ts');
			expect(createReq.body.idempotencyKey).toMatch(/^handoff:[a-f0-9]{32}$/);

			const launchReq = mockServer.requests.find(r => /\/cloud-agents\/lightsprint$/.test(r.path) && r.method === 'POST');
			expect(launchReq).toBeDefined();
		});

		test('poll accepts a session URL and returns the PR when idle', async () => {
			const result = await runCliJson([
				'handoff',
				'poll',
				`http://localhost:${mockServer.port}/agent-sessions/session-handoff-1`,
				'--once',
			]);

			expect(result.exitCode).toBe(0);
			expect(result.json.terminal).toBe(true);
			expect(result.json.status.sessionStatus).toBe('idle');
			expect(result.json.status.prUrl).toContain('/pull/123');
		});
	});

	// ─── CLI: get ────────────────────────────────────────────────────────

	describe('CLI: stacks', () => {
		test('lists stacks from mock server', async () => {
			const result = await runCliJson(['stacks']);
			if (result.exitCode !== 0) {
				console.error('CLI stacks --output json failed:', { stderr: result.stderr, stdout: result.stdout });
			}
			expect(result.exitCode).toBe(0);
			expect(result.json).toBeDefined();
			expect(result.json.stacks).toBeArray();
			expect(result.json.stacks.length).toBe(1);
			expect(result.json.stacks[0].id).toBe('stk_1');
			expect(result.json.stacks[0].taskPrefix).toBe('ENG');
			// The CLI sources repoIds from the server's memberRepoIds field, so the
			// member repo count must come through (1 repo).
			expect(result.json.stacks[0].repoIds).toEqual(['r1']);
		});

		test('stacks get resolves ENG prefix to stk_1 and returns detail', async () => {
			const result = await runCliJson(['stacks', 'get', 'ENG']);
			expect(result.exitCode).toBe(0);
			expect(result.json).toBeDefined();
			// resolveStackId matches the ENG prefix to stk_1, so the detail request
			// targets /api/workspaces/:wsId/stacks/stk_1.
			const detailReq = mockServer.requests.find(r => r.method === 'GET' && /\/stacks\/stk_1$/.test(r.path));
			expect(detailReq).toBeDefined();
			const stack = result.json.stack || result.json;
			expect(stack.id).toBe('stk_1');
			// The server returns resolved repos under memberRepos; the CLI renders
			// these (fullName) for the human view.
			expect(result.json.memberRepos).toBeArray();
			expect(result.json.memberRepos.length).toBe(1);
			expect(result.json.memberRepos[0].fullName).toBe('SprintsAI/core');
		});
	});

	describe('CLI: get', () => {
		test('gets a task by ID', async () => {
			const result = await runCliJson(['get', '--task', 'task-1']);
			expect(result.exitCode).toBe(0);
			expect(result.json.task).toBeDefined();
			expect(result.json.task.title).toBe('E2E Test Task 1');
		});

		test('get returns error for nonexistent task', async () => {
			const result = await runCli(['get', '--task', 'nonexistent-id']);
			expect(result.exitCode).not.toBe(0);
		});

		test('get in text mode shows task details', async () => {
			const result = await runCli(['get', '--task', 'task-1']);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain('E2E Test Task 1');
			expect(result.stdout).toContain('todo');
		});
	});

	// ─── CLI: update ─────────────────────────────────────────────────────

	describe('CLI: update', () => {
		test('updates task status', async () => {
			const result = await runCliJson(['update', '--task', 'task-1', '--status', 'in_progress']);
			expect(result.exitCode).toBe(0);
			const patchReq = mockServer.requests.find(r => r.method === 'PATCH' && r.path.includes('task-1'));
			expect(patchReq).toBeDefined();
			expect(patchReq.body.status).toBe('in_progress');
		});

		test('updates task title', async () => {
			const result = await runCliJson(['update', '--task', 'task-2', '--title', 'Updated Title']);
			expect(result.exitCode).toBe(0);
			const patchReq = mockServer.requests.find(r => r.method === 'PATCH' && r.path.includes('task-2'));
			expect(patchReq).toBeDefined();
			expect(patchReq.body.title).toBe('Updated Title');
		});

		test('update --dry-run does not hit API', async () => {
			const result = await runCliJson(['update', '--task', 'task-1', '--status', 'done', '--dry-run']);
			expect(result.exitCode).toBe(0);
			const patchReq = mockServer.requests.find(r => r.method === 'PATCH');
			expect(patchReq).toBeUndefined();
		});

		test('update rejects invalid status', async () => {
			const result = await runCli(['update', '--task', 'task-1', '--status', 'invalid_status']);
			expect(result.exitCode).not.toBe(0);
		});

		test('update adds dependency', async () => {
			const result = await runCliJson(['update', '--task', 'task-1', '--add-dep', 'task-2']);
			expect(result.exitCode).toBe(0);
			const depReq = mockServer.requests.find(r => r.method === 'POST' && r.path.includes('/dependencies'));
			expect(depReq).toBeDefined();
			expect(depReq.body.dependsOnTaskId).toBe('task-2');
		});

		test('update removes dependency', async () => {
			const result = await runCliJson(['update', '--task', 'task-1', '--remove-dep', 'task-2']);
			expect(result.exitCode).toBe(0);
			const depReq = mockServer.requests.find(r => r.method === 'DELETE' && r.path.includes('/dependencies'));
			expect(depReq).toBeDefined();
		});
	});

	// ─── CLI: claim ──────────────────────────────────────────────────────

	describe('CLI: claim', () => {
		test('claims a task', async () => {
			const result = await runCliJson(['claim', '--task', 'task-1']);
			expect(result.exitCode).toBe(0);
			const claimReq = mockServer.requests.find(r => r.method === 'POST' && r.path.includes('/claim'));
			expect(claimReq).toBeDefined();
		});

		test('claim sets task to in_progress', async () => {
			const result = await runCliJson(['claim', '--task', 'task-2']);
			expect(result.exitCode).toBe(0);
			expect(result.json.task.status).toBe('in_progress');
		});

		test('claim --dry-run does not hit API', async () => {
			const result = await runCliJson(['claim', '--task', 'task-1', '--dry-run']);
			expect(result.exitCode).toBe(0);
			const claimReq = mockServer.requests.find(r => r.method === 'POST' && r.path.includes('/claim'));
			expect(claimReq).toBeUndefined();
		});

		test('claim rejects invalid task ID', async () => {
			const result = await runCli(['claim', '--task', 'bad?id&chars']);
			expect(result.exitCode).not.toBe(0);
		});
	});

	// ─── CLI: comment ────────────────────────────────────────────────────

	describe('CLI: comment', () => {
		test('adds a comment to a task', async () => {
			const result = await runCliJson(['comment', '--task', 'task-1', '--body', 'Test comment body']);
			expect(result.exitCode).toBe(0);
			const commentReq = mockServer.requests.find(r => r.method === 'POST' && r.path.includes('/comments'));
			expect(commentReq).toBeDefined();
			expect(commentReq.body.body).toBe('Test comment body');
		});

		test('comment --dry-run does not hit API', async () => {
			const result = await runCliJson(['comment', '--task', 'task-1', '--body', 'Dry run', '--dry-run']);
			expect(result.exitCode).toBe(0);
			const commentReq = mockServer.requests.find(r => r.method === 'POST' && r.path.includes('/comments'));
			expect(commentReq).toBeUndefined();
		});
	});

	// ─── CLI: whoami ─────────────────────────────────────────────────────

	describe('CLI: whoami', () => {
		test('shows connection info', async () => {
			const result = await runCli(['whoami']);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain('mock-workspace-id');
			expect(result.stdout).toContain('Mock Workspace');
		});
	});
});

// ─── Session Lifecycle Tests ─────────────────────────────────────────────────
// These tests spawn the daemon process directly (not through cc-start) so they
// work on both main branch and current branch regardless of cc-start spawn logic.

describe('E2E: Session Lifecycle', () => {
	let mockPort;
	let mockWsMessages;
	let mockHttpServer;
	let wsConnections;

	beforeAll(() => {
		// Create mock server with WebSocket support
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

				// Task endpoints for task sync (workspace-scoped global create)
				if (url.pathname === '/api/tasks' && req.method === 'POST') {
					const body = await req.json().catch(() => ({}));
					return Response.json({
						task: {
							id: 'created-task-' + randomBytes(4).toString('hex'),
							title: body.title || '',
							status: body.status || 'backlog',
							workspaceId: body.workspaceId || 'mock-workspace-id',
						}
					}, { status: 201 });
				}

				if (url.pathname.match(/\/api\/tasks\/.*\/dependencies/) && req.method === 'POST') {
					return Response.json({ ok: true });
				}

				if (url.pathname.match(/\/api\/tasks\//) && req.method === 'PATCH') {
					return Response.json({ task: { id: 'patched', status: 'done' } });
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

	/**
	 * Helper: spawn a daemon process directly with controlled env vars.
	 * Returns { daemonProc, credsPath } — caller must clean up.
	 */
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
				LS_WORKSPACE_ID: 'mock-workspace-id',
				LS_SESSION_ID: sessionId,
				LS_CWD: process.cwd(),
				LS_CC_PID: String(ccPid),
				LS_GIT_BRANCH: opts.gitBranch || 'main',
			},
		});
		daemonProc.unref();
		return { daemonProc, credsPath };
	}

	/**
	 * Helper: wait for a WS message matching a predicate, with timeout.
	 */
	async function waitForWsMessage(predicate, timeoutMs = 8000) {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const msg = mockWsMessages.find(predicate);
			if (msg) return msg;
			await new Promise(r => setTimeout(r, 200));
		}
		return null;
	}

	/**
	 * Helper: read session state, retrying briefly if not yet written.
	 */
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

	// ─── Session Start ───────────────────────────────────────────────────

	describe('Session Start', () => {
		test('daemon connects to mock WS and sends session:start', async () => {
			const testSessionId = `e2e-start-${randomBytes(8).toString('hex')}`;
			const dummyProc = Bun.spawn(['sleep', '300'], { stdout: 'ignore', stderr: 'ignore' });
			let daemonPid;

			try {
				// Spawn daemon — if it doesn't connect within 10s, kill and retry once.
				// CI runners occasionally have slow process starts on the first spawn.
				let sessionStart = null;
				for (let attempt = 0; attempt < 2 && !sessionStart; attempt++) {
					if (attempt > 0) {
						mockWsMessages.length = 0;
						cleanupTestSessions('e2e-start-');
					}
					const { daemonProc } = spawnDaemon(testSessionId, dummyProc.pid);
					daemonPid = daemonProc.pid;
					sessionStart = await waitForWsMessage(m => m.type === 'session:start', 10000);
					if (!sessionStart) {
						try { process.kill(daemonPid, 'SIGTERM'); } catch {}
					}
				}

				expect(sessionStart).not.toBeNull();
				expect(sessionStart.data.ccSessionId).toBe(testSessionId);

				// Verify session state file was created
				const state = await waitForSessionState(testSessionId);
				expect(state).not.toBeNull();
				expect(state.port).toBeGreaterThan(0);
				expect(state.daemonPid).toBeGreaterThan(0);
				expect(state.ccSessionId).toBe(testSessionId);
			} finally {
				try { process.kill(daemonPid, 'SIGTERM'); } catch {}
				dummyProc.kill();
				await dummyProc.exited;
				cleanupTestSessions('e2e-start-');
			}
		}, 25000);

		test('session:start message includes gitBranch and machineId', async () => {
			const testSessionId = `e2e-startmeta-${randomBytes(8).toString('hex')}`;
			const dummyProc = Bun.spawn(['sleep', '300'], { stdout: 'ignore', stderr: 'ignore' });
			let daemonPid;

			try {
				const { daemonProc } = spawnDaemon(testSessionId, dummyProc.pid, { gitBranch: 'feature/test-branch' });
				daemonPid = daemonProc.pid;

				const sessionStart = await waitForWsMessage(m => m.type === 'session:start');
				expect(sessionStart).not.toBeNull();
				expect(sessionStart.data.gitBranch).toBe('feature/test-branch');
				expect(sessionStart.data.machineId).toBeDefined();
				expect(typeof sessionStart.data.machineId).toBe('string');
				expect(sessionStart.data.machineId.length).toBeGreaterThan(0);
			} finally {
				try { process.kill(daemonPid, 'SIGTERM'); } catch {}
				dummyProc.kill();
				await dummyProc.exited;
				cleanupTestSessions('e2e-startmeta-');
			}
		}, 15000);

		test('session state file includes lsSessionId after WS ack', async () => {
			const testSessionId = `e2e-startls-${randomBytes(8).toString('hex')}`;
			const dummyProc = Bun.spawn(['sleep', '300'], { stdout: 'ignore', stderr: 'ignore' });
			let daemonPid;

			try {
				const { daemonProc } = spawnDaemon(testSessionId, dummyProc.pid);
				daemonPid = daemonProc.pid;

				// Wait for session:start and ack
				await waitForWsMessage(m => m.type === 'session:start');
				const state = await waitForSessionState(testSessionId);
				expect(state).not.toBeNull();

				// lsSessionId is initially null in state file, then updated after ack.
				// Poll until lsSessionId appears (daemon writes it after receiving ack).
				const stateFile = join(SESSIONS_DIR, `${testSessionId}.json`);
				const deadline = Date.now() + 5000;
				let updatedState = null;
				while (Date.now() < deadline) {
					try {
						updatedState = JSON.parse(readFileSync(stateFile, 'utf-8'));
						if (updatedState.lsSessionId) break;
					} catch {}
					await new Promise(r => setTimeout(r, 200));
				}

				expect(updatedState).not.toBeNull();
				expect(updatedState.lsSessionId).toBeDefined();
				expect(updatedState.lsSessionId).toMatch(/^mock-ls-session-/);
			} finally {
				try { process.kill(daemonPid, 'SIGTERM'); } catch {}
				dummyProc.kill();
				await dummyProc.exited;
				cleanupTestSessions('e2e-startls-');
			}
		}, 15000);

		test('session state file includes daemonToken for auth', async () => {
			const testSessionId = `e2e-starttoken-${randomBytes(8).toString('hex')}`;
			const dummyProc = Bun.spawn(['sleep', '300'], { stdout: 'ignore', stderr: 'ignore' });
			let daemonPid;

			try {
				const { daemonProc } = spawnDaemon(testSessionId, dummyProc.pid);
				daemonPid = daemonProc.pid;

				await waitForWsMessage(m => m.type === 'session:start');
				const state = await waitForSessionState(testSessionId);
				expect(state).not.toBeNull();
				expect(state.daemonToken).toBeDefined();
				expect(typeof state.daemonToken).toBe('string');
				expect(state.daemonToken.length).toBe(64); // 32 random bytes → 64 hex chars
			} finally {
				try { process.kill(daemonPid, 'SIGTERM'); } catch {}
				dummyProc.kill();
				await dummyProc.exited;
				cleanupTestSessions('e2e-starttoken-');
			}
		}, 15000);
	});

	// ─── Session End ─────────────────────────────────────────────────────

	describe('Session End', () => {
		/** Poll until a process is no longer alive (max 5s). */
		async function waitForProcessExit(pid, timeoutMs = 5000) {
			const deadline = Date.now() + timeoutMs;
			while (Date.now() < deadline) {
				try { process.kill(pid, 0); } catch { return; }
				await new Promise(r => setTimeout(r, 200));
			}
		}

		test('session-end endpoint triggers shutdown and cleanup', async () => {
			const testSessionId = `e2e-end-${randomBytes(8).toString('hex')}`;
			const dummyProc = Bun.spawn(['sleep', '300'], { stdout: 'ignore', stderr: 'ignore' });
			let daemonPid;

			try {
				const { daemonProc } = spawnDaemon(testSessionId, dummyProc.pid);
				daemonPid = daemonProc.pid;

				// Wait for daemon to connect
				await waitForWsMessage(m => m.type === 'session:start');

				const state = await waitForSessionState(testSessionId);
				expect(state).not.toBeNull();

				// Send session end via HTTP (same as cc-end.js does)
				mockWsMessages.length = 0;
				await fetch(`http://127.0.0.1:${state.port}/session-end`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						...(state.daemonToken ? { 'Authorization': `Bearer ${state.daemonToken}` } : {}),
					},
					body: JSON.stringify({}),
					signal: AbortSignal.timeout(3000),
				});

				// Wait for session:end on WS
				const sessionEnd = await waitForWsMessage(m => m.type === 'session:end', 5000);
				expect(sessionEnd).not.toBeNull();

				// Wait for daemon to exit
				await waitForProcessExit(state.daemonPid);

				// Verify session state file was cleaned up
				const stateFile = join(SESSIONS_DIR, `${testSessionId}.json`);
				expect(existsSync(stateFile)).toBe(false);

				// Verify daemon process is dead
				expect(() => process.kill(state.daemonPid, 0)).toThrow();
			} finally {
				try { process.kill(daemonPid, 'SIGTERM'); } catch {}
				dummyProc.kill();
				await dummyProc.exited;
				cleanupTestSessions('e2e-end-');
			}
		}, 20000);

		test('session:end message has status completed on normal shutdown', async () => {
			const testSessionId = `e2e-endstatus-${randomBytes(8).toString('hex')}`;
			const dummyProc = Bun.spawn(['sleep', '300'], { stdout: 'ignore', stderr: 'ignore' });
			let daemonPid;

			try {
				const { daemonProc } = spawnDaemon(testSessionId, dummyProc.pid);
				daemonPid = daemonProc.pid;

				await waitForWsMessage(m => m.type === 'session:start');
				const state = await waitForSessionState(testSessionId);
				expect(state).not.toBeNull();

				mockWsMessages.length = 0;
				await fetch(`http://127.0.0.1:${state.port}/session-end`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						...(state.daemonToken ? { 'Authorization': `Bearer ${state.daemonToken}` } : {}),
					},
					body: JSON.stringify({}),
					signal: AbortSignal.timeout(3000),
				});

				const sessionEnd = await waitForWsMessage(m => m.type === 'session:end', 5000);
				expect(sessionEnd).not.toBeNull();
				expect(sessionEnd.data.status).toBe('completed');

				await waitForProcessExit(state.daemonPid);
			} finally {
				try { process.kill(daemonPid, 'SIGTERM'); } catch {}
				dummyProc.kill();
				await dummyProc.exited;
				cleanupTestSessions('e2e-endstatus-');
			}
		}, 20000);

		test('SIGTERM triggers graceful shutdown with session:end', async () => {
			const testSessionId = `e2e-sigterm-${randomBytes(8).toString('hex')}`;
			const dummyProc = Bun.spawn(['sleep', '300'], { stdout: 'ignore', stderr: 'ignore' });
			let daemonPid;

			try {
				const { daemonProc } = spawnDaemon(testSessionId, dummyProc.pid);
				daemonPid = daemonProc.pid;

				await waitForWsMessage(m => m.type === 'session:start');
				const state = await waitForSessionState(testSessionId);
				expect(state).not.toBeNull();

				mockWsMessages.length = 0;

				// Send SIGTERM directly to daemon process
				process.kill(state.daemonPid, 'SIGTERM');

				// Should send session:end before exiting
				const sessionEnd = await waitForWsMessage(m => m.type === 'session:end', 5000);
				expect(sessionEnd).not.toBeNull();

				// Wait for cleanup
				await waitForProcessExit(state.daemonPid);

				// Verify daemon is dead
				expect(() => process.kill(state.daemonPid, 0)).toThrow();

				// Verify session state cleaned up
				const stateFile = join(SESSIONS_DIR, `${testSessionId}.json`);
				expect(existsSync(stateFile)).toBe(false);
			} finally {
				try { process.kill(daemonPid, 'SIGTERM'); } catch {}
				dummyProc.kill();
				await dummyProc.exited;
				cleanupTestSessions('e2e-sigterm-');
			}
		}, 15000);
	});

	// ─── HTTP Auth & Error Handling ─────────────────────────────────────

	describe('HTTP Auth & Error Handling', () => {
		test('mutating endpoints reject requests without auth token', async () => {
			const testSessionId = `e2e-noauth-${randomBytes(8).toString('hex')}`;
			const dummyProc = Bun.spawn(['sleep', '300'], { stdout: 'ignore', stderr: 'ignore' });
			let daemonPid;

			try {
				const { daemonProc } = spawnDaemon(testSessionId, dummyProc.pid);
				daemonPid = daemonProc.pid;

				await waitForWsMessage(m => m.type === 'session:start');
				const state = await waitForSessionState(testSessionId);
				expect(state).not.toBeNull();

				// /event without auth → 401
				const eventRes = await fetch(`http://127.0.0.1:${state.port}/event`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ eventType: 'Test', payload: {} }),
					signal: AbortSignal.timeout(2000),
				});
				expect(eventRes.status).toBe(401);

				// /session-end without auth → 401
				const endRes = await fetch(`http://127.0.0.1:${state.port}/session-end`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({}),
					signal: AbortSignal.timeout(2000),
				});
				expect(endRes.status).toBe(401);
			} finally {
				try { process.kill(daemonPid, 'SIGTERM'); } catch {}
				dummyProc.kill();
				await dummyProc.exited;
				cleanupTestSessions('e2e-noauth-');
			}
		}, 15000);

		test('mutating endpoints reject requests with wrong auth token', async () => {
			const testSessionId = `e2e-badauth-${randomBytes(8).toString('hex')}`;
			const dummyProc = Bun.spawn(['sleep', '300'], { stdout: 'ignore', stderr: 'ignore' });
			let daemonPid;

			try {
				const { daemonProc } = spawnDaemon(testSessionId, dummyProc.pid);
				daemonPid = daemonProc.pid;

				await waitForWsMessage(m => m.type === 'session:start');
				const state = await waitForSessionState(testSessionId);
				expect(state).not.toBeNull();

				const res = await fetch(`http://127.0.0.1:${state.port}/event`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Authorization': 'Bearer wrong-token-value',
					},
					body: JSON.stringify({ eventType: 'Test', payload: {} }),
					signal: AbortSignal.timeout(2000),
				});
				expect(res.status).toBe(401);
				const body = await res.json();
				expect(body.error).toBe('Unauthorized');
			} finally {
				try { process.kill(daemonPid, 'SIGTERM'); } catch {}
				dummyProc.kill();
				await dummyProc.exited;
				cleanupTestSessions('e2e-badauth-');
			}
		}, 15000);

		test('health endpoint is accessible without auth', async () => {
			const testSessionId = `e2e-healthnoauth-${randomBytes(8).toString('hex')}`;
			const dummyProc = Bun.spawn(['sleep', '300'], { stdout: 'ignore', stderr: 'ignore' });
			let daemonPid;

			try {
				const { daemonProc } = spawnDaemon(testSessionId, dummyProc.pid);
				daemonPid = daemonProc.pid;

				await waitForWsMessage(m => m.type === 'session:start');
				const state = await waitForSessionState(testSessionId);
				expect(state).not.toBeNull();

				// No Authorization header
				const resp = await fetch(`http://127.0.0.1:${state.port}/health`, {
					signal: AbortSignal.timeout(2000),
				});
				expect(resp.status).toBe(200);
				const health = await resp.json();
				expect(health.ok).toBe(true);
				expect(health.sessionId).toBeDefined();
			} finally {
				try { process.kill(daemonPid, 'SIGTERM'); } catch {}
				dummyProc.kill();
				await dummyProc.exited;
				cleanupTestSessions('e2e-healthnoauth-');
			}
		}, 15000);

		test('unknown endpoint returns 404', async () => {
			const testSessionId = `e2e-404-${randomBytes(8).toString('hex')}`;
			const dummyProc = Bun.spawn(['sleep', '300'], { stdout: 'ignore', stderr: 'ignore' });
			let daemonPid;

			try {
				const { daemonProc } = spawnDaemon(testSessionId, dummyProc.pid);
				daemonPid = daemonProc.pid;

				await waitForWsMessage(m => m.type === 'session:start');
				const state = await waitForSessionState(testSessionId);
				expect(state).not.toBeNull();

				const resp = await fetch(`http://127.0.0.1:${state.port}/nonexistent`, {
					headers: {
						...(state.daemonToken ? { 'Authorization': `Bearer ${state.daemonToken}` } : {}),
					},
					signal: AbortSignal.timeout(2000),
				});
				expect(resp.status).toBe(404);
			} finally {
				try { process.kill(daemonPid, 'SIGTERM'); } catch {}
				dummyProc.kill();
				await dummyProc.exited;
				cleanupTestSessions('e2e-404-');
			}
		}, 15000);

		test('/event with invalid JSON returns 400', async () => {
			const testSessionId = `e2e-badjson-${randomBytes(8).toString('hex')}`;
			const dummyProc = Bun.spawn(['sleep', '300'], { stdout: 'ignore', stderr: 'ignore' });
			let daemonPid;

			try {
				const { daemonProc } = spawnDaemon(testSessionId, dummyProc.pid);
				daemonPid = daemonProc.pid;

				await waitForWsMessage(m => m.type === 'session:start');
				const state = await waitForSessionState(testSessionId);
				expect(state).not.toBeNull();

				const resp = await fetch(`http://127.0.0.1:${state.port}/event`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						...(state.daemonToken ? { 'Authorization': `Bearer ${state.daemonToken}` } : {}),
					},
					body: 'not valid json {{{{',
					signal: AbortSignal.timeout(2000),
				});
				expect(resp.status).toBe(400);
			} finally {
				try { process.kill(daemonPid, 'SIGTERM'); } catch {}
				dummyProc.kill();
				await dummyProc.exited;
				cleanupTestSessions('e2e-badjson-');
			}
		}, 15000);
	});

	// ─── Event Forwarding ────────────────────────────────────────────────

	describe('Event Forwarding', () => {
		test('events posted to daemon are forwarded to WS', async () => {
			const testSessionId = `e2e-event-${randomBytes(8).toString('hex')}`;
			const dummyProc = Bun.spawn(['sleep', '300'], { stdout: 'ignore', stderr: 'ignore' });
			let daemonPid;

			try {
				const { daemonProc } = spawnDaemon(testSessionId, dummyProc.pid);
				daemonPid = daemonProc.pid;

				// Wait for daemon to connect
				await waitForWsMessage(m => m.type === 'session:start');
				const state = await waitForSessionState(testSessionId);
				expect(state).not.toBeNull();

				// Clear messages after session:start
				mockWsMessages.length = 0;

				// Send an event directly to daemon HTTP (same as cc-event.js does)
				await fetch(`http://127.0.0.1:${state.port}/event`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						...(state.daemonToken ? { 'Authorization': `Bearer ${state.daemonToken}` } : {}),
					},
					body: JSON.stringify({
						eventType: 'UserPromptSubmit',
						payload: {
							hook_event_name: 'UserPromptSubmit',
							prompt: 'test prompt',
						},
					}),
					signal: AbortSignal.timeout(3000),
				});

				// Wait for event to be forwarded to WS
				const eventsMsg = await waitForWsMessage(m => m.type === 'events', 3000);
				expect(eventsMsg).not.toBeNull();
			} finally {
				try { process.kill(daemonPid, 'SIGTERM'); } catch {}
				dummyProc.kill();
				await dummyProc.exited;
				cleanupTestSessions('e2e-event-');
			}
		}, 15000);

		test('multiple events are each forwarded to WS independently', async () => {
			const testSessionId = `e2e-multievt-${randomBytes(8).toString('hex')}`;
			const dummyProc = Bun.spawn(['sleep', '300'], { stdout: 'ignore', stderr: 'ignore' });
			let daemonPid;

			try {
				const { daemonProc } = spawnDaemon(testSessionId, dummyProc.pid);
				daemonPid = daemonProc.pid;

				await waitForWsMessage(m => m.type === 'session:start');
				const state = await waitForSessionState(testSessionId);
				expect(state).not.toBeNull();

				mockWsMessages.length = 0;

				const headers = {
					'Content-Type': 'application/json',
					...(state.daemonToken ? { 'Authorization': `Bearer ${state.daemonToken}` } : {}),
				};

				// Send three distinct events
				for (const eventType of ['PreToolUse', 'PostToolUse', 'UserPromptSubmit']) {
					await fetch(`http://127.0.0.1:${state.port}/event`, {
						method: 'POST',
						headers,
						body: JSON.stringify({
							eventType,
							payload: { hook_event_name: eventType, marker: eventType },
						}),
						signal: AbortSignal.timeout(3000),
					});
				}

				// Wait for all three to arrive
				const deadline = Date.now() + 5000;
				while (Date.now() < deadline) {
					const eventsMsgs = mockWsMessages.filter(m => m.type === 'events');
					if (eventsMsgs.length >= 3) break;
					await new Promise(r => setTimeout(r, 200));
				}

				const eventsMsgs = mockWsMessages.filter(m => m.type === 'events');
				expect(eventsMsgs.length).toBeGreaterThanOrEqual(3);
			} finally {
				try { process.kill(daemonPid, 'SIGTERM'); } catch {}
				dummyProc.kill();
				await dummyProc.exited;
				cleanupTestSessions('e2e-multievt-');
			}
		}, 15000);

		test('event endpoint returns ok:true on success', async () => {
			const testSessionId = `e2e-evtresp-${randomBytes(8).toString('hex')}`;
			const dummyProc = Bun.spawn(['sleep', '300'], { stdout: 'ignore', stderr: 'ignore' });
			let daemonPid;

			try {
				const { daemonProc } = spawnDaemon(testSessionId, dummyProc.pid);
				daemonPid = daemonProc.pid;

				await waitForWsMessage(m => m.type === 'session:start');
				const state = await waitForSessionState(testSessionId);
				expect(state).not.toBeNull();

				const resp = await fetch(`http://127.0.0.1:${state.port}/event`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						...(state.daemonToken ? { 'Authorization': `Bearer ${state.daemonToken}` } : {}),
					},
					body: JSON.stringify({
						eventType: 'PreToolUse',
						payload: { hook_event_name: 'PreToolUse', tool_name: 'Read' },
					}),
					signal: AbortSignal.timeout(3000),
				});
				expect(resp.status).toBe(200);
				const body = await resp.json();
				expect(body.ok).toBe(true);
			} finally {
				try { process.kill(daemonPid, 'SIGTERM'); } catch {}
				dummyProc.kill();
				await dummyProc.exited;
				cleanupTestSessions('e2e-evtresp-');
			}
		}, 15000);
	});

	// ─── Daemon Survives CC Kill ─────────────────────────────────────────

	describe('CC Process Death', () => {
		test('daemon detects dead CC PID and shuts down gracefully', async () => {
			const testSessionId = `e2e-cckill-${randomBytes(8).toString('hex')}`;

			// Spawn a dummy "CC process" that we can kill
			const dummyProc = Bun.spawn(['sleep', '300'], { stdout: 'ignore', stderr: 'ignore' });
			const dummyPid = dummyProc.pid;

			try {
				spawnDaemon(testSessionId, dummyPid);

				// Wait for daemon to connect
				const sessionStart = await waitForWsMessage(m => m.type === 'session:start');
				expect(sessionStart).toBeDefined();

				const state = await waitForSessionState(testSessionId);
				expect(state).not.toBeNull();

				// Kill the "CC process"
				mockWsMessages.length = 0;
				dummyProc.kill();
				await dummyProc.exited;

				// Wait for watchdog to detect death (polls every 5s) and send session:end
				const sessionEnd = await waitForWsMessage(m => m.type === 'session:end', 12000);
				expect(sessionEnd).toBeDefined();
				expect(sessionEnd.data.status).toBe('errored');

				// Wait for cleanup
				await new Promise(r => setTimeout(r, 1000));

				// Verify daemon is dead
				let isAlive = true;
				try { process.kill(state.daemonPid, 0); } catch { isAlive = false; }
				expect(isAlive).toBe(false);
			} finally {
				try { dummyProc.kill(); } catch {}
				cleanupTestSessions('e2e-cckill-');
			}
		}, 25000);
	});

	// ─── Stale Session Recovery ──────────────────────────────────────────

	describe('Stale Session Recovery', () => {
		test('new daemon starts successfully despite stale session files', async () => {
			const staleSessionId = `e2e-stale-${randomBytes(8).toString('hex')}`;
			const freshSessionId = `e2e-fresh-${randomBytes(8).toString('hex')}`;
			const dummyProc = Bun.spawn(['sleep', '300'], { stdout: 'ignore', stderr: 'ignore' });

			try {
				// Create a stale session file with dead PID
				mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
				writeFileSync(
					join(SESSIONS_DIR, `${staleSessionId}.json`),
					JSON.stringify({
						port: 99999,
						daemonPid: 999999, // dead
						ccPid: 999998,
						ccSessionId: staleSessionId,
						lsSessionId: null,
						workspaceId: 'mock-workspace-id',
					}),
					{ mode: 0o600 }
				);

				// Start a fresh daemon
				spawnDaemon(freshSessionId, dummyProc.pid);

				// Wait for connection
				const freshStart = await waitForWsMessage(
					m => m.type === 'session:start' && m.data.ccSessionId === freshSessionId
				);
				expect(freshStart).toBeDefined();

				// Fresh session state should be valid
				const freshState = await waitForSessionState(freshSessionId);
				expect(freshState).not.toBeNull();
				expect(freshState.port).toBeGreaterThan(0);

				// Clean up
				try { process.kill(freshState.daemonPid, 'SIGTERM'); } catch {}
			} finally {
				dummyProc.kill();
				await dummyProc.exited;
				cleanupTestSessions('e2e-stale-');
				cleanupTestSessions('e2e-fresh-');
			}
		}, 15000);
	});

	// ─── Daemon Health Check ─────────────────────────────────────────────

	describe('Daemon Health', () => {
		test('daemon health endpoint responds', async () => {
			const testSessionId = `e2e-health-${randomBytes(8).toString('hex')}`;
			const dummyProc = Bun.spawn(['sleep', '300'], { stdout: 'ignore', stderr: 'ignore' });

			try {
				spawnDaemon(testSessionId, dummyProc.pid);

				// Wait for daemon to be ready
				await waitForWsMessage(m => m.type === 'session:start');
				const state = await waitForSessionState(testSessionId);
				expect(state).not.toBeNull();

				// Hit health endpoint
				const resp = await fetch(`http://127.0.0.1:${state.port}/health`, {
					signal: AbortSignal.timeout(2000),
				});
				expect(resp.status).toBe(200);
				const health = await resp.json();
				expect(health.ok).toBe(true);

				// Clean up
				try { process.kill(state.daemonPid, 'SIGTERM'); } catch {}
			} finally {
				dummyProc.kill();
				await dummyProc.exited;
				cleanupTestSessions('e2e-health-');
			}
		}, 15000);
	});

});
