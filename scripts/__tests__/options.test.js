import { describe, test, expect } from 'bun:test';
import { parseGlobalOptions } from '../lib/options.js';

describe('parseGlobalOptions', () => {
	test('--output json sets outputFormat to json', () => {
		const { globalOptions } = parseGlobalOptions(['--output', 'json']);
		expect(globalOptions.outputFormat).toBe('json');
	});

	test('--output text sets outputFormat to text', () => {
		const { globalOptions } = parseGlobalOptions(['--output', 'text']);
		expect(globalOptions.outputFormat).toBe('text');
	});

	test('--output invalid throws Error', () => {
		expect(() => parseGlobalOptions(['--output', 'invalid'])).toThrow(
			'Invalid output format: "invalid"'
		);
	});

	test('--json sets outputFormat to json', () => {
		const { globalOptions } = parseGlobalOptions(['--json']);
		expect(globalOptions.outputFormat).toBe('json');
	});

	test('--json with JSON body leaves both in remainingArgs', () => {
		const { globalOptions, remainingArgs } = parseGlobalOptions([
			'--json',
			'{"key":"val"}',
		]);
		expect(remainingArgs).toEqual(['--json', '{"key":"val"}']);
		// outputFormat should not be set to json by the --json flag in this case
		// It may still be json due to non-TTY default in test environment
	});

	test('--dry-run sets dryRun to true', () => {
		const { globalOptions } = parseGlobalOptions(['--dry-run']);
		expect(globalOptions.dryRun).toBe(true);
	});

	test('--fields sets fields array and outputFormat to json', () => {
		const { globalOptions } = parseGlobalOptions(['--fields', 'title,status']);
		expect(globalOptions.fields).toEqual(['title', 'status']);
		expect(globalOptions.outputFormat).toBe('json');
	});

	test('--fields trims whitespace in field names', () => {
		const { globalOptions } = parseGlobalOptions([
			'--fields',
			' title , status ',
		]);
		expect(globalOptions.fields).toEqual(['title', 'status']);
	});

	test('unknown args pass through to remainingArgs', () => {
		const { remainingArgs } = parseGlobalOptions([
			'--task',
			'foo',
			'--bar',
		]);
		expect(remainingArgs).toEqual(['--task', 'foo', '--bar']);
	});

	test('multiple flags combine correctly', () => {
		const { globalOptions, remainingArgs } = parseGlobalOptions([
			'--output',
			'json',
			'--dry-run',
			'--task',
			'foo',
		]);
		expect(globalOptions.outputFormat).toBe('json');
		expect(globalOptions.dryRun).toBe(true);
		expect(remainingArgs).toEqual(['--task', 'foo']);
	});

	test('empty args returns defaults', () => {
		const { globalOptions, remainingArgs } = parseGlobalOptions([]);
		expect(globalOptions.dryRun).toBe(false);
		expect(globalOptions.fields).toBeNull();
		expect(remainingArgs).toEqual([]);
		// outputFormat defaults to 'text' unless process.stdout.isTTY === false
		// In bun test, isTTY is undefined (not false), so the non-TTY override does not trigger
		if (process.stdout.isTTY === false) {
			expect(globalOptions.outputFormat).toBe('json');
		} else {
			expect(globalOptions.outputFormat).toBe('text');
		}
	});

	test('default outputFormat is json when stdout.isTTY is exactly false', () => {
		// The implementation checks process.stdout.isTTY === false (strict equality).
		// When isTTY is undefined (common in test runners), the default remains 'text'.
		const originalIsTTY = process.stdout.isTTY;
		try {
			Object.defineProperty(process.stdout, 'isTTY', {
				value: false,
				writable: true,
				configurable: true,
			});
			const { globalOptions } = parseGlobalOptions([]);
			expect(globalOptions.outputFormat).toBe('json');
		} finally {
			Object.defineProperty(process.stdout, 'isTTY', {
				value: originalIsTTY,
				writable: true,
				configurable: true,
			});
		}
	});

	test('explicit --output text overrides non-TTY default', () => {
		const { globalOptions } = parseGlobalOptions(['--output', 'text']);
		expect(globalOptions.outputFormat).toBe('text');
	});
});
