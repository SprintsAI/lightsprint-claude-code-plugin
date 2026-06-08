/**
 * HTTP client for Lightsprint API.
 * Uses Node.js built-in fetch with Bearer token auth.
 * Handles automatic token refresh when access token expires.
 */

import { requireConfig, readReposFile, writeReposFile } from './config.js';
import { withFileLock } from './filelock.js';
import { join } from 'path';
import { homedir } from 'os';

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10MB
export const DEFAULT_TIMEOUT_MS = 30_000;

let _config = null;

let _onError = null;

/**
 * Set an error reporting callback. Called when retries are exhausted or auth fails.
 * Only set in daemon context where Sentry is initialized.
 * @param {(error: Error, context: object) => void} fn
 */
export function setErrorReporter(fn) {
	_onError = fn;
}

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
			signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: cfg.refreshToken
			})
		});

		if (!response.ok) {
			console.error(`Lightsprint: token refresh failed (${response.status}). Please re-run install.sh.`);
			if (_onError) _onError(new Error(`Token refresh failed: ${response.status}`), { source: 'client-auth' });
			return false;
		}

		const data = await response.json();

		// Update repos.json atomically with file lock
		const configDir = process.env.LIGHTSPRINT_CONFIG_DIR || join(homedir(), '.lightsprint');
		const lockPath = join(configDir, 'repos.json.lock');
		await withFileLock(lockPath, () => {
			const repos = readReposFile();
			const key = cfg.repo;
			if (repos[key]) {
				repos[key].accessToken = data.access_token;
				repos[key].refreshToken = data.refresh_token;
				repos[key].expiresAt = Date.now() + (data.expires_in * 1000);
				writeReposFile(repos);
			}
		});

		// Update in-memory config
		cfg.accessToken = data.access_token;
		cfg.refreshToken = data.refresh_token;
		cfg.expiresAt = Date.now() + (data.expires_in * 1000);

		return true;
	} catch (err) {
		console.error('Lightsprint: token refresh error:', err.message);
		if (_onError) _onError(err, { source: 'client-auth' });
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
 * Parse JSON with descriptive errors for non-JSON responses.
 * @param {string} body - Response body text
 * @returns {any} Parsed JSON
 */
export function safeJsonParse(body) {
	if (!body || body.length === 0) {
		throw new Error('Lightsprint API: empty response body');
	}
	try {
		return JSON.parse(body);
	} catch {
		if (body.trimStart().startsWith('<')) {
			throw new Error(`Lightsprint API: unexpected non-JSON response (HTML). First 200 chars: ${body.slice(0, 200)}`);
		}
		throw new Error(`Lightsprint API: failed to parse response as JSON. First 200 chars: ${body.slice(0, 200)}`);
	}
}

/**
 * Fetch with retry for 5xx and network errors.
 * @param {string} url
 * @param {object} options - fetch options
 * @param {Function} [fetchFn=fetch] - fetch implementation (for testing)
 * @param {{ maxRetries?: number, baseDelayMs?: number }} [retryOpts]
 * @returns {Promise<Response>}
 */
export async function retryableFetch(url, options = {}, fetchFn = fetch, retryOpts = {}) {
	const maxRetries = retryOpts.maxRetries ?? 3;
	const baseDelayMs = retryOpts.baseDelayMs ?? 1000;
	let lastResponse;
	let lastError;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			const response = await fetchFn(url, options);

			// Don't retry client errors (4xx) except 429
			if (response.status === 429) {
				const retryAfter = response.headers.get('Retry-After');
				let delayMs = baseDelayMs * Math.pow(2, attempt);
				if (retryAfter) {
					const seconds = Number(retryAfter);
					if (Number.isFinite(seconds) && seconds > 0) {
						delayMs = seconds * 1000;
					} else {
						// Try HTTP-date format (e.g. "Thu, 01 Dec 1994 16:00:00 GMT")
						const date = new Date(retryAfter);
						if (!isNaN(date.getTime())) {
							delayMs = Math.max(0, date.getTime() - Date.now());
						}
					}
				}
				if (attempt < maxRetries) {
					await new Promise(r => setTimeout(r, delayMs));
					continue;
				}
				return response;
			}

			if (response.status < 500) return response;

			// 5xx — retry with backoff
			lastResponse = response;
			if (attempt < maxRetries) {
				const jitter = 0.8 + Math.random() * 0.4;
				await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, attempt) * jitter));
				continue;
			}
			if (_onError) {
				_onError(new Error(`API ${response.status} after ${maxRetries} retries: ${url}`), {
					source: 'client', extras: { status: response.status, url, attempts: maxRetries + 1 },
				});
			}
			return response;
		} catch (err) {
			lastError = err;
			if (attempt < maxRetries) {
				const jitter = 0.8 + Math.random() * 0.4;
				await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, attempt) * jitter));
				continue;
			}
			if (_onError) {
				_onError(err, { source: 'client', extras: { url, attempts: maxRetries + 1 } });
			}
			throw err;
		}
	}

	if (lastResponse) return lastResponse;
	throw lastError;
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
	const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
	const { timeoutMs: _, ...fetchOptions } = options;

	const response = await retryableFetch(url, {
		...fetchOptions,
		signal: options.signal || AbortSignal.timeout(timeoutMs),
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
	return safeJsonParse(body);
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

/**
 * Get the workspace ID for the connected repo from the token.
 * The CLI is repo-scoped; stacks live at the workspace layer, so most
 * stack/task operations resolve the workspace from `/api/repo-key/info`.
 * @returns {Promise<string>}
 */
export async function getWorkspaceId() {
	const info = await getRepoInfo();
	const workspaceId = info.workspaceId || info.repo?.workspaceId || info.project?.workspaceId;
	if (!workspaceId) {
		throw new Error('Could not resolve a workspace for this connection. Re-run "lightsprint connect" to refresh your credentials.');
	}
	return workspaceId;
}

/**
 * Make an authenticated SSE request to the Lightsprint API.
 * Consumes the event stream and returns the final 'complete' event payload.
 * @param {string} path - API path
 * @param {{ timeout?: number }} [options]
 * @returns {Promise<object|null>} Parsed payload from the 'complete' event, or null if stream was empty
 */
export async function apiRequestSSE(path, options = {}) {
	const timeout = options.timeout || 120_000;
	const cfg = await config();

	const refreshed = await refreshTokenIfNeeded();
	if (!refreshed) {
		throw new Error('Lightsprint: unable to authenticate. Please re-run install.sh.');
	}

	const url = `${cfg.baseUrl}${path}`;
	const response = await retryableFetch(url, {
		signal: AbortSignal.timeout(timeout),
		headers: {
			'Authorization': `Bearer ${cfg.accessToken}`,
			'Accept': 'text/event-stream'
		}
	});

	if (!response.ok) {
		const text = await readBodyCapped(response).catch(() => '');
		const safeText = text.length > 500 ? text.slice(0, 500) + '...' : text;
		throw new Error(`Lightsprint API ${response.status}: ${safeText}`);
	}

	// Empty 200 response (no signals / no content)
	const contentType = response.headers.get('content-type') || '';
	if (!contentType.includes('text/event-stream')) {
		// Server returned a non-SSE response (e.g. empty JSON for no signals)
		const body = await readBodyCapped(response);
		if (!body || body.trim() === '') return null;
		return safeJsonParse(body);
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop(); // keep incomplete line in buffer

			for (const line of lines) {
				if (!line.startsWith('data: ')) continue;
				const raw = line.slice(6).trim();
				if (!raw) continue;

				let data;
				try {
					data = JSON.parse(raw);
				} catch {
					continue; // skip malformed SSE data lines
				}

				if (data.type === 'complete') {
					return data.payload !== undefined ? data.payload : data;
				}
				if (data.type === 'error') {
					throw new Error(data.message || 'AI analysis failed');
				}
				// 'progress' events: silently continue
			}
		}
	} finally {
		reader.releaseLock();
	}

	// Stream ended without a complete event
	return null;
}
