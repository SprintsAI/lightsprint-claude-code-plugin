/**
 * cc-start.js — SessionStart hook handler.
 *
 * Gate check → spawn cc-daemon as detached child → exit.
 * Claude Code calls this on session start. Must exit quickly.
 */

import { spawn, execSync } from 'child_process';
import { readHookInput, readSessionState, isPidAlive, deleteSessionState, hasRunningDaemonForCcPid, createLogger } from './lib/cc-utils.js';
import { getConfig } from './lib/config.js';

const log = createLogger('cc-start');

/**
 * Get Claude Code's PID. Walk up from current process looking for the `claude` binary.
 * Process tree may be: claude → lightsprint cc-start (direct)
 *                   or: claude → shell → lightsprint cc-start (via shell)
 */
function getClaudeCodePid() {
	let pid = process.ppid;
	for (let i = 0; i < 3; i++) {
		try {
			const command = execSync(`ps -o command= -p ${pid}`, {
				encoding: 'utf-8',
				stdio: ['pipe', 'pipe', 'pipe']
			}).trim();
			if (/\bclaude\b/i.test(command)) return pid;
			// Go up one level
			const ppid = parseInt(
				execSync(`ps -o ppid= -p ${pid}`, {
					encoding: 'utf-8',
					stdio: ['pipe', 'pipe', 'pipe']
				}).trim(),
				10
			);
			if (ppid <= 1 || isNaN(ppid)) break;
			pid = ppid;
		} catch {
			break;
		}
	}
	return process.ppid;
}

/**
 * Detect git branch from cwd.
 */
function getGitBranch(cwd) {
	try {
		return execSync('git rev-parse --abbrev-ref HEAD', {
			cwd,
			encoding: 'utf-8',
			stdio: ['pipe', 'pipe', 'pipe']
		}).trim();
	} catch {
		return null;
	}
}

export async function main(args) {
	const input = readHookInput(args);
	if (!input) {
		log('No hook input');
		return;
	}

	const cwd = input.cwd || process.cwd();
	const ccSessionId = input.session_id;

	if (!ccSessionId) {
		log('No session_id in hook input');
		return;
	}

	// Gate check: is this repo connected to Lightsprint?
	const cfg = getConfig(cwd);
	if (!cfg) {
		log('Gate check failed — repo not connected', { cwd });
		return;
	}

	// Check for stale session file
	const existing = readSessionState(ccSessionId);
	if (existing) {
		if (isPidAlive(existing.pid)) {
			// Daemon already running for this session
			return;
		}
		// Stale session file → clean up
		deleteSessionState(ccSessionId);
	}

	// Check if this Claude Code process already has a running daemon
	// (handles --continue firing SessionStart for both new and old session IDs)
	const ccPid = getClaudeCodePid();
	if (hasRunningDaemonForCcPid(ccPid)) {
		log('Daemon already running for this CC process, skipping', { ccPid, ccSessionId });
		return;
	}

	// Spawn cc-daemon as detached child
	const gitBranch = getGitBranch(cwd);
	log('Spawning daemon', { ccSessionId, projectId: cfg.projectId, ccPid, cwd });

	const daemon = spawn(process.execPath, ['cc-daemon'], {
		detached: true,
		stdio: 'ignore',
		env: {
			...process.env,
			LS_ACCESS_TOKEN: cfg.accessToken,
			LS_REFRESH_TOKEN: cfg.refreshToken || '',
			LS_EXPIRES_AT: cfg.expiresAt ? String(cfg.expiresAt) : '',
			LS_BASE_URL: cfg.baseUrl,
			LS_PROJECT_ID: cfg.projectId,
			LS_SESSION_ID: ccSessionId,
			LS_CWD: cwd,
			LS_CC_PID: String(ccPid),
			LS_GIT_BRANCH: gitBranch || '',
		}
	});
	daemon.unref();
	log('Daemon spawned', { daemonPid: daemon.pid });

	// Brief wait for daemon to be ready
	await new Promise(r => setTimeout(r, 500));
}
