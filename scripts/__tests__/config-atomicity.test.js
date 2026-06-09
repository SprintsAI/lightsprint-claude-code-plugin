// scripts/__tests__/config-atomicity.test.js
import { describe, test, expect, beforeAll, beforeEach, afterEach } from 'bun:test';
import { readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync, statSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { writeConnection, readConnection } from '../lib/connection.js';
import { setMapping, getMapping, removeSessionMappings } from '../lib/task-map.js';

const CONFIG_DIR = process.env.LIGHTSPRINT_CONFIG_DIR || join(homedir(), '.lightsprint');
const CONNECTION_FILE = join(CONFIG_DIR, 'connection.json');
const MAP_FILE = join(CONFIG_DIR, 'task-map.json');

describe('writeConnection atomicity', () => {
	let originalContent;

	beforeAll(() => {
		mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
	});

	beforeEach(() => {
		try {
			originalContent = readFileSync(CONNECTION_FILE, 'utf-8');
		} catch {
			originalContent = null;
		}
	});

	afterEach(() => {
		if (originalContent !== null) {
			writeFileSync(CONNECTION_FILE, originalContent, { mode: 0o600 });
		} else {
			try { unlinkSync(CONNECTION_FILE); } catch { /* already gone */ }
		}
		// Clean up any leftover temp files
		try {
			const files = readdirSync(CONFIG_DIR);
			for (const f of files) {
				if (f.startsWith('connection.json.')) {
					try { unlinkSync(join(CONFIG_DIR, f)); } catch {}
				}
			}
		} catch { /* CONFIG_DIR may not exist */ }
	});

	test('writes valid JSON that can be read back', () => {
		const testData = { workspaceId: 'ws-test', workspaceName: 'Test WS', accessToken: 'test123' };
		writeConnection(testData);
		const result = readConnection();
		expect(result).not.toBeNull();
		expect(result.workspaceId).toBe('ws-test');
		expect(result.accessToken).toBe('test123');
	});

	test('does not leave temp files after successful write', () => {
		writeConnection({ workspaceId: 'ws-test', accessToken: 'abc' });
		const files = readdirSync(CONFIG_DIR);
		const tempFiles = files.filter(f => f.startsWith('connection.json.'));
		expect(tempFiles.length).toBe(0);
	});

	test('file has restricted permissions (0o600)', () => {
		writeConnection({ workspaceId: 'ws-test', accessToken: 'abc' });
		const stats = statSync(CONNECTION_FILE);
		const mode = stats.mode & 0o777;
		expect(mode).toBe(0o600);
	});
});

describe('task-map.json permissions', () => {
	const testSession = 'test-perms-session';

	afterEach(() => {
		removeSessionMappings(testSession);
	});

	test('task-map.json has 0o600 permissions after write', () => {
		setMapping(testSession, 'cc-task-1', 'ls-task-1');
		const stats = statSync(MAP_FILE);
		const mode = stats.mode & 0o777;
		expect(mode).toBe(0o600);
	});
});
