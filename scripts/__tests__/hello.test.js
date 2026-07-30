import { describe, test, expect } from 'bun:test';
import { hello } from '../hello.js';

describe('hello', () => {
	test('defaults to greeting the world', () => {
		expect(hello()).toBe('Hello, world!');
	});

	test('greets a provided name', () => {
		expect(hello('Lightsprint')).toBe('Hello, Lightsprint!');
	});
});
