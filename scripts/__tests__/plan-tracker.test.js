import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';

// We'll test the plan-tracker module by temporarily replacing ACTIVE_FILE.
// Since the module uses a hardcoded path, we test the logic indirectly by:
// 1. Saving/restoring the real file if it exists
// 2. Or we re-implement the test using the module's exports directly
// The module reads/writes ~/.lightsprint/active-plan.json

// Import the module
import { setActivePlan, getActivePlan, clearActivePlan } from '../lib/plan-tracker.js';

describe('plan-tracker', () => {
	const activePlanPath = join(homedir(), '.lightsprint', 'active-plan.json');
	let savedContent = null;
	let hadFile = false;

	beforeEach(() => {
		// Save existing file if present
		try {
			if (existsSync(activePlanPath)) {
				const { readFileSync } = require('fs');
				savedContent = readFileSync(activePlanPath, 'utf-8');
				hadFile = true;
			}
		} catch {
			// ignore
		}
		// Clear any existing state
		clearActivePlan();
	});

	afterEach(() => {
		// Restore original file
		if (hadFile && savedContent !== null) {
			writeFileSync(activePlanPath, savedContent);
		} else {
			clearActivePlan();
		}
	});

	test('getActivePlan returns undefined when no file exists', () => {
		clearActivePlan();
		expect(getActivePlan()).toBeUndefined();
	});

	test('setActivePlan + getActivePlan round-trip', () => {
		setActivePlan('plan-123', 'proj-456', 'sess-789');

		const result = getActivePlan();
		expect(result).toBeDefined();
		expect(result.planId).toBe('plan-123');
		expect(result.projectId).toBe('proj-456');
		expect(result.sessionId).toBe('sess-789');
	});

	test('clearActivePlan removes the file', () => {
		setActivePlan('plan-abc', 'proj-def', 'sess-ghi');
		expect(getActivePlan()).toBeDefined();

		clearActivePlan();
		expect(getActivePlan()).toBeUndefined();
		expect(existsSync(activePlanPath)).toBe(false);
	});

	test('setActivePlan overwrites previous plan', () => {
		setActivePlan('plan-1', 'proj-1', 'sess-1');
		setActivePlan('plan-2', 'proj-2', 'sess-2');

		const result = getActivePlan();
		expect(result.planId).toBe('plan-2');
		expect(result.projectId).toBe('proj-2');
		expect(result.sessionId).toBe('sess-2');
	});

	test('getActivePlan handles corrupted JSON gracefully', () => {
		writeFileSync(activePlanPath, 'not valid json{{{');
		expect(getActivePlan()).toBeUndefined();
	});

	test('getActivePlan returns undefined for JSON missing required fields', () => {
		writeFileSync(activePlanPath, JSON.stringify({ foo: 'bar' }));
		expect(getActivePlan()).toBeUndefined();
	});
});
