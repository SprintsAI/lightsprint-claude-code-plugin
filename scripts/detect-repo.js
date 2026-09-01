#!/usr/bin/env node
/**
 * Print the GitHub repository (owner/repo) for the current working directory.
 *
 * This is the shared entrypoint the shell installers use so bash, PowerShell and
 * the CLI all resolve remotes through scripts/lib/git-remote.js instead of each
 * hand-rolling a `git remote get-url origin` + string-chomp.
 *
 * Usage:
 *   node detect-repo.js             # stdout: "owner/repo" (exit 0), or the reason
 *                                   # on stderr (exit 1)
 *   node detect-repo.js --explain   # prints a human-readable reason (always exits 0)
 *   node detect-repo.js --json      # prints the full resolution as JSON (always exits 0)
 *
 * Credentials embedded in remote URLs are masked before anything is printed.
 */

import { resolveGitHubRemote, describeRemoteResolution } from './lib/git-remote.js';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
	console.log('Usage: detect-repo.js [--explain | --json]\n'
		+ '  (no flag)   print owner/repo on stdout, or the reason on stderr and exit 1\n'
		+ '  --explain   print a human-readable reason and exit 0\n'
		+ '  --json      print the full resolution as JSON and exit 0');
	process.exit(0);
}

const unknown = args.find((a) => a.startsWith('-') && !['--explain', '--json'].includes(a));
if (unknown) {
	console.error(`Unknown argument: ${unknown}. Use --explain, --json, or no flag.`);
	process.exit(2);
}

const result = resolveGitHubRemote(process.cwd());

if (args.includes('--json')) {
	console.log(JSON.stringify({ ...result, message: describeRemoteResolution(result) }));
	process.exit(0);
}

if (args.includes('--explain')) {
	console.log(describeRemoteResolution(result));
	process.exit(0);
}

if (result.fullName) {
	console.log(result.fullName);
	process.exit(0);
}

// stdout stays clean so `$(node detect-repo.js)` is either the repo or empty;
// the reason goes to stderr so callers never get a bare non-zero exit.
console.error(describeRemoteResolution(result));
process.exit(1);
