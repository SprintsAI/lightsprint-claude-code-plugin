// scripts/__tests__/client-resilience.test.js
import { describe, test, expect } from 'bun:test';

describe('safeJsonParse', () => {
	test('returns parsed JSON for valid input', async () => {
		const { safeJsonParse } = await import('../lib/client.js');
		const result = safeJsonParse('{"key":"value"}');
		expect(result).toEqual({ key: 'value' });
	});

	test('throws descriptive error for HTML response', async () => {
		const { safeJsonParse } = await import('../lib/client.js');
		expect(() => safeJsonParse('<html>502</html>')).toThrow(/unexpected non-JSON response/i);
	});

	test('throws descriptive error for empty string', async () => {
		const { safeJsonParse } = await import('../lib/client.js');
		expect(() => safeJsonParse('')).toThrow(/empty response body/i);
	});

	test('throws descriptive error for malformed JSON', async () => {
		const { safeJsonParse } = await import('../lib/client.js');
		expect(() => safeJsonParse('{invalid')).toThrow(/failed to parse/i);
	});
});

describe('DEFAULT_TIMEOUT_MS', () => {
	test('is exported and set to 30000', async () => {
		const { DEFAULT_TIMEOUT_MS } = await import('../lib/client.js');
		expect(DEFAULT_TIMEOUT_MS).toBe(30000);
	});
});

describe('retryableFetch', () => {
	test('returns response on first success', async () => {
		const { retryableFetch } = await import('../lib/client.js');
		const mockFetch = async () => new Response('{"ok":true}', { status: 200 });
		const result = await retryableFetch('http://test.local/api', {}, mockFetch);
		expect(result.status).toBe(200);
	});

	test('retries on 500 and succeeds', async () => {
		const { retryableFetch } = await import('../lib/client.js');
		let attempt = 0;
		const mockFetch = async () => {
			attempt++;
			if (attempt === 1) return new Response('error', { status: 500 });
			return new Response('{"ok":true}', { status: 200 });
		};
		const result = await retryableFetch('http://test.local/api', {}, mockFetch, { baseDelayMs: 1 });
		expect(result.status).toBe(200);
		expect(attempt).toBe(2);
	});

	test('retries on 502 and succeeds', async () => {
		const { retryableFetch } = await import('../lib/client.js');
		let attempt = 0;
		const mockFetch = async () => {
			attempt++;
			if (attempt <= 2) return new Response('error', { status: 502 });
			return new Response('{"ok":true}', { status: 200 });
		};
		const result = await retryableFetch('http://test.local/api', {}, mockFetch, { baseDelayMs: 1 });
		expect(result.status).toBe(200);
		expect(attempt).toBe(3);
	});

	test('retries on network error and succeeds', async () => {
		const { retryableFetch } = await import('../lib/client.js');
		let attempt = 0;
		const mockFetch = async () => {
			attempt++;
			if (attempt === 1) throw new Error('fetch failed');
			return new Response('{"ok":true}', { status: 200 });
		};
		const result = await retryableFetch('http://test.local/api', {}, mockFetch, { baseDelayMs: 1 });
		expect(result.status).toBe(200);
		expect(attempt).toBe(2);
	});

	test('gives up after max retries and returns last 5xx response', async () => {
		const { retryableFetch } = await import('../lib/client.js');
		let attempt = 0;
		const mockFetch = async () => {
			attempt++;
			return new Response('server error', { status: 503 });
		};
		const result = await retryableFetch('http://test.local/api', {}, mockFetch, { maxRetries: 3, baseDelayMs: 1 });
		expect(result.status).toBe(503);
		expect(attempt).toBe(4); // 1 initial + 3 retries
	});

	test('does NOT retry on 4xx errors', async () => {
		const { retryableFetch } = await import('../lib/client.js');
		let attempt = 0;
		const mockFetch = async () => {
			attempt++;
			return new Response('not found', { status: 404 });
		};
		const result = await retryableFetch('http://test.local/api', {}, mockFetch, { baseDelayMs: 1 });
		expect(result.status).toBe(404);
		expect(attempt).toBe(1);
	});

	test('does NOT retry on 401 errors', async () => {
		const { retryableFetch } = await import('../lib/client.js');
		let attempt = 0;
		const mockFetch = async () => {
			attempt++;
			return new Response('unauthorized', { status: 401 });
		};
		const result = await retryableFetch('http://test.local/api', {}, mockFetch, { baseDelayMs: 1 });
		expect(result.status).toBe(401);
		expect(attempt).toBe(1);
	});

	test('handles 429 with Retry-After header', async () => {
		const { retryableFetch } = await import('../lib/client.js');
		let attempt = 0;
		const mockFetch = async () => {
			attempt++;
			if (attempt === 1) {
				return new Response('rate limited', {
					status: 429,
					headers: { 'Retry-After': '1' }
				});
			}
			return new Response('{"ok":true}', { status: 200 });
		};
		const result = await retryableFetch('http://test.local/api', {}, mockFetch, { baseDelayMs: 1 });
		expect(result.status).toBe(200);
		expect(attempt).toBe(2);
	});
});

describe('parseInt safety', () => {
	test('parseInt with radix handles normal number', () => {
		expect(parseInt('3600', 10)).toBe(3600);
	});

	test('parseInt on undefined returns NaN', () => {
		expect(Number.isNaN(parseInt(undefined, 10))).toBe(true);
	});

	test('NaN guard prevents invalid expiresAt', () => {
		const expiresIn = undefined;
		const parsed = parseInt(expiresIn, 10);
		const guarded = Number.isFinite(parsed) ? parsed : 0;
		expect(guarded).toBe(0);
	});

	test('NaN guard passes valid expiresAt', () => {
		const expiresIn = '3600';
		const parsed = parseInt(expiresIn, 10);
		const guarded = Number.isFinite(parsed) ? parsed : 0;
		expect(guarded).toBe(3600);
	});
});
