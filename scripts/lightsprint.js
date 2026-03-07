#!/usr/bin/env node
/**
 * lightsprint.js — Unified CLI for Lightsprint.
 *
 * Subcommands:
 *   review-plan [input]    Plan review hook handler (invoked by Claude Code hooks)
 *   tasks [options]         List tasks from the project board
 *   create <title> [opts]   Create a new task
 *   update <taskId> [opts]  Update an existing task
 *   get <taskId>            Show full task details
 *   claim <taskId>          Claim a task (set to in_progress)
 *   comment <taskId> <body> Add a comment to a task
 *   open                    Open project board in the browser
 *   status                  Show connection status
 *   whoami                  Show project/auth info
 *   connect [--base-url]    Authenticate and connect
 *   disconnect              Remove credentials for this folder
 *   upgrade                 Upgrade to the latest version
 *   help                    Show this help message
 */

import { reviewPlanMain } from './review-plan.js';
import { cliMain } from './ls-cli.js';
import { main as ccStartMain } from './cc-start.js';
import { main as ccDaemonMain } from './cc-daemon.js';
import { main as ccEndMain } from './cc-end.js';
import { main as ccEventMain } from './cc-event.js';
import { main as ccReviewMain } from './cc-review.js';

// Injected at build time via --define
const BUILD_VERSION = typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'dev';
const BUILD_HASH = typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'dev';
const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'unknown';

const subcommand = process.argv[2];
const args = process.argv.slice(3);

if (subcommand === 'review-plan') {
	reviewPlanMain(args);
} else if (subcommand === 'cc-start') {
	await ccStartMain(args);
} else if (subcommand === 'cc-daemon') {
	await ccDaemonMain();
} else if (subcommand === 'cc-end') {
	await ccEndMain(args);
} else if (subcommand === 'cc-event') {
	await ccEventMain(args);
} else if (subcommand === 'cc-review') {
	await ccReviewMain(args);
} else if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
	showHelp();
} else if (subcommand === '--version' || subcommand === '-v') {
	console.log(`lightsprint v${BUILD_VERSION} (${BUILD_HASH})`);
} else {
	cliMain(subcommand, args, { version: BUILD_VERSION }).catch(err => {
		console.error(`Error: ${err.message}`);
		process.exit(1);
	});
}

function showHelp() {
	console.log(`lightsprint v${BUILD_VERSION} (${BUILD_HASH}) — built ${BUILD_TIME}

Lightsprint CLI — Plan review and task management

Usage:
  lightsprint <command> [options]

Commands:
  review-plan [input]     Review an implementation plan (Claude Code hook)
  tasks [options]         List tasks from the project board
  create <title> [opts]   Create a new task
  update <taskId> [opts]  Update an existing task
  get <taskId>            Show full task details
  claim <taskId>          Claim a task (set to in_progress)
  comment <taskId> <body> Add a comment to a task
  open                    Open the project board in your browser
  status                  Show connection status for this repository
  whoami                  Show project/auth info
  connect [--base-url]    Authenticate and connect to Lightsprint
  disconnect              Remove Lightsprint credentials for this repository
  upgrade                 Upgrade to the latest version

Flags:
  --help, -h              Show this help message
  --version, -v           Show version

Run 'lightsprint <command> --help' for command-specific help.

For more information: https://github.com/SprintsAI/lightsprint-claude-code-plugin`);
}
