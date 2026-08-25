/**
 * GitHub remote detection — the single source of truth for "which GitHub repo is this?".
 *
 * Everything that needs an `owner/repo` for the current working tree goes through
 * `resolveGitHubRemote()` (or the thin `getGitRepoFullName()` wrapper in config.js).
 * The installers shell out to `scripts/detect-repo.js`, which calls the same code,
 * so bash, PowerShell and the CLI can never drift apart again.
 *
 * Remote selection order (first GitHub remote that matches wins):
 *   1. the upstream remote of the current branch (branch.<name>.remote)
 *   2. origin
 *   3. upstream
 *   4. the only GitHub remote, when exactly one exists
 *   5. otherwise the alphabetically first GitHub remote, flagged as ambiguous
 *
 * Detection also runs from non-interactive contexts (hooks, the daemon), so it never
 * prompts — an ambiguous repo resolves deterministically and reports `ambiguous: true`
 * so interactive callers can say so.
 */

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';

const GIT_TIMEOUT_MS = 5000;
const SSH_TIMEOUT_MS = 3000;
const SSH_CACHE_LIMIT = 64;

/** Schemes where ~/.ssh/config host aliases apply. */
const SSH_SCHEMES = new Set(['ssh', 'ssh+git', 'git+ssh']);

// Deliberately permissive: GitHub allows dots in repo names (owner/repo.js) and
// repos whose name starts with a dot (owner/.github).
const NAME_RE = /^[A-Za-z0-9._-]+$/;

/** Hostnames must not smuggle userinfo, encoded dots, or path separators. */
const INVALID_HOST_RE = /[@%/\s]/;

// ─── host helpers ────────────────────────────────────────────────────────

/**
 * Lowercase a hostname and drop the trailing root dot. Preserves IPv6 brackets.
 * @param {string|null|undefined} host
 * @returns {string|null}
 */
export function normalizeHost(host) {
	if (typeof host !== 'string') return null;
	let h = host.trim().toLowerCase();
	while (h.endsWith('.')) h = h.slice(0, -1);
	if (!h || INVALID_HOST_RE.test(h)) return null;
	return h;
}

/** Extra hosts to treat as GitHub, e.g. LIGHTSPRINT_GITHUB_HOSTS="github.acme.com,git.acme.com". */
function extraGitHubHosts() {
	const raw = process.env.LIGHTSPRINT_GITHUB_HOSTS;
	if (!raw) return [];
	return raw.split(',').map((h) => normalizeHost(h)).filter(Boolean);
}

/**
 * Is this hostname GitHub?
 *
 * Only github.com, its subdomains, and hosts explicitly listed in
 * LIGHTSPRINT_GITHUB_HOSTS count. There is deliberately no `github.<anything>`
 * heuristic: guessing that github.acme.com is an enterprise install also accepts
 * github.evil.com, and no denylist of TLD-shaped labels can separate the two
 * without a public suffix list. Self-hosted users opt in explicitly instead.
 *
 * @param {string|null|undefined} host
 * @returns {boolean}
 */
export function isGitHubHost(host) {
	const h = normalizeHost(host);
	if (!h) return false;
	if (h === 'github.com' || h.endsWith('.github.com')) return true;
	return extraGitHubHosts().includes(h);
}

// ─── URL parsing ─────────────────────────────────────────────────────────

const SCHEME_RE = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([\s\S]*)$/;
// scp-style: [user@]host:path — host holds no slash, and the colon is not a Windows drive.
const SCP_RE = /^(?:([^@/]+)@)?(\[[0-9A-Fa-f:.]+\]|[^@/:]+):([\s\S]*)$/;
const WINDOWS_PATH_RE = /^[A-Za-z]:[\\/]/;

/**
 * Parse any URL form git accepts into its parts. Never throws.
 *
 * Handles https/http, ssh (with optional port), git, git+ssh, scp-style
 * `git@host:owner/repo.git`, file:// and bare local paths.
 *
 * @param {string} raw
 * @returns {{ scheme: string|null, host: string|null, port: string|null, path: string, isLocal: boolean, sshLike: boolean }|null}
 */
export function parseRemoteUrl(raw) {
	if (typeof raw !== 'string') return null;
	const url = raw.trim();
	if (!url) return null;

	const schemeMatch = url.match(SCHEME_RE);
	if (schemeMatch) {
		const scheme = schemeMatch[1].toLowerCase();
		const rest = schemeMatch[2];
		if (scheme === 'file') {
			return { scheme, host: null, port: null, path: rest, isLocal: true, sshLike: false };
		}
		const slash = rest.indexOf('/');
		const authority = slash === -1 ? rest : rest.slice(0, slash);
		let path = slash === -1 ? '' : rest.slice(slash);

		// Strip any user[:password]@ credentials.
		const at = authority.lastIndexOf('@');
		const hostPort = at === -1 ? authority : authority.slice(at + 1);

		let host = hostPort;
		let port = null;
		if (hostPort.startsWith('[')) {
			// IPv6 literal: [::1]:22
			const end = hostPort.indexOf(']');
			if (end !== -1) {
				host = hostPort.slice(0, end + 1);
				const remainder = hostPort.slice(end + 1);
				if (remainder.startsWith(':')) port = remainder.slice(1);
			}
		} else {
			const colon = hostPort.lastIndexOf(':');
			if (colon !== -1) {
				port = hostPort.slice(colon + 1);
				host = hostPort.slice(0, colon);
			}
		}
		// `ssh://git@github.com:owner/repo.git` is not valid git, but people write it —
		// a non-numeric "port" is really the first path segment.
		if (port !== null && !/^\d*$/.test(port)) {
			path = `/${port}${path}`;
			port = null;
		}
		if (port === '') port = null;

		return {
			scheme,
			host: normalizeHost(host),
			port,
			path,
			isLocal: !host,
			sshLike: SSH_SCHEMES.has(scheme),
		};
	}

	// Bare local paths — never a GitHub remote, and never an error.
	if (WINDOWS_PATH_RE.test(url) || url.startsWith('/') || url.startsWith('~') ||
		url.startsWith('./') || url.startsWith('../') || url.startsWith('\\\\') || url.startsWith('.\\')) {
		return { scheme: null, host: null, port: null, path: url, isLocal: true, sshLike: false };
	}

	const scp = url.match(SCP_RE);
	if (scp) {
		const host = scp[2];
		// A single-letter "host" is a Windows drive letter (C:foo), not a hostname.
		if (/^[A-Za-z]$/.test(host)) {
			return { scheme: null, host: null, port: null, path: url, isLocal: true, sshLike: false };
		}
		return {
			scheme: null,
			host: normalizeHost(host),
			port: null,
			path: scp[3],
			isLocal: false,
			sshLike: true,
		};
	}

	// Relative path, or something we do not understand — treat as local.
	return { scheme: null, host: null, port: null, path: url, isLocal: true, sshLike: false };
}

const SCHEME_CREDENTIALS_RE = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/@]*@/;
const SCP_CREDENTIALS_RE = /^[^@/]*:[^@/]*@/;

/**
 * Mask any credentials embedded in a remote URL.
 *
 * Remote URLs routinely carry tokens (https://x-access-token:ghp_…@github.com/o/r).
 * Every URL this module hands back is redacted at the source, because the URLs end
 * up in error messages that reach the terminal, ~/.lightsprint/daemon.log and Sentry.
 *
 * @param {string} url
 * @returns {string}
 */
export function redactRemoteUrl(url) {
	if (typeof url !== 'string' || !url) return '';
	if (SCHEME_CREDENTIALS_RE.test(url)) return url.replace(SCHEME_CREDENTIALS_RE, '$1***@');
	// scp-style only carries a secret when there is a user:password pair;
	// a bare `git@host:path` is not a credential.
	if (SCP_CREDENTIALS_RE.test(url)) return url.replace(SCP_CREDENTIALS_RE, '***@');
	return url;
}

/**
 * Turn a remote URL path into `{ owner, repo }`.
 * Strips leading/trailing slashes and a trailing `.git` suffix — dots *inside*
 * the repo name (owner/repo.js, owner/docs.site) are preserved.
 * @param {string} path
 * @returns {{ owner: string, repo: string }|null}
 */
export function splitOwnerRepo(path) {
	if (typeof path !== 'string') return null;
	let p = path.replace(/^\/+/, '').replace(/\/+$/, '');
	if (!p) return null;
	if (p.toLowerCase().endsWith('.git')) {
		p = p.slice(0, -4).replace(/\/+$/, '');
	}
	const segments = p.split('/').filter(Boolean);
	if (segments.length !== 2) return null;
	const [owner, repo] = segments;
	if (!NAME_RE.test(owner) || !NAME_RE.test(repo)) return null;
	if (owner === '.' || owner === '..' || repo === '.' || repo === '..') return null;
	return { owner, repo };
}

/**
 * Parse a remote URL into a GitHub `owner/repo`, or null when it is not a GitHub remote.
 *
 * @param {string} url
 * @param {{ resolveHost?: (host: string) => string|null }} [options]
 *   resolveHost maps an ssh host alias (`github-work`) to its real hostname.
 * @returns {{ fullName: string, owner: string, repo: string, host: string, alias: string|null }|null}
 */
export function parseGitHubRemoteUrl(url, options = {}) {
	const { resolveHost } = options;
	const parsed = parseRemoteUrl(url);
	if (!parsed || parsed.isLocal || !parsed.host) return null;

	const ownerRepo = splitOwnerRepo(parsed.path);
	if (!ownerRepo) return null;

	let host = parsed.host;
	let alias = null;
	if (!isGitHubHost(host) && typeof resolveHost === 'function' && parsed.sshLike) {
		let resolved = null;
		try {
			resolved = normalizeHost(resolveHost(host));
		} catch {
			resolved = null; // a failed alias lookup must never break detection
		}
		if (resolved && resolved !== host) {
			alias = host;
			host = resolved;
		}
	}
	if (!isGitHubHost(host)) return null;

	return {
		fullName: `${ownerRepo.owner}/${ownerRepo.repo}`,
		owner: ownerRepo.owner,
		repo: ownerRepo.repo,
		host,
		alias,
	};
}

// ─── git / ssh plumbing ──────────────────────────────────────────────────

function runGit(args, cwd) {
	return execFileSync('git', args, {
		cwd,
		encoding: 'utf-8',
		timeout: GIT_TIMEOUT_MS,
		stdio: ['pipe', 'pipe', 'pipe'],
		windowsHide: true,
	});
}

/**
 * Classify the working directory. Distinguishes "git is missing" from "the
 * directory is gone" from "git ran and refused" (dubious ownership, a broken
 * repo), because each needs different advice.
 * @returns {{ state: 'yes'|'no'|'bad-cwd'|'git-unavailable'|'git-failed', detail?: string }}
 */
function gitRepoState(cwd) {
	// spawnSync reports ENOENT both for a missing binary and a missing cwd.
	if (cwd && !existsSync(cwd)) return { state: 'bad-cwd' };

	let failure = null;
	try {
		if (runGit(['rev-parse', '--is-inside-work-tree'], cwd).trim() === 'true') return { state: 'yes' };
	} catch (err) {
		if (err && (err.code === 'ENOENT' || err.errno === 'ENOENT')) return { state: 'git-unavailable' };
		const stderr = (err?.stderr || '').toString().trim();
		// "not a git repository" is the ordinary answer, not a malfunction.
		if (stderr && !/not a git repository/i.test(stderr)) failure = stderr;
	}

	// A bare repo prints "false" above but still has usable remotes.
	try {
		if (runGit(['rev-parse', '--is-bare-repository'], cwd).trim() === 'true') return { state: 'yes' };
	} catch { /* handled below */ }

	return failure ? { state: 'git-failed', detail: failure } : { state: 'no' };
}

/**
 * List every configured remote with its fetch URL, falling back to the push URL
 * for a remote that only has one.
 *
 * Uses `git remote -v` rather than raw config so url.<base>.insteadOf rewrites are
 * applied — reading remote.<name>.url directly would miss them.
 *
 * @param {string} [cwd]
 * @returns {Array<{ name: string, url: string }>}
 */
export function listGitRemotes(cwd) {
	const fetchUrls = new Map();
	const pushUrls = new Map();
	try {
		const out = runGit(['remote', '-v'], cwd);
		for (const line of out.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			// "origin\tgit@github.com:owner/repo.git (fetch)"
			const match = trimmed.match(/^(\S+)\s+(.*?)\s+\((fetch|push)\)$/);
			if (!match) continue;
			const [, name, url, kind] = match;
			const target = kind === 'fetch' ? fetchUrls : pushUrls;
			if (!target.has(name)) target.set(name, url);
		}
	} catch {
		// no remotes, or git failed — an empty list is the answer
	}

	const names = [...new Set([...fetchUrls.keys(), ...pushUrls.keys()])];
	return names.map((name) => ({ name, url: fetchUrls.get(name) ?? pushUrls.get(name) }));
}

/**
 * The remote that the current branch tracks, or null on a detached HEAD /
 * a branch with no upstream.
 * @param {string} [cwd]
 * @returns {string|null}
 */
export function getBranchUpstreamRemote(cwd) {
	try {
		// symbolic-ref (not rev-parse) so this also works on an unborn branch;
		// it exits non-zero on a detached HEAD, which is exactly what we want.
		const branch = runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd).trim();
		if (!branch || branch === 'HEAD') return null; // detached HEAD
		const remote = runGit(['config', '--get', `branch.${branch}.remote`], cwd).trim();
		// A "." remote means the branch tracks another local branch.
		return remote && remote !== '.' ? remote : null;
	} catch {
		return null;
	}
}

const sshHostCache = new Map();

/**
 * Resolve an ssh host alias from ~/.ssh/config to its real hostname.
 * Best-effort: returns null when ssh is unavailable or the lookup fails.
 * @param {string} host
 * @returns {string|null}
 */
export function resolveSshHostAlias(host) {
	const key = normalizeHost(host);
	// A leading dash would be read by ssh as an option, not a host operand.
	if (!key || key.startsWith('-')) return null;
	if (sshHostCache.has(key)) return sshHostCache.get(key);

	let resolved = null;
	try {
		// `--` so a hostname can never be taken for a flag.
		const out = execFileSync('ssh', ['-G', '--', key], {
			encoding: 'utf-8',
			timeout: SSH_TIMEOUT_MS,
			stdio: ['pipe', 'pipe', 'pipe'],
			windowsHide: true,
		});
		for (const line of out.split('\n')) {
			const match = line.match(/^hostname\s+(\S+)\s*$/i);
			if (match) {
				resolved = normalizeHost(match[1]);
				break;
			}
		}
	} catch {
		resolved = null;
	}
	// Keys come from repo config, so bound the map rather than letting a repo grow it.
	if (sshHostCache.size >= SSH_CACHE_LIMIT) sshHostCache.clear();
	sshHostCache.set(key, resolved);
	return resolved;
}

// ─── resolution ──────────────────────────────────────────────────────────

/**
 * @typedef {Object} RemoteEntry
 * @property {string} name
 * @property {string} url            redacted — any embedded credentials are masked
 * @property {string|null} host
 * @property {string|null} fullName
 * @property {boolean} isGitHub
 * @property {'not-a-url'|'host-not-github'|'ssh-alias-unresolved'|'not-owner-repo'|null} skipped
 *   why this remote was not usable, or null when it was
 */

/**
 * @typedef {Object} RemoteResolution
 * @property {string|null} fullName   e.g. "owner/repo"
 * @property {string|null} remote     the remote name that was chosen
 * @property {string|null} host
 * @property {'ok'|'git-unavailable'|'git-failed'|'bad-cwd'|'not-a-git-repo'|'no-remotes'|'no-github-remote'} reason
 * @property {RemoteEntry[]} remotes  every remote that was inspected
 * @property {boolean} ambiguous      the chosen remote may not be the one the user meant
 * @property {string|null} selectedBy how the remote was chosen
 * @property {string} [detail]        raw git stderr, when reason is 'git-failed'
 */

/**
 * Why a remote could not be used. Kept separate from the parse so the failure
 * message can say "github.com, but the path is not owner/repo" instead of the
 * flatly untrue "host github.com is not GitHub".
 * @returns {RemoteEntry['skipped']}
 */
function classifySkip(parsed) {
	if (!parsed || parsed.isLocal || !parsed.host) return 'not-a-url';
	if (isGitHubHost(parsed.host)) return 'not-owner-repo';
	// An ssh-ish host with no dot is almost always a ~/.ssh/config alias.
	if (parsed.sshLike && !parsed.host.includes('.')) return 'ssh-alias-unresolved';
	return 'host-not-github';
}

/**
 * Find the GitHub repository for a working tree. Never throws.
 *
 * @param {string} [cwd]
 * @param {{ remotes?: Array<{name: string, url: string}>, upstreamRemote?: string|null,
 *           resolveHost?: ((host: string) => string|null)|null }} [options] test seams
 * @returns {RemoteResolution}
 */
export function resolveGitHubRemote(cwd, options = {}) {
	const hasInjectedRemotes = Array.isArray(options.remotes);
	const resolveHost = options.resolveHost === undefined ? resolveSshHostAlias : options.resolveHost;

	if (!hasInjectedRemotes) {
		const { state, detail } = gitRepoState(cwd);
		if (state !== 'yes') {
			const reason = state === 'no' ? 'not-a-git-repo' : state;
			return {
				fullName: null,
				remote: null,
				host: null,
				reason,
				remotes: [],
				ambiguous: false,
				selectedBy: null,
				...(detail ? { detail } : {}),
			};
		}
	}

	const rawRemotes = hasInjectedRemotes ? options.remotes : listGitRemotes(cwd);
	const remotes = rawRemotes.map(({ name, url }) => {
		const parsed = parseRemoteUrl(url);
		const gh = parseGitHubRemoteUrl(url, resolveHost ? { resolveHost } : {});
		return {
			name,
			url: redactRemoteUrl(url),
			host: gh?.host ?? parsed?.host ?? null,
			fullName: gh?.fullName ?? null,
			isGitHub: Boolean(gh),
			skipped: gh ? null : classifySkip(parsed),
		};
	});

	if (remotes.length === 0) {
		return { fullName: null, remote: null, host: null, reason: 'no-remotes', remotes, ambiguous: false, selectedBy: null };
	}

	const githubRemotes = remotes.filter((r) => r.isGitHub);
	if (githubRemotes.length === 0) {
		return { fullName: null, remote: null, host: null, reason: 'no-github-remote', remotes, ambiguous: false, selectedBy: null };
	}

	const pick = (entry, selectedBy, ambiguous = false) => ({
		fullName: entry.fullName,
		remote: entry.name,
		host: entry.host,
		reason: 'ok',
		remotes,
		ambiguous,
		selectedBy,
	});

	const upstreamRemote = options.upstreamRemote !== undefined ? options.upstreamRemote : getBranchUpstreamRemote(cwd);
	const preferences = [
		[upstreamRemote, 'branch-upstream'],
		['origin', 'origin'],
		['upstream', 'upstream'],
	];
	for (const [name, selectedBy] of preferences) {
		if (!name) continue;
		const hit = githubRemotes.find((r) => r.name === name);
		if (!hit) continue;
		// Tracking a non-origin remote silently changes which repo we connect to,
		// and it changes again when the user switches branch — say so.
		const overridesOrigin = selectedBy === 'branch-upstream'
			&& name !== 'origin'
			&& githubRemotes.some((r) => r.name === 'origin');
		return pick(hit, selectedBy, overridesOrigin);
	}

	if (githubRemotes.length === 1) return pick(githubRemotes[0], 'only-remote');

	const sorted = [...githubRemotes].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	return pick(sorted[0], 'alphabetical', true);
}

/**
 * A human-readable explanation of a resolution — including which remotes were
 * inspected and why none of them matched.
 * @param {RemoteResolution} result
 * @returns {string}
 */
export function describeRemoteResolution(result) {
	if (!result) return 'Could not determine the GitHub repository for this folder.';
	const remotes = Array.isArray(result.remotes) ? result.remotes : [];

	if (result.reason === 'ok') {
		const via = result.remote ? ` (remote "${result.remote}")` : '';
		// Anything other than github.com is worth naming: the backend is told only
		// "owner/repo", so an enterprise host links against that name alone.
		const onHost = result.host && result.host !== 'github.com' ? ` on host ${result.host}` : '';
		let warning = '';
		if (result.ambiguous) {
			const candidates = remotes
				.filter((r) => r.isGitHub)
				.map((r) => `${r.name} (${r.fullName})`)
				.join(', ');
			warning = `\nMore than one GitHub remote could apply: ${candidates}. Using "${result.remote}".`
				+ `\nTo choose a different one: git branch --set-upstream-to=<remote>/<branch>`
				+ `\nor rename the canonical remote: git remote rename <remote> origin`;
		}
		return `Detected GitHub repository ${result.fullName}${onHost}${via}.${warning}`;
	}

	if (result.reason === 'git-unavailable') {
		return 'git was not found on PATH. Lightsprint needs git to detect the GitHub repository for this folder.';
	}

	if (result.reason === 'bad-cwd') {
		return 'The current directory no longer exists. Change into your project folder and try again.';
	}

	if (result.reason === 'git-failed') {
		return `git could not read this repository:\n  ${result.detail || 'unknown error'}\nFix the problem git reports above, then try again.`;
	}

	if (result.reason === 'not-a-git-repo') {
		return 'This folder is not a git repository. Lightsprint needs a git repo with a GitHub remote: run "git init" and add a remote, or cd into your project first.';
	}

	if (result.reason === 'no-remotes') {
		return 'This git repository has no remotes configured. Add one, e.g.:\n  git remote add origin git@github.com:owner/repo.git';
	}

	const lines = remotes.map((r) => `  ${r.name} -> ${r.url} (${skipReason(r)})`);
	return [
		'No GitHub remote found in this repository.',
		'Remotes checked:',
		...lines,
		'',
		'Lightsprint needs a remote pointing at GitHub. Add one, e.g.:',
		'  git remote add origin git@github.com:owner/repo.git',
		'Self-hosted GitHub Enterprise: set LIGHTSPRINT_GITHUB_HOSTS to your host (comma-separated).',
		'Note that Lightsprint links the repository by owner/repo name only, so an enterprise',
		'repo connects against the workspace repo of the same name.',
	].join('\n');
}

/** One clause explaining why a single remote was skipped. */
function skipReason(entry) {
	switch (entry.skipped) {
		case 'not-owner-repo':
			return `${entry.host} is GitHub, but the URL is not a plain owner/repo`;
		case 'ssh-alias-unresolved':
			return `ssh host "${entry.host}" did not resolve to a GitHub host (checked with ssh -G)`;
		case 'host-not-github':
			return `host ${entry.host} is not GitHub`;
		case 'not-a-url':
			return 'a local path, not a remote URL';
		default:
			return entry.host ? `host ${entry.host} is not GitHub` : 'not a GitHub URL';
	}
}
