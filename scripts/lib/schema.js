/**
 * Command schema definitions for `lightsprint describe <command>`.
 *
 * Provides runtime-queryable parameter info so agents can self-serve
 * instead of relying on stale documentation baked into skill prompts.
 */

import { VALID_STATUSES, VALID_COMPLEXITIES, VALID_PROVIDERS, MAX_TITLE_LENGTH, MAX_DESCRIPTION_LENGTH, MAX_COMMENT_LENGTH } from './validate.js';

const COMMAND_SCHEMAS = {
	tasks: {
		description: 'List tasks from the active workspace board',
		params: {
			status: { type: 'enum', flag: '--status', values: VALID_STATUSES, description: 'Filter by status' },
			assignee: { type: 'string', flag: '--assignee', description: 'Filter by assignee name/email (case-insensitive substring)' },
			project: { type: 'string', flag: '--project', description: 'Filter by project. Comma-separated project IDs or "none" for unassigned. Max 10.' },
			stack: { type: 'string', flag: '--stack', description: 'Filter by stack (stack ID, task prefix, or name)' },
			limit: { type: 'integer', flag: '--limit', default: 20, description: 'Max results (server max: 100)' },
			offset: { type: 'integer', flag: '--offset', default: 0, description: 'Skip first N results' },
			sort: { type: 'enum', flag: '--sort', values: ['position', 'updated_at', 'created_at'], default: 'position', description: 'Sort order: position (board order), updated_at, created_at' }
		},
		supportsDryRun: false,
		supportsJsonBody: false
	},
	projects: {
		description: 'List projects in the active workspace',
		params: {
			status: { type: 'enum', flag: '--status', values: ['active', 'completed', 'archived'], description: 'Filter by project status' }
		},
		supportsDryRun: false,
		supportsJsonBody: false
	},
	stacks: {
		description: 'List stacks in the active workspace',
		params: {},
		supportsDryRun: false,
		supportsJsonBody: false
	},
	'stacks-get': {
		description: 'Show a stack and its member repos (accepts stack ID, task prefix, or name)',
		params: {
			ref: { type: 'string', required: true, description: 'Stack ID, task prefix, or name' }
		},
		supportsDryRun: false,
		supportsJsonBody: false
	},
	create: {
		description: 'Create a new task in the active workspace (default stack unless --stack given)',
		params: {
			title: { type: 'string', required: true, flag: '--title', maxLength: MAX_TITLE_LENGTH, description: 'Task title' },
			description: { type: 'string', flag: '--description', maxLength: MAX_DESCRIPTION_LENGTH, description: 'Task description' },
			status: { type: 'enum', flag: '--status', values: VALID_STATUSES, default: 'backlog', description: 'Initial status' },
			complexity: { type: 'enum', flag: '--complexity', values: VALID_COMPLEXITIES, description: 'Complexity estimate' },
			dependsOn: { type: 'string[]', flag: '--depends-on', description: 'Comma-separated task IDs this task depends on' },
			projectId: { type: 'string', flag: '--project', description: 'Assign to a project by ID' },
			stack: { type: 'string', flag: '--stack', description: 'Create in a stack (stack ID, task prefix, or name)' },
			ccPid: { type: 'integer', flag: '--cc-pid', description: 'Claude Code PID for session linking' }
		},
		supportsDryRun: true,
		supportsJsonBody: true
	},
	update: {
		description: 'Update an existing task',
		params: {
			taskId: { type: 'string', required: true, flag: '--task', description: 'Task ID (raw or display ID like LIG-024)' },
			title: { type: 'string', flag: '--title', maxLength: MAX_TITLE_LENGTH, description: 'New title' },
			description: { type: 'string', flag: '--description', maxLength: MAX_DESCRIPTION_LENGTH, description: 'New description' },
			status: { type: 'enum', flag: '--status', values: VALID_STATUSES, description: 'New status' },
			complexity: { type: 'enum', flag: '--complexity', values: VALID_COMPLEXITIES, description: 'New complexity' },
			requiresSchemaChange: { type: 'boolean', flag: '--requires-schema-change', description: 'Whether the task involves a DB schema change (drives the schema-change badge)' },
			assignee: { type: 'string', flag: '--assignee', description: 'Assign to team member' },
			position: { type: 'integer', flag: '--position', description: 'New position within section (0-based)' },
			addDep: { type: 'string', flag: '--add-dep', repeatable: true, description: 'Add dependency (repeatable)' },
			removeDep: { type: 'string', flag: '--remove-dep', repeatable: true, description: 'Remove dependency (repeatable)' },
			projectId: { type: 'string', flag: '--project', description: 'Move task to a project by ID' }
		},
		supportsDryRun: true,
		supportsJsonBody: true
	},
	get: {
		description: 'Show full task details including dependencies',
		params: {
			taskId: { type: 'string', required: true, flag: '--task', description: 'Task ID (raw or display ID)' }
		},
		supportsDryRun: false,
		supportsJsonBody: false
	},
	claim: {
		description: 'Claim a task (set to in_progress, assign to you, link CC session)',
		params: {
			taskId: { type: 'string', required: true, flag: '--task', description: 'Task ID' },
			ccPid: { type: 'integer', flag: '--cc-pid', description: 'Claude Code PID for session linking' }
		},
		supportsDryRun: true,
		supportsJsonBody: false
	},
	'current-task': {
		description: 'Get the task linked to the current CC session',
		params: {
			ccPid: { type: 'integer', flag: '--cc-pid', description: 'Claude Code PID' }
		},
		supportsDryRun: false,
		supportsJsonBody: false
	},
	'link-pr': {
		description: 'Link a GitHub PR to a task',
		params: {
			taskId: { type: 'string', required: true, flag: '--task', description: 'Task ID' },
			prUrl: { type: 'string', required: true, flag: '--pr-url', description: 'GitHub PR URL (https://github.com/owner/repo/pull/N)' }
		},
		supportsDryRun: false,
		supportsJsonBody: false
	},
	'unlink-pr': {
		description: 'Remove a linked PR from a task',
		params: {
			taskId: { type: 'string', required: true, flag: '--task', description: 'Task ID' }
		},
		supportsDryRun: false,
		supportsJsonBody: false
	},
	comment: {
		description: 'Add a comment to a task',
		params: {
			taskId: { type: 'string', required: true, flag: '--task', description: 'Task ID' },
			body: { type: 'string', required: true, flag: '--body', maxLength: MAX_COMMENT_LENGTH, description: 'Comment text' }
		},
		supportsDryRun: true,
		supportsJsonBody: false
	},
	whoami: {
		description: 'Show the connected workspace and auth info',
		params: {},
		supportsDryRun: false,
		supportsJsonBody: false
	},
	open: {
		description: 'Open the active workspace board in browser',
		params: {},
		supportsDryRun: false,
		supportsJsonBody: false
	},
	status: {
		description: 'Show connection status',
		params: {},
		supportsDryRun: false,
		supportsJsonBody: false
	},
	connect: {
		description: 'Authenticate and connect to a Lightsprint workspace',
		params: {
			baseUrl: { type: 'string', flag: '--base-url', description: 'Custom Lightsprint instance URL' }
		},
		supportsDryRun: false,
		supportsJsonBody: false
	},
	disconnect: {
		description: 'Remove the active workspace credentials',
		params: {},
		supportsDryRun: false,
		supportsJsonBody: false
	},
	upgrade: {
		description: 'Download and install the latest version',
		params: {},
		supportsDryRun: false,
		supportsJsonBody: false
	},
	'agent-launch': {
		description: 'Launch a cloud agent for a task',
		params: {
			taskId: { type: 'string', required: true, flag: '--task', description: 'Task ID (raw or display ID)' },
			provider: { type: 'enum', required: true, flag: '--provider', values: VALID_PROVIDERS, description: 'Cloud agent provider' },
			model: { type: 'string', flag: '--model', description: 'Override default model for the provider' },
			baseRef: { type: 'string', flag: '--base-ref', description: 'Base branch (defaults to repo default branch)' },
			environmentId: { type: 'string', flag: '--environment-id', description: 'Environment ID (for codex/anthropic)' },
			autoMerge: { type: 'boolean', flag: '--auto-merge', description: 'Arm auto-merge: the autopilot merges the PR at 100/100 readiness with green CI. Bare flag — takes no value. Needs merge permission (any role but member_no_merge). Use when the user asks for an "auto-merge", "automerge", or "yolo" launch. Omitting this and --no-auto-merge inherits the task\'s current setting — it does NOT mean off.' },
			noAutoMerge: { type: 'boolean', flag: '--no-auto-merge', description: 'Launch with auto-merge explicitly off, overriding a setting already armed on the task.' },
			yes: { type: 'boolean', flag: '--yes', description: 'Confirm arming auto-merge across more than one --task. Without it, --auto-merge with multiple tasks is refused.' }
		},
		supportsDryRun: true,
		supportsJsonBody: false
	},
	'agent-stop': {
		description: 'Stop the active cloud agent for a task',
		params: {
			taskId: { type: 'string', required: true, flag: '--task', description: 'Task ID' },
			provider: { type: 'enum', required: true, flag: '--provider', values: VALID_PROVIDERS, description: 'Cloud agent provider' }
		},
		supportsDryRun: true,
		supportsJsonBody: false
	},
	'agent-settings': {
		description: 'Show cloud agent provider configuration',
		params: {
			provider: { type: 'enum', flag: '--provider', values: VALID_PROVIDERS, description: 'Also fetch environments for this provider' }
		},
		supportsDryRun: false,
		supportsJsonBody: false
	},
	'agent-create-pr': {
		description: 'Create a GitHub PR from a cloud agent working branch',
		params: {
			taskId: { type: 'string', required: true, flag: '--task', description: 'Task ID (raw or display ID)' },
			provider: { type: 'enum', required: true, flag: '--provider', values: VALID_PROVIDERS, description: 'Cloud agent provider' },
			agentId: { type: 'string', required: true, flag: '--agent-id', description: 'Agent ID' }
		},
		supportsDryRun: true,
		supportsJsonBody: false
	},
	'ask-list': {
		description: 'List Codebase Ask threads in the active workspace',
		params: {
			limit: { type: 'integer', flag: '--limit', description: 'Max results' },
			offset: { type: 'integer', flag: '--offset', default: 0, description: 'Skip first N results' }
		},
		supportsDryRun: false,
		supportsJsonBody: false
	},
	'ask-create': {
		description: 'Create a new Codebase Ask thread',
		params: {
			stack: { type: 'string', flag: '--stack', description: 'Target stack (stack ID, task prefix, or name)' },
			title: { type: 'string', flag: '--title', description: 'Thread title' }
		},
		supportsDryRun: false,
		supportsJsonBody: false
	},
	'ask-get': {
		description: 'Show details of a Codebase Ask thread',
		params: {
			threadId: { type: 'string', required: true, flag: '--thread', description: 'Thread ID' }
		},
		supportsDryRun: false,
		supportsJsonBody: false
	},
	'ask-messages': {
		description: 'List or send messages in a Codebase Ask thread. Send via --content flag.',
		params: {
			threadId: { type: 'string', required: true, flag: '--thread', description: 'Thread ID' },
			content: { type: 'string', flag: '--content', description: 'Message content to send. Omit to list messages.' }
		},
		supportsDryRun: false,
		supportsJsonBody: false
	},
	'ask-cancel': {
		description: 'Cancel the currently running turn in an Ask thread',
		params: {
			threadId: { type: 'string', required: true, flag: '--thread', description: 'Thread ID' }
		},
		supportsDryRun: false,
		supportsJsonBody: false
	},
	'ask-delete': {
		description: 'Delete a Codebase Ask thread permanently',
		params: {
			threadId: { type: 'string', required: true, flag: '--thread', description: 'Thread ID' }
		},
		supportsDryRun: false,
		supportsJsonBody: false
	},
	merge: {
		description: 'Merge the GitHub PR linked to a task',
		params: {
			taskId: { type: 'string', required: true, flag: '--task', description: 'Task ID (raw or display ID)' }
		},
		supportsDryRun: true,
		supportsJsonBody: false
	},
	'review-hub-signals': {
		description: 'Get PR signals (CI, reviews, comments) for a task linked PR',
		params: {
			taskId: { type: 'string', required: true, flag: '--task', description: 'Task ID (raw or display ID)' },
			refresh: { type: 'boolean', flag: '--refresh', description: 'Force re-fetch signals from GitHub' }
		},
		supportsDryRun: true,
		supportsJsonBody: false
	},
	'review-hub-scores': {
		description: 'Get AI readiness analysis for a task linked PR',
		params: {
			taskId: { type: 'string', required: true, flag: '--task', description: 'Task ID (raw or display ID)' },
			refresh: { type: 'boolean', flag: '--refresh', description: 'Refresh signals and trigger fresh AI analysis' }
		},
		supportsDryRun: true,
		supportsJsonBody: false
	},
	delete: {
		description: 'Delete a task permanently',
		params: {
			taskId: { type: 'string', required: true, flag: '--task', description: 'Task ID (raw or display ID like LIG-024)' }
		},
		supportsDryRun: true,
		supportsJsonBody: false
	}
};

/**
 * Get schema for a specific command.
 * @param {string} name
 * @returns {object|null}
 */
export function getCommandSchema(name) {
	const schema = COMMAND_SCHEMAS[name];
	if (!schema) return null;
	return { command: name, ...schema };
}

/**
 * Get all command names.
 * @returns {string[]}
 */
export function getAllCommandNames() {
	return Object.keys(COMMAND_SCHEMAS);
}
