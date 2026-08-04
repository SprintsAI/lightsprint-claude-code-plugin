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

// Error paths need stderr and the exit code, not just stdout — a command that
// fails silently with exit 0 is indistinguishable from success otherwise.
const runCliFull = async (...args) => {
	const proc = Bun.spawn(['bun', 'run', CLI_PATH, ...args], {
		stdout: 'pipe',
		stderr: 'pipe'
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text()
	]);
	const exitCode = await proc.exited;
	return { stdout, stderr, exitCode };
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

	test('omits autoMerge when neither flag is passed — the server then inherits', async () => {
		const stdout = await runCli(
			'agent', 'launch', '--task', 'LS-1', '--provider', 'anthropic',
			'--dry-run', '--output', 'json'
		);
		expect(JSON.parse(stdout).requestBody).not.toHaveProperty('autoMerge');
	});

	test('--no-auto-merge sends false, to override a task already armed', async () => {
		const stdout = await runCli(
			'agent', 'launch', '--task', 'LS-1', '--provider', 'anthropic',
			'--no-auto-merge', '--dry-run', '--output', 'json'
		);
		expect(JSON.parse(stdout).requestBody.autoMerge).toBe(false);
	});

	test('rejects a value after the bare flag instead of launching a phantom task', async () => {
		// `--auto-merge true` used to push "true" onto the positional task IDs —
		// validateId accepts it, so LS-1 launched armed while a task named "true"
		// failed, all with exit 0.
		const { stdout, stderr, exitCode } = await runCliFull(
			'agent', 'launch', '--task', 'LS-1', '--provider', 'anthropic',
			'--auto-merge', 'true', '--dry-run', '--output', 'json'
		);
		expect(exitCode).not.toBe(0);
		expect(stderr + stdout).toContain('bare flag');
		expect(stdout).not.toContain('/api/tasks/true/');
	});

	test('refuses to arm auto-merge across several tasks without --yes', async () => {
		const { stdout, stderr, exitCode } = await runCliFull(
			'agent', 'launch', '--task', 'LS-1', '--task', 'LS-2',
			'--provider', 'anthropic', '--auto-merge', '--dry-run', '--output', 'json'
		);
		expect(exitCode).not.toBe(0);
		expect(stderr + stdout).toContain('--yes');
	});

	test('--yes allows the multi-task fan-out, arming every task', async () => {
		const stdout = await runCli(
			'agent', 'launch', '--task', 'LS-1', '--task', 'LS-2', '--provider', 'anthropic',
			'--auto-merge', '--yes', '--dry-run', '--output', 'json'
		);
		const result = JSON.parse(stdout);
		expect(result.requestBody.autoMerge).toBe(true);
		expect(result.endpoint).toContain('/api/tasks/LS-1/cloud-agents/anthropic');
		expect(result.endpoint).toContain('/api/tasks/LS-2/cloud-agents/anthropic');
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

	test('describe agent-launch documents the flags and its trigger words', async () => {
		const schema = JSON.parse(await runCli('describe', 'agent-launch'));
		expect(schema.params.autoMerge).toMatchObject({ type: 'boolean', flag: '--auto-merge' });
		expect(schema.params.autoMerge.description).toContain('yolo');
		// Must not claim a false default: omitting the flag inherits, not disarms.
		expect(schema.params.autoMerge).not.toHaveProperty('default');
		expect(schema.params.autoMerge.description).toMatch(/inherit/i);
		expect(schema.params.noAutoMerge).toMatchObject({ flag: '--no-auto-merge' });
	});
});
