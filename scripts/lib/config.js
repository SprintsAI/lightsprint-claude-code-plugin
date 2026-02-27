/**
 * Configuration loader for Lightsprint plugin.
 *
 * Per-folder auth resolution:
 * 1. Walk up from process.cwd() in ~/.lightsprint/projects.json
 * 2. Fall back to git main worktree path (supports git worktrees)
 * 3. If no match found, trigger browser-based OAuth (interactive only)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

const CONFIG_DIR = join(homedir(), '.lightsprint');
const PROJECTS_FILE = join(CONFIG_DIR, 'projects.json');
const PLUGIN_CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export function ensureConfigDir() {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true });
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
	return process.env.LIGHTSPRINT_BASE_URL || readPluginConfig().baseUrl || 'https://lightsprint.ai';
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
	writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2));
}

/**
 * Try to resolve the git main worktree path.
 * Returns null if not in a git repo or git is unavailable.
 */
function getGitMainWorktree() {
	try {
		return execSync('git worktree list --porcelain', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
			.split('\n')
			.find(line => line.startsWith('worktree '))
			?.replace('worktree ', '') || null;
	} catch {
		return null;
	}
}

/**
 * Find the project config for the current working directory.
 * Resolution order:
 * 1. Walk up from cwd to find a matching folder
 * 2. If in a git worktree, try the main worktree path
 *
 * @returns {{ accessToken: string, refreshToken: string, expiresAt: number, projectId: string, projectName: string, folder: string } | null}
 */
function findProjectConfig(startDir) {
	const projects = readProjectsFile();
	let dir = startDir || process.cwd();

	while (true) {
		if (projects[dir]) {
			return { ...projects[dir], folder: dir };
		}
		const parent = dirname(dir);
		if (parent === dir) break; // reached root
		dir = parent;
	}

	// Fall back to the git main worktree (supports git worktrees)
	const mainWorktree = getGitMainWorktree();
	if (mainWorktree && projects[mainWorktree]) {
		return { ...projects[mainWorktree], folder: mainWorktree };
	}

	return null;
}

/**
 * Get the Lightsprint config for the current folder.
 * Returns null for both unconfigured and skipped folders (hooks should skip silently).
 * @returns {{ accessToken: string, refreshToken: string, expiresAt: number, projectId: string, projectName: string, folder: string, baseUrl: string } | null}
 */
export function getConfig(cwd) {
	const project = findProjectConfig(cwd);
	if (!project || project.skipped) return null;

	// Env var overrides stored baseUrl, which overrides plugin config, which overrides hardcoded default
	const baseUrl = process.env.LIGHTSPRINT_BASE_URL || project.baseUrl || getDefaultBaseUrl();

	return {
		...project,
		baseUrl
	};
}

/**
 * Get config or trigger on-demand OAuth.
 * Only call from interactive contexts (skills/CLI), not hooks.
 * Returns null if the user previously skipped this folder.
 * @returns {Promise<{ accessToken: string, refreshToken: string, expiresAt: number, projectId: string, projectName: string, folder: string, baseUrl: string } | null>}
 */
export async function requireConfig() {
	// Check for skipped folders before calling getConfig (which hides them)
	const project = findProjectConfig();
	if (project?.skipped) {
		console.log('Lightsprint is not connected for this folder (previously skipped).');
		return null;
	}

	const existing = getConfig();
	if (existing) return existing;

	// No config for this folder — trigger OAuth
	const { authenticate } = await import('./auth.js');
	const baseUrl = getDefaultBaseUrl();
	const result = await authenticate(baseUrl);

	// User skipped during OAuth flow
	if (result.skipped) return null;

	return result;
}
