/**
 * HTTP client for Lightsprint API.
 * Uses Node.js built-in fetch with Bearer token auth.
 * Handles automatic token refresh when access token expires.
 */

import { requireConfig, readProjectsFile, writeProjectsFile } from './config.js';

let _config = null;

async function config() {
	if (!_config) _config = await requireConfig();
	return _config;
}

/**
 * Refresh the access token using the refresh token.
 * Updates projects.json with new tokens atomically.
 * @returns {boolean} true if refresh succeeded
 */
async function refreshTokenIfNeeded() {
	const cfg = await config();

	// Check if token expires within 5 minutes
	const fiveMinutes = 5 * 60 * 1000;
	if (cfg.expiresAt && cfg.expiresAt > Date.now() + fiveMinutes) {
		return true; // Token still valid
	}

	if (!cfg.refreshToken) {
		return false;
	}

	try {
		const response = await fetch(`${cfg.baseUrl}/oauth/token`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: cfg.refreshToken
			})
		});

		if (!response.ok) {
			console.error(`Lightsprint: token refresh failed (${response.status}). Please re-run install.sh.`);
			return false;
		}

		const data = await response.json();

		// Update projects.json atomically
		const projects = readProjectsFile();
		if (projects[cfg.folder]) {
			projects[cfg.folder].accessToken = data.access_token;
			projects[cfg.folder].refreshToken = data.refresh_token;
			projects[cfg.folder].expiresAt = Date.now() + (data.expires_in * 1000);
			writeProjectsFile(projects);
		}

		// Update in-memory config
		cfg.accessToken = data.access_token;
		cfg.refreshToken = data.refresh_token;
		cfg.expiresAt = Date.now() + (data.expires_in * 1000);

		return true;
	} catch (err) {
		console.error('Lightsprint: token refresh error:', err.message);
		return false;
	}
}

/**
 * Make an authenticated request to the Lightsprint API.
 * Automatically refreshes the access token if expired.
 * @param {string} path - API path (e.g., '/api/projects/abc/tasks')
 * @param {object} [options] - fetch options
 * @returns {Promise<any>} Parsed JSON response
 */
export async function apiRequest(path, options = {}) {
	const cfg = await config();

	// Refresh token if needed
	const refreshed = await refreshTokenIfNeeded();
	if (!refreshed) {
		throw new Error('Lightsprint: unable to authenticate. Please re-run install.sh.');
	}

	const url = `${cfg.baseUrl}${path}`;

	const response = await fetch(url, {
		...options,
		headers: {
			'Authorization': `Bearer ${cfg.accessToken}`,
			'Content-Type': 'application/json',
			...options.headers
		}
	});

	if (!response.ok) {
		const text = await response.text().catch(() => '');
		throw new Error(`Lightsprint API ${response.status}: ${text}`);
	}

	if (response.status === 204) return null;
	return response.json();
}

/**
 * Get project info from the token.
 * @returns {Promise<{ project: { id: string, name: string }, scopes: string[] }>}
 */
let _projectInfo = null;
export async function getProjectInfo() {
	if (_projectInfo) return _projectInfo;
	_projectInfo = await apiRequest('/api/project-key/info');
	return _projectInfo;
}

/**
 * Get the project ID from the token.
 * @returns {Promise<string>}
 */
export async function getProjectId() {
	// Use the projectId from config first (faster, no API call)
	const cfg = await config();
	if (cfg.projectId) return cfg.projectId;

	const info = await getProjectInfo();
	return info.project.id;
}
