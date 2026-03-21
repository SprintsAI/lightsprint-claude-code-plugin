// scripts/__tests__/config-atomicity.test.js
import { describe, test, expect, beforeAll, beforeEach, afterEach } from 'bun:test';
import { readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync, statSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { readReposFile, writeReposFile } from '../lib/config.js';
import { setMapping, getMapping, removeSessionMappings } from '../lib/task-map.js';

const CONFIG_DIR = process.env.LIGHTSPRINT_CONFIG_DIR || join(homedir(), '.lightsprint');
const REPOS_FILE = join(CONFIG_DIR, 'repos.json');
const MAP_FILE = join(CONFIG_DIR, 'task-map.json');

describe('writeReposFile atomicity', () => {
	let originalContent;

	beforeAll(() => {
		mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
	});

	beforeEach(() => {
		try {
			originalContent = readFileSync(REPOS_FILE, 'utf-8');
		} catch {
			originalContent = null;
		}
	});

	afterEach(() => {
		if (originalContent !== null) {
			writeFileSync(REPOS_FILE, originalContent, { mode: 0o600 });
		}
		// Clean up any leftover temp files
		try {
			const files = readdirSync(CONFIG_DIR);
			for (const f of files) {
				if (f.startsWith('repos.json.')) {
					try { unlinkSync(join(CONFIG_DIR, f)); } catch {}
				}
			}
		} catch { /* CONFIG_DIR may not exist */ }
	});

	test('writes valid JSON that can be read back', () => {
		const testData = { 'test/repo': { accessToken: 'test123', repoId: 'r1' } };
		writeReposFile(testData);
		const result = readReposFile();
		expect(result['test/repo']).toBeDefined();
		expect(result['test/repo'].accessToken).toBe('test123');
	});

	test('does not leave temp files after successful write', () => {
		writeReposFile({ 'test/repo': { accessToken: 'abc' } });
		const files = readdirSync(CONFIG_DIR);
		const tempFiles = files.filter(f => f.startsWith('repos.json.'));
		expect(tempFiles.length).toBe(0);
	});

	test('file has restricted permissions (0o600)', () => {
		writeReposFile({ 'test/repo': { accessToken: 'abc' } });
		const stats = statSync(REPOS_FILE);
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
