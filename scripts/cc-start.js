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
 * Get the command name for a given PID (cross-platform).
 * @param {number} pid
 * @returns {string|null}
 */
function getProcessCommand(pid) {
	try {
		if (process.platform === 'win32') {
			const out = execSync(`wmic process where ProcessId=${pid} get CommandLine /format:list`, {
				encoding: 'utf-8',
				stdio: ['pipe', 'pipe', 'pipe']
			}).trim();
			const match = out.match(/CommandLine=(.*)/);
			return match ? match[1].trim() : null;
		}
		return execSync(`ps -o command= -p ${pid}`, {
			encoding: 'utf-8',
			stdio: ['pipe', 'pipe', 'pipe']
		}).trim();
	} catch {
		return null;
	}
}

/**
 * Get the parent PID for a given PID (cross-platform).
 * @param {number} pid
 * @returns {number|null}
 */
function getParentPid(pid) {
	try {
		if (process.platform === 'win32') {
			const out = execSync(`wmic process where ProcessId=${pid} get ParentProcessId /format:list`, {
				encoding: 'utf-8',
				stdio: ['pipe', 'pipe', 'pipe']
			}).trim();
			const match = out.match(/ParentProcessId=(\d+)/);
			return match ? parseInt(match[1], 10) : null;
		}
		const ppid = parseInt(
			execSync(`ps -o ppid= -p ${pid}`, {
				encoding: 'utf-8',
				stdio: ['pipe', 'pipe', 'pipe']
			}).trim(),
			10
		);
		return isNaN(ppid) ? null : ppid;
	} catch {
		return null;
	}
}

/**
 * Get Claude Code's PID. Walk up from current process looking for the `claude` binary.
 * Process tree may be: claude → lightsprint cc-start (direct)
 *                   or: claude → shell → lightsprint cc-start (via shell)
 */
function getClaudeCodePid() {
	let pid = process.ppid;
	for (let i = 0; i < 3; i++) {
		const command = getProcessCommand(pid);
		if (!command) break;
		if (/\bclaude\b/i.test(command)) return pid;
		const ppid = getParentPid(pid);
		if (!ppid || ppid <= 1) break;
		pid = ppid;
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

	// Poll daemon health endpoint until ready (or timeout)
	const maxWaitMs = 5000;
	const pollIntervalMs = 100;
	const start = Date.now();
	while (Date.now() - start < maxWaitMs) {
		try {
			const state = readSessionState(ccSessionId);
			if (state?.port) {
				const resp = await fetch(`http://127.0.0.1:${state.port}/health`, {
					signal: AbortSignal.timeout(500),
				});
				if (resp.ok) {
					log('Daemon ready', { elapsedMs: Date.now() - start });
					break;
				}
			}
		} catch {
			// Not ready yet
		}
		await new Promise(r => setTimeout(r, pollIntervalMs));
	}
}
