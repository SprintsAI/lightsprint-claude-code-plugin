#!/usr/bin/env node
/**
 * lightsprint — CLI for Lightsprint skills.
 *
 * Commands:
 *   tasks [--status todo|in_progress|in_review|done] [--assignee <name>] [--limit N] [--offset N]
 *   create <title> [--description <text>] [--complexity <level>] [--status <status>] [--depends-on <id1,id2,...>]
 *   update <taskId> [--title <text>] [--description <text>] [--status <status>] [--complexity <level>] [--assignee <name>] [--add-dep <taskId>] [--remove-dep <taskId>]
 *   get <taskId>
 *   claim <taskId> [--cc-pid <pid>]
 *   current-task [--cc-pid <pid>]
 *   comment <taskId> <body>
 *   whoami
 */

import { createHash } from 'crypto';
import { execFileSync, execSync } from 'child_process';
import { mkdirSync, mkdtempSync, chmodSync, copyFileSync, unlinkSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { apiRequest, getProjectId, getProjectInfo } from './lib/client.js';
import { setMapping } from './lib/task-map.js';
import { lsToCcStatus } from './lib/status-mapper.js';
import { authenticate } from './lib/auth.js';
import { getConfig, getDefaultBaseUrl, readProjectsFile, writeProjectsFile, getGitRepoFullName } from './lib/config.js';
import { validateId, validateStatus, validateComplexity, validateEnum, VALID_DEPS_FILTERS, validateTitle, validateDescription, validateCommentBody, validateBaseUrl, validateVersion } from './lib/validate.js';
import { findRunningDaemonForCcPid, getClaudeCodePid } from './lib/cc-utils.js';
import { parseGlobalOptions } from './lib/options.js';
import { outputResult, outputError, outputDryRun, classifyError, formatTaskText, buildTaskData, filterFields } from './lib/output.js';
import { getCommandSchema, getAllCommandNames } from './lib/schema.js';

export async function cliMain(command, args, context = {}) {
	// Handle help flags
	if (!command || command === 'help' || command === '--help' || command === '-h') {
		return showHelp();
	}

	const { globalOptions: opts, remainingArgs } = parseGlobalOptions(args);

	try {
		switch (command) {
			case 'tasks': return await cmdTasks(remainingArgs, opts);
			case 'create': return await cmdCreate(remainingArgs, opts);
			case 'update': return await cmdUpdate(remainingArgs, opts);
			case 'get': return await cmdGet(remainingArgs, opts);
			case 'claim': return await cmdClaim(remainingArgs, opts);
			case 'current-task': return await cmdCurrentTask(remainingArgs, opts);
			case 'link-pr': return await cmdLinkPr(remainingArgs, opts);
			case 'unlink-pr': return await cmdUnlinkPr(remainingArgs, opts);
			case 'comment': return await cmdComment(remainingArgs, opts);
			case 'whoami': return await cmdWhoami(opts);
			case 'open': return cmdOpen(opts);
			case 'status': return cmdStatus(opts);
			case 'connect': return await cmdConnect(remainingArgs, opts);
			case 'disconnect': return await cmdDisconnect(remainingArgs, opts);
			case 'upgrade': return await cmdUpgrade(context.version || 'dev', opts);
			case 'describe': return cmdDescribe(remainingArgs);
			default:
				outputError('unknown_command', `Unknown command: ${command}. Use 'lightsprint help' for usage information.`, { command }, opts);
				process.exit(1);
		}
	} catch (err) {
		outputError(classifyError(err), err.message, {}, opts);
		process.exit(1);
	}
}

// ─── help ────────────────────────────────────────────────────────────────

function showHelp() {
	console.log(`Lightsprint CLI — Manage tasks on your Lightsprint project board

Usage:
  lightsprint <command> [options] [--output json|text] [--dry-run] [--fields f1,f2]
  lightsprint help          Show this help message

Commands:

  tasks [options]
    List tasks from the project board
    Options:
      --status <status>     Filter by status (comma-separated): backlog, todo, in_progress, in_review, done
      --complexity <level>  Filter by complexity: low, medium, high
      --assignee <name>     Filter by assignee name/email
      --mine                Show only tasks assigned to me
      --unassigned           Only show tasks with no assignee
      --deps <filter>       Filter by dependencies: has-dependencies, has-dependents, unblocked
      --limit <N>           Limit number of results (default: 20)
      --offset <N>          Skip first N results (for pagination)
      --page-all            Stream all tasks as NDJSON (one JSON object per line)
    Example:
      lightsprint tasks --status todo,in_progress --mine
      lightsprint tasks --status backlog --unassigned --complexity low
      lightsprint tasks --deps unblocked --status todo

  create <title> [options]
    Create a new task
    Options:
      --description <text>        Task description
      --complexity <level>        low, medium, or high
      --status <status>           backlog, todo, in_progress, in_review, or done (default: todo)
      --depends-on <ids>          Comma-separated task IDs this task depends on
      --json-body <json>          Raw JSON request body (replaces individual flags)
    Example:
      lightsprint create "Fix login bug" --description "Users can't log in" --complexity high

  update <taskId> [options]
    Update an existing task
    Options:
      --title <text>              New task title
      --description <text>        New description
      --status <status>           New status: backlog, todo, in_progress, in_review, done
      --complexity <level>        New complexity: low, medium, high
      --assignee <name>           Assign task to a team member
      --add-dep <taskId>          Add a dependency (repeatable)
      --remove-dep <taskId>       Remove a dependency (repeatable)
      --json-body <json>          Raw JSON request body (replaces individual flags)
    Example:
      lightsprint update abc123 --status done --assignee "John"

  get <taskId>
    Show full details of a task including description, todo list, dependencies, and related files
    Example:
      lightsprint get abc123

  claim <taskId> [--cc-pid <pid>]
    Claim a task and set its status to in_progress. Links the active CC session if found.
    Example:
      lightsprint claim --cc-pid $PPID abc123

  unlink-pr <taskId>
    Remove a linked GitHub pull request from a task
    Example:
      lightsprint unlink-pr abc123

  comment <taskId> <body>
    Add a comment to a task
    Example:
      lightsprint comment abc123 "This is now complete"

  describe [command]
    Show accepted parameters, types, and valid enum values as JSON
    Example:
      lightsprint describe create

  open
    Open the project board in your browser

  status
    Show Lightsprint connection status for the current repository

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
    Remove Lightsprint credentials for the current repository

  review-plan [input]
    Review an implementation plan (typically invoked by Claude Code hooks)

  upgrade
    Download and install the latest version from GitHub releases

Global Flags:
  --output json|text      Output format (default: text). JSON is machine-readable.
  --json                  Shorthand for --output json
  --dry-run               Validate inputs without making API calls (create, update, claim, comment)
  --fields f1,f2          Return only specified fields (implies --output json)
  --help, -h              Show this help message
`);
}

// ─── tasks ───────────────────────────────────────────────────────────────

async function cmdTasks(args, opts) {
	const projectId = await getProjectId();
	const params = new URLSearchParams();

	// Parse args
	let status = null;
	let limit = 20;
	let offset = 0;
	let assigneeFilter = null;
	let complexity = null;
	let depsFilter = null;
	let unassigned = false;
	let mine = false;
	let pageAll = false;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--status' && args[i + 1]) {
			status = args[++i];
		} else if (args[i] === '--limit' && args[i + 1]) {
			limit = parseInt(args[++i], 10);
		} else if (args[i] === '--offset' && args[i + 1]) {
			offset = parseInt(args[++i], 10);
		} else if (args[i] === '--assignee' && args[i + 1]) {
			assigneeFilter = args[++i];
		} else if (args[i] === '--complexity' && args[i + 1]) {
			complexity = args[++i];
		} else if (args[i] === '--deps' && args[i + 1]) {
			depsFilter = args[++i];
		} else if (args[i] === '--unassigned') {
			unassigned = true;
		} else if (args[i] === '--mine') {
			mine = true;
		} else if (args[i] === '--page-all') {
			pageAll = true;
		}
	}

	// Validate enum inputs
	if (status) {
		// Support comma-separated statuses
		for (const s of status.split(',')) validateStatus(s);
	}
	if (complexity) validateComplexity(complexity);
	if (depsFilter) {
		validateEnum(depsFilter, VALID_DEPS_FILTERS, 'deps filter');
	}

	// All filtering is server-side — build query params
	params.set('limit', String(limit));
	params.set('offset', String(offset));
	if (status) params.set('status', status);
	if (complexity) params.set('complexity', complexity);
	if (unassigned) params.set('unassigned', 'true');
	if (depsFilter) params.set('deps', depsFilter);
	if (mine) params.set('assignee', 'me');
	else if (assigneeFilter) params.set('assignee', assigneeFilter);

	validateId(projectId, 'Project ID');

	// --page-all: stream all pages as NDJSON (one task per line)
	if (pageAll) {
		let pageOffset = 0;
		const pageLimit = 100; // max per page
		let hasMore = true;
		while (hasMore) {
			params.set('limit', String(pageLimit));
			params.set('offset', String(pageOffset));
			const pageData = await apiRequest(`/api/repos/${projectId}/tasks?${params}`);
			const pageTasks = pageData.tasks || [];
			const prefix = pageData.taskPrefix || 'LS';
			for (const task of pageTasks) {
				const displayId = task.taskNumber != null
					? `${prefix}-${task.taskNumber < 100 ? task.taskNumber.toString().padStart(3, '0') : task.taskNumber}`
					: task.id;
				const line = {
					displayId, id: task.id, title: task.title,
					status: (task.status || 'unknown'),
					assignee: task.assignedUser?.name || task.assignee || null,
					complexity: (task.complexity && task.complexity !== 'unknown') ? task.complexity : null,
					description: task.description || null
				};
				const output = opts.fields ? filterFields(line, opts.fields) : line;
				process.stdout.write(JSON.stringify(output) + '\n');
			}
			hasMore = pageData.pagination?.hasMore || false;
			pageOffset += pageTasks.length || pageLimit;
			if (pageTasks.length === 0) break;
		}
		return;
	}

	const data = await apiRequest(`/api/repos/${projectId}/tasks?${params}`);
	let tasks = data.tasks || [];

	const prefix = data.taskPrefix || 'LS';
	const resultTasks = tasks.map(task => {
		const displayId = task.taskNumber != null
			? `${prefix}-${task.taskNumber < 100 ? task.taskNumber.toString().padStart(3, '0') : task.taskNumber}`
			: task.id;
		return {
			displayId,
			id: task.id,
			title: task.title,
			status: (task.status || 'unknown'),
			assignee: task.assignedUser?.name || task.assignee || null,
			complexity: (task.complexity && task.complexity !== 'unknown') ? task.complexity : null,
			description: task.description || null
		};
	});

	const result = {
		tasks: resultTasks,
		totalCount: data.totalCount || tasks.length,
		hasMore: data.pagination?.hasMore || false,
		taskPrefix: prefix
	};

	outputResult(result, opts, () => {
		if (resultTasks.length === 0) {
			console.log('No tasks found.');
			return;
		}

		const totalLabel = data.totalCount > tasks.length ? ` of ${data.totalCount} total` : '';
		console.log(`Found ${resultTasks.length} task(s)${totalLabel}:\n`);

		for (const task of resultTasks) {
			const assigneeLabel = task.assignee ? ` [${task.assignee}]` : '';
			const complexity = task.complexity ? ` (${task.complexity})` : '';
			console.log(`  ${task.displayId}  [${task.status}]${assigneeLabel}${complexity}  ${task.title}`);
			if (task.description) {
				const desc = task.description.slice(0, 120).replace(/\n/g, ' ');
				console.log(`           ${desc}${task.description.length > 120 ? '...' : ''}`);
			}
		}

		if (result.hasMore) {
			console.log(`\n  ... and ${data.totalCount - tasks.length} more. Use --limit/--offset to see more.`);
		}
	});
}

// ─── create ──────────────────────────────────────────────────────────────

async function cmdCreate(args, opts) {
	if (args.length === 0) {
		throw new Error('Usage: lightsprint create <title> [--description <text>] [--complexity low|medium|high] [--status backlog|todo|in_progress|in_review|done] [--depends-on <id1,id2,...>]');
	}

	const projectId = await getProjectId();

	// Check for --json-body
	let jsonBody = null;

	// Parse args: collect title tokens and flags
	const titleParts = [];
	let description = null;
	let complexity = null;
	let status = 'todo';
	let dependsOn = null;

	for (let i = 0; i < args.length; i++) {
		if ((args[i] === '--json-body' || args[i] === '--json') && args[i + 1]) {
			jsonBody = args[++i];
		} else if (args[i] === '--description' && args[i + 1]) {
			description = args[++i];
		} else if (args[i] === '--complexity' && args[i + 1]) {
			complexity = args[++i];
		} else if (args[i] === '--status' && args[i + 1]) {
			status = args[++i];
		} else if (args[i] === '--depends-on' && args[i + 1]) {
			dependsOn = args[++i];
		} else {
			titleParts.push(args[i]);
		}
	}

	let body;

	if (jsonBody) {
		// Raw JSON mode — reject if combined with individual flags
		if (titleParts.length > 0 || description || complexity) {
			throw new Error('Cannot combine --json/--json-body with --description, --complexity, or positional title. Use --json/--json-body alone.');
		}
		try {
			body = JSON.parse(jsonBody);
		} catch {
			throw new Error('Invalid JSON in --json/--json-body.');
		}
		// Validate known fields (use 'in' to catch empty strings)
		if ('title' in body) validateTitle(body.title);
		if ('status' in body) validateStatus(body.status);
		if ('complexity' in body) validateComplexity(body.complexity);
		if ('description' in body) validateDescription(body.description);
	} else {
		const title = titleParts.join(' ');
		if (!title) {
			throw new Error('Error: title is required.');
		}

		validateTitle(title);
		validateStatus(status);
		if (description) validateDescription(description);
		if (complexity) validateComplexity(complexity);

		body = { title, status: status };
		if (description) body.description = description;
		if (complexity) body.complexity = complexity;
	}

	// Resolve dependency IDs (supports display IDs like LIG-024)
	let dependencyTaskIds = null;
	if (dependsOn) {
		const rawIds = dependsOn.split(',').map(s => s.trim()).filter(Boolean);
		for (const id of rawIds) validateId(id, 'Dependency task ID');
		dependencyTaskIds = await Promise.all(rawIds.map(id => resolveTaskId(id)));
	}
	if (dependencyTaskIds) body.dependencyTaskIds = dependencyTaskIds;

	// Dry-run: validate only, don't call API
	if (opts.dryRun) {
		return outputDryRun('create', body, `POST /api/repos/${projectId}/tasks`, opts);
	}

	validateId(projectId, 'Project ID');
	const data = await apiRequest(`/api/repos/${projectId}/tasks`, {
		method: 'POST',
		body: JSON.stringify(body)
	});

	const task = data.task;
	const result = {
		task: buildTaskData(task),
		dependenciesAdded: dependencyTaskIds ? dependencyTaskIds.length : 0
	};

	outputResult(result, opts, () => {
		console.log(`Created task: ${task.title}`);
		console.log(`ID: ${task.id}`);
		console.log(`Status: ${(task.status || 'unknown')}`);
		if (task.complexity && task.complexity !== 'unknown') {
			console.log(`Complexity: ${task.complexity}`);
		}
		if (task.description) {
			console.log(`\nDescription:\n${task.description}`);
		}
		if (dependencyTaskIds && dependencyTaskIds.length > 0) {
			console.log(`\nDependencies added: ${dependencyTaskIds.length}`);
		}
		console.log(`\nTo link this task in Claude Code, create a task with:`);
		console.log(`  metadata: { lightsprint_task_id: "${task.id}" }`);
	});
}

// ─── update ──────────────────────────────────────────────────────────────

async function cmdUpdate(args, opts) {
	const taskIdInput = args[0];
	if (!taskIdInput || taskIdInput.startsWith('--')) {
		throw new Error('Usage: lightsprint update <taskId> [--title <text>] [--description <text>] [--status backlog|todo|in_progress|in_review|done] [--complexity low|medium|high] [--assignee <name>] [--add-dep <taskId>] [--remove-dep <taskId>]');
	}

	// Parse flags
	let patch = {};
	const addDeps = [];
	const removeDeps = [];
	let jsonBody = null;
	for (let i = 1; i < args.length; i++) {
		if ((args[i] === '--json-body' || args[i] === '--json') && args[i + 1]) {
			jsonBody = args[++i];
		} else if (args[i] === '--title' && args[i + 1]) {
			patch.title = args[++i];
		} else if (args[i] === '--description' && args[i + 1]) {
			patch.description = args[++i];
		} else if (args[i] === '--status' && args[i + 1]) {
			patch.status = args[++i];
		} else if (args[i] === '--complexity' && args[i + 1]) {
			patch.complexity = args[++i];
		} else if (args[i] === '--assignee' && args[i + 1]) {
			patch.assignee = args[++i];
		} else if (args[i] === '--add-dep' && args[i + 1]) {
			addDeps.push(args[++i]);
		} else if (args[i] === '--remove-dep' && args[i + 1]) {
			removeDeps.push(args[++i]);
		}
	}

	if (jsonBody) {
		if (Object.keys(patch).length > 0) {
			throw new Error('Cannot combine --json/--json-body with --title, --description, --status, --complexity, or --assignee. Use --json/--json-body alone.');
		}
		try {
			patch = JSON.parse(jsonBody);
		} catch {
			throw new Error('Invalid JSON in --json/--json-body.');
		}
		if ('title' in patch) validateTitle(patch.title);
		if ('description' in patch) validateDescription(patch.description);
		if ('status' in patch) validateStatus(patch.status);
		if ('complexity' in patch) validateComplexity(patch.complexity);
	}

	const hasPatch = Object.keys(patch).length > 0;
	const hasDeps = addDeps.length > 0 || removeDeps.length > 0;

	if (!hasPatch && !hasDeps) {
		throw new Error('Error: at least one field to update is required.');
	}

	validateId(taskIdInput, 'Task ID');
	if (!jsonBody) {
		if (patch.title) validateTitle(patch.title);
		if (patch.description) validateDescription(patch.description);
		if (patch.status) validateStatus(patch.status);
		if (patch.complexity) validateComplexity(patch.complexity);
	}
	for (const id of addDeps) validateId(id, 'Dependency task ID');
	for (const id of removeDeps) validateId(id, 'Dependency task ID');

	// Dry-run: validate only
	if (opts.dryRun) {
		return outputDryRun('update', { taskId: taskIdInput, patch, addDeps, removeDeps }, `PATCH /api/tasks/${taskIdInput}`, opts);
	}

	const taskId = await resolveTaskId(taskIdInput);

	// Apply field updates
	if (hasPatch) {
		await apiRequest(`/api/tasks/${taskId}`, {
			method: 'PATCH',
			body: JSON.stringify(patch)
		});
	}

	// Apply dependency changes
	const depsAdded = [];
	const depsRemoved = [];
	const errors = [];
	for (const depInput of addDeps) {
		const depId = await resolveTaskId(depInput);
		try {
			await apiRequest(`/api/tasks/${taskId}/dependencies`, {
				method: 'POST',
				body: JSON.stringify({ dependsOnTaskId: depId })
			});
			depsAdded.push(depId);
		} catch (err) {
			errors.push({ action: 'add_dep', input: depInput, message: err.message });
		}
	}
	for (const depInput of removeDeps) {
		const depId = await resolveTaskId(depInput);
		try {
			await apiRequest(`/api/tasks/${taskId}/dependencies`, {
				method: 'DELETE',
				body: JSON.stringify({ dependsOnTaskId: depId })
			});
			depsRemoved.push(depId);
		} catch (err) {
			errors.push({ action: 'remove_dep', input: depInput, message: err.message });
		}
	}

	// Fetch updated task to confirm
	const data = await apiRequest(`/api/tasks/${taskId}`);
	const task = data.task;

	const result = {
		task: buildTaskData(task),
		dependenciesAdded: depsAdded,
		dependenciesRemoved: depsRemoved,
		errors
	};

	outputResult(result, opts, () => {
		console.log(`Updated task: ${task.title}`);
		console.log(`ID: ${task.id}`);
		console.log(`Status: ${(task.status || 'unknown')}`);
		if (task.assignee) console.log(`Assignee: ${task.assignee}`);
		if (task.complexity && task.complexity !== 'unknown') {
			console.log(`Complexity: ${task.complexity}`);
		}
		if (task.description) {
			const desc = task.description.slice(0, 200).replace(/\n/g, ' ');
			console.log(`Description: ${desc}${task.description.length > 200 ? '...' : ''}`);
		}
		for (const id of depsAdded) console.log(`Added dependency: ${taskId} depends on ${id}`);
		for (const id of depsRemoved) console.log(`Removed dependency: ${taskId} no longer depends on ${id}`);
		for (const e of errors) console.error(`Failed to ${e.action} ${e.input}: ${e.message}`);
	});
}

// ─── get ─────────────────────────────────────────────────────────────────

async function cmdGet(args, opts) {
	const taskIdInput = args[0];
	if (!taskIdInput) {
		throw new Error('Usage: lightsprint get <taskId>');
	}

	validateId(taskIdInput, 'Task ID');
	const taskId = await resolveTaskId(taskIdInput);

	// Fetch task and dependencies in parallel
	const [data, depData] = await Promise.all([
		apiRequest(`/api/tasks/${taskId}`),
		apiRequest(`/api/tasks/${taskId}/dependencies`).catch(err => {
			// Only suppress 404 (endpoint unavailable); surface other errors as partial failure
			if (err.message && (err.message.includes('404') || err.message.includes('not found'))) {
				return { dependencies: [], dependents: [] };
			}
			return { dependencies: [], dependents: [], _error: err.message };
		})
	]);
	const task = data.task;

	if (!task) {
		throw new Error(`Task ${taskId} not found`);
	}

	const dependencies = depData.dependencies || [];
	const dependents = depData.dependents || [];

	// API returns dependency join records; the actual task is nested under dependsOnTask / task
	const mapDep = d => {
		const t = d.dependsOnTask || d.task || d;
		return {
			id: t.id,
			taskNumber: t.taskNumber || null,
			title: t.title,
			status: (t.status || 'unknown')
		};
	};

	const result = {
		task: buildTaskData(task),
		dependencies: dependencies.map(mapDep),
		dependents: dependents.map(mapDep)
	};
	if (depData._error) result.dependenciesError = depData._error;

	outputResult(result, opts, () => {
		formatTaskText(task);

		if (depData._error) {
			console.error(`\nWarning: Could not fetch dependencies: ${depData._error}`);
		}
		if (result.dependencies.length > 0) {
			console.log(`\nDepends on:`);
			for (const d of result.dependencies) {
				const label = d.taskNumber != null ? `#${d.taskNumber}` : d.id;
				console.log(`  - ${label} ${d.title} [${d.status}]`);
			}
		}
		if (result.dependents.length > 0) {
			console.log(`\nBlocks:`);
			for (const d of result.dependents) {
				const label = d.taskNumber != null ? `#${d.taskNumber}` : d.id;
				console.log(`  - ${label} ${d.title} [${d.status}]`);
			}
		}
	});
}

// ─── current-task ────────────────────────────────────────────────────────

async function cmdCurrentTask(args, opts) {
	// Parse --cc-pid flag (passed by skill via $PPID)
	let ccPidArg;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--cc-pid' && i + 1 < args.length) {
			ccPidArg = parseInt(args[++i], 10);
		}
	}

	// Discover the active CC session's Lightsprint session ID
	const ccPid = ccPidArg || getClaudeCodePid();
	const daemonState = findRunningDaemonForCcPid(ccPid);
	if (!daemonState?.lsSessionId) {
		const result = { task: null, message: 'No active CC session found. Claim a task first with /lightsprint:claim.' };
		return outputResult(result, opts, () => console.log(result.message));
	}

	const data = await apiRequest(`/api/cc-sessions/${daemonState.lsSessionId}/task`);
	const task = data.task;

	if (!task) {
		const result = { task: null, message: 'No task is linked to the current CC session. Claim a task with /lightsprint:claim.' };
		return outputResult(result, opts, () => console.log(result.message));
	}

	const result = {
		task: buildTaskData(task),
		sessionId: daemonState.lsSessionId
	};

	outputResult(result, opts, () => formatTaskText(task));
}

// ─── claim ───────────────────────────────────────────────────────────────

async function cmdClaim(args, opts) {
	// Parse --cc-pid flag (passed by skill via $PPID)
	let ccPidArg;
	const filteredArgs = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--cc-pid' && i + 1 < args.length) {
			ccPidArg = parseInt(args[++i], 10);
		} else {
			filteredArgs.push(args[i]);
		}
	}

	const taskIdInput = filteredArgs[0];
	if (!taskIdInput) {
		throw new Error('Usage: lightsprint claim <taskId>');
	}

	validateId(taskIdInput, 'Task ID');

	// Dry-run: validate only
	if (opts.dryRun) {
		return outputDryRun('claim', { taskId: taskIdInput }, `POST /api/tasks/${taskIdInput}/claim`, opts);
	}

	const taskId = await resolveTaskId(taskIdInput);

	// Best-effort: discover the active CC session's Lightsprint session ID
	let ccSessionId;
	try {
		const ccPid = ccPidArg || getClaudeCodePid();
		const daemonState = findRunningDaemonForCcPid(ccPid);
		if (daemonState?.lsSessionId) {
			ccSessionId = daemonState.lsSessionId;
		}
	} catch {
		// Session discovery failed — continue without linking
	}

	// Claim: sets status to in_progress and assigns to the token owner
	const claimBody = {};
	if (ccSessionId) {
		claimBody.ccSessionId = ccSessionId;
	}

	await apiRequest(`/api/tasks/${taskId}/claim`, {
		method: 'POST',
		body: JSON.stringify(claimBody)
	});

	// Get full task details
	const data = await apiRequest(`/api/tasks/${taskId}`);
	const task = data.task;

	if (!task) {
		throw new Error(`Task ${taskId} not found`);
	}

	const result = {
		task: buildTaskData(task),
		ccSessionLinked: !!ccSessionId
	};

	outputResult(result, opts, () => {
		formatTaskText(task, { prefix: 'Claimed task' });
		console.log(`\nTo link this task in Claude Code, create a task with:`);
		console.log(`  metadata: { lightsprint_task_id: "${task.id}" }`);
	});
}

// ─── link-pr ─────────────────────────────────────────────────────────────

async function cmdLinkPr(args, opts) {
	const taskIdInput = args[0];
	const prUrl = args[1];

	if (!taskIdInput || !prUrl) {
		throw new Error('Usage: lightsprint link-pr <taskId> <prUrl>');
	}

	validateId(taskIdInput, 'Task ID');

	// Basic validation of PR URL format
	if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(prUrl)) {
		throw new Error('Invalid GitHub PR URL. Expected format: https://github.com/owner/repo/pull/123');
	}

	const taskId = await resolveTaskId(taskIdInput);
	const data = await apiRequest(`/api/tasks/${taskId}/link-pr`, {
		method: 'POST',
		body: JSON.stringify({ prUrl })
	});

	const pr = data.pr;
	const result = {
		taskId,
		pr: { prUrl: pr.prUrl, status: pr.status, title: pr.title || null }
	};

	outputResult(result, opts, () => {
		console.log(`Linked PR to task ${taskIdInput}`);
		console.log(`PR: ${pr.prUrl}`);
		console.log(`Status: ${pr.status}`);
		if (pr.title) console.log(`Title: ${pr.title}`);
	});
}

// ─── unlink-pr ───────────────────────────────────────────────────────────

async function cmdUnlinkPr(args, opts) {
	const taskIdInput = args[0];

	if (!taskIdInput) {
		throw new Error('Usage: lightsprint unlink-pr <taskId>');
	}

	validateId(taskIdInput, 'Task ID');
	const taskId = await resolveTaskId(taskIdInput);
	await apiRequest(`/api/tasks/${taskId}/link-pr`, {
		method: 'DELETE'
	});

	const result = { success: true, taskId, message: `Unlinked PR from task ${taskIdInput}.` };
	outputResult(result, opts, () => console.log(result.message));
}

// ─── comment ─────────────────────────────────────────────────────────────

async function cmdComment(args, opts) {
	const taskIdInput = args[0];
	const body = args.slice(1).join(' ');

	if (!taskIdInput || !body) {
		throw new Error('Usage: lightsprint comment <taskId> <body>');
	}

	validateId(taskIdInput, 'Task ID');
	validateCommentBody(body);

	// Dry-run: validate only
	if (opts.dryRun) {
		return outputDryRun('comment', { taskId: taskIdInput, body }, `POST /api/tasks/${taskIdInput}/comments`, opts);
	}

	const taskId = await resolveTaskId(taskIdInput);
	await apiRequest(`/api/tasks/${taskId}/comments`, {
		method: 'POST',
		body: JSON.stringify({ body })
	});

	const result = { success: true, taskId, message: `Comment added to task ${taskIdInput}.` };
	outputResult(result, opts, () => console.log(result.message));
}

// ─── whoami ──────────────────────────────────────────────────────────────

async function cmdWhoami(opts) {
	const info = await getProjectInfo();

	const proj = info.repo || info.project;
	const result = {
		user: info.user ? {
			name: info.user.name,
			email: info.user.email,
			id: info.user.id
		} : null,
		project: {
			name: proj.name,
			fullName: proj.fullName || null,
			id: proj.id
		},
		scopes: info.scopes
	};

	outputResult(result, opts, () => {
		if (info.user) {
			console.log(`User: ${info.user.name}`);
			if (info.user.email) console.log(`Email: ${info.user.email}`);
		}
		console.log(`Project: ${proj.name}`);
		if (proj.fullName) console.log(`Repository: ${proj.fullName}`);
		console.log(`Project ID: ${proj.id}`);
		console.log(`Scopes: ${info.scopes.join(', ')}`);
	});
}

// ─── open ────────────────────────────────────────────────────────────────

function cmdOpen(opts) {
	const cwd = process.cwd();
	const cfg = getConfig(cwd);

	if (!cfg) {
		throw new Error('Not connected to Lightsprint. Run "lightsprint connect" first.');
	}

	const url = `${cfg.baseUrl}/projects/${cfg.projectId}`;

	let opened = false;
	const platform = process.platform;
	try {
		if (platform === 'darwin') {
			execSync(`open ${JSON.stringify(url)}`, { stdio: 'ignore' });
		} else if (platform === 'win32') {
			execSync(`start "" ${JSON.stringify(url)}`, { stdio: 'ignore' });
		} else {
			execSync(`xdg-open ${JSON.stringify(url)}`, { stdio: 'ignore' });
		}
		opened = true;
	} catch {
		// Fallback: just print the URL
	}

	const result = { url, opened };
	outputResult(result, opts, () => {
		if (opened) {
			console.log(`Opened ${url}`);
		} else {
			console.log(`Open this URL in your browser:\n  ${url}`);
		}
	});
}

// ─── status ──────────────────────────────────────────────────────────────

function cmdStatus(opts) {
	const cwd = process.cwd();
	const cfg = getConfig(cwd);

	if (!cfg) {
		const result = { connected: false, message: 'Not connected to Lightsprint. Run "lightsprint connect" first.' };
		return outputResult(result, opts, () => {
			console.log('Not connected to Lightsprint.\n');
			console.log('To get started:\n');
			console.log('  1. Run:  lightsprint connect');
			console.log('  2. Authorize in the browser when prompted');
			console.log('  3. Select the project to link to this repository\n');
			console.log('For a custom instance:\n');
			console.log('  lightsprint connect --base-url https://your-instance.lightsprint.ai');
		});
	}

	let tokenValid = null;
	let remainingMs = null;
	if (cfg.expiresAt) {
		remainingMs = cfg.expiresAt - Date.now();
		tokenValid = remainingMs > 0;
	}

	const result = {
		connected: true,
		projectName: cfg.projectName || 'unknown',
		projectId: cfg.projectId,
		repo: cfg.repo,
		baseUrl: cfg.baseUrl,
		token: { valid: tokenValid, remainingMs: remainingMs != null ? Math.max(0, remainingMs) : null }
	};

	outputResult(result, opts, () => {
		console.log(`Project:    ${cfg.projectName || 'unknown'}`);
		console.log(`Project ID: ${cfg.projectId}`);
		console.log(`Repository: ${cfg.repo}`);
		console.log(`Base URL:   ${cfg.baseUrl}`);
		if (cfg.expiresAt) {
			if (!tokenValid) {
				console.log(`Token:      expired`);
			} else {
				const hours = Math.floor(remainingMs / 3600000);
				const mins = Math.floor((remainingMs % 3600000) / 60000);
				console.log(`Token:      valid (${hours}h ${mins}m remaining)`);
			}
		}
	});
}

// ─── connect ─────────────────────────────────────────────────────────────

async function cmdConnect(args, opts) {
	let baseUrl = null;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--base-url' && args[i + 1]) {
			baseUrl = args[++i];
		}
	}
	const resolvedBaseUrl = baseUrl || getDefaultBaseUrl();
	validateBaseUrl(resolvedBaseUrl);
	await authenticate(resolvedBaseUrl);

	// After successful auth, output connection info
	const cwd = process.cwd();
	const cfg = getConfig(cwd);
	if (cfg && opts.outputFormat === 'json') {
		const result = {
			connected: true,
			projectName: cfg.projectName || null,
			projectId: cfg.projectId,
			repo: cfg.repo
		};
		console.log(JSON.stringify(result));
	}
}

// ─── disconnect ──────────────────────────────────────────────────────

async function cmdDisconnect(args, opts) {
	const projects = readProjectsFile();
	const cwd = process.cwd();

	// Find matching entries: repo name + walk up from cwd
	const toRemove = [];
	const repoName = getGitRepoFullName(cwd);
	if (repoName && projects[repoName]) {
		toRemove.push(repoName);
	}
	for (const [folder] of Object.entries(projects)) {
		if (!cwd.startsWith(folder) && folder !== cwd) continue;
		toRemove.push(folder);
	}

	if (toRemove.length === 0) {
		const result = { disconnected: [], message: 'No Lightsprint connection found for this folder.' };
		return outputResult(result, opts, () => console.log(result.message));
	}

	const disconnected = [];
	for (const folder of toRemove) {
		const entry = projects[folder];
		const projectName = entry.projectName || entry.baseUrl || 'unknown';
		delete projects[folder];
		disconnected.push({ key: folder, projectName });
	}

	writeProjectsFile(projects);

	const result = { disconnected };
	outputResult(result, opts, () => {
		for (const d of disconnected) {
			console.log(`Disconnected: ${d.projectName} (${d.key})`);
		}
	});
}

// ─── upgrade ─────────────────────────────────────────────────────────

const UPGRADE_REPO = 'SprintsAI/lightsprint-claude-code-plugin';
const UPGRADE_BINARY = 'lightsprint';

async function cmdUpgrade(currentVersion, opts) {
	const platform = process.platform;  // darwin, linux, win32
	const arch = process.arch;          // x64, arm64
	const platformStr = `${platform}-${arch}`;
	const assetName = platform === 'win32'
		? `${UPGRADE_BINARY}-${platformStr}.exe`
		: `${UPGRADE_BINARY}-${platformStr}`;

	// Fetch latest release — progress to stderr so JSON on stdout stays clean
	const log = opts.outputFormat === 'json' ? (...a) => console.error(...a) : (...a) => console.log(...a);
	log('Checking for updates...');
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
	validateVersion(latestVersion);

	if (currentVersion === latestVersion) {
		// Still ensure installed_plugins.json is correct (may be stale from older upgrades)
		ensureInstalledPluginsJson(latestVersion, { logger: log });
		const result = { upgraded: false, current: currentVersion, latest: latestVersion, message: 'Already up to date.' };
		return outputResult(result, opts, () => console.log(`Already up to date (v${currentVersion}).`));
	}

	if (currentVersion !== 'dev') {
		log(`Current version: v${currentVersion}`);
	}
	log(`Latest version:  v${latestVersion}`);
	log(`Downloading ${assetName}...`);

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

	// Determine install paths
	const home = homedir();
	const pluginCacheDir = join(home, '.claude', 'plugins', 'cache', 'lightsprint', 'lightsprint', latestVersion);
	const pluginBinDir = join(pluginCacheDir, 'bin');
	const isWindows = platform === 'win32';
	const binaryFilename = isWindows ? `${UPGRADE_BINARY}.exe` : UPGRADE_BINARY;
	const cliDir = isWindows
		? join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'lightsprint')
		: join(process.env.XDG_DATA_HOME || join(home, '.local'), 'bin');

	// Write to a secure temp directory
	const tmpDir = mkdtempSync(join(tmpdir(), 'lightsprint-upgrade-'));
	const tmpPath = join(tmpDir, assetName);
	try {
		writeFileSync(tmpPath, binBuffer, { mode: 0o755 });

		// Download and extract plugin source files (hooks, skills, plugin.json, etc.)
		// Without these, Claude Code can't discover hooks or skills after upgrade.
		log('Downloading plugin files...');
		const tarballUrl = release.tarball_url;
		const tarRes = await fetch(tarballUrl, {
			headers: { 'User-Agent': 'lightsprint-cli' },
			redirect: 'follow'
		});
		if (!tarRes.ok) {
			throw new Error(`Failed to download plugin source (HTTP ${tarRes.status})`);
		}
		const tarPath = join(tmpDir, 'source.tar.gz');
		writeFileSync(tarPath, Buffer.from(await tarRes.arrayBuffer()));

		// Remove old version directory if it exists (start fresh)
		try { rmSync(pluginCacheDir, { recursive: true, force: true }); } catch {}
		mkdirSync(pluginCacheDir, { recursive: true });
		execFileSync('tar', ['-xzf', tarPath, '-C', pluginCacheDir, '--strip-components=1'], { stdio: 'ignore' });
		log('Extracted plugin files (hooks, skills, plugin metadata).');

		// Install compiled binary to plugin cache (overwrites source bin/)
		mkdirSync(pluginBinDir, { recursive: true });
		const pluginDest = join(pluginBinDir, binaryFilename);
		copyFileSync(tmpPath, pluginDest);
		if (!isWindows) chmodSync(pluginDest, 0o755);
		log(`Installed binary to ${pluginBinDir}/`);

		// Install to CLI convenience path
		try {
			mkdirSync(cliDir, { recursive: true });
			const cliDest = join(cliDir, binaryFilename);
			copyFileSync(tmpPath, cliDest);
			if (!isWindows) chmodSync(cliDest, 0o755);
			log(`Updated ${cliDir}/${binaryFilename}`);
		} catch (err) {
			// Non-fatal — plugin cache is the primary location
			console.warn(`Warning: Could not update convenience binary at ${cliDir}: ${err.message}`);
		}

	} finally {
		// Clean up temp directory
		try { rmSync(tmpDir, { recursive: true }); } catch {}
	}

	ensureInstalledPluginsJson(latestVersion, { logger: log });

	// Clean up old version directories
	const pluginParentDir = join(homedir(), '.claude', 'plugins', 'cache', 'lightsprint', 'lightsprint');
	try {
		for (const entry of readdirSync(pluginParentDir)) {
			if (entry !== latestVersion) {
				try { rmSync(join(pluginParentDir, entry), { recursive: true, force: true }); } catch {}
			}
		}
	} catch {}

	const result = { upgraded: true, from: currentVersion, to: latestVersion };
	outputResult(result, opts, () => {
		console.log(`\nUpgraded lightsprint v${currentVersion === 'dev' ? 'dev' : currentVersion} → v${latestVersion}`);
	});
}

// ─── describe ────────────────────────────────────────────────────────────

function cmdDescribe(args) {
	const commandName = args[0];
	if (!commandName) {
		// List all commands
		const names = getAllCommandNames();
		console.log(JSON.stringify({ commands: names }));
		return;
	}
	const schema = getCommandSchema(commandName);
	if (!schema) {
		console.error(JSON.stringify({ error: 'not_found', message: `Unknown command: "${commandName}". Use 'lightsprint describe' to list all commands.` }));
		process.exit(1);
	}
	console.log(JSON.stringify(schema));
}

// ─── helpers ─────────────────────────────────────────────────────────────

function ensureInstalledPluginsJson(version, { logger = console.log } = {}) {
	const home = homedir();
	const pluginCacheDir = join(home, '.claude', 'plugins', 'cache', 'lightsprint', 'lightsprint', version);
	const installedPluginsPath = join(home, '.claude', 'plugins', 'installed_plugins.json');
	try {
		const pluginsData = JSON.parse(readFileSync(installedPluginsPath, 'utf-8'));
		const entries = pluginsData.plugins?.['lightsprint@lightsprint'];
		if (entries && entries.length > 0) {
			if (entries[0].version === version && entries[0].installPath === pluginCacheDir) {
				return; // already correct
			}
			entries[0].installPath = pluginCacheDir;
			entries[0].version = version;
			entries[0].lastUpdated = new Date().toISOString();
			writeFileSync(installedPluginsPath, JSON.stringify(pluginsData, null, 2) + '\n');
			logger('Updated installed_plugins.json');
		}
	} catch (err) {
		console.warn(`Warning: Could not update installed_plugins.json: ${err.message}`);
	}
}

/**
 * Resolve a task reference to a real task ID.
 * Accepts:
 *   - Display ID: "LIG-024" (prefix-number)
 *   - Bare task number: "24" or "024"
 *   - Raw ID: "YCRFHw7OeZUbogdOtYnFh" (returned as-is)
 */
async function resolveTaskId(input) {
	const projectId = await getProjectId();
	const data = await apiRequest(`/api/repos/${projectId}/tasks/resolve?ref=${encodeURIComponent(input)}`);
	return data.taskId;
}


