/**
 * CC Session utilities for Lightsprint plugin.
 *
 * Shared helpers for CC session management:
 * - Logging (createLogger)
 * - Network (findFreePort)
 * - Session file I/O (per-session state in ~/.lightsprint/cc-sessions/)
 */

import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, appendFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';
import { createServer as createNetServer } from 'net';

const SESSIONS_DIR = join(homedir(), '.lightsprint', 'cc-sessions');

/**
 * Create a logger that writes to ~/.lightsprint/daemon.log.
 * Ensures the log directory exists once at creation time.
 * @param {string} tag - e.g. 'cc-daemon', 'cc-start'
 * @returns {(msg: string, data?: object) => void}
 */
export function createLogger(tag) {
	const logDir = join(homedir(), '.lightsprint');
	const logFile = join(logDir, 'daemon.log');
	mkdirSync(logDir, { recursive: true });
	return function log(msg, data) {
		const ts = new Date().toISOString();
		const line = data ? `${ts} [${tag}] ${msg} ${JSON.stringify(data)}\n` : `${ts} [${tag}] ${msg}\n`;
		try {
			appendFileSync(logFile, line);
		} catch { /* never crash on logging */ }
	};
}

/**
 * Find a free port on 127.0.0.1.
 * @returns {Promise<number>}
 */
export function findFreePort() {
	return new Promise((resolve, reject) => {
		const server = createNetServer();
		server.listen(0, '127.0.0.1', () => {
			const port = server.address().port;
			server.close(() => resolve(port));
		});
		server.on('error', reject);
	});
}

/**
 * Get path to session file for a given CC session ID.
 * @param {string} ccSessionId
 * @returns {string}
 */
function sessionFilePath(ccSessionId) {
	return join(SESSIONS_DIR, `${ccSessionId}.json`);
}

/**
 * Write session state atomically.
 * @param {string} ccSessionId
 * @param {object} state - { port, pid, ccPid, lsSessionId, projectId }
 */
export function writeSessionState(ccSessionId, state) {
	mkdirSync(SESSIONS_DIR, { recursive: true });
	const filePath = sessionFilePath(ccSessionId);
	const tmp = filePath + '.' + randomBytes(4).toString('hex');
	writeFileSync(tmp, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }));
	renameSync(tmp, filePath);
}

/**
 * Read session state for a CC session.
 * @param {string} ccSessionId
 * @returns {object|null} - { port, pid, ccPid, lsSessionId, projectId } or null
 */
export function readSessionState(ccSessionId) {
	try {
		return JSON.parse(readFileSync(sessionFilePath(ccSessionId), 'utf-8'));
	} catch {
		return null;
	}
}

/**
 * Delete session state file.
 * @param {string} ccSessionId
 */
export function deleteSessionState(ccSessionId) {
	try {
		unlinkSync(sessionFilePath(ccSessionId));
	} catch {
		// ENOENT or other — ignore
	}
}

/**
 * Check if any daemon is already running for a given Claude Code PID.
 * Scans all session state files in cc-sessions/.
 * @param {number} ccPid - Claude Code process PID
 * @returns {boolean}
 */
export function hasRunningDaemonForCcPid(ccPid) {
	try {
		const files = readdirSync(SESSIONS_DIR);
		for (const file of files) {
			if (!file.endsWith('.json')) continue;
			try {
				const state = JSON.parse(readFileSync(join(SESSIONS_DIR, file), 'utf-8'));
				if (state.ccPid === ccPid && isPidAlive(state.pid)) {
					return true;
				}
			} catch { continue; }
		}
	} catch { /* dir doesn't exist yet */ }
	return false;
}

/**
 * Check if a PID is alive.
 * @param {number} pid
 * @returns {boolean}
 */
export function isPidAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return e.code !== 'ESRCH';
	}
}

/**
 * Read hook input from file argument or stdin.
 * PermissionRequest hooks pass a file path as args[0].
 * Other hooks (SessionStart, PostToolUse, etc.) pass JSON via stdin.
 * @param {string[]} args - CLI args (first may be a file path)
 * @returns {object|null} - Parsed JSON or null
 */
export function readHookInput(args) {
	// Try file argument first (PermissionRequest hooks)
	try {
		const filePath = args[0];
		if (filePath) {
			const raw = readFileSync(filePath, 'utf-8');
			return JSON.parse(raw);
		}
	} catch {
		// Fall through to stdin
	}

	// Try stdin (SessionStart, PostToolUse, etc.)
	try {
		if (!process.stdin.isTTY) {
			const raw = readFileSync('/dev/stdin', 'utf-8');
			if (raw.trim()) return JSON.parse(raw);
		}
	} catch {
		// No input available
	}

	return null;
}
