/**
 * Helpers for handing local work to a Lightsprint managed cloud agent.
 */

import { createHash } from 'crypto';
import { execFileSync, spawnSync } from 'child_process';

export const MAX_HANDOFF_DIFF_BYTES = 100 * 1024;
export const DEFAULT_HANDOFF_POLL_INTERVAL_SECONDS = 30;

const TERMINAL_SESSION_STATUSES = new Set(['idle', 'completed', 'cancelled', 'failed']);

function runGit(args, cwd) {
	try {
		return execFileSync('git', args, {
			cwd,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
			maxBuffer: 1024 * 1024,
		}).trim();
	} catch {
		return '';
	}
}

export function parseGitHubRepoFullName(remote) {
	if (!remote) return null;
	const match = remote.trim().match(/github\.com(?::|\/)([^/]+\/[^/]+?)(?:\.git)?$/i);
	return match ? match[1] : null;
}

export function gatherHandoffGitContext(cwd = process.cwd(), includeDiff = true) {
	const remote = runGit(['remote', 'get-url', 'origin'], cwd);
	const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
	let diff = '';
	let diffTruncated = false;

	if (includeDiff && runGit(['rev-parse', '--is-inside-work-tree'], cwd) === 'true') {
		const result = spawnSync('git', ['diff', 'HEAD'], {
			cwd,
			encoding: 'buffer',
			stdio: ['ignore', 'pipe', 'ignore'],
			maxBuffer: MAX_HANDOFF_DIFF_BYTES + 1,
		});
		const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0);
		diffTruncated = stdout.length > MAX_HANDOFF_DIFF_BYTES || result.error?.code === 'ENOBUFS';
		diff = stdout.subarray(0, MAX_HANDOFF_DIFF_BYTES).toString('utf8');
	}

	return {
		repo: parseGitHubRepoFullName(remote),
		branch: branch && branch !== 'HEAD' ? branch : null,
		diff,
		diffBytes: Buffer.byteLength(diff),
		diffTruncated,
	};
}

export function buildHandoffDescription({ task, context, git }) {
	const blocks = [task.trim()];
	const details = [];

	if (git.repo) details.push(`Repository: ${git.repo}`);
	if (git.branch) details.push(`Local branch: ${git.branch}`);
	if (context?.trim()) details.push('', context.trim());

	if (details.length > 0) {
		blocks.push([
			'<details>',
			'<summary>Context from the local coding agent</summary>',
			'',
			...details,
			'',
			'</details>',
		].join('\n'));
	}

	if (git.diff) {
		blocks.push([
			'<details>',
			`<summary>Uncommitted local changes${git.diffTruncated ? ' (truncated to 100 KiB)' : ''}</summary>`,
			'',
			'This diff is context only. Recreate any needed changes in the cloud workspace; local files are not transferred.',
			'',
			'```diff',
			git.diff,
			'```',
			'',
			'</details>',
		].join('\n'));
	}

	return blocks.join('\n\n');
}

export function selectHandoffStack({ workspace, stacks, repoFullName, explicitStackId = null }) {
	if (explicitStackId) {
		const explicit = stacks.find((stack) => stack.id === explicitStackId);
		if (!explicit) throw new Error(`Stack ${explicitStackId} was not found in the active workspace.`);
		return { ...explicit, selection: 'explicit' };
	}

	const defaultStack = stacks.find((stack) => stack.id === workspace.defaultStackId) ?? null;
	if (!repoFullName) {
		if (!defaultStack) {
			throw new Error('No GitHub repository was detected and the workspace has no default stack. Pass --stack <ref>.');
		}
		return { ...defaultStack, selection: 'workspace-default' };
	}

	const repo = (workspace.repos ?? []).find(
		(candidate) => candidate.fullName?.toLowerCase() === repoFullName.toLowerCase(),
	);
	if (!repo) {
		throw new Error(`Repository ${repoFullName} is not connected to the active Lightsprint workspace.`);
	}

	const matches = stacks.filter((stack) => (stack.memberRepoIds ?? []).includes(repo.id));
	if (matches.length === 1) return { ...matches[0], selection: 'repository-match' };
	if (matches.length > 1) {
		const matchingDefault = matches.find((stack) => stack.id === workspace.defaultStackId);
		if (matchingDefault) return { ...matchingDefault, selection: 'repository-default-match' };
		const choices = matches.map((stack) => stack.taskPrefix || stack.name || stack.id).join(', ');
		throw new Error(`Repository ${repoFullName} belongs to multiple stacks (${choices}). Pass --stack <ref>.`);
	}

	throw new Error(`Repository ${repoFullName} is connected but is not a member of any Lightsprint stack.`);
}

export function createHandoffIdempotencyKey({ task, repo, branch }) {
	const digest = createHash('sha256')
		.update([task, repo ?? '', branch ?? '', Date.now(), process.pid].join('\0'))
		.digest('hex')
		.slice(0, 32);
	return `handoff:${digest}`;
}

export function absoluteLightsprintUrl(baseUrl, pathOrUrl) {
	if (!pathOrUrl) return null;
	if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
	return `${baseUrl.replace(/\/$/, '')}/${pathOrUrl.replace(/^\//, '')}`;
}

export function buildHandoffTaskUrl(baseUrl, workspaceId, taskPrefix, taskNumber) {
	const root = `${baseUrl.replace(/\/$/, '')}/workspaces/${encodeURIComponent(workspaceId)}/tasks`;
	if (!taskPrefix || taskNumber == null) return root;
	return `${root}/${encodeURIComponent(`${taskPrefix}-${taskNumber}`)}`;
}

export function parseHandoffSessionId(value) {
	if (!value) return null;
	const match = String(value).match(/(?:^|\/agent-sessions\/)([a-zA-Z0-9_-]+)(?:[/?#]|$)/);
	return match ? match[1] : null;
}

export function isTerminalHandoffSession(sessionStatus) {
	return TERMINAL_SESSION_STATUSES.has(sessionStatus);
}

export function isFailedHandoffSession(sessionStatus) {
	return sessionStatus === 'failed' || sessionStatus === 'cancelled';
}
