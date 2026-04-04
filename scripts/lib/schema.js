/**
 * Command schema definitions for `lightsprint describe <command>`.
 *
 * Provides runtime-queryable parameter info so agents can self-serve
 * instead of relying on stale documentation baked into skill prompts.
 */

import { VALID_STATUSES, VALID_COMPLEXITIES, VALID_LAYOUT_TYPES, MAX_TITLE_LENGTH, MAX_DESCRIPTION_LENGTH, MAX_COMMENT_LENGTH } from './validate.js';

const COMMAND_SCHEMAS = {
	tasks: {
		description: 'List tasks from the repo board',
		params: {
			status: { type: 'enum', flag: '--status', values: VALID_STATUSES, description: 'Filter by status' },
			assignee: { type: 'string', flag: '--assignee', description: 'Filter by assignee name/email (case-insensitive substring)' },
			project: { type: 'string', flag: '--project', description: 'Filter by project. Comma-separated project IDs or "none" for unassigned. Max 10.' },
			limit: { type: 'integer', flag: '--limit', default: 20, description: 'Max results (server max: 100)' },
			offset: { type: 'integer', flag: '--offset', default: 0, description: 'Skip first N results' },
			sort: { type: 'enum', flag: '--sort', values: ['position', 'updated_at', 'created_at'], default: 'position', description: 'Sort order: position (board order), updated_at, created_at' }
		},
		supportsDryRun: false,
		supportsJsonBody: false
	},
	projects: {
		description: 'List projects in the repo workspace',
		params: {
			status: { type: 'enum', flag: '--status', values: ['active', 'completed', 'archived'], description: 'Filter by project status' }
		},
		supportsDryRun: false,
		supportsJsonBody: false
	},
	create: {
		description: 'Create a new task',
		params: {
			title: { type: 'string', required: true, flag: '--title', maxLength: MAX_TITLE_LENGTH, description: 'Task title' },
			description: { type: 'string', flag: '--description', maxLength: MAX_DESCRIPTION_LENGTH, description: 'Task description' },
			status: { type: 'enum', flag: '--status', values: VALID_STATUSES, default: 'backlog', description: 'Initial status' },
			complexity: { type: 'enum', flag: '--complexity', values: VALID_COMPLEXITIES, description: 'Complexity estimate' },
			dependsOn: { type: 'string[]', flag: '--depends-on', description: 'Comma-separated task IDs this task depends on' },
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
			assignee: { type: 'string', flag: '--assignee', description: 'Assign to team member' },
			position: { type: 'integer', flag: '--position', description: 'New position within section (0-based)' },
			sectionId: { type: 'string', flag: '--section-id', description: 'Section to move task to' },
			layoutType: { type: 'enum', flag: '--layout-type', values: VALID_LAYOUT_TYPES, description: 'Layout type for position update (default: kanban)' },
			addDep: { type: 'string', flag: '--add-dep', repeatable: true, description: 'Add dependency (repeatable)' },
			removeDep: { type: 'string', flag: '--remove-dep', repeatable: true, description: 'Remove dependency (repeatable)' }
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
	'create-plan': {
		description: 'Create a plan on Lightsprint from markdown content',
		params: {
			content: { type: 'string', required: true, flag: '--content', maxLength: 200000, description: 'Plan content in markdown format' },
			title: { type: 'string', flag: '--title', maxLength: MAX_TITLE_LENGTH, description: 'Explicit plan title (default: extracted from content)' },
			taskId: { type: 'string', flag: '--task', description: 'Link plan to an existing task (raw or display ID)' },
			ccPid: { type: 'integer', flag: '--cc-pid', description: 'Claude Code PID for session linking' }
		},
		supportsDryRun: true,
		supportsJsonBody: false
	},
	whoami: {
		description: 'Show current repo and auth info',
		params: {},
		supportsDryRun: false,
		supportsJsonBody: false
	},
	open: {
		description: 'Open repo board in browser',
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
		description: 'Authenticate and connect to Lightsprint',
		params: {
			baseUrl: { type: 'string', flag: '--base-url', description: 'Custom Lightsprint instance URL' }
		},
		supportsDryRun: false,
		supportsJsonBody: false
	},
	disconnect: {
		description: 'Remove credentials for this repository',
		params: {},
		supportsDryRun: false,
		supportsJsonBody: false
	},
	upgrade: {
		description: 'Download and install the latest version',
		params: {},
		supportsDryRun: false,
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
