// scripts/__tests__/git-remote-url.test.js
//
// Table-driven coverage of every remote URL form git accepts.
import { describe, test, expect, afterEach } from 'bun:test';
import {
	parseGitHubRemoteUrl,
	parseRemoteUrl,
	splitOwnerRepo,
	isGitHubHost,
	normalizeHost,
	redactRemoteUrl,
} from '../lib/git-remote.js';

// ─── GitHub URLs that must resolve ───────────────────────────────────────

const GITHUB_URLS = [
	// scheme://
	['https://github.com/owner/repo.git', 'owner/repo', 'github.com'],
	['https://github.com/owner/repo', 'owner/repo', 'github.com'],
	['https://github.com/owner/repo/', 'owner/repo', 'github.com'],
	['https://github.com/owner/repo.git/', 'owner/repo', 'github.com'],
	['http://github.com/owner/repo.git', 'owner/repo', 'github.com'],
	['https://www.github.com/owner/repo.git', 'owner/repo', 'www.github.com'],
	// credentials embedded in the URL
	['https://user:token@github.com/owner/repo.git', 'owner/repo', 'github.com'],
	['https://x-access-token:ghp_secret@github.com/owner/repo', 'owner/repo', 'github.com'],
	['https://token@github.com/owner/repo.git', 'owner/repo', 'github.com'],
	// scp-style
	['git@github.com:owner/repo.git', 'owner/repo', 'github.com'],
	['git@github.com:owner/repo', 'owner/repo', 'github.com'],
	['github.com:owner/repo.git', 'owner/repo', 'github.com'],
	['git@github.com:/owner/repo.git', 'owner/repo', 'github.com'],
	// ssh:// with and without a port
	['ssh://git@github.com/owner/repo.git', 'owner/repo', 'github.com'],
	['ssh://git@github.com:22/owner/repo.git', 'owner/repo', 'github.com'],
	['ssh://git@ssh.github.com:443/owner/repo.git', 'owner/repo', 'ssh.github.com'],
	['ssh://github.com/owner/repo', 'owner/repo', 'github.com'],
	// non-numeric "port" — invalid git, but people write it
	['ssh://git@github.com:owner/repo.git', 'owner/repo', 'github.com'],
	// other schemes
	['git://github.com/owner/repo.git', 'owner/repo', 'github.com'],
	['git+ssh://git@github.com/owner/repo.git', 'owner/repo', 'github.com'],
	['ssh+git://git@github.com/owner/repo.git', 'owner/repo', 'github.com'],
	// dots inside the repo name
	['https://github.com/owner/repo.js', 'owner/repo.js', 'github.com'],
	['https://github.com/owner/repo.js.git', 'owner/repo.js', 'github.com'],
	['git@github.com:owner/docs.site.git', 'owner/docs.site', 'github.com'],
	['git@github.com:owner/docs.site', 'owner/docs.site', 'github.com'],
	['https://github.com/owner/.github.git', 'owner/.github', 'github.com'],
	['https://github.com/my.org/my.repo.git', 'my.org/my.repo', 'github.com'],
	// dashes, underscores, digits
	['git@github.com:SprintsAI/lightsprint-claude-code-plugin.git', 'SprintsAI/lightsprint-claude-code-plugin', 'github.com'],
	['https://github.com/owner_1/repo-2.git', 'owner_1/repo-2', 'github.com'],
	// whitespace and casing
	['  git@github.com:owner/repo.git\n', 'owner/repo', 'github.com'],
	['git@GitHub.com:Owner/Repo.git', 'Owner/Repo', 'github.com'],
	['https://GITHUB.COM/Owner/Repo', 'Owner/Repo', 'github.com'],
];

describe('parseGitHubRemoteUrl — GitHub URL forms', () => {
	for (const [url, expected, expectedHost] of GITHUB_URLS) {
		test(`${url} -> ${expected}`, () => {
			const parsed = parseGitHubRemoteUrl(url);
			expect(parsed).not.toBeNull();
			expect(parsed.fullName).toBe(expected);
			expect(parsed.host).toBe(expectedHost);
			expect(`${parsed.owner}/${parsed.repo}`).toBe(expected);
		});
	}
});

// ─── URLs that are not a GitHub repo ─────────────────────────────────────

const NON_GITHUB_URLS = [
	// other hosts
	'https://gitlab.com/owner/repo.git',
	'git@bitbucket.org:owner/repo.git',
	'ssh://git@git.sr.ht/~owner/repo',
	'https://dev.azure.com/org/project/_git/repo',
	'https://mygithub.com/owner/repo.git',
	'https://github.com.evil.tld/owner/repo.git',
	'https://github.com%2eevil.com/facebook/react.git',
	// local paths — must be reported as "no GitHub remote", never thrown
	'file:///home/user/repo.git',
	'file://C:/repos/repo',
	'/home/user/repo.git',
	'./relative/repo',
	'../sibling/repo.git',
	'~/repos/repo',
	'C:\\Users\\me\\repo',
	'C:/Users/me/repo',
	'\\\\server\\share\\repo',
	'some/relative/path',
	// malformed / incomplete
	'',
	'   ',
	'https://github.com/',
	'https://github.com/owner',
	'https://github.com/owner/repo/tree/main',
	'https://github.com/owner/repo/sub/dir.git',
	'git@github.com:',
	'github.com',
	'ssh://git@[::1]:22/owner/repo.git',
];

describe('parseGitHubRemoteUrl — non-GitHub and malformed URLs', () => {
	for (const url of NON_GITHUB_URLS) {
		test(`${JSON.stringify(url)} -> null`, () => {
			expect(parseGitHubRemoteUrl(url)).toBeNull();
		});
	}

	test('non-string inputs return null instead of throwing', () => {
		expect(parseGitHubRemoteUrl(null)).toBeNull();
		expect(parseGitHubRemoteUrl(undefined)).toBeNull();
		expect(parseGitHubRemoteUrl(42)).toBeNull();
		expect(parseGitHubRemoteUrl({})).toBeNull();
	});
});

// ─── ssh host aliases (~/.ssh/config) ────────────────────────────────────

describe('ssh host aliases', () => {
	test('alias resolving to github.com is recognized', () => {
		const parsed = parseGitHubRemoteUrl('git@github-work:owner/repo.git', {
			resolveHost: (host) => (host === 'github-work' ? 'github.com' : null),
		});
		expect(parsed).not.toBeNull();
		expect(parsed.fullName).toBe('owner/repo');
		expect(parsed.host).toBe('github.com');
		expect(parsed.alias).toBe('github-work');
	});

	test('alias resolution also applies to ssh:// URLs', () => {
		const parsed = parseGitHubRemoteUrl('ssh://git@gh-personal:22/owner/repo.git', {
			resolveHost: () => 'github.com',
		});
		expect(parsed?.fullName).toBe('owner/repo');
	});

	test('alias resolving to a non-GitHub host stays null', () => {
		const parsed = parseGitHubRemoteUrl('git@work-git:owner/repo.git', {
			resolveHost: () => 'gitlab.example.com',
		});
		expect(parsed).toBeNull();
	});

	test('unresolvable alias stays null rather than throwing', () => {
		expect(parseGitHubRemoteUrl('git@github-work:owner/repo.git', { resolveHost: () => null })).toBeNull();
		expect(parseGitHubRemoteUrl('git@github-work:owner/repo.git')).toBeNull();
	});

	test('a resolver that throws does not break parsing', () => {
		const thrower = () => { throw new Error('ssh exploded'); };
		expect(parseGitHubRemoteUrl('git@github-work:owner/repo.git', { resolveHost: thrower })).toBeNull();
		expect(parseGitHubRemoteUrl('git@github.com:owner/repo.git', { resolveHost: thrower })?.fullName).toBe('owner/repo');
	});

	test('host alias resolution is not attempted for https remotes', () => {
		let called = false;
		const parsed = parseGitHubRemoteUrl('https://git.example.com/owner/repo.git', {
			resolveHost: () => { called = true; return 'github.com'; },
		});
		expect(called).toBe(false);
		expect(parsed).toBeNull();
	});
});

// ─── host classification ─────────────────────────────────────────────────

describe('isGitHubHost', () => {
	const originalHosts = process.env.LIGHTSPRINT_GITHUB_HOSTS;
	afterEach(() => {
		if (originalHosts === undefined) delete process.env.LIGHTSPRINT_GITHUB_HOSTS;
		else process.env.LIGHTSPRINT_GITHUB_HOSTS = originalHosts;
	});

	test('github.com and its subdomains', () => {
		expect(isGitHubHost('github.com')).toBe(true);
		expect(isGitHubHost('GitHub.com')).toBe(true);
		expect(isGitHubHost('github.com.')).toBe(true);
		expect(isGitHubHost('ssh.github.com')).toBe(true);
	});

	test('conventional github.<domain> Enterprise hosts are recognized', () => {
		expect(isGitHubHost('github.acme.com')).toBe(true);
		expect(isGitHubHost('github.internal')).toBe(true);
		expect(parseGitHubRemoteUrl('https://github.acme.com/owner/repo.git')?.fullName).toBe('owner/repo');
		expect(parseGitHubRemoteUrl('git@github.internal:owner/repo.git')?.fullName).toBe('owner/repo');
	});

	test('lookalike hosts are rejected', () => {
		expect(isGitHubHost('mygithub.com')).toBe(false);
		expect(isGitHubHost('github.com.evil.tld')).toBe(false);
		expect(isGitHubHost('github.io.evil.tld')).toBe(false);
		expect(isGitHubHost('gitlab.com')).toBe(false);
		expect(isGitHubHost('')).toBe(false);
		expect(isGitHubHost(null)).toBe(false);
	});

	test('hosts that smuggle userinfo or encoded dots are rejected', () => {
		// github.com%2eevil.com is percent-decoded by git/libcurl to an attacker domain.
		expect(isGitHubHost('github.com%2eevil.com')).toBe(false);
		expect(isGitHubHost('github.com@evil.com')).toBe(false);
		expect(isGitHubHost('github.com/evil')).toBe(false);
		expect(isGitHubHost('github.com evil.com')).toBe(false);
	});

	test('LIGHTSPRINT_GITHUB_HOSTS adds self-hosted hosts', () => {
		expect(isGitHubHost('git.acme.internal')).toBe(false);
		process.env.LIGHTSPRINT_GITHUB_HOSTS = 'git.acme.internal, code.acme.internal';
		expect(isGitHubHost('git.acme.internal')).toBe(true);
		expect(isGitHubHost('code.acme.internal')).toBe(true);
		expect(parseGitHubRemoteUrl('https://git.acme.internal/owner/repo.git')?.fullName).toBe('owner/repo');
	});

	test('an arbitrary enterprise hostname can be opted into', () => {
		expect(parseGitHubRemoteUrl('https://code.acme.internal/owner/repo.git')).toBeNull();
		process.env.LIGHTSPRINT_GITHUB_HOSTS = 'code.acme.internal';
		expect(parseGitHubRemoteUrl('https://code.acme.internal/owner/repo.git')?.fullName).toBe('owner/repo');
	});
});

// ─── credential redaction ────────────────────────────────────────────────

describe('redactRemoteUrl', () => {
	test('masks credentials in scheme URLs', () => {
		expect(redactRemoteUrl('https://x-access-token:ghp_SECRET@github.com/o/r.git'))
			.toBe('https://***@github.com/o/r.git');
		expect(redactRemoteUrl('https://token@github.com/o/r.git')).toBe('https://***@github.com/o/r.git');
		expect(redactRemoteUrl('ssh://git:pw@github.com:22/o/r.git')).toBe('ssh://***@github.com:22/o/r.git');
	});

	test('masks a user:password pair in scp-style URLs', () => {
		expect(redactRemoteUrl('user:secret@github.com:o/r.git')).toBe('***@github.com:o/r.git');
	});

	test('leaves credential-free URLs alone', () => {
		expect(redactRemoteUrl('git@github.com:o/r.git')).toBe('git@github.com:o/r.git');
		expect(redactRemoteUrl('https://github.com/o/r.git')).toBe('https://github.com/o/r.git');
		expect(redactRemoteUrl('/srv/git/repo.git')).toBe('/srv/git/repo.git');
	});

	test('never throws on junk input', () => {
		expect(redactRemoteUrl(null)).toBe('');
		expect(redactRemoteUrl(undefined)).toBe('');
		expect(redactRemoteUrl(42)).toBe('');
	});

	test('a redacted URL still parses to the same repo', () => {
		const raw = 'https://x-access-token:ghp_SECRET@github.com/owner/repo.git';
		expect(parseGitHubRemoteUrl(redactRemoteUrl(raw))?.fullName).toBe(parseGitHubRemoteUrl(raw)?.fullName);
	});
});

describe('normalizeHost', () => {
	test('lowercases, trims, and drops the root dot', () => {
		expect(normalizeHost('  GitHub.COM. ')).toBe('github.com');
		expect(normalizeHost('')).toBeNull();
		expect(normalizeHost(null)).toBeNull();
	});
});

// ─── low-level pieces ────────────────────────────────────────────────────

describe('parseRemoteUrl', () => {
	test('splits scheme, host, port and path', () => {
		expect(parseRemoteUrl('ssh://git@github.com:22/owner/repo.git')).toMatchObject({
			scheme: 'ssh', host: 'github.com', port: '22', path: '/owner/repo.git', isLocal: false, sshLike: true,
		});
	});

	test('scp-style has no scheme and is ssh-like', () => {
		expect(parseRemoteUrl('git@github.com:owner/repo.git')).toMatchObject({
			scheme: null, host: 'github.com', path: 'owner/repo.git', isLocal: false, sshLike: true,
		});
	});

	test('file:// and bare paths are local', () => {
		expect(parseRemoteUrl('file:///srv/git/repo.git').isLocal).toBe(true);
		expect(parseRemoteUrl('/srv/git/repo.git').isLocal).toBe(true);
		expect(parseRemoteUrl('C:\\repos\\repo').isLocal).toBe(true);
		expect(parseRemoteUrl('C:/repos/repo').isLocal).toBe(true);
	});

	test('https strips credentials from the host', () => {
		expect(parseRemoteUrl('https://user:pw@github.com/owner/repo.git').host).toBe('github.com');
	});
});

describe('splitOwnerRepo', () => {
	test('strips a trailing .git suffix only', () => {
		expect(splitOwnerRepo('/owner/repo.git')).toEqual({ owner: 'owner', repo: 'repo' });
		expect(splitOwnerRepo('owner/repo.github')).toEqual({ owner: 'owner', repo: 'repo.github' });
		expect(splitOwnerRepo('owner/gitignore')).toEqual({ owner: 'owner', repo: 'gitignore' });
	});

	test('rejects anything that is not exactly owner/repo', () => {
		expect(splitOwnerRepo('/')).toBeNull();
		expect(splitOwnerRepo('owner')).toBeNull();
		expect(splitOwnerRepo('a/b/c')).toBeNull();
		expect(splitOwnerRepo('owner/..')).toBeNull();
	});
});
