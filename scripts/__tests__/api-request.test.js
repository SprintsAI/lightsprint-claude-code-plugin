import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { apiRequest, setConfig } from '../lib/client.js';

let server;
let port;
let lastRequestHeaders = {};

beforeAll(() => {
	server = Bun.serve({
		port: 0, // random available port
		fetch(req) {
			const url = new URL(req.url);
			// Record headers for inspection
			lastRequestHeaders = Object.fromEntries(req.headers.entries());

			switch (url.pathname) {
				case '/api/success':
					return new Response(JSON.stringify({ id: 'task-1', title: 'Test Task' }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					});

				case '/api/empty':
					return new Response(null, { status: 204 });

				case '/api/error-400':
					return new Response(JSON.stringify({ error: 'bad_request', message: 'Invalid task ID' }), {
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					});

				case '/api/error-500':
					return new Response('Internal Server Error', {
						status: 500,
						headers: { 'Content-Type': 'text/plain' },
					});

				case '/api/html-error':
					return new Response('<html><body><h1>502 Bad Gateway</h1><p>nginx</p></body></html>', {
						status: 502,
						headers: { 'Content-Type': 'text/html' },
					});

				case '/api/huge-error': {
					const longBody = 'E'.repeat(1000);
					return new Response(longBody, {
						status: 400,
						headers: { 'Content-Type': 'text/plain' },
					});
				}

				case '/api/non-json':
					return new Response('this is plain text, not json', {
						status: 200,
						headers: { 'Content-Type': 'text/plain' },
					});

				case '/oauth/token':
					return new Response(JSON.stringify({
						access_token: 'refreshed-token',
						refresh_token: 'refreshed-refresh',
						expires_in: 3600,
					}), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					});

				default:
					return new Response('Not Found', { status: 404 });
			}
		},
	});
	port = server.port;
});

afterAll(() => {
	server.stop();
});

beforeEach(() => {
	lastRequestHeaders = {};
	setConfig({
		baseUrl: `http://localhost:${port}`,
		accessToken: 'test-token',
		refreshToken: 'test-refresh',
		expiresAt: Date.now() + 3600000, // 1 hour from now — no refresh needed
		repoId: 'test-repo',
		repo: 'test/repo',
	});
});

describe('apiRequest', () => {
	test('successful JSON response returns parsed object', async () => {
		const result = await apiRequest('/api/success');
		expect(result).toEqual({ id: 'task-1', title: 'Test Task' });
	});

	test('204 response returns null', async () => {
		const result = await apiRequest('/api/empty');
		expect(result).toBeNull();
	});

	test('400 error throws with status and body', async () => {
		await expect(apiRequest('/api/error-400')).rejects.toThrow('Lightsprint API 400:');
		try {
			await apiRequest('/api/error-400');
		} catch (err) {
			expect(err.message).toContain('400');
			expect(err.message).toContain('bad_request');
		}
	});

	test('500 error throws after retries with status and body', async () => {
		// Use a short timeout to speed up retries; retryableFetch retries 5xx
		await expect(apiRequest('/api/error-500', { timeoutMs: 60000 })).rejects.toThrow('Lightsprint API 500:');
	}, 30000);

	test('HTML 502 response throws with HTML content', async () => {
		try {
			await apiRequest('/api/html-error', { timeoutMs: 60000 });
			expect(true).toBe(false); // should not reach here
		} catch (err) {
			expect(err.message).toContain('502');
			expect(err.message).toContain('Bad Gateway');
		}
	}, 30000);

	test('long error body is truncated to 500 chars with ellipsis', async () => {
		try {
			await apiRequest('/api/huge-error');
			expect(true).toBe(false); // should not reach here
		} catch (err) {
			expect(err.message).toContain('400');
			// The truncated body should be 500 chars + "..."
			// Full message: "Lightsprint API 400: " + 500 E's + "..."
			const bodyPart = err.message.replace('Lightsprint API 400: ', '');
			expect(bodyPart).toEndWith('...');
			// 500 E's + "..." = 503 chars
			expect(bodyPart.length).toBe(503);
		}
	});

	test('200 with non-JSON body throws safeJsonParse error', async () => {
		await expect(apiRequest('/api/non-json')).rejects.toThrow('Lightsprint API: failed to parse response as JSON');
	});

	test('auth header is set correctly', async () => {
		await apiRequest('/api/success');
		expect(lastRequestHeaders['authorization']).toBe('Bearer test-token');
		expect(lastRequestHeaders['content-type']).toBe('application/json');
	});
});
