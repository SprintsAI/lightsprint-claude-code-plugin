#!/usr/bin/env node
/**
 * ls-cli.js — CLI for Lightsprint skills.
 *
 * Commands:
 *   tasks [--status todo|in_progress|in_review|done] [--limit N]
 *   create <title> [--description <text>] [--complexity <level>] [--status <status>]
 *   update <taskId> [--title <text>] [--description <text>] [--status <status>] [--complexity <level>] [--assignee <name>]
 *   get <taskId>
 *   claim <taskId>
 *   kanban
 *   comment <taskId> <body>
 *   whoami
 */

import { apiRequest, getProjectId, getProjectInfo } from './lib/client.js';
import { setMapping } from './lib/task-map.js';
import { lsToCcStatus } from './lib/status-mapper.js';
import { authenticate } from './lib/auth.js';

const [,, command, ...args] = process.argv;

async function main() {
	switch (command) {
		case 'tasks': return await cmdTasks(args);
		case 'create': return await cmdCreate(args);
		case 'update': return await cmdUpdate(args);
		case 'get': return await cmdGet(args);
		case 'claim': return await cmdClaim(args);
		case 'kanban': return await cmdKanban();
		case 'comment': return await cmdComment(args);
		case 'whoami': return await cmdWhoami();
		case 'connect': return await cmdConnect();
		default:
			console.log('Usage: ls-cli.js <command> [args]');
			console.log('Commands: tasks, create, update, get, claim, kanban, comment, whoami, connect');
			process.exit(1);
	}
}

// ─── tasks ───────────────────────────────────────────────────────────────

async function cmdTasks(args) {
	const projectId = await getProjectId();
	const params = new URLSearchParams();

	// Parse args
	let status = null;
	let limit = 20;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--status' && args[i + 1]) {
			status = args[++i];
		} else if (args[i] === '--limit' && args[i + 1]) {
			limit = parseInt(args[++i], 10);
		}
	}

	if (status) params.set('columnName', statusToColumnName(status));
	params.set('limit', String(limit));

	const data = await apiRequest(`/api/projects/${projectId}/tasks?${params}`);
	const tasks = data.tasks || [];

	if (tasks.length === 0) {
		console.log('No tasks found.');
		return;
	}

	console.log(`Found ${tasks.length} task(s)${data.totalCount > tasks.length ? ` of ${data.totalCount} total` : ''}:\n`);

	for (const task of tasks) {
		const status = task.projectStatus || 'unknown';
		const assignee = task.assignee ? ` [${task.assignee}]` : '';
		const complexity = task.complexity && task.complexity !== 'unknown' ? ` (${task.complexity})` : '';
		console.log(`  ${task.id}  [${status}]${assignee}${complexity}  ${task.title}`);
		if (task.description) {
			const desc = task.description.slice(0, 120).replace(/\n/g, ' ');
			console.log(`           ${desc}${task.description.length > 120 ? '...' : ''}`);
		}
	}

	if (data.pagination?.hasMore) {
		console.log(`\n  ... and ${data.totalCount - tasks.length} more. Use --limit to see more.`);
	}
}

// ─── create ──────────────────────────────────────────────────────────────

async function cmdCreate(args) {
	if (args.length === 0) {
		console.error('Usage: ls-cli.js create <title> [--description <text>] [--complexity trivial|low|medium|high|critical] [--status todo|in_progress|in_review|done]');
		process.exit(1);
	}

	const projectId = await getProjectId();

	// Parse args: collect title tokens and flags
	const titleParts = [];
	let description = null;
	let complexity = null;
	let status = 'todo';

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--description' && args[i + 1]) {
			description = args[++i];
		} else if (args[i] === '--complexity' && args[i + 1]) {
			complexity = args[++i];
		} else if (args[i] === '--status' && args[i + 1]) {
			status = args[++i];
		} else {
			titleParts.push(args[i]);
		}
	}

	const title = titleParts.join(' ');
	if (!title) {
		console.error('Error: title is required.');
		process.exit(1);
	}

	const body = { title, projectStatus: status };
	if (description) body.description = description;
	if (complexity) body.complexity = complexity;

	const data = await apiRequest(`/api/projects/${projectId}/tasks`, {
		method: 'POST',
		body: JSON.stringify(body)
	});

	const task = data.task;
	console.log(`Created task: ${task.title}`);
	console.log(`ID: ${task.id}`);
	console.log(`Status: ${task.projectStatus || status}`);
	if (task.complexity && task.complexity !== 'unknown') {
		console.log(`Complexity: ${task.complexity}`);
	}
	if (task.description) {
		console.log(`\nDescription:\n${task.description}`);
	}

	console.log(`\nTo link this task in Claude Code, create a task with:`);
	console.log(`  metadata: { lightsprint_task_id: "${task.id}" }`);
}

// ─── update ──────────────────────────────────────────────────────────────

async function cmdUpdate(args) {
	const taskId = args[0];
	if (!taskId || taskId.startsWith('--')) {
		console.error('Usage: ls-cli.js update <taskId> [--title <text>] [--description <text>] [--status todo|in_progress|in_review|done] [--complexity trivial|low|medium|high|critical] [--assignee <name>]');
		process.exit(1);
	}

	// Parse flags
	const patch = {};
	for (let i = 1; i < args.length; i++) {
		if (args[i] === '--title' && args[i + 1]) {
			patch.title = args[++i];
		} else if (args[i] === '--description' && args[i + 1]) {
			patch.description = args[++i];
		} else if (args[i] === '--status' && args[i + 1]) {
			patch.projectStatus = args[++i];
		} else if (args[i] === '--complexity' && args[i + 1]) {
			patch.complexity = args[++i];
		} else if (args[i] === '--assignee' && args[i + 1]) {
			patch.assignee = args[++i];
		}
	}

	if (Object.keys(patch).length === 0) {
		console.error('Error: at least one field to update is required.');
		process.exit(1);
	}

	await apiRequest(`/api/tasks/${taskId}`, {
		method: 'PATCH',
		body: JSON.stringify(patch)
	});

	// Fetch updated task to confirm
	const data = await apiRequest(`/api/tasks/${taskId}`);
	const task = data.task;

	console.log(`Updated task: ${task.title}`);
	console.log(`ID: ${task.id}`);
	console.log(`Status: ${task.projectStatus || 'unknown'}`);
	if (task.assignee) console.log(`Assignee: ${task.assignee}`);
	if (task.complexity && task.complexity !== 'unknown') {
		console.log(`Complexity: ${task.complexity}`);
	}
	if (task.description) {
		const desc = task.description.slice(0, 200).replace(/\n/g, ' ');
		console.log(`Description: ${desc}${task.description.length > 200 ? '...' : ''}`);
	}
}

// ─── get ─────────────────────────────────────────────────────────────────

async function cmdGet(args) {
	const taskId = args[0];
	if (!taskId) {
		console.error('Usage: ls-cli.js get <taskId>');
		process.exit(1);
	}

	const data = await apiRequest(`/api/tasks/${taskId}`);
	const task = data.task;

	if (!task) {
		console.error(`Task ${taskId} not found`);
		process.exit(1);
	}

	console.log(`Title: ${task.title}`);
	console.log(`ID: ${task.id}`);
	console.log(`Status: ${task.projectStatus || 'unknown'}`);
	if (task.assignee) console.log(`Assignee: ${task.assignee}`);
	if (task.complexity && task.complexity !== 'unknown') {
		console.log(`Complexity: ${task.complexity}`);
	}
	if (task.description) {
		console.log(`\nDescription:\n${task.description}`);
	}
	if (task.todoList && task.todoList.length > 0) {
		console.log(`\nTodo list:`);
		for (const item of task.todoList) {
			console.log(`  ${item.completed ? '[x]' : '[ ]'} ${item.text}`);
		}
	}
	if (task.relatedFiles && task.relatedFiles.length > 0) {
		console.log(`\nRelated files:`);
		for (const f of task.relatedFiles) {
			const path = typeof f === 'string' ? f : f.path;
			console.log(`  - ${path}`);
		}
	}
}

// ─── claim ───────────────────────────────────────────────────────────────

async function cmdClaim(args) {
	const taskId = args[0];
	if (!taskId) {
		console.error('Usage: ls-cli.js claim <taskId>');
		process.exit(1);
	}

	// Set task to in_progress
	await apiRequest(`/api/tasks/${taskId}`, {
		method: 'PATCH',
		body: JSON.stringify({ projectStatus: 'in_progress' })
	});

	// Get full task details
	const data = await apiRequest(`/api/tasks/${taskId}`);
	const task = data.task;

	if (!task) {
		console.error(`Task ${taskId} not found`);
		process.exit(1);
	}

	console.log(`Claimed task: ${task.title}`);
	console.log(`ID: ${task.id}`);
	console.log(`Status: in_progress`);
	if (task.description) {
		console.log(`\nDescription:\n${task.description}`);
	}
	if (task.todoList && task.todoList.length > 0) {
		console.log(`\nTodo list:`);
		for (const item of task.todoList) {
			console.log(`  ${item.completed ? '[x]' : '[ ]'} ${item.text}`);
		}
	}
	if (task.relatedFiles && task.relatedFiles.length > 0) {
		console.log(`\nRelated files:`);
		for (const f of task.relatedFiles) {
			const path = typeof f === 'string' ? f : f.path;
			console.log(`  - ${path}`);
		}
	}
	if (task.complexity && task.complexity !== 'unknown') {
		console.log(`Complexity: ${task.complexity}`);
	}

	console.log(`\nTo link this task in Claude Code, create a task with:`);
	console.log(`  metadata: { lightsprint_task_id: "${task.id}" }`);
}

// ─── kanban ──────────────────────────────────────────────────────────────

async function cmdKanban() {
	const projectId = await getProjectId();
	const data = await apiRequest(`/api/projects/${projectId}/kanban`);
	const columns = data.columnsWithTasks || [];

	if (columns.length === 0) {
		console.log('No kanban columns found.');
		return;
	}

	for (const col of columns) {
		const tasks = col.tasks || [];
		const count = tasks.length;
		console.log(`\n--- ${col.name} (${count}) ---`);

		if (count === 0) {
			console.log('  (empty)');
			continue;
		}

		for (const task of tasks) {
			const assignee = task.assignee ? ` [${task.assignee}]` : '';
			const complexity = task.complexity && task.complexity !== 'unknown' ? ` (${task.complexity})` : '';
			console.log(`  ${task.id}${assignee}${complexity}  ${task.title}`);
		}
	}

	// Show meta for lazy-loaded columns
	if (data.todoColumnMeta?.hasMore) {
		console.log(`\n  (Todo: showing ${data.todoColumnMeta.loadedCount} of ${data.todoColumnMeta.totalCount})`);
	}
	if (data.doneColumnMeta?.hasMore) {
		console.log(`  (Done: showing ${data.doneColumnMeta.loadedCount} of ${data.doneColumnMeta.totalCount})`);
	}
}

// ─── comment ─────────────────────────────────────────────────────────────

async function cmdComment(args) {
	const taskId = args[0];
	const body = args.slice(1).join(' ');

	if (!taskId || !body) {
		console.error('Usage: ls-cli.js comment <taskId> <body>');
		process.exit(1);
	}

	await apiRequest(`/api/tasks/${taskId}/comments`, {
		method: 'POST',
		body: JSON.stringify({ body })
	});

	console.log(`Comment added to task ${taskId}.`);
}

// ─── whoami ──────────────────────────────────────────────────────────────

async function cmdWhoami() {
	const info = await getProjectInfo();
	console.log(`Project: ${info.project.name}`);
	if (info.project.fullName) console.log(`Repository: ${info.project.fullName}`);
	console.log(`Project ID: ${info.project.id}`);
	console.log(`Scopes: ${info.scopes.join(', ')}`);
}

// ─── connect ─────────────────────────────────────────────────────────────

async function cmdConnect() {
	const baseUrl = process.env.LIGHTSPRINT_BASE_URL || 'https://lightsprint.ai';
	await authenticate(baseUrl);
}

// ─── helpers ─────────────────────────────────────────────────────────────

function statusToColumnName(status) {
	const map = {
		'todo': 'Todo',
		'in_progress': 'In Progress',
		'in_review': 'In Review',
		'done': 'Done'
	};
	return map[status] || status;
}

main().catch(err => {
	console.error(`Error: ${err.message}`);
	process.exit(1);
});
