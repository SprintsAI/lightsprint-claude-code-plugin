/**
 * Configuration loader for Lightsprint plugin.
 *
 * Per-repo auth resolution:
 * 1. Git repo full name lookup (owner/repo) in ~/.lightsprint/repos.json
 * 2. If no match found, trigger browser-based OAuth (interactive only)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

const CONFIG_DIR = join(homedir(), '.lightsprint');
const REPOS_FILE = join(CONFIG_DIR, 'repos.json');
const PLUGIN_CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const PREFERENCES_FILE = join(CONFIG_DIR, 'preferences.json');

// Known preference keys and their valid values
const KNOWN_PREFERENCES = {
	'link-pr.no-task-behavior': ['prompt', 'always-skip', 'always-create'],
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

export function readReposFile() {
	try {
		if (existsSync(REPOS_FILE)) {
			return JSON.parse(readFileSync(REPOS_FILE, 'utf-8'));
		}
	} catch {
		// Corrupted file, ignore
	}
	return {};
}

export function writeReposFile(data) {
	ensureConfigDir();
	writeFileSync(REPOS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
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
 * Find the repo config by git repo full name (owner/repo).
 *
 * @returns {{ accessToken: string, refreshToken: string, expiresAt: number, repoId: string, repoName: string, repo: string } | null}
 */
function findRepoConfig(startDir) {
	const repos = readReposFile();
	const dir = startDir || process.cwd();

	const repoName = getGitRepoFullName(dir);
	if (repoName && repos[repoName]) {
		return { ...repos[repoName], repo: repoName };
	}

	return null;
}

/**
 * Get the Lightsprint config for the current repo.
 * Returns null for unconfigured and skipped repos (hooks should skip silently).
 * @returns {{ accessToken: string, refreshToken: string, expiresAt: number, repoId: string, repoName: string, repo: string, baseUrl: string } | null}
 */
export function getConfig(cwd) {
	const repo = findRepoConfig(cwd);
	if (!repo || repo.skipped) return null;

	const baseUrl = process.env.LIGHTSPRINT_BASE_URL || repo.baseUrl || getDefaultBaseUrl();

	return {
		...repo,
		baseUrl
	};
}

/**
 * Get config or trigger on-demand OAuth.
 * Only call from interactive contexts (skills/CLI), not hooks.
 * Returns null if the user previously skipped this repo.
 * @returns {Promise<{ accessToken: string, refreshToken: string, expiresAt: number, repoId: string, repoName: string, repo: string, baseUrl: string } | null>}
 */
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

export async function requireConfig() {
	const repo = findRepoConfig();
	if (repo?.skipped) {
		console.log('Lightsprint is not connected for this repository (previously skipped).');
		return null;
	}

	const existing = getConfig();
	if (existing) return existing;

	// No config for this repo — trigger OAuth
	const { authenticate } = await import('./auth.js');
	const baseUrl = getDefaultBaseUrl();
	const result = await authenticate(baseUrl);

	if (result.skipped) return null;

	return result;
}
