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

const GIT_TIMEOUT_MS = 5000;
const SSH_TIMEOUT_MS = 3000;

/** Schemes git accepts that point at a network host. */
const NETWORK_SCHEMES = new Set(['ssh', 'ssh+git', 'git+ssh', 'git', 'http', 'https', 'ftp', 'ftps']);
/** Schemes that are always local, never a GitHub remote. */
const LOCAL_SCHEMES = new Set(['file']);
/** Schemes where ~/.ssh/config host aliases apply. */
const SSH_SCHEMES = new Set(['ssh', 'ssh+git', 'git+ssh']);

// Deliberately permissive: GitHub allows dots in repo names (owner/repo.js) and
// repos whose name starts with a dot (owner/.github).
const NAME_RE = /^[A-Za-z0-9._-]+$/;

/** Second labels that mean the host is not an enterprise install (github.com.evil.tld). */
const TLD_LIKE_LABELS = new Set(['com', 'net', 'org', 'io', 'co', 'dev', 'app', 'ai', 'me', 'sh']);

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
	return h || null;
}

/** Extra hosts to treat as GitHub, e.g. LIGHTSPRINT_GITHUB_HOSTS="github.acme.com,git.acme.com". */
function extraGitHubHosts() {
	const raw = process.env.LIGHTSPRINT_GITHUB_HOSTS;
	if (!raw) return [];
	return raw.split(',').map((h) => normalizeHost(h)).filter(Boolean);
}

/**
 * Is this hostname GitHub (github.com, a github.com subdomain, a GitHub Enterprise
 * host such as github.acme.com, or one configured via LIGHTSPRINT_GITHUB_HOSTS)?
 * @param {string|null|undefined} host
 * @returns {boolean}
 */
export function isGitHubHost(host) {
	const h = normalizeHost(host);
	if (!h) return false;
	if (h === 'github.com' || h.endsWith('.github.com')) return true;
	if (extraGitHubHosts().includes(h)) return true;
	// GitHub Enterprise convention: the first label is literally "github"
	// (github.acme.com). Reject spoofs like github.com.evil.tld, where the second
	// label is a TLD and the registrable domain therefore belongs to someone else.
	const labels = h.split('.');
	if (labels.length >= 2 && labels[0] === 'github' && !TLD_LIKE_LABELS.has(labels[1])) return true;
	return false;
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
		if (LOCAL_SCHEMES.has(scheme)) {
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
			isLocal: !NETWORK_SCHEMES.has(scheme) && !host,
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
	if (p.length > 4 && p.toLowerCase().endsWith('.git')) {
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
 * @returns {'yes'|'no'|'git-unavailable'}
 */
function gitRepoState(cwd) {
	try {
		return runGit(['rev-parse', '--is-inside-work-tree'], cwd).trim() === 'true' ? 'yes' : 'no';
	} catch (err) {
		// ENOENT means git itself is missing; anything else means "not a repo".
		if (err && (err.code === 'ENOENT' || err.errno === 'ENOENT')) return 'git-unavailable';
		return 'no';
	}
}

/**
 * List every configured remote with its fetch URL.
 * Uses `git remote -v` so url.<base>.insteadOf rewrites are applied, and falls back
 * to raw config when that fails.
 * @param {string} [cwd]
 * @returns {Array<{ name: string, url: string }>}
 */
export function listGitRemotes(cwd) {
	const seen = new Map();
	try {
		const out = runGit(['remote', '-v'], cwd);
		for (const line of out.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			// "origin\tgit@github.com:owner/repo.git (fetch)"
			const match = trimmed.match(/^(\S+)\s+(.*?)\s+\((fetch|push)\)$/);
			if (!match) continue;
			const [, name, url, kind] = match;
			// Prefer the fetch URL; only fall back to push when there is no fetch entry.
			if (kind === 'fetch' || !seen.has(name)) seen.set(name, url);
		}
	} catch {
		// fall through to the config-based reader
	}

	if (seen.size === 0) {
		try {
			const out = runGit(['config', '--get-regexp', '^remote\\..*\\.url$'], cwd);
			for (const line of out.split('\n')) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				const space = trimmed.indexOf(' ');
				if (space === -1) continue;
				const key = trimmed.slice(0, space);
				const url = trimmed.slice(space + 1).trim();
				const name = key.replace(/^remote\./, '').replace(/\.url$/, '');
				if (name && url && !seen.has(name)) seen.set(name, url);
			}
		} catch {
			// no remotes, or git failed — an empty list is the answer
		}
	}

	return [...seen.entries()].map(([name, url]) => ({ name, url }));
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
	if (!key) return null;
	if (sshHostCache.has(key)) return sshHostCache.get(key);

	let resolved = null;
	try {
		const out = execFileSync('ssh', ['-G', key], {
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
	sshHostCache.set(key, resolved);
	return resolved;
}

/** Test seam: drop memoized `ssh -G` lookups. */
export function clearSshHostCache() {
	sshHostCache.clear();
}

// ─── resolution ──────────────────────────────────────────────────────────

/**
 * @typedef {Object} RemoteEntry
 * @property {string} name
 * @property {string} url
 * @property {string|null} host
 * @property {string|null} fullName
 * @property {boolean} isGitHub
 */

/**
 * @typedef {Object} RemoteResolution
 * @property {string|null} fullName   e.g. "owner/repo"
 * @property {string|null} remote     the remote name that was chosen
 * @property {string|null} host
 * @property {'ok'|'git-unavailable'|'not-a-git-repo'|'no-remotes'|'no-github-remote'} reason
 * @property {RemoteEntry[]} remotes  every remote that was inspected
 * @property {boolean} ambiguous      several GitHub remotes, none of them preferred
 * @property {string|null} selectedBy how the remote was chosen
 */

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
		const state = gitRepoState(cwd);
		if (state !== 'yes') {
			return {
				fullName: null,
				remote: null,
				host: null,
				reason: state === 'git-unavailable' ? 'git-unavailable' : 'not-a-git-repo',
				remotes: [],
				ambiguous: false,
				selectedBy: null,
			};
		}
	}

	const rawRemotes = hasInjectedRemotes ? options.remotes : listGitRemotes(cwd);
	const remotes = rawRemotes.map(({ name, url }) => {
		const parsed = parseRemoteUrl(url);
		const gh = parseGitHubRemoteUrl(url, resolveHost ? { resolveHost } : {});
		return {
			name,
			url,
			host: gh?.host ?? parsed?.host ?? null,
			fullName: gh?.fullName ?? null,
			isGitHub: Boolean(gh),
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
		if (hit) return pick(hit, selectedBy);
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

	if (result.reason === 'ok') {
		const via = result.remote ? ` (remote "${result.remote}")` : '';
		const warning = result.ambiguous
			? `\nSeveral GitHub remotes are configured (${result.remotes.filter((r) => r.isGitHub).map((r) => r.name).join(', ')}); using "${result.remote}". Set the branch upstream or rename the canonical remote to "origin" to choose explicitly.`
			: '';
		return `Detected GitHub repository ${result.fullName}${via}.${warning}`;
	}

	if (result.reason === 'git-unavailable') {
		return 'git was not found on PATH. Lightsprint needs git to detect the GitHub repository for this folder.';
	}

	if (result.reason === 'not-a-git-repo') {
		return 'This folder is not a git repository. Lightsprint needs a git repo with a GitHub remote — run "git init" and add a remote, or cd into your project first.';
	}

	if (result.reason === 'no-remotes') {
		return 'This git repository has no remotes configured. Add one, e.g.:\n  git remote add origin git@github.com:owner/repo.git';
	}

	const lines = result.remotes.map((r) => {
		const why = r.host ? `host ${r.host} is not GitHub` : 'not a GitHub URL';
		return `  ${r.name} -> ${r.url} (${why})`;
	});
	return [
		'No GitHub remote found in this repository.',
		'Remotes checked:',
		...lines,
		'',
		'Lightsprint needs a remote pointing at GitHub. Add one, e.g.:',
		'  git remote add origin git@github.com:owner/repo.git',
		'For GitHub Enterprise, set LIGHTSPRINT_GITHUB_HOSTS to your host (comma-separated).',
	].join('\n');
}
