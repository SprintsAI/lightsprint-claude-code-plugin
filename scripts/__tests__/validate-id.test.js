import { describe, test, expect } from 'bun:test';
import {
	validateId,
	validateTitle,
	validateDescription,
	validateCommentBody,
	validateStatus,
	validateComplexity,
	validateBaseUrl,
	validateVersion,
} from '../lib/validate.js';

// ─── validateId ─────────────────────────────────────────────────────────

describe('validateId', () => {
	describe('valid IDs', () => {
		test('alphanumeric', () => {
			expect(validateId('abc123')).toBe('abc123');
		});

		test('with dashes', () => {
			expect(validateId('task-123')).toBe('task-123');
		});

		test('with underscores', () => {
			expect(validateId('task_123')).toBe('task_123');
		});

		test('mixed characters', () => {
			expect(validateId('My_Task-99')).toBe('My_Task-99');
		});

		test('custom label is used in valid return', () => {
			expect(validateId('valid', 'Task ID')).toBe('valid');
		});
	});

	describe('path traversal', () => {
		test('rejects ../', () => {
			expect(() => validateId('../')).toThrow('Invalid ID');
		});

		test('rejects ..\\', () => {
			expect(() => validateId('..\\')).toThrow('Invalid ID');
		});

		test('rejects %2e%2e', () => {
			expect(() => validateId('%2e%2e')).toThrow('Invalid ID');
		});
	});

	describe('query injection', () => {
		test('rejects id?fields=name', () => {
			expect(() => validateId('id?fields=name')).toThrow('Invalid ID');
		});

		test('rejects id#exploit', () => {
			expect(() => validateId('id#exploit')).toThrow('Invalid ID');
		});
	});

	describe('URL path characters', () => {
		test('rejects id/subpath', () => {
			expect(() => validateId('id/subpath')).toThrow('Invalid ID');
		});

		test('rejects id%2F', () => {
			expect(() => validateId('id%2F')).toThrow('Invalid ID');
		});
	});

	describe('control characters', () => {
		test('rejects null byte \\x00', () => {
			expect(() => validateId('id\x00')).toThrow('Invalid ID');
		});

		test('rejects newline \\n', () => {
			expect(() => validateId('id\n')).toThrow('Invalid ID');
		});

		test('rejects carriage return \\r', () => {
			expect(() => validateId('id\r')).toThrow('Invalid ID');
		});
	});

	describe('empty / missing', () => {
		test('rejects empty string', () => {
			expect(() => validateId('')).toThrow('ID is required');
		});

		test('rejects null', () => {
			expect(() => validateId(null)).toThrow('ID is required');
		});

		test('rejects undefined', () => {
			expect(() => validateId(undefined)).toThrow('ID is required');
		});
	});

	describe('special characters', () => {
		test('rejects ?', () => {
			expect(() => validateId('id?')).toThrow('Invalid ID');
		});

		test('rejects &', () => {
			expect(() => validateId('id&')).toThrow('Invalid ID');
		});

		test('rejects =', () => {
			expect(() => validateId('id=')).toThrow('Invalid ID');
		});

		test('rejects #', () => {
			expect(() => validateId('id#')).toThrow('Invalid ID');
		});

		test('rejects /', () => {
			expect(() => validateId('id/')).toThrow('Invalid ID');
		});

		test('rejects spaces', () => {
			expect(() => validateId('id with spaces')).toThrow('Invalid ID');
		});
	});

	describe('custom label in errors', () => {
		test('uses custom label for required error', () => {
			expect(() => validateId('', 'Task ID')).toThrow('Task ID is required');
		});

		test('uses custom label for invalid error', () => {
			expect(() => validateId('bad/id', 'Plan ID')).toThrow('Invalid Plan ID');
		});
	});
});

// ─── validateTitle ──────────────────────────────────────────────────────

describe('validateTitle', () => {
	test('accepts normal string', () => {
		expect(validateTitle('My Task Title')).toBe('My Task Title');
	});

	test('accepts string at max length (500)', () => {
		const title = 'a'.repeat(500);
		expect(validateTitle(title)).toBe(title);
	});

	test('rejects string over max length', () => {
		const title = 'a'.repeat(501);
		expect(() => validateTitle(title)).toThrow('exceeds maximum length of 500');
	});

	test('rejects control char \\x00', () => {
		expect(() => validateTitle('title\x00')).toThrow('control characters');
	});

	test('rejects control char \\x08 (backspace)', () => {
		expect(() => validateTitle('title\x08')).toThrow('control characters');
	});

	test('rejects newline (not allowed in title)', () => {
		expect(() => validateTitle('line1\nline2')).toThrow('control characters');
	});

	test('rejects non-string (null)', () => {
		expect(() => validateTitle(null)).toThrow('must be a string');
	});

	test('rejects non-string (undefined)', () => {
		expect(() => validateTitle(undefined)).toThrow('must be a string');
	});

	test('accepts empty string', () => {
		expect(validateTitle('')).toBe('');
	});
});

// ─── validateDescription ────────────────────────────────────────────────

describe('validateDescription', () => {
	test('accepts normal string', () => {
		expect(validateDescription('A task description.')).toBe('A task description.');
	});

	test('accepts string at max length (50000)', () => {
		const desc = 'a'.repeat(50000);
		expect(validateDescription(desc)).toBe(desc);
	});

	test('rejects string over max length', () => {
		const desc = 'a'.repeat(50001);
		expect(() => validateDescription(desc)).toThrow('exceeds maximum length of 50000');
	});

	test('allows newlines', () => {
		expect(validateDescription('line1\nline2\nline3')).toBe('line1\nline2\nline3');
	});

	test('allows carriage returns', () => {
		expect(validateDescription('line1\r\nline2')).toBe('line1\r\nline2');
	});

	test('allows tabs', () => {
		expect(validateDescription('col1\tcol2')).toBe('col1\tcol2');
	});

	test('rejects control char \\x00', () => {
		expect(() => validateDescription('desc\x00')).toThrow('control characters');
	});

	test('rejects control char \\x08 (backspace)', () => {
		expect(() => validateDescription('desc\x08')).toThrow('control characters');
	});

	test('rejects non-string (null)', () => {
		expect(() => validateDescription(null)).toThrow('must be a string');
	});

	test('rejects non-string (undefined)', () => {
		expect(() => validateDescription(undefined)).toThrow('must be a string');
	});
});

// ─── validateCommentBody ────────────────────────────────────────────────

describe('validateCommentBody', () => {
	test('accepts normal string', () => {
		expect(validateCommentBody('A comment.')).toBe('A comment.');
	});

	test('accepts string at max length (10000)', () => {
		const body = 'a'.repeat(10000);
		expect(validateCommentBody(body)).toBe(body);
	});

	test('rejects string over max length', () => {
		const body = 'a'.repeat(10001);
		expect(() => validateCommentBody(body)).toThrow('exceeds maximum length of 10000');
	});

	test('allows newlines', () => {
		expect(validateCommentBody('line1\nline2')).toBe('line1\nline2');
	});

	test('allows tabs', () => {
		expect(validateCommentBody('col1\tcol2')).toBe('col1\tcol2');
	});

	test('rejects control char \\x00', () => {
		expect(() => validateCommentBody('body\x00')).toThrow('control characters');
	});

	test('rejects control char \\x08 (backspace)', () => {
		expect(() => validateCommentBody('body\x08')).toThrow('control characters');
	});

	test('rejects non-string (null)', () => {
		expect(() => validateCommentBody(null)).toThrow('must be a string');
	});

	test('rejects non-string (undefined)', () => {
		expect(() => validateCommentBody(undefined)).toThrow('must be a string');
	});
});

// ─── validateStatus ─────────────────────────────────────────────────────

describe('validateStatus', () => {
	test.each(['backlog', 'todo', 'in_progress', 'in_review', 'done'])('accepts valid status: %s', (status) => {
		expect(validateStatus(status)).toBe(status);
	});

	test('rejects invalid status', () => {
		expect(() => validateStatus('invalid')).toThrow('Invalid status');
	});

	test('error message lists allowed values', () => {
		expect(() => validateStatus('nope')).toThrow('backlog, todo, in_progress, in_review, done');
	});

	test('rejects uppercase variant', () => {
		expect(() => validateStatus('TODO')).toThrow('Invalid status');
	});
});

// ─── validateComplexity ─────────────────────────────────────────────────

describe('validateComplexity', () => {
	test.each(['low', 'medium', 'high'])('accepts valid complexity: %s', (complexity) => {
		expect(validateComplexity(complexity)).toBe(complexity);
	});

	test('rejects invalid complexity', () => {
		expect(() => validateComplexity('extreme')).toThrow('Invalid complexity');
	});

	test('error message lists allowed values', () => {
		expect(() => validateComplexity('nope')).toThrow('low, medium, high');
	});
});

// ─── validateBaseUrl ────────────────────────────────────────────────────

describe('validateBaseUrl', () => {
	test('accepts https URL', () => {
		expect(validateBaseUrl('https://example.com')).toBe('https://example.com');
	});

	test('accepts http://localhost:3000', () => {
		expect(validateBaseUrl('http://localhost:3000')).toBe('http://localhost:3000');
	});

	test('accepts http://127.0.0.1:3000', () => {
		expect(validateBaseUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
	});

	test('rejects http:// for non-localhost', () => {
		expect(() => validateBaseUrl('http://example.com')).toThrow('must use HTTPS');
	});

	test('rejects ftp://', () => {
		expect(() => validateBaseUrl('ftp://example.com')).toThrow('must use HTTP(S)');
	});

	test('rejects file://', () => {
		expect(() => validateBaseUrl('file:///etc/passwd')).toThrow('must use HTTP(S)');
	});

	test('rejects invalid URL string', () => {
		expect(() => validateBaseUrl('not-a-url')).toThrow('Invalid base URL');
	});

	test('rejects empty string', () => {
		expect(() => validateBaseUrl('')).toThrow('Base URL is required');
	});

	test('rejects null', () => {
		expect(() => validateBaseUrl(null)).toThrow('Base URL is required');
	});
});

// ─── validateVersion ────────────────────────────────────────────────────

describe('validateVersion', () => {
	test('accepts 1.0.0', () => {
		expect(validateVersion('1.0.0')).toBe('1.0.0');
	});

	test('accepts 1.2.3-beta.1', () => {
		expect(validateVersion('1.2.3-beta.1')).toBe('1.2.3-beta.1');
	});

	test('accepts 0.0.1', () => {
		expect(validateVersion('0.0.1')).toBe('0.0.1');
	});

	test('accepts 10.20.30', () => {
		expect(validateVersion('10.20.30')).toBe('10.20.30');
	});

	test('rejects abc', () => {
		expect(() => validateVersion('abc')).toThrow('Invalid version format');
	});

	test('rejects empty string', () => {
		expect(() => validateVersion('')).toThrow('Invalid version format');
	});

	test('rejects partial version 1.0', () => {
		expect(() => validateVersion('1.0')).toThrow('Invalid version format');
	});

	test('rejects version with v prefix', () => {
		expect(() => validateVersion('v1.0.0')).toThrow('Invalid version format');
	});
});
