import { describe, test, expect } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import {
	validateStackId,
	validateWorkspaceId,
	validateTaskPrefix,
} from '../lib/validate.js';
import { parseGlobalOptions } from '../lib/options.js';

// ─── Validators ───────────────────────────────────────────────────────────

describe('validateStackId / validateWorkspaceId', () => {
	test('accepts a normal ID', () => {
		expect(validateStackId('stk_abc-123')).toBe('stk_abc-123');
		expect(validateWorkspaceId('ws_abc-123')).toBe('ws_abc-123');
	});

	test('rejects path traversal and query injection', () => {
		expect(() => validateStackId('../etc')).toThrow('Stack ID');
		expect(() => validateStackId('id?x=1')).toThrow('Stack ID');
		expect(() => validateWorkspaceId('a/b')).toThrow('Workspace ID');
	});

	test('rejects empty input', () => {
		expect(() => validateStackId('')).toThrow('Stack ID is required');
		expect(() => validateWorkspaceId(null)).toThrow('Workspace ID is required');
	});
});

describe('validateTaskPrefix', () => {
	test('accepts uppercase alphanumeric starting with a letter', () => {
		expect(validateTaskPrefix('LIG')).toBe('LIG');
		expect(validateTaskPrefix('WEB2')).toBe('WEB2');
		expect(validateTaskPrefix('A')).toBe('A');
	});

	test('rejects lowercase', () => {
		expect(() => validateTaskPrefix('lig')).toThrow('Invalid task prefix');
	});

	test('rejects leading digit', () => {
		expect(() => validateTaskPrefix('1AB')).toThrow('Invalid task prefix');
	});

	test('rejects symbols and spaces', () => {
		expect(() => validateTaskPrefix('LI-G')).toThrow('Invalid task prefix');
		expect(() => validateTaskPrefix('LI G')).toThrow('Invalid task prefix');
	});

	test('rejects > 12 chars', () => {
		expect(() => validateTaskPrefix('ABCDEFGHIJKLM')).toThrow('maximum length');
	});

	test('rejects empty', () => {
		expect(() => validateTaskPrefix('')).toThrow('Task prefix is required');
	});
});

// ─── Global --stack option ─────────────────────────────────────────────────

describe('parseGlobalOptions --stack', () => {
	test('extracts --stack and removes it from remaining args', () => {
		const { globalOptions, remainingArgs } = parseGlobalOptions(['create', '--stack', 'stk-1', '--title', 'X']);
		expect(globalOptions.stack).toBe('stk-1');
		expect(remainingArgs).toEqual(['create', '--title', 'X']);
	});

	test('defaults stack to null when absent', () => {
		const { globalOptions } = parseGlobalOptions(['tasks']);
		expect(globalOptions.stack).toBeNull();
	});
});

// ─── CLI routing (no network) ──────────────────────────────────────────────

const CLI_PATH = join(import.meta.dir, '../lightsprint.js');
const TEST_CONFIG_DIR = join(tmpdir(), `lightsprint-stack-${randomBytes(8).toString('hex')}`);

const runCli = async (args) => {
	const proc = Bun.spawn(['bun', 'run', CLI_PATH, ...args], {
		stdout: 'pipe',
		stderr: 'pipe',
		env: { ...process.env, LIGHTSPRINT_CONFIG_DIR: TEST_CONFIG_DIR },
	});
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;
	return { stdout, stderr, exitCode };
};

describe('stack CLI routing', () => {
	test('stack with no subcommand errors', async () => {
		const { exitCode, stderr } = await runCli(['stack']);
		expect(exitCode).not.toBe(0);
		expect(stderr).toContain('Unknown stack subcommand');
	});

	test('stack unknown subcommand errors', async () => {
		const { exitCode } = await runCli(['stack', 'frobnicate']);
		expect(exitCode).not.toBe(0);
	});

	test('describe stack lists subcommands', async () => {
		const { exitCode, stdout } = await runCli(['describe', 'stack']);
		expect(exitCode).toBe(0);
		const json = JSON.parse(stdout);
		const names = json.subcommands.map((s) => s.command);
		expect(names).toContain('stack list');
		expect(names).toContain('stack create');
		expect(names).toContain('stack use');
	});

	test('describe stack create returns the create schema', async () => {
		const { exitCode, stdout } = await runCli(['describe', 'stack', 'create']);
		expect(exitCode).toBe(0);
		const json = JSON.parse(stdout);
		expect(json.command).toBe('stack-create');
		expect(json.params.taskPrefix.required).toBe(true);
		expect(json.params.repos.required).toBe(true);
	});

	test('stack create --dry-run validates without network', async () => {
		const { exitCode, stdout } = await runCli([
			'stack', 'create', '--name', 'Web', '--task-prefix', 'WEB', '--repos', 'r1,r2', '--dry-run', '--output', 'json',
		]);
		expect(exitCode).toBe(0);
		const json = JSON.parse(stdout);
		expect(json.dryRun).toBe(true);
		expect(json.requestBody.taskPrefix).toBe('WEB');
		expect(json.requestBody.repoIds).toEqual(['r1', 'r2']);
	});

	test('stack create rejects a lowercase task prefix locally', async () => {
		const { exitCode, stderr } = await runCli([
			'stack', 'create', '--name', 'Web', '--task-prefix', 'web', '--repos', 'r1', '--dry-run',
		]);
		expect(exitCode).not.toBe(0);
		expect(stderr.toLowerCase()).toContain('task prefix');
	});

	test('stack create rejects more than 10 repos locally', async () => {
		const repos = Array.from({ length: 11 }, (_, i) => `r${i}`).join(',');
		const { exitCode } = await runCli([
			'stack', 'create', '--name', 'Web', '--task-prefix', 'WEB', '--repos', repos, '--dry-run',
		]);
		expect(exitCode).not.toBe(0);
	});

	test('create --dry-run with --stack reports stack scope without network', async () => {
		const { exitCode, stdout } = await runCli([
			'create', '--title', 'Hello', '--stack', 'stk-xyz', '--dry-run', '--output', 'json',
		]);
		expect(exitCode).toBe(0);
		const json = JSON.parse(stdout);
		expect(json.dryRun).toBe(true);
		expect(json.endpoint).toBe('POST /api/tasks');
		expect(json.requestBody.scope).toBe('stack');
		expect(json.requestBody.stackId).toBe('stk-xyz');
	});
});
