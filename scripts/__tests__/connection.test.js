import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ls-conn-')); process.env.LIGHTSPRINT_CONFIG_DIR = dir; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.LIGHTSPRINT_CONFIG_DIR; });

test('write then read round-trips the active workspace', async () => {
	const { writeConnection, readConnection, clearConnection } = await import('../lib/connection.js?' + Math.random());
	writeConnection({ workspaceId: 'ws1', workspaceName: 'Acme', accessToken: 'lsat_x', refreshToken: 'lsrt_x', expiresAt: 123, baseUrl: 'https://lightsprint.ai' });
	expect(readConnection().workspaceId).toBe('ws1');
	clearConnection();
	expect(readConnection()).toBeNull();
});

test('warns once when plugin and connection base URLs disagree', async () => {
	const { writeConnection } = await import('../lib/connection.js?' + Math.random());
	writeConnection({ workspaceId: 'ws1', accessToken: 'lsat_x', baseUrl: 'https://staging.lightsprint.ai' });
	writeFileSync(join(dir, 'config.json'), JSON.stringify({ baseUrl: 'https://app.lightsprint.ai' }));

	const warnings = [];
	const originalError = console.error;
	console.error = (...args) => warnings.push(args.join(' '));
	try {
		const { getConfig } = await import('../lib/config.js?' + Math.random());
		expect(getConfig().baseUrl).toBe('https://staging.lightsprint.ai');
		getConfig();
	} finally {
		console.error = originalError;
	}

	expect(warnings).toHaveLength(1);
	expect(warnings[0]).toContain('config.json uses https://app.lightsprint.ai');
	expect(warnings[0]).toContain('Using https://staging.lightsprint.ai');
});

test('does not warn when an explicit environment base URL wins', async () => {
	const { getBaseUrlMismatch } = await import('../lib/config.js?' + Math.random());
	expect(getBaseUrlMismatch(
		'https://app.lightsprint.ai',
		'https://staging.lightsprint.ai',
		'https://preview.lightsprint.ai'
	)).toBeNull();
});
