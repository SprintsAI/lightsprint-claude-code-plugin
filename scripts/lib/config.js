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

function promptSetup() {
	try {
		const key = execSync(
			`osascript -e 'text returned of (display dialog "Enter your Lightsprint project API key:" default answer "ls_pk_" with title "Lightsprint Plugin Setup")'`,
			{ encoding: 'utf-8', timeout: 60000 }
		).trim();
		if (!key || !key.startsWith('ls_pk_')) return null;

		let baseUrl = '';
		try {
			baseUrl = execSync(
				`osascript -e 'text returned of (display dialog "Enter your Lightsprint base URL:" default answer "https://lightsprint.ai" with title "Lightsprint Plugin Setup")'`,
				{ encoding: 'utf-8', timeout: 60000 }
			).trim();
		} catch {
			// User cancelled — use default
		}

		const config = readConfigFile();
		config.apiKey = key;
		if (baseUrl && baseUrl !== 'https://lightsprint.ai') {
			config.baseUrl = baseUrl;
		}
		writeConfigFile(config);
		return { apiKey: key, baseUrl: baseUrl || null };
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
	const defaultBaseUrl = 'https://lightsprint.ai';

	// 1. Environment variable
	const envKey = process.env.LIGHTSPRINT_API_KEY;
	if (envKey) {
		return {
			apiKey: envKey,
			baseUrl: process.env.LIGHTSPRINT_BASE_URL || defaultBaseUrl
		};
	}

	// 2. Config file
	const config = readConfigFile();
	if (config.apiKey) {
		return {
			apiKey: config.apiKey,
			baseUrl: process.env.LIGHTSPRINT_BASE_URL || config.baseUrl || defaultBaseUrl
		};
	}

	// 3. macOS prompt
	const prompted = promptSetup();
	if (prompted) {
		return {
			apiKey: prompted.apiKey,
			baseUrl: process.env.LIGHTSPRINT_BASE_URL || prompted.baseUrl || defaultBaseUrl
		};
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
