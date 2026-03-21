/**
 * cc-event.js — Activity event hook handler.
 *
 * Handles: PostToolUse (TaskCreate, TaskUpdate), SubagentStart, SubagentStop,
 *          UserPromptSubmit, Stop, TaskCompleted
 *
 * Reads hook JSON → sends raw event to daemon via HTTP.
 */

import { readHookInput, readSessionState, reportError } from './lib/cc-utils.js';

export async function main(args) {
	const input = readHookInput(args);
	if (!input) return;

	const ccSessionId = input.session_id;
	if (!ccSessionId) return;

	const state = readSessionState(ccSessionId);
	if (!state) return; // No daemon running → exit silently

	const hookEventName = input.hook_event_name;
	if (!hookEventName) return;

	// Send everything — raw hook input as payload
	const event = {
		eventType: hookEventName,
		payload: input,
	};

	try {
		await fetch(`http://127.0.0.1:${state.port}/event`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(state.daemonToken ? { 'Authorization': `Bearer ${state.daemonToken}` } : {}),
			},
			body: JSON.stringify(event),
			signal: AbortSignal.timeout(3000),
		});
	} catch (err) {
		// Daemon may be busy or dead — never block Claude Code
		reportError(ccSessionId, err, 'cc-event').catch(() => {});
		if (process.env.LIGHTSPRINT_DEBUG) {
			process.stderr.write(`[lightsprint:cc-event] ${err.message}\n`);
		}
	}
}
