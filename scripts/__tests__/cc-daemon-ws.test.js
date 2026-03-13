import { describe, test, expect } from 'bun:test';

/**
 * Tests for WebSocket URL construction in cc-daemon.
 *
 * The daemon must pass the access token as a query parameter (?token=...),
 * NOT as an Authorization header, because the server extracts tokens from
 * query params on the HTTP upgrade request.
 */

// Replicate the URL construction logic from cc-daemon.js connectWebSocket()
function buildWsUrl(baseUrl, accessToken) {
	return baseUrl.replace(/^http/, 'ws') + `/cc-ws?token=${encodeURIComponent(accessToken)}`;
}

describe('WebSocket URL construction', () => {
	test('converts http base URL to ws', () => {
		const url = buildWsUrl('http://localhost:5173', 'lsat_test');
		expect(url).toStartWith('ws://localhost:5173/');
	});

	test('converts https base URL to wss', () => {
		const url = buildWsUrl('https://lightsprint.ai', 'lsat_test');
		expect(url).toStartWith('wss://lightsprint.ai/');
	});

	test('includes token as query parameter', () => {
		const url = buildWsUrl('http://localhost:5173', 'lsat_abc123');
		const parsed = new URL(url);
		expect(parsed.searchParams.get('token')).toBe('lsat_abc123');
	});

	test('URL-encodes special characters in token', () => {
		const token = 'lsat_abc=123&foo';
		const url = buildWsUrl('http://localhost:5173', token);
		const parsed = new URL(url);
		expect(parsed.searchParams.get('token')).toBe(token);
	});

	test('path is /cc-ws', () => {
		const url = buildWsUrl('http://localhost:5173', 'lsat_test');
		const parsed = new URL(url);
		expect(parsed.pathname).toBe('/cc-ws');
	});

	test('preserves port from base URL', () => {
		const url = buildWsUrl('http://localhost:3000', 'lsat_test');
		const parsed = new URL(url);
		expect(parsed.port).toBe('3000');
	});

	test('handles base URL with trailing slash', () => {
		// Current impl doesn't strip trailing slash — this documents actual behavior
		const url = buildWsUrl('http://localhost:5173/', 'lsat_test');
		expect(url).toContain('/cc-ws?token=');
	});

	test('handles base URL with path prefix', () => {
		const url = buildWsUrl('https://example.com/api', 'lsat_test');
		const parsed = new URL(url);
		expect(parsed.pathname).toBe('/api/cc-ws');
		expect(parsed.searchParams.get('token')).toBe('lsat_test');
	});
});
