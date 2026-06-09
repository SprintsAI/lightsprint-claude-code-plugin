import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
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
