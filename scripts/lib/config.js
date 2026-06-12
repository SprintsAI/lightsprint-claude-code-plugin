/**
 * Configuration loader for Lightsprint plugin.
 *
 * Workspace-first auth: a single active workspace is stored in
 * ~/.lightsprint/connection.json (managed by connection.js).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { readConnection, writeConnection, clearConnection } from './connection.js';

export { readConnection, writeConnection, clearConnection };

export const CONFIG_DIR = process.env.LIGHTSPRINT_CONFIG_DIR || join(homedir(), '.lightsprint');
const PLUGIN_CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const PREFERENCES_FILE = join(CONFIG_DIR, 'preferences.json');

// Known preference keys and their valid values
const KNOWN_PREFERENCES = {
	'link-pr.no-task-behavior': ['prompt', 'always-skip'],
};

export function ensureConfigDir() {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
	}
}

/**
 * Read the plugin-level config (e.g. baseUrl set during install).
 * @returns {{ baseUrl?: string }}
 */
export function readPluginConfig() {
	try {
		if (existsSync(PLUGIN_CONFIG_FILE)) {
			return JSON.parse(readFileSync(PLUGIN_CONFIG_FILE, 'utf-8'));
		}
	} catch {
		// Corrupted file, ignore
	}
	return {};
}

/**
 * Get the default base URL from env, plugin config, or hardcoded fallback.
 */
export function getDefaultBaseUrl() {
	const url = process.env.LIGHTSPRINT_BASE_URL || readPluginConfig().baseUrl || 'https://lightsprint.ai';
	// Validate URL scheme to prevent token leakage over cleartext or non-HTTP protocols
	if (url && !url.startsWith('https://')) {
		try {
			const parsed = new URL(url);
			const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
			if (isLocalhost) {
				// Localhost allows http: or https: only (reject ftp:, file:, etc.)
				if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
					console.error(`Warning: Base URL "${url}" uses unsupported protocol. Using default instead.`);
					return 'https://lightsprint.ai';
				}
			} else {
				console.error(`Warning: Base URL "${url}" does not use HTTPS. Using default instead.`);
				return 'https://lightsprint.ai';
			}
		} catch {
			console.error(`Warning: Invalid base URL "${url}". Using default instead.`);
			return 'https://lightsprint.ai';
		}
	}
	return url;
}

/**
 * Try to extract the GitHub owner/repo from the git remote URL.
 * @param {string} [cwd] - Working directory to run git in
 * @returns {string|null} e.g. "owner/repo" or null
 */
export function getGitRepoFullName(cwd) {
	try {
		const remote = execSync('git remote get-url origin', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
		// Match SSH (git@github.com:owner/repo.git) or HTTPS (https://github.com/owner/repo.git)
		const match = remote.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/);
		return match ? match[1] : null;
	} catch {
		return null;
	}
}

/**
 * Get the Lightsprint config for the active workspace.
 * The cwd argument is accepted but ignored — the active workspace is global.
 * Returns null if no workspace is connected.
 * @returns {{ accessToken: string, refreshToken: string, expiresAt: number, workspaceId: string, workspaceName: string, baseUrl: string } | null}
 */
export function getConfig() {
	const conn = readConnection();
	if (!conn || !conn.workspaceId) return null;
	const baseUrl = process.env.LIGHTSPRINT_BASE_URL || conn.baseUrl || getDefaultBaseUrl();
	return { ...conn, baseUrl };
}

/**
 * Get config or trigger on-demand OAuth.
 * Only call from interactive contexts (skills/CLI), not hooks.
 * Returns null if authentication was skipped or failed.
 * @returns {Promise<{ accessToken: string, refreshToken: string, expiresAt: number, workspaceId: string, workspaceName: string, baseUrl: string } | null>}
 */
export async function requireConfig() {
	const existing = getConfig();
	if (existing) return existing;
	const { authenticate } = await import('./auth.js');
	const result = await authenticate(getDefaultBaseUrl());
	if (!result || result.skipped) return null;
	return result;
}

// ─── Active stack ─────────────────────────────────────────────────────
// The active (chosen) stack is stored on the connection object so it lives
// and dies with the workspace context: connecting resets it, disconnecting
// drops it. Selecting a stack scopes stack-aware commands (tasks, create)
// to it by default. Without an active stack, those commands span the whole
// workspace, preserving the original workspace-scoped behavior.

/**
 * Get the active stack for the connected workspace, or null if none chosen.
 * @returns {{ id: string, name: string|null, taskPrefix: string|null } | null}
 */
export function getActiveStack() {
	const conn = readConnection();
	const s = conn?.activeStack;
	if (!s || !s.id) return null;
	return { id: s.id, name: s.name ?? null, taskPrefix: s.taskPrefix ?? null };
}

/**
 * Persist the active stack onto the connection.
 * @param {{ id: string, name?: string|null, taskPrefix?: string|null }} stack
 * @returns {{ id: string, name: string|null, taskPrefix: string|null }}
 */
export function setActiveStack(stack) {
	if (!stack || !stack.id) throw new Error('setActiveStack requires a stack with an id.');
	const conn = readConnection();
	if (!conn || !conn.workspaceId) {
		throw new Error('Not connected to a workspace. Run "lightsprint connect" first.');
	}
	conn.activeStack = {
		id: stack.id,
		name: stack.name ?? null,
		taskPrefix: stack.taskPrefix ?? null,
	};
	writeConnection(conn);
	return conn.activeStack;
}

/**
 * Clear the active stack. Returns true if one was set.
 * @returns {boolean}
 */
export function clearActiveStack() {
	const conn = readConnection();
	if (!conn || !conn.activeStack) return false;
	delete conn.activeStack;
	writeConnection(conn);
	return true;
}

// ─── User preferences ────────────────────────────────────────────────

export function readPreferences() {
	try {
		if (existsSync(PREFERENCES_FILE)) {
			return JSON.parse(readFileSync(PREFERENCES_FILE, 'utf-8'));
		}
	} catch {
		// Corrupted file, ignore
	}
	return {};
}

function writePreferences(data) {
	ensureConfigDir();
	writeFileSync(PREFERENCES_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function getPreference(key) {
	return readPreferences()[key] ?? null;
}

export function setPreference(key, value) {
	if (!(key in KNOWN_PREFERENCES)) {
		const knownKeys = Object.keys(KNOWN_PREFERENCES).join(', ');
		throw new Error(`Unknown preference key: "${key}". Known keys: ${knownKeys}`);
	}
	const validValues = KNOWN_PREFERENCES[key];
	if (!validValues.includes(value)) {
		throw new Error(`Invalid value "${value}" for "${key}". Valid values: ${validValues.join(', ')}`);
	}
	const prefs = readPreferences();
	prefs[key] = value;
	writePreferences(prefs);
}

export function deletePreference(key) {
	const prefs = readPreferences();
	if (!(key in prefs)) {
		throw new Error(`Preference "${key}" is not set.`);
	}
	delete prefs[key];
	writePreferences(prefs);
}

export { KNOWN_PREFERENCES };
