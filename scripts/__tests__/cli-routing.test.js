import { describe, test, expect } from 'bun:test';
import { join } from 'path';

const CLI_PATH = join(import.meta.dir, '../lightsprint.js');

describe('CLI routing', () => {
	test('--version flag prints version', async () => {
		const proc = Bun.spawn(['bun', 'run', CLI_PATH, '--version'], {
			stdout: 'pipe',
			stderr: 'pipe'
		});
		const stdout = await new Response(proc.stdout).text();
		await proc.exited;
		expect(stdout).toMatch(/^lightsprint v/);
	});

	test('-v flag prints version', async () => {
		const proc = Bun.spawn(['bun', 'run', CLI_PATH, '-v'], {
			stdout: 'pipe',
			stderr: 'pipe'
		});
		const stdout = await new Response(proc.stdout).text();
		await proc.exited;
		expect(stdout).toMatch(/^lightsprint v/);
	});

	test('help subcommand prints usage', async () => {
		const proc = Bun.spawn(['bun', 'run', CLI_PATH, 'help'], {
			stdout: 'pipe',
			stderr: 'pipe'
		});
		const stdout = await new Response(proc.stdout).text();
		await proc.exited;
		expect(stdout).toContain('Usage:');
		expect(stdout).toContain('lightsprint <command>');
		expect(stdout).toContain('review-plan');
		expect(stdout).toContain('tasks');
	});

	test('--help flag prints usage', async () => {
		const proc = Bun.spawn(['bun', 'run', CLI_PATH, '--help'], {
			stdout: 'pipe',
			stderr: 'pipe'
		});
		const stdout = await new Response(proc.stdout).text();
		await proc.exited;
		expect(stdout).toContain('Usage:');
	});

	test('-h flag prints usage', async () => {
		const proc = Bun.spawn(['bun', 'run', CLI_PATH, '-h'], {
			stdout: 'pipe',
			stderr: 'pipe'
		});
		const stdout = await new Response(proc.stdout).text();
		await proc.exited;
		expect(stdout).toContain('Usage:');
	});

	test('no subcommand prints help', async () => {
		const proc = Bun.spawn(['bun', 'run', CLI_PATH], {
			stdout: 'pipe',
			stderr: 'pipe'
		});
		const stdout = await new Response(proc.stdout).text();
		await proc.exited;
		expect(stdout).toContain('Usage:');
	});

	test('review-plan help shows review-plan usage', async () => {
		const proc = Bun.spawn(['bun', 'run', CLI_PATH, 'review-plan', 'help'], {
			stdout: 'pipe',
			stderr: 'pipe'
		});
		const stdout = await new Response(proc.stdout).text();
		await proc.exited;
		expect(stdout).toContain('lightsprint review-plan');
		expect(stdout).toContain('Review');
	});
});
