/**
 * Configuration loader for Lightsprint plugin.
 *
 * Per-folder auth resolution:
 * 1. Walk up from process.cwd() in ~/.lightsprint/projects.json
 * 2. Fall back to git main worktree path (supports git worktrees)
 * 3. Error if no match found (user must run install.sh)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

const CONFIG_DIR = join(homedir(), '.lightsprint');
const PROJECTS_FILE = join(CONFIG_DIR, 'projects.json');

export function ensureConfigDir() {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true });
	}
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
function findProjectConfig() {
	const projects = readProjectsFile();
	let dir = process.cwd();

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
 * @returns {{ accessToken: string, refreshToken: string, expiresAt: number, projectId: string, projectName: string, folder: string, baseUrl: string } | null}
 */
export function getConfig() {
	const defaultBaseUrl = 'https://lightsprint.ai';
	const baseUrl = process.env.LIGHTSPRINT_BASE_URL || defaultBaseUrl;

	const project = findProjectConfig();
	if (!project) return null;

	return {
		...project,
		baseUrl
	};
}

/**
 * Get config or exit with error message.
 * @returns {{ accessToken: string, refreshToken: string, expiresAt: number, projectId: string, projectName: string, folder: string, baseUrl: string }}
 */
export function requireConfig() {
	const config = getConfig();
	if (!config) {
		console.error('Lightsprint not connected for this folder.');
		console.error('Run install.sh in your project folder to connect.');
		process.exit(1);
	}
	return config;
}
