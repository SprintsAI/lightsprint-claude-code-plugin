// scripts/__tests__/validate-fixes.test.js
import { describe, test, expect } from 'bun:test';
import {
	validateEnum,
	validatePid,
	validatePositiveInt,
	validateAssignee,
	validateProjectName,
	validateHexColor,
	VALID_STATUSES,
	MAX_PROJECT_NAME_LENGTH,
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

describe('validateProjectName', () => {
	test('accepts simple name', () => {
		expect(validateProjectName('Auth refactor')).toBe('Auth refactor');
	});

	test('accepts name with punctuation', () => {
		expect(validateProjectName('Q2 2026 — sprint goals!')).toBe('Q2 2026 — sprint goals!');
	});

	test('rejects empty string', () => {
		expect(() => validateProjectName('')).toThrow(/Project name is required/);
	});

	test('rejects whitespace-only', () => {
		expect(() => validateProjectName('   ')).toThrow(/Project name is required/);
	});

	test('rejects non-string', () => {
		expect(() => validateProjectName(123)).toThrow(/Project name is required/);
		expect(() => validateProjectName(null)).toThrow(/Project name is required/);
	});

	test('rejects string over max length', () => {
		expect(() => validateProjectName('a'.repeat(MAX_PROJECT_NAME_LENGTH + 1))).toThrow(/exceeds maximum length/);
	});

	test('rejects control characters', () => {
		expect(() => validateProjectName('bad\x00name')).toThrow(/control characters/);
	});
});

describe('validateHexColor', () => {
	test('accepts #RRGGBB', () => {
		expect(validateHexColor('#FF9D00')).toBe('#FF9D00');
	});

	test('accepts #rgb shorthand', () => {
		expect(validateHexColor('#F90')).toBe('#F90');
	});

	test('accepts lowercase', () => {
		expect(validateHexColor('#ff9d00')).toBe('#ff9d00');
	});

	test('rejects missing hash', () => {
		expect(() => validateHexColor('FF9D00')).toThrow(/Invalid color/);
	});

	test('rejects invalid characters', () => {
		expect(() => validateHexColor('#GG9D00')).toThrow(/Invalid color/);
	});

	test('rejects wrong length', () => {
		expect(() => validateHexColor('#FF9D0')).toThrow(/Invalid color/);
		expect(() => validateHexColor('#FF9D000')).toThrow(/Invalid color/);
	});

	test('rejects empty string', () => {
		expect(() => validateHexColor('')).toThrow(/Color is required/);
	});

	test('rejects non-string', () => {
		expect(() => validateHexColor(null)).toThrow(/Color is required/);
	});
});
