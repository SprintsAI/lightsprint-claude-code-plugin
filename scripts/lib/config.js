/**
 * Configuration loader for Lightsprint plugin.
 *
 * Resolution order:
 * 1. LIGHTSPRINT_API_KEY environment variable
 * 2. ~/.lightsprint/config.json
 * 3. macOS osascript dialog prompt (saves to config.json)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

const CONFIG_DIR = join(homedir(), '.lightsprint');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

function ensureConfigDir() {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true });
	}
}

function readConfigFile() {
	try {
		if (existsSync(CONFIG_FILE)) {
			return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
		}
	} catch {
		// Corrupted config, ignore
	}
	return {};
}

function writeConfigFile(config) {
	ensureConfigDir();
	writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function promptApiKey() {
	try {
		const result = execSync(
			`osascript -e 'text returned of (display dialog "Enter your Lightsprint project API key:" default answer "ls_pk_" with title "Lightsprint Plugin Setup")'`,
			{ encoding: 'utf-8', timeout: 60000 }
		).trim();
		if (result && result.startsWith('ls_pk_')) {
			const config = readConfigFile();
			config.apiKey = result;
			writeConfigFile(config);
			return result;
		}
	} catch {
		// User cancelled or osascript not available
	}
	return null;
}

/**
 * Get the Lightsprint API key.
 * @returns {{ apiKey: string, baseUrl: string } | null}
 */
export function getConfig() {
	const baseUrl = process.env.LIGHTSPRINT_BASE_URL || 'https://lightsprint.ai';

	// 1. Environment variable
	const envKey = process.env.LIGHTSPRINT_API_KEY;
	if (envKey) {
		return { apiKey: envKey, baseUrl };
	}

	// 2. Config file
	const config = readConfigFile();
	if (config.apiKey) {
		return { apiKey: config.apiKey, baseUrl };
	}

	// 3. macOS prompt
	const prompted = promptApiKey();
	if (prompted) {
		return { apiKey: prompted, baseUrl };
	}

	return null;
}

/**
 * Get config or exit with error message.
 * @returns {{ apiKey: string, baseUrl: string }}
 */
export function requireConfig() {
	const config = getConfig();
	if (!config) {
		console.error('Lightsprint API key not configured.');
		console.error('Set LIGHTSPRINT_API_KEY environment variable or run a Lightsprint skill to configure.');
		process.exit(1);
	}
	return config;
}
