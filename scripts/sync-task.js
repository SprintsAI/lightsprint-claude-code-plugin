#!/usr/bin/env node
/**
 * sync-task.js — PostToolUse hook handler for TaskCreate/TaskUpdate.
 *
 * Called by Claude Code hooks with JSON on stdin containing:
 *   { session_id, tool_name, tool_input, tool_response, ... }
 *
 * On TaskCreate: creates a task in Lightsprint and stores the ID mapping.
 * On TaskUpdate: patches the corresponding Lightsprint task.
 * On Task (subagent): posts a comment to the active task with subagent details.
 */

import { apiRequest, getProjectId } from './lib/client.js';
import { setMapping, getMapping, setActiveTask, getActiveTask, clearActiveTask } from './lib/task-map.js';
import { ccToLsStatus } from './lib/status-mapper.js';
import { getConfig } from './lib/config.js';
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const LOG_DIR = join(homedir(), '.lightsprint');
const LOG_FILE = join(LOG_DIR, 'sync.log');

function output(json) {
	process.stdout.write(JSON.stringify(json));
}

function log(level, message, data) {
	try {
		if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
		const ts = new Date().toISOString();
		const line = `${ts} [${level}] ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`;
		appendFileSync(LOG_FILE, line);
	} catch {
		// Never crash on logging
	}
}

async function main() {
	const action = process.argv[2]; // "create", "update", or "subagent"

	// Read hook stdin first (need cwd for config resolution)
	let input;
	try {
		const chunks = [];
		for await (const chunk of process.stdin) {
			chunks.push(chunk);
		}
		input = JSON.parse(Buffer.concat(chunks).toString());
	} catch (err) {
		log('error', 'Failed to parse stdin', { error: err.message });
		process.exit(0); // Don't block the agent
	}

	const hookCwd = input?.cwd || process.cwd();

	// Check config exists using cwd from stdin
	if (!getConfig(hookCwd)) {
		log('warn', 'No project configured for this folder, skipping sync', { cwd: hookCwd });
		process.exit(0);
	}

	const { tool_input, tool_response } = input;

	try {
		if (action === 'create') {
			await handleCreate(tool_input, tool_response, input.session_id);
		} else if (action === 'update') {
			await handleUpdate(tool_input, tool_response);
		} else if (action === 'subagent') {
			await handleSubagent(tool_input, tool_response);
		} else if (action === 'list') {
			await handleList();
		} else if (action === 'get') {
			await handleGet(tool_input);
		}
	} catch (err) {
		log('error', `sync-task ${action} failed`, { error: err.message });
		// Exit 0 so we don't block the agent
	}

	process.exit(0);
}

async function handleCreate(toolInput, toolResponse, sessionId) {
	// Extract CC task ID from tool_response
	// TaskCreate tool_response contains the created task info
	const ccTaskId = toolResponse?.id || toolResponse?.taskId;
	if (!ccTaskId) {
		log('warn', 'No task ID in tool_response', { toolResponse });
		return;
	}

	const subject = toolInput?.subject;
	const description = toolInput?.description;
	const metadata = toolInput?.metadata;

	// If metadata has lightsprint_task_id, this is a claimed task — just store mapping
	if (metadata?.lightsprint_task_id) {
		setMapping(String(ccTaskId), metadata.lightsprint_task_id);
		log('info', 'Stored mapping for claimed task', { ccTaskId, lsTaskId: metadata.lightsprint_task_id });
		return;
	}

	const projectId = await getProjectId();

	// Build task payload
	const payload = {
		title: subject || 'Untitled task',
		description: description || '',
		projectStatus: 'todo'
	};

	// Extract metadata fields if present
	if (metadata?.complexity) payload.complexity = metadata.complexity;
	if (metadata?.todoList) payload.todoList = metadata.todoList;
	if (metadata?.relatedFiles) payload.relatedFiles = metadata.relatedFiles;

	const result = await apiRequest(`/api/projects/${projectId}/tasks`, {
		method: 'POST',
		body: JSON.stringify(payload)
	});

	const lsTaskId = result?.id || result?.task?.id;
	if (lsTaskId) {
		setMapping(String(ccTaskId), lsTaskId);
		log('info', 'Created LS task', { ccTaskId, lsTaskId, title: payload.title });
	}
}

async function handleUpdate(toolInput, toolResponse) {
	const ccTaskId = toolInput?.taskId;
	if (!ccTaskId) {
		log('warn', 'No taskId in tool_input for update');
		return;
	}

	const lsTaskId = getMapping(String(ccTaskId));
	if (!lsTaskId) {
		log('warn', 'No LS mapping found for CC task', { ccTaskId });
		return;
	}

	// Track active task
	if (toolInput.status === 'in_progress') {
		setActiveTask(lsTaskId);
	} else if (toolInput.status === 'completed' || toolInput.status === 'deleted') {
		clearActiveTask();
	}

	// Handle deletion
	if (toolInput.status === 'deleted') {
		try {
			await apiRequest(`/api/tasks/${lsTaskId}`, { method: 'DELETE' });
			log('info', 'Deleted LS task', { ccTaskId, lsTaskId });
		} catch (err) {
			log('error', 'Failed to delete LS task', { lsTaskId, error: err.message });
		}
		return;
	}

	// Build patch payload
	const patch = {};

	if (toolInput.subject) patch.title = toolInput.subject;
	if (toolInput.description !== undefined) patch.description = toolInput.description;
	if (toolInput.status) {
		const lsStatus = ccToLsStatus(toolInput.status);
		if (lsStatus) patch.projectStatus = lsStatus;
	}
	if (toolInput.owner !== undefined) patch.assignee = toolInput.owner;

	// Metadata fields
	if (toolInput.metadata) {
		if (toolInput.metadata.complexity) patch.complexity = toolInput.metadata.complexity;
		if (toolInput.metadata.todoList) patch.todoList = toolInput.metadata.todoList;
		if (toolInput.metadata.relatedFiles) patch.relatedFiles = toolInput.metadata.relatedFiles;
	}

	if (Object.keys(patch).length === 0) {
		log('info', 'No patchable fields for update', { ccTaskId });
		return;
	}

	await apiRequest(`/api/tasks/${lsTaskId}`, {
		method: 'PATCH',
		body: JSON.stringify(patch)
	});

	log('info', 'Updated LS task', { ccTaskId, lsTaskId, fields: Object.keys(patch) });
}

async function handleList() {
	const projectId = await getProjectId();
	const data = await apiRequest(`/api/projects/${projectId}/tasks?limit=20`);
	const tasks = data.tasks || [];

	if (tasks.length === 0) {
		output({ systemMessage: '[Lightsprint] No tasks on the board.' });
		return;
	}

	const lines = [`[Lightsprint] ${tasks.length} task(s)${data.totalCount > tasks.length ? ` of ${data.totalCount} total` : ''}:`];
	for (const task of tasks) {
		const status = task.projectStatus || 'unknown';
		const assignee = task.assignee ? ` [${task.assignee}]` : '';
		const complexity = task.complexity && task.complexity !== 'unknown' ? ` (${task.complexity})` : '';
		const desc = task.description ? ' — ' + task.description.slice(0, 80).replace(/\n/g, ' ') + (task.description.length > 80 ? '...' : '') : '';
		lines.push(`  ${task.id}  [${status}]${assignee}${complexity}  ${task.title}${desc}`);
	}

	output({ systemMessage: lines.join('\n') });
	log('info', 'Listed LS tasks', { count: tasks.length });
}

async function handleGet(toolInput) {
	const ccTaskId = toolInput?.taskId;
	if (!ccTaskId) {
		log('warn', 'No taskId in tool_input for get');
		return;
	}

	const lsTaskId = getMapping(String(ccTaskId));
	if (!lsTaskId) {
		log('info', 'No LS mapping for CC task on get', { ccTaskId });
		return;
	}

	const data = await apiRequest(`/api/tasks/${lsTaskId}`);
	const task = data.task;
	if (!task) {
		log('warn', 'LS task not found', { lsTaskId });
		return;
	}

	const lines = [`[Lightsprint] Task: ${task.title}`];
	lines.push(`  ID: ${task.id}`);
	lines.push(`  Status: ${task.projectStatus || 'unknown'}`);
	if (task.assignee) lines.push(`  Assignee: ${task.assignee}`);
	if (task.complexity && task.complexity !== 'unknown') lines.push(`  Complexity: ${task.complexity}`);
	if (task.description) lines.push(`  Description: ${task.description.slice(0, 200).replace(/\n/g, ' ')}${task.description.length > 200 ? '...' : ''}`);
	if (task.todoList && task.todoList.length > 0) {
		lines.push('  Todo:');
		for (const item of task.todoList) {
			lines.push(`    ${item.completed ? '[x]' : '[ ]'} ${item.text}`);
		}
	}
	if (task.relatedFiles && task.relatedFiles.length > 0) {
		lines.push('  Related files:');
		for (const f of task.relatedFiles) {
			lines.push(`    - ${typeof f === 'string' ? f : f.path}`);
		}
	}

	output({ systemMessage: lines.join('\n') });
	log('info', 'Fetched LS task details', { ccTaskId, lsTaskId });
}

async function handleSubagent(toolInput, toolResponse) {
	const lsTaskId = getActiveTask();
	if (!lsTaskId) {
		log('info', 'No active task for subagent event, skipping');
		return;
	}

	const agentType = toolInput?.subagent_type || 'unknown';
	const description = toolInput?.description || '';

	const body = `🤖 Spawned **${agentType}** subagent: ${description}`;

	await apiRequest(`/api/tasks/${lsTaskId}/comments`, {
		method: 'POST',
		body: JSON.stringify({ body })
	});

	log('info', 'Posted subagent comment', { lsTaskId, agentType, description });
}

main();
