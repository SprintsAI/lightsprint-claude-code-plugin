/**
 * Configuration loader for Lightsprint plugin.
 *
 * Per-folder auth resolution:
 * 1. Look up process.cwd() in ~/.lightsprint/projects.json
 * 2. Walk up parent directories for monorepo support
 * 3. Error if no match found (user must run install.sh)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

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
 * Find the project config for the current working directory.
 * Walks up parent directories to support monorepos.
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
