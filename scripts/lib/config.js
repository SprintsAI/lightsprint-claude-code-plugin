/**
 * Configuration loader for Lightsprint plugin.
 *
 * Per-project auth resolution:
 * 1. Git repo full name lookup (owner/repo) in ~/.lightsprint/projects.json
 * 2. If no match found, trigger browser-based OAuth (interactive only)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

const CONFIG_DIR = join(homedir(), '.lightsprint');
const PROJECTS_FILE = join(CONFIG_DIR, 'projects.json');
const PLUGIN_CONFIG_FILE = join(CONFIG_DIR, 'config.json');

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
	// Reject non-localhost HTTP URLs to prevent token leakage over cleartext
	if (url && !url.startsWith('https://')) {
		try {
			const parsed = new URL(url);
			const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
			if (!isLocalhost) {
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

export function readProjectsFile() {
	try {
		if (existsSync(PROJECTS_FILE)) {
			return JSON.parse(readFileSync(PROJECTS_FILE, 'utf-8'));
		}
	} catch {
		// Corrupted file, ignore
	}
	return {};
}

export function writeProjectsFile(data) {
	ensureConfigDir();
	writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
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
 * Find the project config by git repo full name (owner/repo).
 *
 * @returns {{ accessToken: string, refreshToken: string, expiresAt: number, projectId: string, projectName: string, repo: string } | null}
 */
function findProjectConfig(startDir) {
	const projects = readProjectsFile();
	const dir = startDir || process.cwd();

	const repoName = getGitRepoFullName(dir);
	if (repoName && projects[repoName]) {
		return { ...projects[repoName], repo: repoName };
	}

	return null;
}

/**
 * Get the Lightsprint config for the current repo.
 * Returns null for unconfigured and skipped repos (hooks should skip silently).
 * @returns {{ accessToken: string, refreshToken: string, expiresAt: number, projectId: string, projectName: string, repo: string, baseUrl: string } | null}
 */
export function getConfig(cwd) {
	const project = findProjectConfig(cwd);
	if (!project || project.skipped) return null;

	const baseUrl = process.env.LIGHTSPRINT_BASE_URL || project.baseUrl || getDefaultBaseUrl();

	return {
		...project,
		baseUrl
	};
}

/**
 * Get config or trigger on-demand OAuth.
 * Only call from interactive contexts (skills/CLI), not hooks.
 * Returns null if the user previously skipped this repo.
 * @returns {Promise<{ accessToken: string, refreshToken: string, expiresAt: number, projectId: string, projectName: string, repo: string, baseUrl: string } | null>}
 */
export async function requireConfig() {
	const project = findProjectConfig();
	if (project?.skipped) {
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
