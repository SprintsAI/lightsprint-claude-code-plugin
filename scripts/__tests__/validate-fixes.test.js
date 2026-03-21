// scripts/__tests__/validate-fixes.test.js
import { describe, test, expect } from 'bun:test';
import {
	validateEnum,
	validatePid,
	validatePositiveInt,
	validateAssignee,
	VALID_STATUSES,
} from '../lib/validate.js';

describe('validateEnum', () => {
	test('works with Array input', () => {
		expect(() => validateEnum('todo', VALID_STATUSES, 'status')).not.toThrow();
	});

	test('works with Set input', () => {
		const allowed = new Set(['position', 'updated_at', 'created_at']);
		expect(() => validateEnum('position', allowed, 'sort field')).not.toThrow();
	});

	test('rejects invalid value with Set input', () => {
		const allowed = new Set(['position', 'updated_at', 'created_at']);
		expect(() => validateEnum('invalid', allowed, 'sort field')).toThrow(/Invalid sort field/);
	});

	test('trims whitespace in comma-separated values', () => {
		const statuses = 'todo, in_progress'.split(',').map(s => s.trim());
		for (const s of statuses) {
			expect(() => validateEnum(s, VALID_STATUSES, 'status')).not.toThrow();
		}
	});
});

describe('validatePositiveInt', () => {
	test('accepts positive integer', () => {
		expect(validatePositiveInt(10, 'limit')).toBe(10);
	});

	test('accepts zero', () => {
		expect(validatePositiveInt(0, 'offset')).toBe(0);
	});

	test('rejects NaN', () => {
		expect(() => validatePositiveInt(NaN, 'limit')).toThrow(/must be a non-negative integer/);
	});

	test('rejects negative', () => {
		expect(() => validatePositiveInt(-5, 'limit')).toThrow(/must be a non-negative integer/);
	});

	test('rejects Infinity', () => {
		expect(() => validatePositiveInt(Infinity, 'limit')).toThrow(/must be a non-negative integer/);
	});
});

describe('validatePid', () => {
	test('accepts valid PID string', () => {
		expect(validatePid('1234')).toBe('1234');
	});

	test('accepts valid PID number', () => {
		expect(validatePid(1234)).toBe('1234');
	});

	test('rejects non-numeric', () => {
		expect(() => validatePid('abc')).toThrow(/Invalid PID/);
	});

	test('rejects zero', () => {
		expect(() => validatePid('0')).toThrow(/Invalid PID/);
	});

	test('rejects negative', () => {
		expect(() => validatePid('-100')).toThrow(/Invalid PID/);
	});
});

describe('validateAssignee', () => {
	test('accepts valid assignee string', () => {
		expect(validateAssignee('john')).toBe('john');
	});

	test('accepts email-like assignee', () => {
		expect(validateAssignee('john@example.com')).toBe('john@example.com');
	});

	test('rejects empty string', () => {
		expect(() => validateAssignee('')).toThrow(/Assignee/);
	});

	test('rejects string over 200 chars', () => {
		expect(() => validateAssignee('a'.repeat(201))).toThrow(/Assignee/);
	});

	test('rejects control characters', () => {
		expect(() => validateAssignee('john\x00doe')).toThrow(/control characters/);
	});
});
