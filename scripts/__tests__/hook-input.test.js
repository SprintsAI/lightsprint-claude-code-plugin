import { describe, test, expect, afterEach } from 'bun:test';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { readHookInput } from '../lib/cc-utils.js';

describe('readHookInput', () => {
	const tmpFiles = [];

	function makeTmpFile(content) {
		const name = `hook-input-test-${randomBytes(8).toString('hex')}.json`;
		const filePath = join(tmpdir(), name);
		writeFileSync(filePath, content, 'utf-8');
		tmpFiles.push(filePath);
		return filePath;
	}

	afterEach(() => {
		for (const f of tmpFiles) {
			try { unlinkSync(f); } catch { /* already gone */ }
		}
		tmpFiles.length = 0;
	});

	test('valid JSON file path in args[0] returns parsed object', () => {
		const data = { tool: 'Write', path: '/tmp/foo.txt' };
		const filePath = makeTmpFile(JSON.stringify(data));
		const result = readHookInput([filePath]);
		expect(result).toEqual(data);
	});

	test('file with valid hook input returns correct object', () => {
		const data = { session_id: 'abc', cwd: '/tmp' };
		const filePath = makeTmpFile(JSON.stringify(data));
		const result = readHookInput([filePath]);
		expect(result).toEqual(data);
	});

	test('invalid JSON in file returns null', () => {
		const filePath = makeTmpFile('not valid json {{{');
		const result = readHookInput([filePath]);
		expect(result).toBeNull();
	});

	test('non-existent file path returns null', () => {
		const bogusPath = join(tmpdir(), `no-such-file-${randomBytes(8).toString('hex')}.json`);
		const result = readHookInput([bogusPath]);
		expect(result).toBeNull();
	});

	test('empty args array returns null', () => {
		const result = readHookInput([]);
		expect(result).toBeNull();
	});

	test('args[0] is undefined returns null', () => {
		const result = readHookInput([undefined]);
		expect(result).toBeNull();
	});
});
