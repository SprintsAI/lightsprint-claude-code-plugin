import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const HOOKS_PATH = join(import.meta.dir, '../../hooks/hooks.json');
const hooks = JSON.parse(readFileSync(HOOKS_PATH, 'utf-8'));
const exitPlanMode = hooks.hooks.PermissionRequest?.find(h => h.matcher === 'ExitPlanMode');

describe('hooks.json configuration', () => {
	test('has PermissionRequest event', () => {
		expect(hooks.hooks).toBeDefined();
		expect(hooks.hooks.PermissionRequest).toBeArray();
		expect(hooks.hooks.PermissionRequest.length).toBeGreaterThan(0);
	});

	test('has ExitPlanMode matcher', () => {
		expect(exitPlanMode).toBeDefined();
	});

	test('ExitPlanMode hook runs lightsprint review-plan command', () => {
		expect(exitPlanMode.hooks).toBeArray();
		expect(exitPlanMode.hooks.length).toBe(1);

		const hook = exitPlanMode.hooks[0];
		expect(hook.type).toBe('command');
		expect(hook.command).toBe('lightsprint cc-review');
	});

	test('ExitPlanMode hook has 4-day timeout', () => {
		const hook = exitPlanMode.hooks[0];
		// 4 days = 345600 seconds
		expect(hook.timeout).toBe(345600);
	});

	test('no unexpected top-level keys', () => {
		expect(Object.keys(hooks)).toEqual(['hooks']);
	});

	test('no unexpected hook events', () => {
		expect(Object.keys(hooks.hooks)).toEqual([
			'PermissionRequest',
			'SessionStart',
			'SessionEnd',
			'UserPromptSubmit',
			'Stop',
			'TaskCompleted',
			'PostToolUse',
			'SubagentStart',
			'SubagentStop',
		]);
	});
});
