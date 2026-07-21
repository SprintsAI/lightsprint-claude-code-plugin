#!/usr/bin/env node
/**
 * lightsprint — CLI for Lightsprint skills.
 *
 * All commands accept positional args OR explicit flags (e.g., `get abc123` or `get --task abc123`).
 * Aliases: create-task→create, review-hub-signals→review-hub signals, etc.
 *
 * Commands:
 *   tasks [--status backlog|todo|in_progress|in_review|done] [--assignee <name>] [--project <filter>] [--sort position|updated_at|created_at] [--limit N] [--offset N]
 *   projects [--status active|completed|archived]
 *   create <title> [--description <text>] [--complexity <level>] [--status <status>] [--project <projectId>] [--depends-on <id1,id2,...>] [--cc-pid <pid>]
 *   update <taskId> [--title <text>] [--description <text>] [--status <status>] [--complexity <level>] [--assignee <name>] [--add-dep <taskId>] [--remove-dep <taskId>]
 *   get <taskId>
 *   claim <taskId> [--cc-pid <pid>]
 *   current-task [--cc-pid <pid>]
 *   comment <taskId> <body>
 *   delete <taskId>
 *   whoami
 *   merge <taskId>
 *   review-hub signals <taskId> [--refresh]
 *   review-hub scores <taskId> [--refresh]
 *   agent launch --task <taskId> --provider <provider>
 *   agent stop --task <taskId> --provider <provider>
 *   agent settings [--provider <provider>]
 *   agent create-pr --task <taskId> --provider <provider> --agent-id <id>
 */

import { createHash } from 'crypto';
import { execFileSync, execSync } from 'child_process';
import { mkdirSync, mkdtempSync, chmodSync, copyFileSync, unlinkSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { apiRequest, apiRequestSSE, getWorkspaceId } from './lib/client.js';
import { authenticate } from './lib/auth.js';
import { getConfig, getDefaultBaseUrl, readConnection, clearConnection, getGitRepoFullName, readPreferences, getPreference, setPreference, deletePreference, KNOWN_PREFERENCES } from './lib/config.js';
import { validateId, validateStatus, validateComplexity, validatePosition, validateEnum, VALID_DEPS_FILTERS, validateTitle, validateDescription, validateCommentBody, validateBaseUrl, validateVersion, validatePositiveInt, validateAssignee, validatePid, validateProjectFilter, validateProvider, validateBoolean } from './lib/validate.js';
import { findRunningDaemonForCcPid, getClaudeCodePid, reportError, findSessionByWorkspaceId } from './lib/cc-utils.js';
import { parseGlobalOptions } from './lib/options.js';
import { outputResult, outputError, outputDryRun, classifyError, formatTaskText, buildTaskData, filterFields } from './lib/output.js';
import { getCommandSchema, getAllCommandNames } from './lib/schema.js';

// Command aliases: maps common hallucinated/alternative names to real commands
const COMMAND_ALIASES = {
	'create-task': 'create',
	'new': 'create',
	'add': 'create',
	'show': 'get',
	'view': 'get',
	'edit': 'update',
	'list': 'tasks',
	'ls': 'tasks',
	'remove': 'delete',
	'rm': 'delete',
	'link': 'link-pr',
	'unlink': 'unlink-pr',
	// Hyphenated compound commands -> space-separated routing
	'review-hub-signals': '_review-hub-signals',
	'review-hub-scores': '_review-hub-scores',
};

// All valid command names for "did you mean?" suggestions
const VALID_COMMANDS = [
	'tasks', 'projects', 'stacks', 'create', 'update', 'get', 'claim', 'current-task',
	'link-pr', 'unlink-pr', 'delete', 'comment', 'whoami',
	'open', 'status', 'connect', 'disconnect', 'upgrade', 'config', 'describe',
	'agent', 'merge', 'review-hub'
];

function suggestCommand(input) {
	// Simple Levenshtein-based suggestion
	let best = null;
	let bestDist = Infinity;
	for (const cmd of VALID_COMMANDS) {
		const dist = levenshtein(input.toLowerCase(), cmd);
		if (dist < bestDist) {
			bestDist = dist;
			best = cmd;
		}
	}
	// Only suggest if edit distance is reasonable (≤ 3)
	return bestDist <= 3 ? best : null;
}

function levenshtein(a, b) {
	const m = a.length, n = b.length;
	const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));
	for (let i = 0; i <= m; i++) dp[i][0] = i;
	for (let j = 0; j <= n; j++) dp[0][j] = j;
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			dp[i][j] = a[i - 1] === b[j - 1]
				? dp[i - 1][j - 1]
				: 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
		}
	}
	return dp[m][n];
}

/**
 * Show command-specific help using the schema system.
 * Returns true if help was shown (caller should return early).
 */
function showSubcommandHelp(commandName) {
	const schema = getCommandSchema(commandName);
	if (schema) {
		// For compound schemas like "review-hub-signals", display as "review-hub signals"
		const displayName = commandName.replace(/^(review-hub|agent)-/, '$1 ');
		console.log(`lightsprint ${displayName}\n`);
		console.log(`  ${schema.description}\n`);
		const params = Object.entries(schema.params || {});
		if (params.length > 0) {
			console.log('Options:');
			for (const [key, param] of params) {
				const flag = param.flag || `--${key}`;
				const req = param.required ? ' (required)' : '';
				const vals = param.values ? ` [${param.values.join(', ')}]` : '';
				const def = param.default !== undefined ? ` (default: ${param.default})` : '';
				console.log(`  ${flag.padEnd(24)} ${param.description || ''}${req}${vals}${def}`);
			}
		}
		if (schema.supportsDryRun) console.log(`  ${'--dry-run'.padEnd(24)} Validate without making API calls`);
		console.log(`\nGlobal flags: --output json|text, --json, --fields f1,f2`);
		return true;
	}
	return false;
}

export async function cliMain(command, args, context = {}) {
	// Handle help flags
	if (!command || command === 'help' || command === '--help' || command === '-h') {
		return showHelp();
	}

	// Resolve aliases
	const resolvedCommand = COMMAND_ALIASES[command] || command;

	// Handle hyphenated compound command aliases (review-hub-signals -> review-hub signals)
	if (resolvedCommand === '_review-hub-signals') {
		return cliMain('review-hub', ['signals', ...args], context);
	}
	if (resolvedCommand === '_review-hub-scores') {
		return cliMain('review-hub', ['scores', ...args], context);
	}

	const { globalOptions: opts, remainingArgs } = parseGlobalOptions(args);

	// Handle --help on any subcommand: lightsprint <command> --help
	if (remainingArgs.includes('--help') || remainingArgs.includes('-h')) {
		// For compound commands, include the subcommand in the schema key when one exists
		let schemaKey = resolvedCommand;
		if (remainingArgs[0] && !remainingArgs[0].startsWith('-')) {
			const candidate = `${resolvedCommand}-${remainingArgs[0]}`;
			if (getCommandSchema(candidate)) {
				schemaKey = candidate;
			}
		}
		if (showSubcommandHelp(schemaKey)) return;
		// Fallback: show generic help for commands without schemas
		console.log(`lightsprint ${resolvedCommand}\n\nRun 'lightsprint help' for full usage.`);
		return;
	}

	try {
		switch (resolvedCommand) {
			case 'tasks': return await cmdTasks(remainingArgs, opts);
			case 'projects': return await cmdProjects(remainingArgs, opts);
			case 'stacks': return remainingArgs[0] === 'get' ? await cmdStackGet(remainingArgs.slice(1), opts) : await cmdStacks(remainingArgs, opts);
			case 'create': return await cmdCreate(remainingArgs, opts);
			case 'update': return await cmdUpdate(remainingArgs, opts);
			case 'get': return await cmdGet(remainingArgs, opts);
			case 'claim': return await cmdClaim(remainingArgs, opts);
			case 'current-task': return await cmdCurrentTask(remainingArgs, opts);
			case 'link-pr': return await cmdLinkPr(remainingArgs, opts);
			case 'unlink-pr': return await cmdUnlinkPr(remainingArgs, opts);
			case 'delete': return await cmdDelete(remainingArgs, opts);
			case 'comment': return await cmdComment(remainingArgs, opts);
			case 'whoami': return await cmdWhoami(opts);
			case 'open': return cmdOpen(opts);
			case 'status': return cmdStatus(opts);
			case 'connect': return await cmdConnect(remainingArgs, opts);
			case 'disconnect': return await cmdDisconnect(remainingArgs, opts);
			case 'upgrade': return await cmdUpgrade(context.version || 'dev', opts);
			case 'config': return cmdConfig(remainingArgs, opts);
			case 'describe': return cmdDescribe(remainingArgs);
			case 'agent': return await cmdAgent(remainingArgs, opts);
			case 'merge': return await cmdMerge(remainingArgs, opts);
			case 'review-hub': return await cmdReviewHub(remainingArgs, opts);
			default: {
				const suggestion = suggestCommand(command);
				const hint = suggestion ? ` Did you mean '${suggestion}'?` : '';
				outputError('unknown_command', `Unknown command: ${command}.${hint} Use 'lightsprint help' for usage information.`, { command, suggestion }, opts);
				process.exit(1);
			}
		}
	} catch (err) {
		// Fire-and-forget error reporting to Sentry via daemon
		try {
			const cfg = getConfig();
			if (cfg?.workspaceId) {
				const sessionId = findSessionByWorkspaceId(cfg.workspaceId);
				if (sessionId) {
					reportError(sessionId, err, 'ls-cli').catch(() => {});
				}
			}
		} catch { /* never block exit on error reporting */ }
		outputError(classifyError(err), err.message, {}, opts);
		process.exit(1);
	}
}

// ─── help ────────────────────────────────────────────────────────────────

function showHelp() {
	console.log(`Lightsprint CLI — Manage tasks in your Lightsprint workspace

Usage:
  lightsprint <command> [options] [--output json|text] [--dry-run] [--fields f1,f2]
  lightsprint help          Show this help message

Commands:

  tasks [options]
    List tasks from the active workspace board
    Options:
      --status <status>     Filter by status (comma-separated): backlog, todo, in_progress, in_review, done
      --complexity <level>  Filter by complexity: low, medium, high
      --assignee <name>     Filter by assignee name/email
      --mine                Show only tasks assigned to me
      --unassigned           Only show tasks with no assignee
      --deps <filter>       Filter by dependencies: has-dependencies, has-dependents, unblocked
      --project <filter>    Filter by project ID(s) or "none" for tasks without a project
      --stack <ref>         Filter by stack (stack ID, task prefix, or name)
      --sort <field>        Sort tasks by: position (default), updated_at, created_at
      --limit <N>           Limit number of results (default: 20)
      --offset <N>          Skip first N results (for pagination)
      --page-all            Stream all tasks as NDJSON (one JSON object per line)
    Example:
      lightsprint tasks --status todo,in_progress --mine
      lightsprint tasks --status backlog --unassigned --complexity low
      lightsprint tasks --deps unblocked --status todo

  projects [options]
    List projects in the active workspace
    Options:
      --status <status>     Filter by project status: active, completed, archived
    Example:
      lightsprint projects
      lightsprint projects --status active

  stacks
    List stacks in the active workspace
    Example:
      lightsprint stacks

  stacks get <stackId|prefix|name>
    Show a stack and its member repos. Accepts a stack ID, task prefix, or name.
    Example:
      lightsprint stacks get ENG
      lightsprint stacks get stk_123

  create <title> [options]
    Create a new task. Title can be positional or via --title flag.
    Aliases: create-task, new, add
    Options:
      --title <text>              Task title (alternative to positional)
      --description <text>        Task description
      --complexity <level>        low, medium, or high
      --status <status>           backlog, todo, in_progress, in_review, or done (default: backlog)
      --project <projectId>       Assign to a project by ID
      --stack <ref>               Create in a stack (stack ID, task prefix, or name)
      --depends-on <ids>          Comma-separated task IDs this task depends on
      --cc-pid <pid>              Claude Code PID for session linking
      --json-body <json>          Raw JSON request body (replaces individual flags)
    Example:
      lightsprint create "Fix login bug" --description "Users can't log in" --complexity high
      lightsprint create --title "Fix login bug" --description "Users can't log in"

  update <taskId> [options]
    Update an existing task. Task ID can be positional or via --task flag.
    Options:
      --task <taskId>             Task ID (alternative to positional)
      --title <text>              New task title
      --description <text>        New description
      --status <status>           New status: backlog, todo, in_progress, in_review, done
      --complexity <level>        New complexity: low, medium, high
      --requires-schema-change <bool>  Whether the task involves a DB schema change (true/false)
      --assignee <name>           Assign task to a team member
      --project <projectId>       Move task to a project by ID
      --add-dep <taskId>          Add a dependency (repeatable)
      --remove-dep <taskId>       Remove a dependency (repeatable)
      --json-body <json>          Raw JSON request body (replaces individual flags)
    Example:
      lightsprint update abc123 --status done --assignee "John"
      lightsprint update --task abc123 --status done

  get <taskId>
    Show full details of a task. Task ID can be positional or via --task flag.
    Example:
      lightsprint get abc123
      lightsprint get --task abc123

  claim <taskId> [--cc-pid <pid>]
    Claim a task and set its status to in_progress. Task ID can be positional or via --task flag.
    Example:
      lightsprint claim abc123
      lightsprint claim --task abc123 --cc-pid $PPID

  unlink-pr <taskId>
    Remove a linked GitHub pull request from a task. Task ID can be positional or via --task flag.
    Example:
      lightsprint unlink-pr abc123

  delete <taskId>
    Delete a task permanently. Task ID can be positional or via --task flag.
    Example:
      lightsprint delete abc123
      lightsprint delete LIG-024

  comment <taskId> <body>
    Add a comment to a task. Supports positional args or --task/--body flags.
    Example:
      lightsprint comment abc123 "This is now complete"
      lightsprint comment --task abc123 --body "This is now complete"

  agent launch [options]
    Launch a cloud agent for a task
    Options:
      --task <taskId>         Task ID (required)
      --provider <provider>   Provider: anthropic, cursor, codex (required)
      --model <model>         Override default model
      --base-ref <ref>        Base branch
      --environment-id <id>   Environment for codex/anthropic

  agent stop [options]
    Stop the active cloud agent for a task
    Options:
      --task <taskId>         Task ID (required)
      --provider <provider>   Provider: anthropic, cursor, codex (required)

  agent settings [options]
    Show cloud agent provider configuration
    Options:
      --provider <provider>   Also fetch environments for this provider

  agent create-pr [options]
    Create a GitHub PR from a cloud agent's working branch
    Options:
      --task <taskId>         Task ID (required)
      --provider <provider>   Provider: anthropic, cursor, codex (required)
      --agent-id <id>         Agent ID (required)
    Example:
      lightsprint agent create-pr --task LIG-024 --provider anthropic --agent-id abc123

  merge <taskId>
    Merge the GitHub PR linked to a task
    Example:
      lightsprint merge LIG-024
      lightsprint merge --task LIG-024

  review-hub signals <taskId> [--refresh]
    Get PR signals (CI checks, reviews, comments) for a task's linked PR
    Options:
      --refresh             Force re-fetch signals from GitHub
    Example:
      lightsprint review-hub signals LIG-024
      lightsprint review-hub signals LIG-024 --refresh

  review-hub scores <taskId> [--refresh]
    Get AI readiness analysis for a task's linked PR
    Options:
      --refresh             Refresh signals from GitHub and trigger fresh AI analysis (consumes credits)
    Example:
      lightsprint review-hub scores LIG-024
      lightsprint review-hub scores LIG-024 --refresh

  config <subcommand> [key] [value]
    Manage user preferences (stored in ~/.lightsprint/preferences.json)
    Subcommands:
      config get <key>          Get a preference value
      config set <key> <value>  Set a preference
      config delete <key>       Remove a preference
      config list               Show all preferences
    Known keys:
      link-pr.no-task-behavior   prompt | always-skip (default: prompt)
    Example:
      lightsprint config set link-pr.no-task-behavior always-skip
      lightsprint config get link-pr.no-task-behavior
      lightsprint config delete link-pr.no-task-behavior

  describe [command]
    Show accepted parameters, types, and valid enum values as JSON
    Example:
      lightsprint describe create

  open
    Open the active workspace board in your browser

  status
    Show Lightsprint connection status for the active workspace

  whoami
    Display the connected workspace and authentication info

  connect [--base-url <url>]
    Authenticate and connect to a Lightsprint workspace (run this first if not authenticated)
    Options:
      --base-url <url>        Connect to a custom Lightsprint instance
    Example:
      lightsprint connect
      lightsprint connect --base-url https://staging.lightsprint.ai

  disconnect
    Remove the active workspace's Lightsprint credentials

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
	const workspaceId = await getWorkspaceId();
	const params = new URLSearchParams();

	// Parse args
	let status = null;
	let limit = 20;
	let offset = 0;
	let assigneeFilter = null;
	let complexity = null;
	let depsFilter = null;
	let projectFilter = null;
	let stackFilter = null;
	let unassigned = false;
	let mine = false;
	let pageAll = false;
	let sort = null;
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
		} else if (args[i] === '--project' && args[i + 1]) {
			projectFilter = args[++i];
		} else if (args[i] === '--stack' && args[i + 1]) {
			stackFilter = args[++i];
		} else if (args[i] === '--sort' && args[i + 1]) {
			sort = args[++i];
		} else if (args[i] === '--unassigned') {
			unassigned = true;
		} else if (args[i] === '--mine') {
			mine = true;
		} else if (args[i] === '--page-all') {
			pageAll = true;
		}
	}

	// Validate numeric inputs
	limit = validatePositiveInt(limit, 'limit');
	offset = validatePositiveInt(offset, 'offset');
	if (assigneeFilter) validateAssignee(assigneeFilter);

	// Validate enum inputs
	if (status) {
		// Support comma-separated statuses (trim whitespace)
		for (const s of status.split(',').map(v => v.trim())) validateStatus(s);
	}
	if (complexity) validateComplexity(complexity);
	if (depsFilter) {
		validateEnum(depsFilter, VALID_DEPS_FILTERS, 'deps filter');
	}
	if (projectFilter) {
		projectFilter = validateProjectFilter(projectFilter);
	}
	const VALID_SORT_FIELDS = ['position', 'updated_at', 'created_at'];
	if (sort) {
		validateEnum(sort, VALID_SORT_FIELDS, 'sort field');
	}

	// All filtering is server-side — build query params.
	// The workspace board endpoint's default (kanban) shape has NO top-level
	// `tasks`/`totalCount`. Use the LIST layout: without a sectionId it returns
	// `{ listSectionsWithTasks: [{ id, name, status, tasks: [...] }, ...] }`,
	// per-section-capped via `perSectionLimit` (max 100). We flatten sections.
	params.set('layoutType', 'list');
	params.set('perSectionLimit', String(Math.min(limit, 100)));
	if (status) params.set('status', status);
	if (complexity) params.set('complexity', complexity);
	if (unassigned) params.set('unassigned', 'true');
	if (depsFilter) params.set('deps', depsFilter);
	if (projectFilter) params.set('project', projectFilter);
	if (sort) params.set('sort', sort);
	if (mine) params.set('assignee', 'me');
	else if (assigneeFilter) params.set('assignee', assigneeFilter);

	const stackId = stackFilter ? await resolveStackId(workspaceId, stackFilter) : null;
	if (stackId) params.set('stack', stackId);

	validateId(workspaceId, 'Workspace ID');

	// Map a board task summary to our display shape. Board task objects may
	// carry their own display fields; prefer task.displayId, fall back to id.
	const mapTask = task => ({
		displayId: task.displayId ?? task.id,
		id: task.id,
		title: task.title,
		status: (task.status || 'unknown'),
		assignee: task.assignedUser?.name || task.assignee || null,
		complexity: (task.complexity && task.complexity !== 'unknown') ? task.complexity : null,
		project: task.project ? { id: task.project.id, name: task.project.name, color: task.project.color || null, projectNumber: task.project.projectNumber } : null,
		description: task.description || null
	});

	// --page-all: stream ALL tasks across ALL sections as NDJSON (one task/line).
	// The no-sectionId list path is per-section-capped (not globally paginated),
	// so we first discover the section ids/names, then paginate each section via
	// `?layoutType=list&sectionId=<id>&limit=100&offset=...` (flat { tasks, totalCount })
	// until each section is exhausted.
	if (pageAll) {
		const boardData = await apiRequest(`/api/workspaces/${workspaceId}/board?${params}`);
		const sections = boardData.listSectionsWithTasks || [];

		// Guard: if the server ever returns a flat { tasks } shape, stream it directly.
		if (sections.length === 0 && Array.isArray(boardData.tasks)) {
			for (const task of boardData.tasks) {
				const line = mapTask(task);
				const output = opts.fields ? filterFields(line, opts.fields) : line;
				process.stdout.write(JSON.stringify(output) + '\n');
			}
			return;
		}

		const pageLimit = 100; // max per page (server clamps to 100)
		for (const section of sections) {
			if (!section || !section.id) continue;
			const sectionParams = new URLSearchParams(params);
			sectionParams.delete('perSectionLimit');
			sectionParams.set('sectionId', section.id);
			sectionParams.set('limit', String(pageLimit));

			let pageOffset = 0;
			let totalCount = Infinity;
			while (pageOffset < totalCount) {
				sectionParams.set('offset', String(pageOffset));
				const pageData = await apiRequest(`/api/workspaces/${workspaceId}/board?${sectionParams}`);
				const pageTasks = pageData.tasks || [];
				totalCount = pageData.totalCount ?? pageTasks.length;
				for (const task of pageTasks) {
					const line = mapTask(task);
					const output = opts.fields ? filterFields(line, opts.fields) : line;
					process.stdout.write(JSON.stringify(output) + '\n');
				}
				if (pageTasks.length === 0) break;
				pageOffset += pageLimit;
			}
		}
		return;
	}

	const data = await apiRequest(`/api/workspaces/${workspaceId}/board?${params}`);
	const sections = data.listSectionsWithTasks || [];
	// Flatten the per-section task arrays into one list. Guard: fall back to a
	// flat { tasks } shape if the server ever returns one.
	let tasks = sections.length > 0
		? sections.flatMap(s => s.tasks || [])
		: (data.tasks || []);

	const resultTasks = tasks.map(mapTask);

	const totalCount = tasks.length;
	// The list path is per-section-capped. If any section returned exactly the
	// per-section limit, it was likely truncated → suggest --page-all/--limit.
	const perSectionLimit = Math.min(limit, 100);
	const hasMore = sections.some(s => (s.tasks || []).length >= perSectionLimit);
	const result = {
		tasks: resultTasks,
		totalCount,
		hasMore
	};

	outputResult(result, opts, () => {
		if (resultTasks.length === 0) {
			console.log('No tasks found.');
			return;
		}

		const totalLabel = totalCount > tasks.length ? ` of ${totalCount} total` : '';
		console.log(`Found ${resultTasks.length} task(s)${totalLabel}:\n`);

		for (const task of resultTasks) {
			const assigneeLabel = task.assignee ? ` [${task.assignee}]` : '';
			const complexity = task.complexity ? ` (${task.complexity})` : '';
			const projectLabel = task.project ? ` {${task.project.name}}` : '';
			console.log(`  ${task.displayId}  [${task.status}]${assigneeLabel}${complexity}${projectLabel}  ${task.title}`);
			if (task.description) {
				const desc = task.description.slice(0, 120).replace(/\n/g, ' ');
				console.log(`           ${desc}${task.description.length > 120 ? '...' : ''}`);
			}
		}

		if (result.hasMore) {
			console.log(`\n  ... some sections may have more tasks (capped at ${perSectionLimit}/section). Use --limit to raise the cap or --page-all for all tasks.`);
		}
	});
}

// ─── projects ───────────────────────────────────────────────────────────

const VALID_PROJECT_STATUSES = ['active', 'completed', 'archived'];

async function cmdProjects(args, opts) {
	const workspaceId = await getWorkspaceId();

	let statusFilter = null;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--status' && args[i + 1]) {
			statusFilter = args[++i];
		}
	}

	if (statusFilter) {
		validateEnum(statusFilter, VALID_PROJECT_STATUSES, 'project status');
	}

	validateId(workspaceId, 'Workspace ID');

	const params = new URLSearchParams();
	if (statusFilter) params.set('status', statusFilter);

	const queryStr = params.toString();
	const url = `/api/workspaces/${workspaceId}/projects${queryStr ? '?' + queryStr : ''}`;
	const data = await apiRequest(url);
	const projects = data.projects || [];

	const resultProjects = projects.map(p => ({
		id: p.id,
		name: p.name,
		color: p.color || null,
		projectNumber: p.projectNumber,
		status: p.status || 'active',
		taskCount: p.taskCount ?? 0
	}));

	const result = { projects: resultProjects };

	outputResult(result, opts, () => {
		if (resultProjects.length === 0) {
			console.log('No projects found.');
			return;
		}

		console.log(`Found ${resultProjects.length} project(s):\n`);

		for (const p of resultProjects) {
			const statusLabel = p.status !== 'active' ? ` [${p.status}]` : '';
			const taskLabel = ` (${p.taskCount} tasks)`;
			console.log(`  P-${p.projectNumber}  ${p.name}${statusLabel}${taskLabel}`);
		}
	});
}

// ─── stacks ──────────────────────────────────────────────────────────────

async function cmdStacks(args, opts) {
	const workspaceId = await getWorkspaceId();
	const data = await apiRequest(`/api/workspaces/${workspaceId}/stacks`);
	const stacks = (data.stacks || []).map(s => ({ id: s.id, name: s.name, taskPrefix: s.taskPrefix, repoIds: s.memberRepoIds || [] }));
	outputResult({ stacks }, opts, () => {
		if (stacks.length === 0) { console.log('No stacks found.'); return; }
		console.log(`Found ${stacks.length} stack(s):\n`);
		for (const s of stacks) console.log(`  ${s.taskPrefix}  ${s.name}  (${s.repoIds.length} repos)  ${s.id}`);
	});
}

async function cmdStackGet(args, opts) {
	const workspaceId = await getWorkspaceId();
	const stackId = await resolveStackId(workspaceId, args[0]);
	validateId(stackId, 'Stack ID');
	const data = await apiRequest(`/api/workspaces/${workspaceId}/stacks/${stackId}`);
	outputResult(data, opts, () => {
		const s = data.stack || data;
		console.log(`${s.taskPrefix}  ${s.name}  ${s.id}`);
		for (const r of (data.memberRepos || data.repos || data.members || [])) console.log(`  - ${r.fullName || r.name || r.id}`);
	});
}

// ─── create ──────────────────────────────────────────────────────────────

async function cmdCreate(args, opts) {
	if (args.length === 0) {
		throw new Error('Usage: lightsprint create --title <text> [--description <text>] [--complexity low|medium|high] [--status backlog|todo|in_progress|in_review|done] [--project <projectId>] [--depends-on <id1,id2,...>] [--parent <taskId>] [--cc-pid <pid>]');
	}

	const workspaceId = await getWorkspaceId();

	// Check for --json-body
	let jsonBody = null;

	// Parse args: supports both --title <text> and positional <title>
	let title = null;
	let description = null;
	let complexity = null;
	let status = 'backlog';
	let dependsOn = null;
	let parentId = null;
	let projectId = null;
	let stackFilter = null;
	let ccPidArg;

	for (let i = 0; i < args.length; i++) {
		if ((args[i] === '--json-body' || args[i] === '--json') && args[i + 1]) {
			jsonBody = args[++i];
		} else if (args[i] === '--title' && args[i + 1]) {
			title = args[++i];
		} else if (args[i] === '--description' && args[i + 1]) {
			description = args[++i];
		} else if (args[i] === '--complexity' && args[i + 1]) {
			complexity = args[++i];
		} else if (args[i] === '--status' && args[i + 1]) {
			status = args[++i];
		} else if (args[i] === '--depends-on' && args[i + 1]) {
			dependsOn = args[++i];
		} else if (args[i] === '--parent' && args[i + 1]) {
			parentId = args[++i];
		} else if (args[i] === '--project' && args[i + 1]) {
			projectId = args[++i];
		} else if (args[i] === '--stack' && args[i + 1]) {
			stackFilter = args[++i];
		} else if (args[i] === '--cc-pid' && args[i + 1]) {
			ccPidArg = parseInt(args[++i], 10);
			validatePid(ccPidArg);
		} else if (!title && !args[i].startsWith('-')) {
			// Positional: first non-flag arg is the title
			title = args[i];
		} else {
			throw new Error(`Unknown argument: ${args[i]}. Use: lightsprint create <title> [--description <text>] ...`);
		}
	}

	let body;

	if (jsonBody) {
		// Raw JSON mode — reject if combined with individual flags
		if (title || description || complexity) {
			throw new Error('Cannot combine --json/--json-body with --title, --description, --complexity. Use --json/--json-body alone.');
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
		if (!title) {
			throw new Error('Error: --title is required.');
		}

		validateTitle(title);
		validateStatus(status);
		if (description) validateDescription(description);
		if (complexity) validateComplexity(complexity);

		body = { title, status: status };
		if (description) body.description = description;
		if (complexity) body.complexity = complexity;
	}

	if (projectId) {
		validateId(projectId, 'Project ID');
		body.projectId = projectId;
	}

	body.scope = 'default';
	body.workspaceId = workspaceId;

	if (stackFilter) {
		body.stackId = await resolveStackId(workspaceId, stackFilter);
	}

	// Resolve dependency IDs (supports display IDs like LIG-024)
	let dependencyTaskIds = null;
	if (dependsOn) {
		const rawIds = dependsOn.split(',').map(s => s.trim()).filter(Boolean);
		for (const id of rawIds) validateId(id, 'Dependency task ID');
		dependencyTaskIds = await Promise.all(rawIds.map(id => resolveTaskId(id)));
	}
	if (dependencyTaskIds) body.dependencyTaskIds = dependencyTaskIds;

	// Resolve parent task ID (supports display IDs like LS-1100)
	let resolvedParentId = null;
	if (parentId) {
		validateId(parentId, 'Parent task ID');
		resolvedParentId = await resolveTaskId(parentId);
	}

	// Best-effort: discover the active CC session's Lightsprint session ID
	let lsSessionId;
	try {
		const ccPid = ccPidArg || getClaudeCodePid();
		const daemonState = findRunningDaemonForCcPid(ccPid);
		if (daemonState?.lsSessionId) {
			lsSessionId = daemonState.lsSessionId;
		}
	} catch {
		// Session discovery failed — continue without linking
	}
	if (lsSessionId) body.lsSessionId = lsSessionId;

	// Dry-run: validate only, don't call API
	if (opts.dryRun) {
		return outputDryRun('create', body, 'POST /api/tasks', opts);
	}

	validateId(workspaceId, 'Workspace ID');
	const data = await apiRequest('/api/tasks', {
		method: 'POST',
		body: JSON.stringify(body)
	});

	const task = data.task;

	// Link as subtask: parent depends-on this new task
	let parentLinked = false;
	if (resolvedParentId && task.id) {
		try {
			validateId(resolvedParentId, 'Parent task ID');
			validateId(task.id, 'New task ID');
			await apiRequest(`/api/tasks/${resolvedParentId}/dependencies`, {
				method: 'POST',
				body: JSON.stringify({ dependsOnTaskId: task.id })
			});
			parentLinked = true;
		} catch (err) {
			// Include error in output but don't fail the whole command
			console.error(`Warning: task created but failed to link to parent ${parentId}: ${err.message}`);
		}
	}

	const result = {
		task: buildTaskData(task),
		dependenciesAdded: dependencyTaskIds ? dependencyTaskIds.length : 0,
		...(resolvedParentId ? { parent: { id: resolvedParentId, linked: parentLinked } } : {})
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
		if (parentLinked) {
			console.log(`\nLinked as subtask of: ${parentId}`);
		}
		console.log(`\nTo link this task in Claude Code, create a task with:`);
		console.log(`  metadata: { lightsprint_task_id: "${task.id}" }`);
	});
}

// ─── update ──────────────────────────────────────────────────────────────

async function cmdUpdate(args, opts) {
	// Parse flags — supports both --task <id> and positional <taskId>
	let taskIdInput = null;
	let patch = {};
	const addDeps = [];
	const removeDeps = [];
	let jsonBody = null;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--task' && args[i + 1]) {
			taskIdInput = args[++i];
		} else if ((args[i] === '--json-body' || args[i] === '--json') && args[i + 1]) {
			jsonBody = args[++i];
		} else if (args[i] === '--title' && args[i + 1]) {
			patch.title = args[++i];
		} else if (args[i] === '--description' && args[i + 1]) {
			patch.description = args[++i];
		} else if (args[i] === '--status' && args[i + 1]) {
			patch.status = args[++i];
		} else if (args[i] === '--complexity' && args[i + 1]) {
			patch.complexity = args[++i];
		} else if (args[i] === '--requires-schema-change' && args[i + 1]) {
			patch.requiresSchemaChange = validateBoolean(args[++i], 'requires-schema-change');
		} else if (args[i] === '--assignee' && args[i + 1]) {
			patch.assignee = args[++i];
		} else if (args[i] === '--position' && args[i + 1]) {
			patch.position = Number(args[++i]);
		} else if (args[i] === '--project' && args[i + 1]) {
			patch.projectId = args[++i];
		} else if (args[i] === '--add-dep' && args[i + 1]) {
			addDeps.push(args[++i]);
		} else if (args[i] === '--remove-dep' && args[i + 1]) {
			removeDeps.push(args[++i]);
		} else if (!taskIdInput && !args[i].startsWith('-')) {
			taskIdInput = args[i];
		} else {
			throw new Error(`Unknown argument: ${args[i]}. Use: lightsprint update <taskId> [--status <status>] ...`);
		}
	}

	if (!taskIdInput) {
		throw new Error('Usage: lightsprint update <taskId> [--title <text>] [--description <text>] [--status backlog|todo|in_progress|in_review|done] [--complexity low|medium|high] [--requires-schema-change true|false] [--assignee <name>] [--position <num>] [--add-dep <taskId>] [--remove-dep <taskId>]');
	}

	if (jsonBody) {
		if (Object.keys(patch).length > 0) {
			throw new Error('Cannot combine --json/--json-body with --title, --description, --status, --complexity, --assignee, or --position. Use --json/--json-body alone.');
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
		if ('position' in patch) validatePosition(patch.position);
		if ('requiresSchemaChange' in patch) patch.requiresSchemaChange = validateBoolean(patch.requiresSchemaChange, 'requires-schema-change');
	}

	const hasPatch = Object.keys(patch).length > 0;
	const hasDeps = addDeps.length > 0 || removeDeps.length > 0;

	if (!hasPatch && !hasDeps) {
		throw new Error('Error: at least one field to update is required.');
	}

	validateId(taskIdInput, 'Task ID');
	if (patch.position !== undefined && patch.status) {
		throw new Error('Cannot combine --position with --status. Position reorders within the current section; status moves the task to a different section.');
	}
	if (!jsonBody) {
		if (patch.title) validateTitle(patch.title);
		if (patch.description) validateDescription(patch.description);
		if (patch.status) validateStatus(patch.status);
		if (patch.complexity) validateComplexity(patch.complexity);
		if (patch.position !== undefined) validatePosition(patch.position);
		if (patch.projectId) validateId(patch.projectId, 'Project ID');
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
	let taskIdInput = null;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--task' && args[i + 1]) {
			taskIdInput = args[++i];
		} else if (!taskIdInput && !args[i].startsWith('-')) {
			taskIdInput = args[i];
		} else {
			throw new Error(`Unknown argument: ${args[i]}. Use: lightsprint get <taskId>`);
		}
	}
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
			validatePid(ccPidArg);
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
	let taskIdInput = null;
	let ccPidArg;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--task' && args[i + 1]) {
			taskIdInput = args[++i];
		} else if (args[i] === '--cc-pid' && args[i + 1]) {
			ccPidArg = parseInt(args[++i], 10);
			validatePid(ccPidArg);
		} else if (!taskIdInput && !args[i].startsWith('-')) {
			taskIdInput = args[i];
		} else {
			throw new Error(`Unknown argument: ${args[i]}. Use: lightsprint claim <taskId>`);
		}
	}

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
	let taskIdInput = null;
	let prUrl = null;
	let force = false;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--task' && args[i + 1]) {
			taskIdInput = args[++i];
		} else if ((args[i] === '--pr-url' || args[i] === '--pr') && args[i + 1]) {
			prUrl = args[++i];
		} else if (args[i] === '--force') {
			force = true;
		} else {
			throw new Error(`Unknown argument: ${args[i]}. Use --task <taskId> --pr-url <url> [--force].`);
		}
	}

	if (!taskIdInput || !prUrl) {
		throw new Error('Usage: lightsprint link-pr --task <taskId> --pr-url <prUrl> [--force]');
	}

	validateId(taskIdInput, 'Task ID');

	// Basic validation of PR URL format
	if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(prUrl)) {
		throw new Error('Invalid GitHub PR URL. Expected format: https://github.com/owner/repo/pull/123');
	}

	const taskId = await resolveTaskId(taskIdInput);
	const data = await apiRequest(`/api/tasks/${taskId}/link-pr`, {
		method: 'POST',
		body: JSON.stringify(force ? { prUrl, force: true } : { prUrl })
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
	let taskIdInput = null;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--task' && args[i + 1]) {
			taskIdInput = args[++i];
		} else if (!taskIdInput && !args[i].startsWith('-')) {
			taskIdInput = args[i];
		} else {
			throw new Error(`Unknown argument: ${args[i]}. Use: lightsprint unlink-pr <taskId>`);
		}
	}

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

// ─── delete ─────────────────────────────────────────────────────────────

async function cmdDelete(args, opts) {
	let taskIdInput = null;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--task' && args[i + 1]) {
			taskIdInput = args[++i];
		} else if (!taskIdInput && !args[i].startsWith('-')) {
			taskIdInput = args[i];
		} else {
			throw new Error(`Unknown argument: ${args[i]}. Use: lightsprint delete <taskId>`);
		}
	}

	if (!taskIdInput) {
		throw new Error('Usage: lightsprint delete <taskId>');
	}

	validateId(taskIdInput, 'Task ID');

	if (opts.dryRun) {
		return outputDryRun('delete', { taskId: taskIdInput }, `DELETE /api/tasks/${taskIdInput}`, opts);
	}

	const taskId = await resolveTaskId(taskIdInput);
	await apiRequest(`/api/tasks/${taskId}`, {
		method: 'DELETE'
	});

	const result = { success: true, taskId, message: `Deleted task ${taskIdInput}.` };
	outputResult(result, opts, () => console.log(result.message));
}

// ─── comment ─────────────────────────────────────────────────────────────

async function cmdComment(args, opts) {
	let taskIdInput = null;
	let body = null;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--task' && args[i + 1]) {
			taskIdInput = args[++i];
		} else if (args[i] === '--body' && args[i + 1]) {
			body = args[++i];
		} else if (!args[i].startsWith('-')) {
			// Positional args: first is taskId, second is body
			if (!taskIdInput) {
				taskIdInput = args[i];
			} else if (!body) {
				body = args[i];
			} else {
				throw new Error(`Unknown argument: ${args[i]}. Use: lightsprint comment <taskId> <body>`);
			}
		} else {
			throw new Error(`Unknown argument: ${args[i]}. Use: lightsprint comment <taskId> <body>`);
		}
	}

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
	const workspaceId = await getWorkspaceId();
	const [ws, user] = await Promise.all([
		apiRequest(`/api/workspaces/${workspaceId}`),
		apiRequest(`/api/user/profile`).catch(() => null),
	]);
	const wsObj = ws.workspace || ws;
	const result = {
		user: user ? { name: user.name, email: user.email, id: user.id } : null,
		workspace: { id: workspaceId, name: wsObj?.name ?? null },
	};
	outputResult(result, opts, () => {
		if (result.user) console.log(`User: ${result.user.name}${result.user.email ? ` <${result.user.email}>` : ''}`);
		console.log(`Workspace: ${result.workspace.name ?? workspaceId} (${result.workspace.id})`);
	});
}

// ─── open ────────────────────────────────────────────────────────────────

function cmdOpen(opts) {
	const cwd = process.cwd();
	const cfg = getConfig(cwd);

	if (!cfg) {
		throw new Error('Not connected to Lightsprint. Run "lightsprint connect" first.');
	}

	const url = `${cfg.baseUrl}/workspaces/${cfg.workspaceId}/tasks`;

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
		const result = { connected: false, message: 'Not connected to Lightsprint. Run "lightsprint connect".' };
		return outputResult(result, opts, () => {
			console.log('Not connected to Lightsprint. Run "lightsprint connect".\n');
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
		workspaceId: cfg.workspaceId,
		workspaceName: cfg.workspaceName || 'unknown',
		baseUrl: cfg.baseUrl,
		token: { valid: tokenValid, remainingMs: remainingMs != null ? Math.max(0, remainingMs) : null }
	};

	outputResult(result, opts, () => {
		console.log(`Workspace:    ${cfg.workspaceName || 'unknown'}`);
		console.log(`Workspace ID: ${cfg.workspaceId}`);
		console.log(`Base URL:     ${cfg.baseUrl}`);
		if (cfg.expiresAt) {
			if (!tokenValid) {
				console.log(`Token:        expired`);
			} else {
				const hours = Math.floor(remainingMs / 3600000);
				const mins = Math.floor((remainingMs % 3600000) / 60000);
				console.log(`Token:        valid (${hours}h ${mins}m remaining)`);
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
			workspaceId: cfg.workspaceId,
			workspaceName: cfg.workspaceName
		};
		console.log(JSON.stringify(result));
	}
}

// ─── disconnect ──────────────────────────────────────────────────────

async function cmdDisconnect(args, opts) {
	const conn = readConnection();
	clearConnection();
	const result = conn
		? { disconnected: [{ workspaceId: conn.workspaceId, workspaceName: conn.workspaceName || null }] }
		: { disconnected: [], message: 'No active Lightsprint connection.' };
	outputResult(result, opts, () => {
		if (!conn) console.log(result.message);
		else console.log(`Disconnected workspace: ${conn.workspaceName || conn.workspaceId}`);
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

// ─── config ──────────────────────────────────────────────────────────────

function cmdConfig(args, opts) {
	const subcommand = args[0];
	if (!subcommand) {
		throw new Error('Usage: lightsprint config <get|set|delete|list> [key] [value]');
	}

	switch (subcommand) {
		case 'get': {
			const key = args[1];
			if (!key) throw new Error('Usage: lightsprint config get <key>');
			const value = getPreference(key);
			outputResult({ key, value }, opts, () => {
				if (value === null) {
					console.log(`(not set)`);
				} else {
					console.log(value);
				}
			});
			break;
		}
		case 'set': {
			const key = args[1];
			const value = args[2];
			if (!key || !value) throw new Error('Usage: lightsprint config set <key> <value>');
			setPreference(key, value);
			outputResult({ key, value, success: true }, opts, () => {
				console.log(`Set ${key} = ${value}`);
			});
			break;
		}
		case 'delete': {
			const key = args[1];
			if (!key) throw new Error('Usage: lightsprint config delete <key>');
			deletePreference(key);
			outputResult({ key, success: true }, opts, () => {
				console.log(`Deleted ${key}`);
			});
			break;
		}
		case 'list': {
			const prefs = readPreferences();
			outputResult(prefs, opts, () => {
				const entries = Object.entries(prefs);
				if (entries.length === 0) {
					console.log('No preferences set.');
				} else {
					for (const [k, v] of entries) {
						console.log(`${k} = ${v}`);
					}
				}
			});
			break;
		}
		default:
			throw new Error(`Unknown config subcommand: "${subcommand}". Use get, set, delete, or list.`);
	}
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

	// Support compound commands: "describe agent" lists agent subcommands,
	// "describe agent launch" or "describe agent-launch" shows specific schema
	const subName = args[1];
	const candidates = subName
		? [`${commandName}-${subName}`, `${commandName} ${subName}`]
		: [commandName];

	for (const candidate of candidates) {
		const schema = getCommandSchema(candidate);
		if (schema) {
			console.log(JSON.stringify(schema));
			return;
		}
	}

	// Check if this is a compound command parent (agent, review-hub)
	const allNames = getAllCommandNames();
	const subcommands = allNames.filter(n => n.startsWith(`${commandName}-`));
	if (subcommands.length > 0) {
		console.log(JSON.stringify({
			command: commandName,
			description: `Compound command with subcommands`,
			subcommands: subcommands.map(n => {
				const s = getCommandSchema(n);
				// Display as space-separated to match CLI invocation syntax
				// (e.g. `agent launch`, not `agent-launch`)
				const displayName = `${commandName} ${n.slice(commandName.length + 1)}`;
				return { command: displayName, description: s?.description || '' };
			})
		}));
		return;
	}

	console.error(JSON.stringify({ error: 'not_found', message: `Unknown command: "${commandName}". Use 'lightsprint describe' to list all commands.` }));
	process.exit(1);
}

// ─── agent ──────────────────────────────────────────────────────────────

async function cmdAgent(args, opts) {
	const subcommand = args[0];
	const subArgs = args.slice(1);

	switch (subcommand) {
		case 'launch': return await cmdAgentLaunch(subArgs, opts);
		case 'stop': return await cmdAgentStop(subArgs, opts);
		case 'settings': return await cmdAgentSettings(subArgs, opts);
		case 'create-pr': return await cmdAgentCreatePr(subArgs, opts);
		default:
			throw new Error(`Unknown agent subcommand: "${subcommand || ''}". Use: launch, stop, settings, create-pr`);
	}
}

async function cmdAgentLaunch(args, opts) {
	const taskIdInputs = [];
	let provider = null;
	let model = null;
	let baseRef = null;
	let environmentId = null;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--task' && args[i + 1]) {
			taskIdInputs.push(args[++i]);
		} else if (args[i] === '--provider' && args[i + 1]) {
			provider = args[++i];
		} else if (args[i] === '--model' && args[i + 1]) {
			model = args[++i];
		} else if (args[i] === '--base-ref' && args[i + 1]) {
			baseRef = args[++i];
		} else if (args[i] === '--environment-id' && args[i + 1]) {
			environmentId = args[++i];
		} else if (!args[i].startsWith('-')) {
			// Positional: treat as task ID
			taskIdInputs.push(args[i]);
		} else {
			throw new Error(`Unknown argument: ${args[i]}. Use --task, --provider, --model, --base-ref, --environment-id.`);
		}
	}

	if (taskIdInputs.length === 0) throw new Error('Usage: lightsprint agent launch --task <taskId> [--task <taskId> ...] --provider <provider>');
	if (!provider) throw new Error('--provider is required. Allowed values: anthropic, cursor, codex');

	for (const id of taskIdInputs) validateId(id, 'Task ID');
	validateProvider(provider);

	const body = {};
	if (model) body.model = model;
	if (baseRef) body.baseRef = baseRef;
	if (environmentId) body.environmentId = environmentId;

	if (opts.dryRun) {
		return outputDryRun('agent launch', body, taskIdInputs.map(id => `POST /api/tasks/${id}/cloud-agents/${provider}`).join(', '), opts);
	}

	// Launch single task directly (preserve original behavior)
	if (taskIdInputs.length === 1) {
		const taskId = await resolveTaskId(taskIdInputs[0]);
		const result = await apiRequest(`/api/tasks/${taskId}/cloud-agents/${provider}`, {
			method: 'POST',
			body: JSON.stringify(body)
		});

		outputResult(result, opts, () => {
			console.log(`Agent launched for task ${taskIdInputs[0]}`);
			console.log(`Provider: ${provider}`);
			console.log(`Status: ${result.status}`);
			if (result.agentUrl) console.log(`Agent URL: ${result.agentUrl}`);
			if (result.branchName) console.log(`Branch: ${result.branchName}`);
		});
		return;
	}

	// Launch multiple tasks concurrently
	const outcomes = await Promise.allSettled(taskIdInputs.map(async (input) => {
		const taskId = await resolveTaskId(input);
		const result = await apiRequest(`/api/tasks/${taskId}/cloud-agents/${provider}`, {
			method: 'POST',
			body: JSON.stringify(body)
		});
		return { task: input, ...result };
	}));

	const results = outcomes.map((outcome, i) => {
		if (outcome.status === 'fulfilled') {
			return outcome.value;
		}
		return { task: taskIdInputs[i], error: outcome.reason?.message || String(outcome.reason) };
	});

	outputResult(results, opts, () => {
		for (const r of results) {
			if (r.error) {
				console.log(`${r.task}: FAILED — ${r.error}`);
			} else {
				console.log(`${r.task}: ${r.status}${r.agentUrl ? ` — ${r.agentUrl}` : ''}`);
			}
		}
	});
}

async function cmdAgentStop(args, opts) {
	let taskIdInput = null;
	let provider = null;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--task' && args[i + 1]) {
			taskIdInput = args[++i];
		} else if (args[i] === '--provider' && args[i + 1]) {
			provider = args[++i];
		} else {
			throw new Error(`Unknown argument: ${args[i]}. Use --task, --provider.`);
		}
	}

	if (!taskIdInput) throw new Error('Usage: lightsprint agent stop --task <taskId> --provider <provider>');
	if (!provider) throw new Error('--provider is required. Allowed values: anthropic, cursor, codex');

	validateId(taskIdInput, 'Task ID');
	validateProvider(provider);

	if (opts.dryRun) {
		return outputDryRun('agent stop', { taskId: taskIdInput, provider }, `DELETE /api/tasks/${taskIdInput}/cloud-agents/${provider}`, opts);
	}

	const taskId = await resolveTaskId(taskIdInput);
	const result = await apiRequest(`/api/tasks/${taskId}/cloud-agents/${provider}`, {
		method: 'DELETE'
	});

	outputResult(result, opts, () => {
		console.log(`Agent interrupted for task ${taskIdInput}`);
		console.log(`Provider: ${provider}`);
	});
}

async function cmdAgentSettings(args, opts) {
	let providerFilter = null;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--provider' && args[i + 1]) {
			providerFilter = args[++i];
		} else {
			throw new Error(`Unknown argument: ${args[i]}. Use --provider.`);
		}
	}

	if (providerFilter) validateProvider(providerFilter);

	const settings = await apiRequest('/api/cloud-agents/settings');

	let environments = null;
	if (providerFilter) {
		const envResult = await apiRequest(`/api/cloud-agents/settings/environments?provider=${providerFilter}`);
		environments = envResult.environments;
	}

	const data = { ...settings };
	if (environments) {
		data.environments = { provider: providerFilter, items: environments };
	}

	outputResult(data, opts, () => {
		console.log('Provider     Configured  Default Model');
		for (const [name, info] of Object.entries(settings.providers)) {
			const configured = info.configured ? 'yes' : 'no';
			console.log(`${name.padEnd(13)}${configured.padEnd(12)}${info.defaultModel}`);
		}

		if (environments && environments.length > 0) {
			console.log(`\nEnvironments (${providerFilter}):`);
			for (const env of environments) {
				console.log(`  ${env.id.padEnd(15)}${env.name}`);
			}
		} else if (environments && environments.length === 0) {
			console.log(`\nNo environments found for ${providerFilter}.`);
		}
	});
}

async function cmdAgentCreatePr(args, opts) {
	let taskIdInput = null;
	let provider = null;
	let agentId = null;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--task' && args[i + 1]) {
			taskIdInput = args[++i];
		} else if (args[i] === '--provider' && args[i + 1]) {
			provider = args[++i];
		} else if (args[i] === '--agent-id' && args[i + 1]) {
			agentId = args[++i];
		} else {
			throw new Error(`Unknown argument: ${args[i]}. Use --task, --provider, --agent-id.`);
		}
	}

	if (!taskIdInput) throw new Error('Usage: lightsprint agent create-pr --task <taskId> --provider <provider> --agent-id <agentId>');
	if (!provider) throw new Error('--provider is required. Allowed values: anthropic, cursor, codex');
	if (!agentId) throw new Error('--agent-id is required.');

	validateId(taskIdInput, 'Task ID');
	validateProvider(provider);
	validateId(agentId, 'Agent ID');

	if (opts.dryRun) {
		return outputDryRun('agent create-pr', { taskId: taskIdInput, provider, agentId }, `POST /api/tasks/${taskIdInput}/cloud-agents/${provider}/${agentId}/create-pr`, opts);
	}

	const taskId = await resolveTaskId(taskIdInput);
	const result = await apiRequest(`/api/tasks/${taskId}/cloud-agents/${provider}/${agentId}/create-pr`, {
		method: 'POST'
	});

	outputResult(result, opts, () => {
		console.log(`PR created for task ${taskIdInput}`);
		if (result.prUrl) console.log(result.prUrl);
		if (result.prNumber) console.log(`PR #${result.prNumber}`);
		if (result.title) console.log(`Title: ${result.title}`);
	});
}

// ─── merge ───────────────────────────────────────────────────────────────

async function cmdMerge(args, opts) {
	let taskIdInput = null;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--task' && args[i + 1]) {
			taskIdInput = args[++i];
		} else if (!taskIdInput && !args[i].startsWith('-')) {
			taskIdInput = args[i];
		} else {
			throw new Error(`Unknown argument: ${args[i]}. Use: lightsprint merge <taskId>`);
		}
	}

	if (!taskIdInput) throw new Error('Usage: lightsprint merge <taskId>');
	validateId(taskIdInput, 'Task ID');

	if (opts.dryRun) {
		return outputDryRun('merge', { taskId: taskIdInput }, `POST /api/tasks/${taskIdInput}/pr/merge`, opts);
	}

	const taskId = await resolveTaskId(taskIdInput);
	const result = await apiRequest(`/api/tasks/${taskId}/pr/merge`, { method: 'POST' });

	outputResult(result, opts, () => {
		const pr = result.pr || {};
		if (pr.status === 'queued') {
			console.log(`PR #${pr.prNumber} queued for merge (task ${taskIdInput})`);
		} else {
			console.log(`PR #${pr.prNumber} merged for task ${taskIdInput}`);
			if (pr.sha) console.log(`SHA: ${pr.sha}`);
		}
		if (pr.prUrl) console.log(pr.prUrl);
	});
}

// ─── review-hub ──────────────────────────────────────────────────────────

async function cmdReviewHub(args, opts) {
	const subcommand = args[0];
	const subArgs = args.slice(1);

	switch (subcommand) {
		case 'signals': return await cmdReviewHubSignals(subArgs, opts);
		case 'scores': return await cmdReviewHubScores(subArgs, opts);
		default:
			throw new Error(`Unknown review-hub subcommand: "${subcommand || ''}". Use: signals, scores`);
	}
}

async function cmdReviewHubSignals(args, opts) {
	let taskIdInput = null;
	let refresh = false;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--task' && args[i + 1]) {
			taskIdInput = args[++i];
		} else if (args[i] === '--refresh') {
			refresh = true;
		} else if (!taskIdInput && !args[i].startsWith('-')) {
			taskIdInput = args[i];
		} else {
			throw new Error(`Unknown argument: ${args[i]}. Use --task <taskId> [--refresh].`);
		}
	}

	if (!taskIdInput) throw new Error('Usage: lightsprint review-hub signals <taskId> [--refresh]');
	validateId(taskIdInput, 'Task ID');

	if (opts.dryRun) {
		const method = refresh ? 'POST' : 'GET';
		return outputDryRun('review-hub signals', { taskId: taskIdInput, refresh }, `${method} /api/review-hub/{prId}/signals`, opts);
	}

	const { prId, prNumber } = await resolveTaskPrId(taskIdInput);

	const method = refresh ? 'POST' : 'GET';
	const result = await apiRequest(`/api/review-hub/${prId}/signals`, { method });

	outputResult(result, opts, () => {
		const signals = result.signals || [];
		console.log(`Signals for task ${taskIdInput} (PR #${prNumber}):`);
		if (signals.length === 0) {
			console.log('  No signals found.');
			return;
		}
		for (const s of signals) {
			const statusIcon = s.status === 'success' ? '\u2713' : s.status === 'failure' ? '\u2717' : '\u2022';
			const cat = (s.category || '').padEnd(10);
			const title = s.title || s.actorLogin || '';
			const detail = s.scoreLabel ? ` (${s.scoreLabel})` : '';
			console.log(`  ${cat} ${statusIcon} ${title}${detail}`);
		}
		console.log(`\n${signals.length} signal(s)${result.lastViewedAt ? ` | Last viewed: ${result.lastViewedAt}` : ''}`);
	});
}

async function cmdReviewHubScores(args, opts) {
	let taskIdInput = null;
	let refresh = false;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--task' && args[i + 1]) {
			taskIdInput = args[++i];
		} else if (args[i] === '--refresh') {
			refresh = true;
		} else if (!taskIdInput && !args[i].startsWith('-')) {
			taskIdInput = args[i];
		} else {
			throw new Error(`Unknown argument: ${args[i]}. Use --task <taskId> [--refresh].`);
		}
	}

	if (!taskIdInput) throw new Error('Usage: lightsprint review-hub scores <taskId> [--refresh]');
	validateId(taskIdInput, 'Task ID');

	if (opts.dryRun) {
		const endpoint = refresh
			? 'POST /api/review-hub/{prId}/signals + GET /api/review-hub/{prId}/ai-overlay'
			: 'GET /api/review-hub/{prId}/ai-overlay';
		return outputDryRun('review-hub scores', { taskId: taskIdInput, refresh }, endpoint, opts);
	}

	const { prId, prNumber } = await resolveTaskPrId(taskIdInput);

	// If --refresh, force-refresh signals first (clears AI cache)
	if (refresh) {
		await apiRequest(`/api/review-hub/${prId}/signals`, { method: 'POST' });
	}

	// Consume the SSE stream (returns cached or triggers fresh analysis)
	const result = await apiRequestSSE(`/api/review-hub/${prId}/ai-overlay`, { timeout: 120_000 });

	if (!result || (result.readiness_score === undefined && result.readinessScore === undefined)) {
		const data = { readinessScore: null, message: 'No scores available. Use --refresh to trigger AI analysis (consumes credits).' };
		outputResult(data, opts, () => {
			console.log(`AI Readiness for task ${taskIdInput} (PR #${prNumber}):`);
			console.log('  No cached scores available.');
			console.log('  Use --refresh to trigger AI analysis (consumes credits).');
		});
		return;
	}

	// Normalize field names (API uses snake_case)
	const data = {
		readinessScore: result.readiness_score ?? result.readinessScore,
		readinessLabel: result.readiness_label ?? result.readinessLabel,
		sectionSummaries: result.section_summaries ?? result.sectionSummaries ?? {},
		changeCallouts: result.change_callouts ?? result.changeCallouts ?? [],
		suggestedActions: result.suggested_actions ?? result.suggestedActions ?? [],
		addressal: result.addressal ?? null,
		updatedAt: result.updated_at ?? result.updatedAt ?? null
	};

	outputResult(data, opts, () => {
		console.log(`AI Readiness for task ${taskIdInput} (PR #${prNumber}):`);
		console.log(`  Score: ${data.readinessScore}/100 (${data.readinessLabel})`);

		const sections = Object.entries(data.sectionSummaries);
		if (sections.length > 0) {
			console.log('\n  Sections:');
			for (const [key, val] of sections) {
				console.log(`    ${key}: ${val}`);
			}
		}

		if (data.changeCallouts.length > 0) {
			console.log('\n  Callouts:');
			for (const c of data.changeCallouts) {
				console.log(`    - ${typeof c === 'string' ? c : c.message || JSON.stringify(c)}`);
			}
		}

		if (data.suggestedActions.length > 0) {
			console.log('\n  Suggested Actions:');
			for (const a of data.suggestedActions) {
				console.log(`    - ${typeof a === 'string' ? a : a.message || JSON.stringify(a)}`);
			}
		}
	});
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
 * Resolve a task ID input to the internal PR record ID.
 * @param {string} taskIdInput - Display ID, bare number, or raw ID
 * @returns {Promise<{ taskId: string, prId: string, prNumber: number|null, prUrl: string|null }>}
 */
async function resolveTaskPrId(taskIdInput) {
	const taskId = await resolveTaskId(taskIdInput);
	const data = await apiRequest(`/api/tasks/${taskId}`);
	const task = data.task;
	if (!task) throw new Error(`Task ${taskIdInput} not found.`);

	const prs = task.githubPullRequests;
	if (!prs || prs.length === 0) {
		throw new Error(`No PR linked to task ${taskIdInput}. Use 'lightsprint link-pr' first.`);
	}
	const pr = prs[0];
	return { taskId, prId: pr.id, prNumber: pr.prNumber || null, prUrl: pr.prUrl || null };
}

/**
 * Resolve a task reference to a real task ID.
 * Accepts:
 *   - Display ID: "LIG-024" (prefix-number)
 *   - Bare task number: "24" or "024"
 *   - Raw ID: "YCRFHw7OeZUbogdOtYnFh" (returned as-is)
 */
async function resolveTaskId(input) {
	const DISPLAY_ID_PATTERN = /^[A-Z]{2,4}-\d{1,6}$/;
	const BARE_NUMBER_PATTERN = /^\d{1,6}$/;

	// Raw task IDs are globally addressable by /api/tasks/:id. Returning them
	// directly avoids sending stack tasks through the legacy repo-board resolver,
	// which only accepts tasks whose repoId matches the connected repo.
	if (!DISPLAY_ID_PATTERN.test(input) && !BARE_NUMBER_PATTERN.test(input)) {
		return input;
	}

	const workspaceId = await getWorkspaceId();
	const data = await apiRequest(`/api/workspaces/${workspaceId}/tasks/resolve?ref=${encodeURIComponent(input)}`);
	return data.taskId;
}

/**
 * Resolve a stack reference (id, taskPrefix, or name) to a stack ID.
 * Returns null when no ref is given. Throws if no stack matches.
 */
async function resolveStackId(workspaceId, ref) {
	if (!ref) return null;
	const data = await apiRequest(`/api/workspaces/${workspaceId}/stacks`);
	const stacks = data.stacks || [];
	const lc = String(ref).toLowerCase();
	const hit = stacks.find(s => s.id === ref)
		|| stacks.find(s => (s.taskPrefix || '').toLowerCase() === lc)
		|| stacks.find(s => (s.name || '').toLowerCase() === lc);
	if (!hit) throw new Error(`No stack matches "${ref}". Run "lightsprint stacks" to list stacks.`);
	return hit.id;
}
