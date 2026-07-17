import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
	absoluteLightsprintUrl,
	buildHandoffDescription,
	buildHandoffTaskUrl,
	gatherHandoffGitContext,
	isFailedHandoffSession,
	isTerminalHandoffSession,
	parseGitHubRepoFullName,
	parseHandoffSessionId,
	selectHandoffStack,
} from '../lib/handoff.js';

describe('handoff helpers', () => {
	test('parses HTTPS and SSH GitHub remotes', () => {
		expect(parseGitHubRepoFullName('https://github.com/SprintsAI/lightsprint.git')).toBe('SprintsAI/lightsprint');
		expect(parseGitHubRepoFullName('git@github.com:SprintsAI/lightsprint.git')).toBe('SprintsAI/lightsprint');
		expect(parseGitHubRepoFullName('https://gitlab.com/SprintsAI/lightsprint.git')).toBeNull();
	});

	test('captures the repository, branch, and uncommitted diff from Git', () => {
		const repoDir = mkdtempSync(join(tmpdir(), 'lightsprint-handoff-test-'));
		try {
			execFileSync('git', ['init', '-b', 'main'], { cwd: repoDir });
			execFileSync('git', ['config', 'user.email', 'test@lightsprint.ai'], { cwd: repoDir });
			execFileSync('git', ['config', 'user.name', 'Lightsprint Test'], { cwd: repoDir });
			execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:SprintsAI/lightsprint.git'], { cwd: repoDir });
			writeFileSync(join(repoDir, 'example.txt'), 'before\n');
			execFileSync('git', ['add', 'example.txt'], { cwd: repoDir });
			execFileSync('git', ['commit', '-m', 'test fixture'], { cwd: repoDir });
			writeFileSync(join(repoDir, 'example.txt'), 'after\n');

			const context = gatherHandoffGitContext(repoDir);
			expect(context.repo).toBe('SprintsAI/lightsprint');
			expect(context.branch).toBe('main');
			expect(context.diff).toContain('-before');
			expect(context.diff).toContain('+after');
			expect(context.diffBytes).toBeGreaterThan(0);
			expect(context.diffTruncated).toBe(false);
		} finally {
			rmSync(repoDir, { recursive: true, force: true });
		}
	});

	test('builds task context without embedding an omitted diff', () => {
		const description = buildHandoffDescription({
			task: 'Fix auth',
			context: 'Timeout is hardcoded.',
			git: { repo: 'SprintsAI/lightsprint', branch: 'main', diff: '', diffTruncated: false },
		});
		expect(description).toContain('Fix auth');
		expect(description).toContain('Repository: SprintsAI/lightsprint');
		expect(description).toContain('Local branch: main');
		expect(description).toContain('Timeout is hardcoded.');
		expect(description).not.toContain('```diff');
	});

	test('selects the unique stack containing the current repository', () => {
		const selected = selectHandoffStack({
			workspace: {
				defaultStackId: 'stack-default',
				repos: [{ id: 'repo-1', fullName: 'SprintsAI/lightsprint' }],
			},
			stacks: [
				{ id: 'stack-default', name: 'Default', memberRepoIds: [] },
				{ id: 'stack-product', name: 'Product', memberRepoIds: ['repo-1'] },
			],
			repoFullName: 'sprintsai/LIGHTSPRINT',
		});
		expect(selected.id).toBe('stack-product');
		expect(selected.selection).toBe('repository-match');
	});

	test('requires an explicit stack when a repo has multiple non-default matches', () => {
		expect(() => selectHandoffStack({
			workspace: {
				defaultStackId: 'stack-default',
				repos: [{ id: 'repo-1', fullName: 'SprintsAI/lightsprint' }],
			},
			stacks: [
				{ id: 'stack-a', name: 'A', memberRepoIds: ['repo-1'] },
				{ id: 'stack-b', name: 'B', memberRepoIds: ['repo-1'] },
			],
			repoFullName: 'SprintsAI/lightsprint',
		})).toThrow('belongs to multiple stacks');
	});

	test('builds absolute task and session URLs', () => {
		expect(buildHandoffTaskUrl('https://app.lightsprint.ai/', 'ws-1', 'LS', 42))
			.toBe('https://app.lightsprint.ai/workspaces/ws-1/tasks/LS-42');
		expect(absoluteLightsprintUrl('https://app.lightsprint.ai/', '/agent-sessions/sess-1'))
			.toBe('https://app.lightsprint.ai/agent-sessions/sess-1');
	});

	test('parses session IDs and classifies terminal status', () => {
		expect(parseHandoffSessionId('sess_123')).toBe('sess_123');
		expect(parseHandoffSessionId('https://app.lightsprint.ai/agent-sessions/sess_123?embed=1')).toBe('sess_123');
		expect(isTerminalHandoffSession('running')).toBe(false);
		expect(isTerminalHandoffSession('idle')).toBe(true);
		expect(isFailedHandoffSession('failed')).toBe(true);
		expect(isFailedHandoffSession('completed')).toBe(false);
	});
});
