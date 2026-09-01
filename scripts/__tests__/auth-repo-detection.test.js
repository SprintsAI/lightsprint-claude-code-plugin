// scripts/__tests__/auth-repo-detection.test.js
//
// The connect/OAuth flow must start for any repo with a usable GitHub remote —
// including one whose only remote is "upstream" — and must explain itself when
// there is no GitHub remote at all.
import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Redirect the connection file into a temp dir BEFORE anything imports config.js.
// The alternative — writing the developer's real ~/.lightsprint/connection.json and
// restoring it afterwards — loses their live connection if the run is interrupted.
const TEMP_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'ls-auth-cfg-'));
process.env.LIGHTSPRINT_CONFIG_DIR = TEMP_CONFIG_DIR;

let openedUrl = null;

// browser.js is only used by auth.js, so stubbing it keeps the OAuth flow local:
// "opening the browser" just calls back into the loopback server auth.js started.
mock.module('../lib/browser.js', () => ({
	findBrowserProfileForEmail: () => null,
	openBrowser: (url) => {
		openedUrl = url;
		void completeCallback(url);
		return true;
	},
}));

async function completeCallback(authorizeUrl) {
	const port = new URL(authorizeUrl).searchParams.get('port');
	const callback = `http://127.0.0.1:${port}/callback?access_token=test-access&refresh_token=test-refresh`
		+ '&expires_in=3600&workspace_id=ws-test&workspace_name=Test%20Workspace';
	// The server starts just after openBrowser() returns — retry briefly.
	for (let attempt = 0; attempt < 40; attempt++) {
		try {
			await fetch(callback);
			return;
		} catch {
			await new Promise((r) => setTimeout(r, 25));
		}
	}
}

const createdDirs = [TEMP_CONFIG_DIR];
let savedGlobalConfig;
let savedSystemConfig;

function git(cwd, args) {
	return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function makeRepo(remotes) {
	const dir = mkdtempSync(join(tmpdir(), 'ls-auth-'));
	createdDirs.push(dir);
	git(dir, ['init', '-q', '-b', 'main', '.']);
	for (const [name, url] of remotes) git(dir, ['remote', 'add', name, url]);
	return dir;
}

beforeAll(() => {
	// A developer's ~/.gitconfig (an insteadOf rewrite, say) must not steer these repos.
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
	delete process.env.LIGHTSPRINT_CONFIG_DIR;
	for (const dir of createdDirs) {
		try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
	}
});

describe('authenticate — repo detection', () => {
	test('a repo whose only remote is "upstream" can complete the OAuth flow', async () => {
		const { authenticate } = await import('../lib/auth.js');
		const dir = makeRepo([['upstream', 'git@github.com:acme/canonical.git']]);
		openedUrl = null;

		const result = await authenticate('https://app.lightsprint.ai', { cwd: dir, quiet: true });

		expect(openedUrl).toContain('repo=acme%2Fcanonical');
		expect(result.workspaceId).toBe('ws-test');
		expect(result.accessToken).toBe('test-access');
	});

	test('an ssh-alias remote with a dotted repo name also connects', async () => {
		const { authenticate } = await import('../lib/auth.js');
		const dir = makeRepo([['gh', 'https://github.com/acme/docs.site.git']]);
		openedUrl = null;

		await authenticate('https://app.lightsprint.ai', { cwd: dir, quiet: true });

		expect(openedUrl).toContain('repo=acme%2Fdocs.site');
	});

	test('no GitHub remote fails with an actionable message that lists the remotes', async () => {
		const { authenticate } = await import('../lib/auth.js');
		const dir = makeRepo([['origin', 'git@gitlab.com:acme/widget.git']]);

		const error = await authenticate('https://app.lightsprint.ai', { cwd: dir, quiet: true })
			.then(() => null, (e) => e);

		expect(error).toBeInstanceOf(Error);
		expect(error.message).toContain('No GitHub remote found');
		expect(error.message).toContain('origin -> git@gitlab.com:acme/widget.git');
		expect(error.message).not.toContain('requires a git repo with an origin remote');
		// Structured too, so `--output json` can emit the reason rather than prose.
		expect(error.code).toBe('repo_detection_failed');
		expect(error.details.reason).toBe('no-github-remote');
		expect(error.details.remotes.map((r) => r.name)).toEqual(['origin']);
	});

	test('credentials in a remote URL never reach the thrown error', async () => {
		const { authenticate } = await import('../lib/auth.js');
		const dir = makeRepo([['origin', 'https://user:ghp_LEAKME@gitlab.com/acme/widget.git']]);

		const error = await authenticate('https://app.lightsprint.ai', { cwd: dir, quiet: true })
			.then(() => null, (e) => e);

		// This message reaches the terminal, ~/.lightsprint/daemon.log and Sentry.
		expect(error.message).not.toContain('ghp_LEAKME');
		expect(JSON.stringify(error.details)).not.toContain('ghp_LEAKME');
	});

	test('writes the connection to the temp config dir, not the real one', async () => {
		const { readConnection } = await import('../lib/connection.js');
		expect(process.env.LIGHTSPRINT_CONFIG_DIR).toBe(TEMP_CONFIG_DIR);
		expect(readConnection()?.workspaceId).toBe('ws-test');
	});
});
