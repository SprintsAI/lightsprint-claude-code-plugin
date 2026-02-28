#!/usr/bin/env node
/**
 * lightsprint — CLI for Lightsprint skills.
 *
 * Commands:
 *   tasks [--status todo|in_progress|in_review|done] [--limit N]
 *   create <title> [--description <text>] [--complexity <level>] [--status <status>]
 *   update <taskId> [--title <text>] [--description <text>] [--status <status>] [--complexity <level>] [--assignee <name>]
 *   get <taskId>
 *   claim <taskId>
 *   comment <taskId> <body>
 *   whoami
 */

import { createHash } from 'crypto';
import { mkdirSync, mkdtempSync, chmodSync, copyFileSync, unlinkSync, rmSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { apiRequest, getProjectId, getProjectInfo } from './lib/client.js';
import { setMapping } from './lib/task-map.js';
import { lsToCcStatus } from './lib/status-mapper.js';
import { authenticate } from './lib/auth.js';
import { getConfig, getDefaultBaseUrl, readProjectsFile, writeProjectsFile } from './lib/config.js';

export async function cliMain(command, args, context = {}) {
	// Handle help flags
	if (!command || command === 'help' || command === '--help' || command === '-h') {
		return showHelp();
	}

	switch (command) {
		case 'tasks': return await cmdTasks(args);
		case 'create': return await cmdCreate(args);
		case 'update': return await cmdUpdate(args);
		case 'get': return await cmdGet(args);
		case 'claim': return await cmdClaim(args);
		case 'comment': return await cmdComment(args);
		case 'whoami': return await cmdWhoami();
		case 'status': return cmdStatus();
		case 'connect': return await cmdConnect(args);
		case 'disconnect': return await cmdDisconnect(args);
		case 'upgrade': return await cmdUpgrade(context.version || 'dev');
		default:
			console.error(`Unknown command: ${command}`);
			console.error(`Use 'lightsprint help' for usage information.`);
			process.exit(1);
	}
}

// ─── help ────────────────────────────────────────────────────────────────

function showHelp() {
	console.log(`Lightsprint CLI — Manage tasks on your Lightsprint project board

Usage:
  lightsprint <command> [options]
  lightsprint help          Show this help message

Commands:

  tasks [options]
    List tasks from the project board
    Options:
      --status <status>   Filter by status: todo, in_progress, in_review, done
      --limit <N>         Limit number of results (default: 20)
    Example:
      lightsprint tasks --status in_progress --limit 10

  create <title> [options]
    Create a new task
    Options:
      --description <text>        Task description
      --complexity <level>        trivial, low, medium, high, or critical
      --status <status>           todo, in_progress, in_review, or done (default: todo)
    Example:
      lightsprint create "Fix login bug" --description "Users can't log in" --complexity high

  update <taskId> [options]
    Update an existing task
    Options:
      --title <text>              New task title
      --description <text>        New description
      --status <status>           New status
      --complexity <level>        New complexity level
      --assignee <name>           Assign task to a team member
    Example:
      lightsprint update abc123 --status done --assignee "John"

  get <taskId>
    Show full details of a task including description, todo list, and related files
    Example:
      lightsprint get abc123

  claim <taskId>
    Claim a task and set its status to in_progress
    Example:
      lightsprint claim abc123

  comment <taskId> <body>
    Add a comment to a task
    Example:
      lightsprint comment abc123 "This is now complete"

  status
    Show Lightsprint connection status for the current folder

  whoami
    Display current project and authentication info

  connect [--base-url <url>]
    Authenticate and connect to Lightsprint (run this first if not authenticated)
    Options:
      --base-url <url>        Connect to a custom Lightsprint instance
    Example:
      lightsprint connect
      lightsprint connect --base-url https://staging.lightsprint.ai

  disconnect
    Remove Lightsprint credentials for the current folder

  review-plan [input]
    Review an implementation plan (typically invoked by Claude Code hooks)

  upgrade
    Download and install the latest version from GitHub releases

Flags:
  --help, -h              Show this help message
`);
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
		console.error('Usage: lightsprint create <title> [--description <text>] [--complexity trivial|low|medium|high|critical] [--status todo|in_progress|in_review|done]');
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
		console.error('Usage: lightsprint update <taskId> [--title <text>] [--description <text>] [--status todo|in_progress|in_review|done] [--complexity trivial|low|medium|high|critical] [--assignee <name>]');
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
		console.error('Usage: lightsprint get <taskId>');
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
		console.error('Usage: lightsprint claim <taskId>');
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

// ─── comment ─────────────────────────────────────────────────────────────

async function cmdComment(args) {
	const taskId = args[0];
	const body = args.slice(1).join(' ');

	if (!taskId || !body) {
		console.error('Usage: lightsprint comment <taskId> <body>');
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

// ─── status ──────────────────────────────────────────────────────────────

function cmdStatus() {
	const cwd = process.cwd();
	const cfg = getConfig(cwd);

	if (!cfg) {
		console.log('Not connected to Lightsprint.\n');
		console.log('To get started:\n');
		console.log('  1. Run:  lightsprint connect');
		console.log('  2. Authorize in the browser when prompted');
		console.log('  3. Select the project to link to this folder\n');
		console.log('For a custom instance:\n');
		console.log('  lightsprint connect --base-url https://your-instance.lightsprint.ai');
		return;
	}

	console.log(`Project:    ${cfg.projectName || 'unknown'}`);
	console.log(`Project ID: ${cfg.projectId}`);
	console.log(`Folder:     ${cfg.folder}`);
	console.log(`Base URL:   ${cfg.baseUrl}`);

	if (cfg.expiresAt) {
		const remaining = cfg.expiresAt - Date.now();
		if (remaining <= 0) {
			console.log(`Token:      expired`);
		} else {
			const hours = Math.floor(remaining / 3600000);
			const mins = Math.floor((remaining % 3600000) / 60000);
			console.log(`Token:      valid (${hours}h ${mins}m remaining)`);
		}
	}
}

// ─── connect ─────────────────────────────────────────────────────────────

async function cmdConnect(args) {
	let baseUrl = null;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--base-url' && args[i + 1]) {
			baseUrl = args[++i];
		}
	}
	await authenticate(baseUrl || getDefaultBaseUrl());
}

// ─── disconnect ──────────────────────────────────────────────────────

async function cmdDisconnect() {
	const projects = readProjectsFile();
	const cwd = process.cwd();

	// Find matching entries: walk up from cwd (same logic as findProjectConfig)
	const toRemove = [];
	for (const [folder] of Object.entries(projects)) {
		if (!cwd.startsWith(folder) && folder !== cwd) continue;
		toRemove.push(folder);
	}

	if (toRemove.length === 0) {
		console.log('No Lightsprint connection found for this folder.');
		return;
	}

	for (const folder of toRemove) {
		const entry = projects[folder];
		const projectName = entry.projectName || entry.baseUrl || 'unknown';
		delete projects[folder];
		console.log(`Disconnected: ${projectName} (${folder})`);
	}

	writeProjectsFile(projects);
}

// ─── upgrade ─────────────────────────────────────────────────────────

const UPGRADE_REPO = 'SprintsAI/lightsprint-claude-code-plugin';
const UPGRADE_BINARY = 'lightsprint';

async function cmdUpgrade(currentVersion) {
	const platform = process.platform;  // darwin, linux, win32
	const arch = process.arch;          // x64, arm64
	const platformStr = `${platform}-${arch}`;
	const assetName = platform === 'win32'
		? `${UPGRADE_BINARY}-${platformStr}.exe`
		: `${UPGRADE_BINARY}-${platformStr}`;

	// Fetch latest release
	console.log('Checking for updates...');
	const res = await fetch(`https://api.github.com/repos/${UPGRADE_REPO}/releases/latest`, {
		headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'lightsprint-cli' }
	});
	if (!res.ok) {
		throw new Error(`Failed to check for updates (HTTP ${res.status})`);
	}
	const release = await res.json();
	const tag = release.tag_name;
	const latestVersion = tag.replace(/^v/, '');

	// Validate version string to prevent path traversal
	if (/[\\/]|\.\./.test(latestVersion)) {
		throw new Error(`Invalid characters in version from release tag: ${tag}`);
	}

	if (currentVersion === latestVersion) {
		console.log(`Already up to date (v${currentVersion}).`);
		return;
	}

	if (currentVersion !== 'dev') {
		console.log(`Current version: v${currentVersion}`);
	}
	console.log(`Latest version:  v${latestVersion}`);
	console.log(`Downloading ${assetName}...`);

	// Download binary
	const downloadUrl = `https://github.com/${UPGRADE_REPO}/releases/download/${tag}/${assetName}`;
	const checksumUrl = `${downloadUrl}.sha256`;

	const binRes = await fetch(downloadUrl);
	if (!binRes.ok) {
		throw new Error(`Failed to download binary from ${downloadUrl} (HTTP ${binRes.status})`);
	}
	const binBuffer = Buffer.from(await binRes.arrayBuffer());

	// Verify checksum (mandatory)
	const csRes = await fetch(checksumUrl);
	if (!csRes.ok) {
		throw new Error(`Failed to download checksum from ${checksumUrl} (HTTP ${csRes.status}). Aborting upgrade for safety.`);
	}
	const csText = await csRes.text();
	const expected = csText.trim().split(/\s+/)[0];
	const actual = createHash('sha256').update(binBuffer).digest('hex');
	if (expected !== actual) {
		throw new Error(`Checksum verification failed!\n  Expected: ${expected}\n  Actual:   ${actual}`);
	}

	// Write to a secure temp directory
	const tmpDir = mkdtempSync(join(tmpdir(), 'lightsprint-upgrade-'));
	const tmpPath = join(tmpDir, assetName);
	try {
		writeFileSync(tmpPath, binBuffer, { mode: 0o755 });

		// Determine install paths
		const home = homedir();
		const pluginBinDir = join(home, '.claude', 'plugins', 'cache', 'lightsprint', 'lightsprint', latestVersion, 'bin');
		const isWindows = platform === 'win32';
		const binaryFilename = isWindows ? `${UPGRADE_BINARY}.exe` : UPGRADE_BINARY;
		const cliDir = isWindows
			? join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'lightsprint')
			: join(process.env.XDG_DATA_HOME || join(home, '.local'), 'bin');

		// Install to plugin cache
		mkdirSync(pluginBinDir, { recursive: true });
		const pluginDest = join(pluginBinDir, binaryFilename);
		copyFileSync(tmpPath, pluginDest);
		if (!isWindows) chmodSync(pluginDest, 0o755);
		console.log(`Installed to ${pluginBinDir}/`);

		// Install to CLI convenience path
		try {
			mkdirSync(cliDir, { recursive: true });
			const cliDest = join(cliDir, binaryFilename);
			copyFileSync(tmpPath, cliDest);
			if (!isWindows) chmodSync(cliDest, 0o755);
			console.log(`Updated ${cliDir}/${binaryFilename}`);
		} catch (err) {
			// Non-fatal — plugin cache is the primary location
			console.warn(`Warning: Could not update convenience binary at ${cliDir}: ${err.message}`);
		}
	} finally {
		// Clean up temp directory
		try { rmSync(tmpDir, { recursive: true }); } catch {}
	}

	console.log(`\nUpgraded lightsprint v${currentVersion === 'dev' ? 'dev' : currentVersion} → v${latestVersion}`);
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

