// scripts/__tests__/active-stack.test.js
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeConnection, clearConnection } from '../lib/connection.js';
import { getActiveStack, setActiveStack, clearActiveStack } from '../lib/config.js';

// The active-stack helpers read/write connection.json via connection.js, which
// resolves the config dir from LIGHTSPRINT_CONFIG_DIR at call time. Point it at
// a throwaway dir so the tests never touch the developer's real connection.
let tmpDir;
let originalConfigDir;

describe('active stack helpers', () => {
	beforeAll(() => {
		originalConfigDir = process.env.LIGHTSPRINT_CONFIG_DIR;
		tmpDir = mkdtempSync(join(tmpdir(), 'ls-active-stack-'));
		process.env.LIGHTSPRINT_CONFIG_DIR = tmpDir;
	});

	afterAll(() => {
		if (originalConfigDir === undefined) delete process.env.LIGHTSPRINT_CONFIG_DIR;
		else process.env.LIGHTSPRINT_CONFIG_DIR = originalConfigDir;
		try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
	});

	beforeEach(() => {
		clearConnection();
		writeConnection({ workspaceId: 'ws-test', workspaceName: 'Test WS', accessToken: 'tok' });
	});

	test('getActiveStack returns null when none is set', () => {
		expect(getActiveStack()).toBeNull();
	});

	test('setActiveStack persists and getActiveStack reads it back', () => {
		const saved = setActiveStack({ id: 'stk_1', name: 'Engineering', taskPrefix: 'ENG' });
		expect(saved).toEqual({ id: 'stk_1', name: 'Engineering', taskPrefix: 'ENG' });
		expect(getActiveStack()).toEqual({ id: 'stk_1', name: 'Engineering', taskPrefix: 'ENG' });
	});

	test('setActiveStack normalizes missing name/prefix to null', () => {
		setActiveStack({ id: 'stk_2' });
		expect(getActiveStack()).toEqual({ id: 'stk_2', name: null, taskPrefix: null });
	});

	test('setActiveStack preserves existing connection fields', async () => {
		setActiveStack({ id: 'stk_3', name: 'Web', taskPrefix: 'WEB' });
		const { readConnection } = await import('../lib/connection.js');
		const conn = readConnection();
		expect(conn.workspaceId).toBe('ws-test');
		expect(conn.accessToken).toBe('tok');
		expect(conn.activeStack.id).toBe('stk_3');
	});

	test('clearActiveStack removes it and reports whether one was set', () => {
		setActiveStack({ id: 'stk_4', name: 'Ops', taskPrefix: 'OPS' });
		expect(clearActiveStack()).toBe(true);
		expect(getActiveStack()).toBeNull();
		expect(clearActiveStack()).toBe(false);
	});

	test('setActiveStack throws without an id', () => {
		expect(() => setActiveStack({ name: 'No id' })).toThrow(/requires a stack with an id/);
	});

	test('setActiveStack throws when not connected', () => {
		clearConnection();
		expect(() => setActiveStack({ id: 'stk_5' })).toThrow(/Not connected/);
	});
});
