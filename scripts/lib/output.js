/**
 * Output formatting helpers for Lightsprint CLI.
 *
 * Provides structured JSON output (for agents) and human-readable text output,
 * controlled by the --output flag parsed in options.js.
 */

/**
 * Output a result in the appropriate format.
 * @param {object} data - The result data object
 * @param {{ outputFormat: string, fields: string[]|null }} opts - Global options
 * @param {(data: object) => void} textFormatter - Function that prints human-readable output
 */
export function outputResult(data, opts, textFormatter) {
	if (opts.outputFormat === 'json') {
		const filtered = opts.fields ? filterFields(data, opts.fields) : data;
		console.log(JSON.stringify(filtered));
	} else {
		textFormatter(data);
	}
}

/**
 * Output an error in the appropriate format.
 * @param {string} code - Error classification code
 * @param {string} message - Human-readable error message
 * @param {object} [details={}] - Additional context (e.g. taskId, field)
 * @param {{ outputFormat: string }} opts - Global options
 */
export function outputError(code, message, details = {}, opts) {
	if (opts.outputFormat === 'json') {
		console.error(JSON.stringify({ error: code, message, ...details }));
	} else {
		console.error(message);
	}
}

/**
 * Classify an error into a standard code.
 * @param {Error} err
 * @returns {string}
 */
export function classifyError(err) {
	const msg = err.message || '';
	if (msg.includes('Invalid') || msg.includes('required') || msg.includes('exceeds maximum')) {
		return 'validation_error';
	}
	if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('Not connected') || msg.includes('not authenticated')) {
		return 'auth_error';
	}
	if (msg.includes('not found') || msg.includes('404')) {
		return 'not_found';
	}
	if (msg.includes('HTTP') || msg.includes('API') || msg.includes('fetch')) {
		return 'api_error';
	}
	return 'error';
}

/**
 * Output a dry-run result.
 * @param {string} command - Command name
 * @param {object} requestBody - The would-be request body
 * @param {string} endpoint - The would-be API endpoint
 * @param {{ outputFormat: string }} opts - Global options
 */
export function outputDryRun(command, requestBody, endpoint, opts) {
	const data = {
		dryRun: true,
		command,
		validationPassed: true,
		requestBody,
		endpoint
	};
	if (opts.outputFormat === 'json') {
		console.log(JSON.stringify(data));
	} else {
		console.log(`[dry-run] ${command}`);
		console.log(`Endpoint: ${endpoint}`);
		console.log(`Body: ${JSON.stringify(requestBody, null, 2)}`);
	}
}

/**
 * Format a task for text output. Shared across cmdGet, cmdCurrentTask, cmdClaim.
 * @param {object} task
 * @param {{ prefix?: string }} [options]
 */
export function formatTaskText(task, options = {}) {
	const prefix = options.prefix ? `${options.prefix}: ` : '';
	console.log(`${prefix}Title: ${task.title}`);
	console.log(`ID: ${task.id}`);
	console.log(`Status: ${task.status || 'unknown'}`);
	const assignee = task.assignedUser?.name || task.assignee;
	if (assignee) console.log(`Assignee: ${assignee}`);
	if (task.complexity && task.complexity !== 'unknown') {
		console.log(`Complexity: ${task.complexity}`);
	}
	if (task.project) {
		console.log(`Project: ${task.project.name}`);
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

/**
 * Build a normalized task data object for JSON output.
 * @param {object} task - Raw task from API
 * @returns {object}
 */
export function buildTaskData(task) {
	return {
		id: task.id,
		title: task.title,
		status: task.status || 'unknown',
		assignee: task.assignedUser?.name || task.assignee || null,
		complexity: (task.complexity && task.complexity !== 'unknown') ? task.complexity : null,
		project: task.project ? { id: task.project.id, name: task.project.name, color: task.project.color || null, projectNumber: task.project.projectNumber } : null,
		description: task.description || null,
		todoList: task.todoList || [],
		relatedFiles: (task.relatedFiles || []).map(f => typeof f === 'string' ? f : f.path),
		creator: task.creator ? { id: task.creator.id, name: task.creator.name, email: task.creator.email, avatar: task.creator.avatar } : null
	};
}

/**
 * Filter an object (or array of objects) to only include specified fields.
 * @param {object|object[]} data
 * @param {string[]} fields
 * @returns {object|object[]}
 */
export function filterFields(data, fields) {
	if (Array.isArray(data)) {
		return data.map(item => filterObj(item, fields));
	}
	return filterObj(data, fields);
}

function filterObj(obj, fields) {
	const result = {};
	for (const key of fields) {
		if (key in obj) {
			result[key] = obj[key];
		}
	}
	return result;
}
