/**
 * cc-stop-room.js — Stop a plan room for the current session.
 *
 * POSTs to the local daemon's /stop-room endpoint.
 * The daemon must already be running (via cc-start).
 */

import { findRunningDaemonForCcPid } from './lib/cc-utils.js';

export async function main() {
	const ccPid = parseInt(process.env.CLAUDE_CODE_PID || process.ppid, 10);
	const state = findRunningDaemonForCcPid(ccPid);
	if (!state) {
		process.stderr.write(JSON.stringify({ ok: false, error: 'no_active_session', message: 'No active Claude Code session found.' }) + '\n');
		process.exit(1);
	}

	try {
		const resp = await fetch(`http://127.0.0.1:${state.port}/stop-room`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(state.daemonToken ? { Authorization: `Bearer ${state.daemonToken}` } : {}),
			},
			body: '{}',
			signal: AbortSignal.timeout(5000),
		});

		const data = await resp.json();
		if (data.ok) {
			process.stdout.write('Plan room closed.\n');
		} else {
			process.stderr.write(`Failed to stop plan room: ${data.error}\n`);
			process.exit(1);
		}
	} catch (err) {
		process.stderr.write(`Failed to stop plan room: ${err.message}\n`);
		process.exit(1);
	}
}
