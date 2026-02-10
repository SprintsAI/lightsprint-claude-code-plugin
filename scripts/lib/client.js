/**
 * HTTP client for Lightsprint API.
 * Uses Node.js built-in fetch with Bearer token auth.
 */

import { requireConfig } from './config.js';

let _config = null;

function config() {
	if (!_config) _config = requireConfig();
	return _config;
}

/**
 * Make an authenticated request to the Lightsprint API.
 * @param {string} path - API path (e.g., '/api/projects/abc/tasks')
 * @param {object} [options] - fetch options
 * @returns {Promise<any>} Parsed JSON response
 */
export async function apiRequest(path, options = {}) {
	const { apiKey, baseUrl } = config();
	const url = `${baseUrl}${path}`;

	const response = await fetch(url, {
		...options,
		headers: {
			'Authorization': `Bearer ${apiKey}`,
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
 * Get project info from the API key.
 * @returns {Promise<{ project: { id: string, name: string }, scopes: string[] }>}
 */
let _projectInfo = null;
export async function getProjectInfo() {
	if (_projectInfo) return _projectInfo;
	_projectInfo = await apiRequest('/api/project-key/info');
	return _projectInfo;
}

/**
 * Get the project ID from the API key.
 * @returns {Promise<string>}
 */
export async function getProjectId() {
	const info = await getProjectInfo();
	return info.project.id;
}
