// scripts/__tests__/auth-repo-detection.test.js
//
// The connect/OAuth flow must start for any repo with a usable GitHub remote —
// including one whose only remote is "upstream" — and must explain itself when
// there is no GitHub remote at all.
import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = process.env.LIGHTSPRINT_CONFIG_DIR || join(homedir(), '.lightsprint');
const CONNECTION_FILE = join(CONFIG_DIR, 'connection.json');

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

const createdDirs = [];
let savedConnection = null;

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
	savedConnection = existsSync(CONNECTION_FILE) ? readFileSync(CONNECTION_FILE, 'utf-8') : null;
});

afterAll(() => {
	if (savedConnection !== null) writeFileSync(CONNECTION_FILE, savedConnection, { mode: 0o600 });
	else { try { unlinkSync(CONNECTION_FILE); } catch { /* already gone */ } }
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
	});
});
