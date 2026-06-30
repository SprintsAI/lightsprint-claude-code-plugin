import { describe, test, expect } from 'bun:test';
import { hello } from '../lib/hello.js';

describe('hello', () => {
	test('greets a given name', () => {
		expect(hello('Lightsprint')).toBe('Hello, Lightsprint!');
	});

	test('defaults to world when called with no argument', () => {
		expect(hello()).toBe('Hello, world!');
	});

	test('falls back to world for an empty string', () => {
		expect(hello('')).toBe('Hello, world!');
	});

	test('falls back to world for whitespace-only input', () => {
		expect(hello('   ')).toBe('Hello, world!');
	});

	test('trims surrounding whitespace', () => {
		expect(hello('  Ada  ')).toBe('Hello, Ada!');
	});

	test('accepts a name at the max length (200)', () => {
		const name = 'a'.repeat(200);
		expect(hello(name)).toBe(`Hello, ${name}!`);
	});

	test('rejects a name over the max length', () => {
		expect(() => hello('a'.repeat(201))).toThrow('exceeds maximum length of 200');
	});

	test('rejects control character \\x00', () => {
		expect(() => hello('Ada\x00')).toThrow('control characters');
	});

	test('rejects newline', () => {
		expect(() => hello('line1\nline2')).toThrow('control characters');
	});

	test('rejects non-string (null)', () => {
		expect(() => hello(null)).toThrow('must be a string');
	});

	test('rejects non-string (number)', () => {
		expect(() => hello(42)).toThrow('must be a string');
	});
});
