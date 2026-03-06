/**
 * cc-end.js — SessionEnd hook handler.
 *
 * Tells the daemon to shut down gracefully.
 */

import { readHookInput, readSessionState } from './lib/cc-utils.js';

export async function main(args) {
	const input = readHookInput(args);
	if (!input) return;

	const ccSessionId = input.session_id;
	if (!ccSessionId) return;

	const state = readSessionState(ccSessionId);
	if (!state) return; // No daemon running

	try {
		await fetch(`http://127.0.0.1:${state.port}/session-end`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(state.daemonToken ? { 'Authorization': `Bearer ${state.daemonToken}` } : {}),
			},
			body: JSON.stringify({}),
			signal: AbortSignal.timeout(3000),
		});
	} catch {
		// Daemon may already be dead — that's fine
	}
}
