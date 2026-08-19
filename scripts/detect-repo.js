#!/usr/bin/env node
/**
 * Print the GitHub repository (owner/repo) for the current working directory.
 *
 * This is the shared entrypoint the shell installers use so bash, PowerShell and
 * the CLI all resolve remotes through scripts/lib/git-remote.js instead of each
 * hand-rolling a `git remote get-url origin` + string-chomp.
 *
 * Usage:
 *   node detect-repo.js             # prints "owner/repo" and exits 0, or exits 1
 *   node detect-repo.js --explain   # prints a human-readable reason (always exits 0)
 *   node detect-repo.js --json      # prints the full resolution as JSON (always exits 0)
 */

import { resolveGitHubRemote, describeRemoteResolution } from './lib/git-remote.js';

const args = process.argv.slice(2);
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

process.exit(1);
