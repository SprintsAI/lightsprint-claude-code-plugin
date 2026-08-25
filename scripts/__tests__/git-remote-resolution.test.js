// scripts/__tests__/git-remote-resolution.test.js
//
// Remote *selection* — which remote wins — exercised against real throwaway git
// repositories, plus the failure messages the CLI shows when nothing matches.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
	resolveGitHubRemote,
	describeRemoteResolution,
	listGitRemotes,
	getBranchUpstreamRemote,
} from '../lib/git-remote.js';
import { getGitRepoFullName } from '../lib/config.js';

const REPO_ROOT = join(import.meta.dir, '../..');
const GH = (name) => `git@github.com:acme/${name}.git`;

const createdDirs = [];
let savedGlobalConfig;
let savedSystemConfig;

beforeAll(() => {
	// Keep git hermetic: the developer's ~/.gitconfig must not change the outcome
	// (an insteadOf rewrite or a default remote would silently skew these tests).
	savedGlobalConfig = process.env.GIT_CONFIG_GLOBAL;
	savedSystemConfig = process.env.GIT_CONFIG_SYSTEM;
	process.env.GIT_CONFIG_GLOBAL = '/dev/null';
	process.env.GIT_CONFIG_SYSTEM = '/dev/null';
});

afterAll(() => {
	if (savedGlobalConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
	else process.env.GIT_CONFIG_GLOBAL = savedGlobalConfig;
	if (savedSystemConfig === undefined) delete process.env.GIT_CONFIG_SYSTEM;
	else process.env.GIT_CONFIG_SYSTEM = savedSystemConfig;
	for (const dir of createdDirs) {
		try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
	}
});

function git(cwd, args) {
	return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

/**
 * @param {Array<[string, string]>} remotes  [name, url] pairs
 * @param {{ trackedRemote?: string, detached?: boolean, config?: Array<[string,string]> }} [opts]
 */
function makeRepo(remotes = [], opts = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'ls-remote-'));
	createdDirs.push(dir);
	git(dir, ['init', '-q', '-b', 'main', '.']);
	for (const [key, value] of opts.config || []) git(dir, ['config', key, value]);
	for (const [name, url] of remotes) git(dir, ['remote', 'add', name, url]);
	if (opts.trackedRemote) {
		// What `git branch --set-upstream-to` writes, without needing to fetch.
		git(dir, ['config', 'branch.main.remote', opts.trackedRemote]);
		git(dir, ['config', 'branch.main.merge', 'refs/heads/main']);
	}
	if (opts.detached) {
		git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
		git(dir, ['checkout', '-q', '--detach', 'HEAD']);
	}
	return dir;
}

// ─── selection order ─────────────────────────────────────────────────────

describe('resolveGitHubRemote — remote selection', () => {
	test('origin only (the common case)', () => {
		const dir = makeRepo([['origin', GH('widget')]]);
		const result = resolveGitHubRemote(dir);
		expect(result.reason).toBe('ok');
		expect(result.fullName).toBe('acme/widget');
		expect(result.remote).toBe('origin');
		expect(result.selectedBy).toBe('origin');
		expect(result.ambiguous).toBe(false);
	});

	test('upstream only — no origin at all', () => {
		const dir = makeRepo([['upstream', GH('canonical')]]);
		const result = resolveGitHubRemote(dir);
		expect(result.fullName).toBe('acme/canonical');
		expect(result.remote).toBe('upstream');
		expect(result.selectedBy).toBe('upstream');
	});

	test('a single non-origin remote wins whatever it is called', () => {
		for (const name of ['github', 'gh', 'fork', 'mirror']) {
			const dir = makeRepo([[name, GH('solo')]]);
			const result = resolveGitHubRemote(dir);
			expect(result.fullName).toBe('acme/solo');
			expect(result.remote).toBe(name);
			expect(result.selectedBy).toBe('only-remote');
		}
	});

	test('fork workflow: origin is the fork, upstream is canonical — origin wins', () => {
		const dir = makeRepo([
			['origin', 'git@github.com:me/widget.git'],
			['upstream', GH('widget')],
		]);
		const result = resolveGitHubRemote(dir);
		expect(result.fullName).toBe('me/widget');
		expect(result.remote).toBe('origin');
		expect(result.selectedBy).toBe('origin');
	});

	test("the current branch's upstream beats origin, and says so", () => {
		const dir = makeRepo([
			['origin', 'git@github.com:me/widget.git'],
			['upstream', GH('widget')],
		], { trackedRemote: 'upstream' });
		expect(getBranchUpstreamRemote(dir)).toBe('upstream');
		const result = resolveGitHubRemote(dir);
		expect(result.fullName).toBe('acme/widget');
		expect(result.remote).toBe('upstream');
		expect(result.selectedBy).toBe('branch-upstream');
		// Overriding a GitHub origin changes the connect target and flips again on
		// the next branch switch — the user is told rather than surprised.
		expect(result.ambiguous).toBe(true);
		const message = describeRemoteResolution(result);
		expect(message).toContain('upstream (acme/widget)');
		expect(message).toContain('origin (me/widget)');
		expect(message).toContain('git branch --set-upstream-to=');
	});

	test('tracking origin itself is not ambiguous', () => {
		const dir = makeRepo([['origin', GH('widget')]], { trackedRemote: 'origin' });
		const result = resolveGitHubRemote(dir);
		expect(result.selectedBy).toBe('branch-upstream');
		expect(result.ambiguous).toBe(false);
	});

	test('branch tracking a remote that is not a GitHub remote falls through to origin', () => {
		const dir = makeRepo([
			['origin', GH('widget')],
			['internal', 'git@gitlab.com:acme/widget.git'],
		], { trackedRemote: 'internal' });
		const result = resolveGitHubRemote(dir);
		expect(result.remote).toBe('origin');
		expect(result.selectedBy).toBe('origin');
	});

	test('detached HEAD has no branch upstream and still resolves', () => {
		const dir = makeRepo([['origin', GH('widget')]], { trackedRemote: 'origin', detached: true });
		expect(getBranchUpstreamRemote(dir)).toBeNull();
		const result = resolveGitHubRemote(dir);
		expect(result.fullName).toBe('acme/widget');
		expect(result.selectedBy).toBe('origin');
	});

	test('origin pointing at a non-GitHub host defers to the GitHub remote', () => {
		const dir = makeRepo([
			['origin', 'git@gitlab.com:acme/widget.git'],
			['github', GH('widget')],
		]);
		const result = resolveGitHubRemote(dir);
		expect(result.fullName).toBe('acme/widget');
		expect(result.remote).toBe('github');
		expect(result.selectedBy).toBe('only-remote');
		expect(result.ambiguous).toBe(false);
	});

	test('several GitHub remotes with no preferred name resolve deterministically and report ambiguity', () => {
		const dir = makeRepo([
			['zulu', GH('zulu')],
			['alpha', GH('alpha')],
		]);
		const result = resolveGitHubRemote(dir);
		expect(result.remote).toBe('alpha');
		expect(result.selectedBy).toBe('alphabetical');
		expect(result.ambiguous).toBe(true);
		expect(describeRemoteResolution(result)).toContain('More than one GitHub remote');
	});

	test('url.<base>.insteadOf rewrites are honoured', () => {
		const dir = makeRepo([['origin', 'gh:acme/widget.git']], {
			config: [['url.git@github.com:.insteadOf', 'gh:']],
		});
		expect(resolveGitHubRemote(dir).fullName).toBe('acme/widget');
	});

	test('every remote is reported, GitHub or not', () => {
		const dir = makeRepo([
			['origin', GH('widget')],
			['backup', 'file:///srv/git/widget.git'],
		]);
		const result = resolveGitHubRemote(dir);
		expect(result.remotes.map((r) => r.name).sort()).toEqual(['backup', 'origin']);
		expect(result.remotes.find((r) => r.name === 'backup').isGitHub).toBe(false);
	});
});

// ─── failure paths ───────────────────────────────────────────────────────

describe('resolveGitHubRemote — failures are reported, never thrown', () => {
	test('repository with no remotes', () => {
		const dir = makeRepo([]);
		const result = resolveGitHubRemote(dir);
		expect(result.reason).toBe('no-remotes');
		expect(result.fullName).toBeNull();
		expect(describeRemoteResolution(result)).toContain('no remotes configured');
	});

	test('only non-GitHub remotes — message names each remote and why it did not match', () => {
		const dir = makeRepo([
			['origin', 'git@gitlab.com:acme/widget.git'],
			['backup', '/srv/git/widget.git'],
		]);
		const result = resolveGitHubRemote(dir);
		expect(result.reason).toBe('no-github-remote');
		expect(result.fullName).toBeNull();
		const message = describeRemoteResolution(result);
		expect(message).toContain('No GitHub remote found');
		expect(message).toContain('origin -> git@gitlab.com:acme/widget.git');
		expect(message).toContain('gitlab.com is not GitHub');
		expect(message).toContain('backup -> /srv/git/widget.git');
		expect(message).toContain('a local path, not a remote URL');
		expect(message).toContain('LIGHTSPRINT_GITHUB_HOSTS');
		// The old message asserted something untrue about origin.
		expect(message).not.toContain('requires a git repo with an origin remote');
	});

	test('a github.com remote is never described as "not GitHub"', () => {
		const dir = makeRepo([
			['origin', 'https://github.com/acme/widget/tree/main'],
			['gist', 'git@github.com:0123456789abcdef.git'],
		]);
		const result = resolveGitHubRemote(dir);
		expect(result.reason).toBe('no-github-remote');
		const message = describeRemoteResolution(result);
		expect(message).not.toContain('github.com is not GitHub');
		expect(message).toContain('github.com is GitHub, but the URL is not a plain owner/repo');
		expect(result.remotes.find((r) => r.name === 'origin').skipped).toBe('not-owner-repo');
	});

	test('an unresolved ssh alias is described as an alias, not a host', () => {
		const dir = makeRepo([['origin', 'git@github-work:acme/widget.git']]);
		const result = resolveGitHubRemote(dir, { resolveHost: () => null });
		expect(result.reason).toBe('no-github-remote');
		expect(describeRemoteResolution(result)).toContain('ssh host "github-work" did not resolve');
	});

	test('credentials embedded in a remote URL are never printed', () => {
		const dir = makeRepo([['origin', 'https://x-access-token:ghp_SUPERSECRET@gitlab.com/acme/widget.git']]);
		const result = resolveGitHubRemote(dir);
		const message = describeRemoteResolution(result);
		expect(message).not.toContain('ghp_SUPERSECRET');
		expect(message).toContain('https://***@gitlab.com/acme/widget.git');
		// Redacted at the source, so --json and any other consumer is covered too.
		expect(JSON.stringify(result)).not.toContain('ghp_SUPERSECRET');
	});

	test('a local-path remote does not throw', () => {
		const dir = makeRepo([['origin', 'file:///srv/git/widget.git']]);
		expect(() => resolveGitHubRemote(dir)).not.toThrow();
		expect(resolveGitHubRemote(dir).fullName).toBeNull();
	});

	test('not a git repository', () => {
		const dir = mkdtempSync(join(tmpdir(), 'ls-plain-'));
		createdDirs.push(dir);
		const result = resolveGitHubRemote(dir);
		expect(result.reason).toBe('not-a-git-repo');
		expect(result.remotes).toEqual([]);
		expect(describeRemoteResolution(result)).toContain('not a git repository');
	});

	test('a directory that no longer exists is not reported as missing git', () => {
		const dir = mkdtempSync(join(tmpdir(), 'ls-gone-'));
		rmSync(dir, { recursive: true, force: true });
		const result = resolveGitHubRemote(dir);
		expect(result.reason).toBe('bad-cwd');
		const message = describeRemoteResolution(result);
		expect(message).toContain('no longer exists');
		expect(message).not.toContain('git was not found');
	});

	test('a bare repository still resolves its remotes', () => {
		const dir = mkdtempSync(join(tmpdir(), 'ls-bare-'));
		createdDirs.push(dir);
		git(dir, ['init', '-q', '--bare', '.']);
		git(dir, ['remote', 'add', 'origin', GH('bare')]);
		expect(resolveGitHubRemote(dir).fullName).toBe('acme/bare');
	});

	test('describeRemoteResolution tolerates a missing or partial result', () => {
		expect(describeRemoteResolution(null)).toContain('Could not determine');
		expect(() => describeRemoteResolution({ reason: 'no-github-remote' })).not.toThrow();
		expect(() => describeRemoteResolution({ reason: 'ok', ambiguous: true, fullName: 'a/b' })).not.toThrow();
	});
});

// ─── injected remotes (no git process) ───────────────────────────────────

describe('resolveGitHubRemote — injected remotes', () => {
	const resolve = (remotes, extra = {}) =>
		resolveGitHubRemote(undefined, { remotes, upstreamRemote: null, resolveHost: null, ...extra });

	test('ordering does not depend on the order git lists remotes in', () => {
		const forward = resolve([{ name: 'b', url: GH('b') }, { name: 'a', url: GH('a') }]);
		const backward = resolve([{ name: 'a', url: GH('a') }, { name: 'b', url: GH('b') }]);
		expect(forward.remote).toBe('a');
		expect(backward.remote).toBe('a');
	});

	test('ssh host aliases are resolved through the injected resolver', () => {
		const result = resolve(
			[{ name: 'origin', url: 'git@github-work:acme/widget.git' }],
			{ resolveHost: (host) => (host === 'github-work' ? 'github.com' : null) },
		);
		expect(result.fullName).toBe('acme/widget');
		expect(result.host).toBe('github.com');
	});

	test('an empty remote list reports no-remotes', () => {
		expect(resolve([]).reason).toBe('no-remotes');
	});
});

// ─── the wrapper the rest of the plugin uses ─────────────────────────────

describe('getGitRepoFullName', () => {
	test('returns the resolved repo for a non-origin remote', () => {
		const dir = makeRepo([['upstream', GH('canonical')]]);
		expect(getGitRepoFullName(dir)).toBe('acme/canonical');
	});

	test('returns null outside a git repo', () => {
		const dir = mkdtempSync(join(tmpdir(), 'ls-plain-'));
		createdDirs.push(dir);
		expect(getGitRepoFullName(dir)).toBeNull();
	});
});

describe('listGitRemotes', () => {
	test('lists names and fetch URLs', () => {
		const dir = makeRepo([['origin', GH('widget')], ['fork', 'git@github.com:me/widget.git']]);
		const remotes = listGitRemotes(dir).sort((a, b) => a.name.localeCompare(b.name));
		expect(remotes).toEqual([
			{ name: 'fork', url: 'git@github.com:me/widget.git' },
			{ name: 'origin', url: GH('widget') },
		]);
	});

	test('prefers the fetch URL when push differs', () => {
		const dir = makeRepo([['origin', GH('widget')]]);
		git(dir, ['remote', 'set-url', '--push', 'origin', 'git@github.com:me/widget.git']);
		expect(listGitRemotes(dir)).toEqual([{ name: 'origin', url: GH('widget') }]);
	});
});

// ─── the installers must use the same code ───────────────────────────────

describe('installers share the detection helper', () => {
	const unixInstaller = readFileSync(join(REPO_ROOT, 'install.sh'), 'utf-8');
	const windowsInstaller = readFileSync(join(REPO_ROOT, 'scripts/install.ps1'), 'utf-8');

	test('install.sh delegates to scripts/detect-repo.js', () => {
		expect(unixInstaller).toContain('scripts/detect-repo.js');
		expect(unixInstaller).not.toContain('git remote get-url origin');
	});

	test('install.ps1 delegates to scripts/detect-repo.js', () => {
		expect(windowsInstaller).toContain('scripts\\detect-repo.js');
		expect(windowsInstaller).not.toContain('git remote get-url origin');
	});

	test('detect-repo.js prints owner/repo on stdout, or the reason on stderr', () => {
		const dir = makeRepo([['upstream', GH('canonical')]]);
		const script = join(REPO_ROOT, 'scripts/detect-repo.js');
		expect(execFileSync('node', [script], { cwd: dir, encoding: 'utf-8' }).trim()).toBe('acme/canonical');

		const empty = makeRepo([]);
		// Exit 1, but never a bare non-zero exit: the reason goes to stderr.
		const failed = spawnSync('node', [script], { cwd: empty, encoding: 'utf-8' });
		expect(failed.status).toBe(1);
		expect(failed.stdout).toBe('');
		expect(failed.stderr).toContain('no remotes configured');

		expect(execFileSync('node', [script, '--explain'], { cwd: empty, encoding: 'utf-8' })).toContain('no remotes configured');

		const json = JSON.parse(execFileSync('node', [script, '--json'], { cwd: dir, encoding: 'utf-8' }));
		expect(json.fullName).toBe('acme/canonical');
		expect(json.reason).toBe('ok');

		const bad = spawnSync('node', [script, '--nope'], { cwd: dir, encoding: 'utf-8' });
		expect(bad.status).toBe(2);
		expect(bad.stderr).toContain('Unknown argument');
	});
});

// ─── the installer's detection block, actually executed ──────────────────

describe('install.sh detection block', () => {
	// Extract the real block from install.sh so this cannot drift from what ships,
	// then run it under the same `set -euo pipefail` the installer uses.
	const installer = readFileSync(join(REPO_ROOT, 'install.sh'), 'utf-8');
	const start = installer.indexOf('DETECT_SCRIPT=');
	const end = installer.indexOf('rm -f "$DETECT_STDERR"') + 'rm -f "$DETECT_STDERR"'.length;
	const block = installer.slice(start, end);

	/** A PATH holding everything the block needs except node. */
	function pathWithoutNode() {
		const binDir = mkdtempSync(join(tmpdir(), 'ls-nonode-'));
		createdDirs.push(binDir);
		for (const tool of ['bash', 'mktemp', 'cat', 'rm', 'sed', 'git']) {
			const real = execFileSync('which', [tool], { encoding: 'utf-8' }).trim();
			symlinkSync(real, join(binDir, tool));
		}
		return binDir;
	}

	function runBlock(cwd, { pluginDir = REPO_ROOT, pathEnv } = {}) {
		const script = `set -euo pipefail\nPLUGIN_DIR=${JSON.stringify(pluginDir)}\n${block}\n`
			+ 'echo "NAME=$REPO_FULL_NAME"\necho "REASON=$DETECT_REASON"\n';
		return execFileSync('bash', ['-c', script], {
			cwd,
			encoding: 'utf-8',
			env: { ...process.env, ...(pathEnv === undefined ? {} : { PATH: pathEnv }) },
		});
	}

	test('extracted the real block', () => {
		expect(start).toBeGreaterThan(-1);
		expect(block).toContain('detect-repo.js');
	});

	test('detects the repo', () => {
		const out = runBlock(makeRepo([['fork', GH('widget')]]));
		expect(out).toContain('NAME=acme/widget');
		expect(out).toContain('REASON=');
		expect(out).not.toContain('REASON=node was not found');
	});

	test('reports a reason when there is no GitHub remote', () => {
		const out = runBlock(makeRepo([['origin', 'git@gitlab.com:acme/widget.git']]));
		expect(out).toContain('NAME=\n');
		expect(out).toContain('No GitHub remote found');
	});

	test('reports a reason when node is missing instead of a bare "not detected"', () => {
		// The pre-fix code went silent here: no name, no reason, in a valid repo.
		const out = runBlock(makeRepo([['origin', GH('widget')]]), { pathEnv: pathWithoutNode() });
		expect(out).toContain('NAME=\n');
		expect(out).toContain('node was not found on PATH');
	});

	test('reports a reason when the helper is missing (version skew)', () => {
		const emptyPlugin = mkdtempSync(join(tmpdir(), 'ls-noplugin-'));
		createdDirs.push(emptyPlugin);
		const out = runBlock(makeRepo([['origin', GH('widget')]]), { pluginDir: emptyPlugin });
		expect(out).toContain('NAME=\n');
		expect(out).toContain('Plugin files are missing');
	});
});
