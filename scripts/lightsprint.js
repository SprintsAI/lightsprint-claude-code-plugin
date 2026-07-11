#!/usr/bin/env node
/**
 * lightsprint.js — Unified CLI for Lightsprint.
 *
 * Subcommands (all accept positional args OR explicit flags):
 *   tasks [options]         List tasks from the repo board
 *   create <title> [opts]   Create a new task (also: --title <text>)
 *   update <taskId> [opts]  Update an existing task (also: --task <id>)
 *   get <taskId>            Show full task details (also: --task <id>)
 *   claim <taskId>          Claim a task (also: --task <id>)
 *   comment <taskId> <body> Add a comment to a task (also: --task/--body)
 *   create-plan [opts]      Create a plan from markdown content
 *   agent launch [opts]     Launch a cloud agent for a task
 *   agent stop [opts]       Stop the active agent for a task
 *   agent settings [opts]   Show cloud agent provider configuration
 *   open                    Open repo board in the browser
 *   status                  Show connection status
 *   whoami                  Show repo/auth info
 *   connect [--base-url]    Authenticate and connect
 *   disconnect              Remove credentials for this folder
 *   upgrade                 Upgrade to the latest version
 *   version                 Show version and build info
 *   help                    Show this help message
 */

import { cliMain } from './ls-cli.js';
import { main as ccStartMain } from './cc-start.js';
import { main as ccEndMain } from './cc-end.js';
import { main as ccEventMain } from './cc-event.js';
import { main as ccPrCreatedMain } from './cc-pr-created.js';

// Injected at build time via --define
const BUILD_VERSION = typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'dev';
const BUILD_HASH = typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'dev';
const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'unknown';

const subcommand = process.argv[2];
const args = process.argv.slice(3);

if (subcommand === 'cc-start') {
	await ccStartMain(args);
} else if (subcommand === 'cc-daemon') {
	const { main: ccDaemonMain } = await import('./cc-daemon.js');
	await ccDaemonMain();
} else if (subcommand === 'cc-end') {
	await ccEndMain(args);
} else if (subcommand === 'cc-event') {
	await ccEventMain(args);
} else if (subcommand === 'cc-pr-created') {
	await ccPrCreatedMain(args);
} else if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
	showHelp();
} else if (subcommand === 'version') {
	console.log(`lightsprint v${BUILD_VERSION} (${BUILD_HASH}) — built ${BUILD_TIME}`);
} else {
	cliMain(subcommand, args, { version: BUILD_VERSION }).catch(() => {
		// cliMain handles its own error output via outputError + process.exit(1).
		// This catch is a safety net for any edge cases where the process hasn't exited yet.
		process.exit(1);
	});
}

function showHelp() {
	console.log(`lightsprint v${BUILD_VERSION} (${BUILD_HASH}) — built ${BUILD_TIME}

Lightsprint CLI — Task management

Usage:
  lightsprint <command> [options]

Commands:
  tasks [options]         List tasks from the repo board
  create <title> [opts]   Create a new task (also: --title <text>)
  update <taskId> [opts]  Update an existing task (also: --task <id>)
  get <taskId>            Show full task details (also: --task <id>)
  claim <taskId>          Claim a task (set to in_progress) (also: --task <id>)
  comment <taskId> <body> Add a comment to a task (also: --task/--body)
  create-plan [opts]      Create a plan from markdown content
  agent launch [opts]     Launch a cloud agent for a task
  agent stop [opts]       Stop the active agent for a task
  agent settings [opts]   Show cloud agent provider configuration
  agent create-pr [opts]  Create a GitHub PR from a cloud agent working branch
  merge [opts]            Merge the GitHub PR linked to a task
  review-hub signals [opts] Get PR signals (CI, reviews, comments) for a task
  review-hub scores [opts]  Get AI readiness analysis for a task linked PR
  describe [command]      Show accepted parameters/types as JSON
  open                    Open the repo board in your browser
  status                  Show connection status for this repository
  whoami                  Show repo/auth info
  connect [--base-url]    Authenticate and connect to Lightsprint
  disconnect              Remove Lightsprint credentials for this repository
  upgrade                 Upgrade to the latest version

Global Flags:
  --output json|text      Output format (default: text)
  --json                  Shorthand for --output json
  --dry-run               Validate without making API calls
  --fields f1,f2          Return only specified fields (implies --output json)
  --help, -h              Show this help message

Other Commands:
  version                 Show version and build info

Run 'lightsprint <command> --help' for command-specific help.

For more information: https://github.com/SprintsAI/lightsprint-claude-code-plugin`);
}
