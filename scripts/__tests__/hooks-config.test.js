import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const HOOKS_PATH = join(import.meta.dir, '../../hooks/hooks.json');
const hooks = JSON.parse(readFileSync(HOOKS_PATH, 'utf-8'));

describe('hooks.json configuration', () => {
	test('has no PermissionRequest event (plan review flow removed)', () => {
		expect(hooks.hooks).toBeDefined();
		expect(hooks.hooks.PermissionRequest).toBeUndefined();
	});

	test('no unexpected top-level keys', () => {
		expect(Object.keys(hooks)).toEqual(['hooks']);
	});

	test('no unexpected hook events', () => {
		expect(Object.keys(hooks.hooks)).toEqual([
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
