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

});

describe('agent launch --auto-merge', () => {
	test('sends autoMerge in the launch body', async () => {
		const stdout = await runCli(
			'agent', 'launch', '--task', 'LS-1', '--provider', 'anthropic',
			'--auto-merge', '--dry-run', '--output', 'json'
		);
		const result = JSON.parse(stdout);
		expect(result.validationPassed).toBe(true);
		expect(result.requestBody.autoMerge).toBe(true);
	});

	test('omits autoMerge when the flag is absent', async () => {
		const stdout = await runCli(
			'agent', 'launch', '--task', 'LS-1', '--provider', 'anthropic',
			'--dry-run', '--output', 'json'
		);
		expect(JSON.parse(stdout).requestBody).not.toHaveProperty('autoMerge');
	});

	test('is a bare flag — the following positional stays a task ID', async () => {
		const stdout = await runCli(
			'agent', 'launch', '--provider', 'anthropic', '--auto-merge', 'LS-2',
			'--dry-run', '--output', 'json'
		);
		const result = JSON.parse(stdout);
		expect(result.requestBody.autoMerge).toBe(true);
		expect(result.endpoint).toContain('/api/tasks/LS-2/cloud-agents/anthropic');
	});

	test('describe agent-launch documents the flag and its trigger words', async () => {
		const schema = JSON.parse(await runCli('describe', 'agent-launch'));
		expect(schema.params.autoMerge).toMatchObject({ type: 'boolean', flag: '--auto-merge', default: false });
		expect(schema.params.autoMerge.description).toContain('yolo');
	});
});
