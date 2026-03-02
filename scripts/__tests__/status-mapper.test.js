import { describe, test, expect } from 'bun:test';
import { lsToCcStatus } from '../lib/status-mapper.js';

describe('lsToCcStatus', () => {
	test('maps todo to pending', () => {
		expect(lsToCcStatus('todo')).toBe('pending');
	});

	test('maps in_progress to in_progress', () => {
		expect(lsToCcStatus('in_progress')).toBe('in_progress');
	});

	test('maps in_review to in_progress', () => {
		expect(lsToCcStatus('in_review')).toBe('in_progress');
	});

	test('maps done to completed', () => {
		expect(lsToCcStatus('done')).toBe('completed');
	});

	test('returns undefined for unknown status', () => {
		expect(lsToCcStatus('cancelled')).toBeUndefined();
		expect(lsToCcStatus('')).toBeUndefined();
		expect(lsToCcStatus(undefined)).toBeUndefined();
	});
});
