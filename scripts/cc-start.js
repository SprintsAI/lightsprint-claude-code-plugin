/**
 * cc-start.js — SessionStart hook handler.
 *
 * Gate check → spawn cc-daemon as detached child → exit.
 * Claude Code calls this on session start. Must exit quickly.
 */

import { spawn, execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';
import { readHookInput, readSessionState, writeSessionState, isPidAlive, deleteSessionState, findRunningDaemonForCcPid, createLogger, getClaudeCodePid } from './lib/cc-utils.js';
import { getConfig } from './lib/config.js';
import { withFileLock } from './lib/filelock.js';

const log = createLogger('cc-start');

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
		if (isPidAlive(existing.daemonPid)) {
			// Daemon already running for this session
			return;
		}
		// Stale session file → clean up
		deleteSessionState(ccSessionId);
	}

	// Use lockfile to prevent concurrent daemon spawning
	const configDir = process.env.LIGHTSPRINT_CONFIG_DIR || join(homedir(), '.lightsprint');
	const lockPath = join(configDir, 'cc-start.lock');
	const ccPid = getClaudeCodePid();

	await withFileLock(lockPath, async () => {
		// Check if this Claude Code process already has a running daemon
		// (handles --continue firing SessionStart for both new and old session IDs)
		const existingDaemonState = findRunningDaemonForCcPid(ccPid);
		if (existingDaemonState) {
			// Create a session state file for the new session ID pointing to the existing daemon,
			// so hooks using this session_id can still find the daemon's port.
			log('Daemon already running for this CC process, aliasing session', { ccPid, ccSessionId });
			writeSessionState(ccSessionId, {
				port: existingDaemonState.port,
				daemonPid: existingDaemonState.daemonPid,
				ccPid: existingDaemonState.ccPid,
				ccSessionId,
				lsSessionId: existingDaemonState.lsSessionId,
				repoId: existingDaemonState.repoId,
			});
			return;
		}

		// Spawn cc-daemon as detached child
		const gitBranch = getGitBranch(cwd);
		log('Spawning daemon', { ccSessionId, repoId: cfg.repoId, ccPid, cwd });

		// Write credentials to a temp file (0o600) so they don't leak via /proc/pid/environ
		const credsDir = join(configDir, 'cc-sessions');
		mkdirSync(credsDir, { recursive: true, mode: 0o700 });
		const credsPath = join(credsDir, `.creds-${randomBytes(8).toString('hex')}.json`);
		writeFileSync(credsPath, JSON.stringify({
			accessToken: cfg.accessToken,
			refreshToken: cfg.refreshToken || '',
			expiresAt: cfg.expiresAt ? String(cfg.expiresAt) : '',
		}), { mode: 0o600 });

		// Only pass non-sensitive env vars + path to credentials file
		// When running from source (bun lightsprint.js cc-start), we need to pass
		// the script path so the daemon spawns as `bun lightsprint.js cc-daemon`.
		// When running as a compiled binary, process.execPath IS the binary.
		const scriptPath = process.argv[1]?.endsWith('.js') ? process.argv[1] : null;
		const daemonArgs = scriptPath ? [scriptPath, 'cc-daemon'] : ['cc-daemon'];
		const daemon = spawn(process.execPath, daemonArgs, {
			detached: true,
			stdio: 'ignore',
			env: {
				PATH: process.env.PATH,
				HOME: process.env.HOME,
				NODE_ENV: process.env.NODE_ENV || '',
				LIGHTSPRINT_BASE_URL: process.env.LIGHTSPRINT_BASE_URL || '',
				LS_CREDS_FILE: credsPath,
				LS_BASE_URL: cfg.baseUrl,
				LS_REPO_ID: cfg.repoId,
				LS_SESSION_ID: ccSessionId,
				LS_CWD: cwd,
				LS_CC_PID: String(ccPid),
				LS_GIT_BRANCH: gitBranch || '',
			}
		});
		daemon.unref();
		log('Daemon spawned', { daemonPid: daemon.pid });
	});

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
