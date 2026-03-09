/**
 * HTTP client for Lightsprint API.
 * Uses Node.js built-in fetch with Bearer token auth.
 * Handles automatic token refresh when access token expires.
 */

import { requireConfig, readReposFile, writeReposFile } from './config.js';

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10MB

let _config = null;

/**
 * Inject config directly (e.g., after fresh OAuth in hook context).
 * @param {object} cfg - Config object with accessToken, baseUrl, etc.
 */
export function setConfig(cfg) {
	_config = cfg;
}

async function config() {
	if (!_config) {
		_config = await requireConfig();
		if (!_config) {
			throw new Error('Lightsprint is not connected for this folder.');
		}
	}
	return _config;
}

/**
 * Refresh the access token using the refresh token.
 * Updates repos.json with new tokens atomically.
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

		// Update repos.json atomically
		const repos = readReposFile();
		const key = cfg.repo;
		if (repos[key]) {
			repos[key].accessToken = data.access_token;
			repos[key].refreshToken = data.refresh_token;
			repos[key].expiresAt = Date.now() + (data.expires_in * 1000);
			writeReposFile(repos);
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
 * Read response body with a size cap to prevent OOM on oversized responses.
 * Checks Content-Length first, then streams with a byte limit as fallback.
 * @param {Response} response
 * @returns {Promise<string>}
 */
async function readBodyCapped(response) {
	const contentLength = response.headers.get('content-length');
	if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
		throw new Error('Lightsprint API response too large');
	}
	// For responses without Content-Length, stream with a byte cap
	if (!contentLength && response.body) {
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let text = '';
		let bytesRead = 0;
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				bytesRead += value.length;
				if (bytesRead > MAX_RESPONSE_BYTES) {
					throw new Error('Lightsprint API response too large');
				}
				text += decoder.decode(value, { stream: true });
			}
			text += decoder.decode(); // flush
		} finally {
			reader.releaseLock();
		}
		return text;
	}
	return response.text();
}

/**
 * Make an authenticated request to the Lightsprint API.
 * Automatically refreshes the access token if expired.
 * @param {string} path - API path (e.g., '/api/repos/abc/tasks')
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
		const text = await readBodyCapped(response).catch(() => '');
		// Truncate error body to avoid leaking verbose server internals
		const safeText = text.length > 500 ? text.slice(0, 500) + '...' : text;
		throw new Error(`Lightsprint API ${response.status}: ${safeText}`);
	}

	if (response.status === 204) return null;
	const body = await readBodyCapped(response);
	return JSON.parse(body);
}

/**
 * Get repo info from the token.
 * @returns {Promise<{ repo: { id: string, name: string }, scopes: string[] }>}
 */
let _repoInfo = null;
export async function getRepoInfo() {
	if (_repoInfo) return _repoInfo;
	_repoInfo = await apiRequest('/api/repo-key/info');
	return _repoInfo;
}

/**
 * Get the repo ID from the token.
 * @returns {Promise<string>}
 */
export async function getRepoId() {
	// Use the repoId from config first (faster, no API call)
	const cfg = await config();
	if (cfg.repoId) return cfg.repoId;

	const info = await getRepoInfo();
	return info.repo?.id || info.project?.id;
}
