import { describe, test, expect } from 'bun:test';
import { join } from 'path';

const CLI_PATH = join(import.meta.dir, '../lightsprint.js');

const runCli = async (...args) => {
	const proc = Bun.spawn(['bun', 'run', CLI_PATH, ...args], {
		stdout: 'pipe',
		stderr: 'pipe'
	});
	const stdout = await new Response(proc.stdout).text();
	await proc.exited;
	return stdout;
};

describe('CLI routing', () => {
	test('version subcommand prints version with build time', async () => {
		const stdout = await runCli('version');
		expect(stdout).toMatch(/^lightsprint v/);
		expect(stdout).toContain('built');
	});

	test('help subcommand prints usage', async () => {
		const stdout = await runCli('help');
		expect(stdout).toContain('Usage:');
		expect(stdout).toContain('lightsprint <command>');
		expect(stdout).toContain('review-plan');
		expect(stdout).toContain('tasks');
	});

	test('--help flag prints usage', async () => {
		const stdout = await runCli('--help');
		expect(stdout).toContain('Usage:');
	});

	test('-h flag prints usage', async () => {
		const stdout = await runCli('-h');
		expect(stdout).toContain('Usage:');
	});

	test('no subcommand prints help', async () => {
		const stdout = await runCli();
		expect(stdout).toContain('Usage:');
	});

	test('review-plan help shows review-plan usage', async () => {
		const stdout = await runCli('review-plan', 'help');
		expect(stdout).toContain('lightsprint review-plan');
		expect(stdout).toContain('Review');
	});

	test('help mentions projects create', async () => {
		const stdout = await runCli('help');
		expect(stdout).toContain('projects create');
	});

	test('projects create --help shows schema-based usage', async () => {
		const stdout = await runCli('projects', 'create', '--help');
		expect(stdout).toContain('lightsprint projects create');
		expect(stdout).toContain('--name');
		expect(stdout).toContain('--color');
	});
});
