/**
 * cc-review.js — ExitPlanMode PermissionRequest hook handler.
 *
 * Sends plan content to the daemon for review (blocking).
 * The daemon handles: upload to API, open browser, wait for callback.
 *
 * If daemon is not running or unreachable, outputs deny with retry prompt.
 */

import { readSessionState, readHookInput } from './lib/cc-utils.js';
import { outputAllow, outputDeny } from './review-plan.js';

export async function main(args) {
	const input = readHookInput(args);
	if (!input) {
		outputAllow();
		return;
	}

	const ccSessionId = input?.session_id;
	if (!ccSessionId) {
		outputAllow();
		return;
	}

	const state = readSessionState(ccSessionId);
	if (!state) {
		// No daemon running — deny so the review gate blocks until daemon is available
		outputDeny('Plan review daemon is not running for this session. Please retry — the daemon may still be starting.');
		return;
	}

	try {
		const res = await fetch(`http://127.0.0.1:${state.port}/review-plan`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(state.daemonToken ? { 'Authorization': `Bearer ${state.daemonToken}` } : {}),
			},
			body: JSON.stringify({
				plan: input?.tool_input?.plan,
				allowedPrompts: input?.tool_input?.allowedPrompts,
				transcriptPath: input?.transcript_path,
				sessionId: ccSessionId,
			}),
			signal: AbortSignal.timeout(345600000), // 4 day timeout
		});

		if (!res.ok) {
			outputDeny('Plan review daemon returned an error. Please retry.');
			return;
		}

		const result = await res.json();

		if (result.decision === 'deny') {
			outputDeny(result.feedback);
		} else {
			outputAllow();
		}
	} catch (err) {
		// Daemon unreachable — deny so plan review gate blocks until daemon recovers
		outputDeny('Plan review daemon is unreachable. Please retry — the daemon may be restarting.');
	}

	process.exit(0);
}
