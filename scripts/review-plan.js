#!/usr/bin/env node
/**
 * review-plan.js — PreToolUse hook handler for ExitPlanMode.
 *
 * Called by Claude Code hooks with JSON on stdin containing:
 *   { tool_name, tool_input: { allowedPrompts }, transcript_path, cwd, session_id, ... }
 *
 * Note: ExitPlanMode does NOT include plan content in tool_input.
 * The plan is written to a file during plan mode. We extract it from:
 * 1. The transcript (find the last Write tool call to a plan file)
 * 2. Fallback: common plan file locations (.claude/plan.md)
 *
 * Flow:
 * 1. Config guard — if no config, allow and exit
 * 2. Read stdin, extract plan from transcript or plan file
 * 3. Upload plan to Lightsprint (PUT version if active plan exists, POST new otherwise)
 * 4. Start callback server, open browser to plan review page
 * 5. Wait for user decision via callback
 * 6. Output decision JSON to stdout
 *
 * Error handling: ANY failure outputs allow decision and exits 0.
 */

import { createServer } from 'http';
import { createServer as createNetServer } from 'net';
import { exec, spawn } from 'child_process';
import open from 'open';
import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getConfig, getDefaultBaseUrl } from './lib/config.js';
import { apiRequest, getProjectId, setConfig } from './lib/client.js';
import { getActivePlan, setActivePlan, clearActivePlan } from './lib/plan-tracker.js';

const LOG_DIR = join(homedir(), '.lightsprint');
const LOG_FILE = join(LOG_DIR, 'sync.log');

// Injected at build time via --define (enables version verification in logs)
const BUILD_HASH = typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'dev';

function log(level, message, data) {
	try {
		if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
		const ts = new Date().toISOString();
		const line = `${ts} [${level}] review-plan: ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`;
		appendFileSync(LOG_FILE, line);
	} catch {
		// Never crash on logging
	}
}

function outputAllow() {
	const result = {
		hookSpecificOutput: {
			hookEventName: "PermissionRequest",
			decision: {
				behavior: "allow"
			}
		}
	};
	const json = JSON.stringify(result);
	log('info', 'Output decision', { output: json });
	process.stdout.write(json);
}

function outputDeny(feedback) {
	const result = {
		hookSpecificOutput: {
			hookEventName: "PermissionRequest",
			decision: {
				behavior: "deny",
				message: feedback || "Plan rejected by reviewer."
			}
		}
	};
	const json = JSON.stringify(result);
	log('info', 'Output decision', { output: json });
	process.stdout.write(json);
}

function findFreePort() {
	return new Promise((resolve, reject) => {
		const server = createNetServer();
		server.listen(0, () => {
			const port = server.address().port;
			server.close(() => resolve(port));
		});
		server.on('error', reject);
	});
}

async function openBrowser(url) {
	try {
		await open(url);
		return;
	} catch {
	}

	// Fallback: spawn /usr/bin/open (macOS) or exec
	const isMac = process.platform === 'darwin';
	try {
		if (isMac) {
			const child = spawn('/usr/bin/open', [url], { detached: true, stdio: 'ignore' });
			if (child) child.unref();
		} else {
			exec(process.platform === 'linux' ? `xdg-open "${url}"` : `start "" "${url}"`);
		}
		return;
	} catch {
		// fall through
	}
	log('warn', 'Could not open browser, printing URL');
}

/**
 * Extract plan content from the session transcript.
 * Reads the JSONL transcript backwards to find the most recent plan file written.
 * @param {string} transcriptPath - Path to the transcript JSONL file
 * @param {string} cwd - Working directory to resolve relative paths
 * @returns {string|null} Plan content or null
 */
function extractPlanFromTranscript(transcriptPath, cwd) {
	try {
		if (!transcriptPath || !existsSync(transcriptPath)) {
			log('debug', 'No transcript path or file not found', { transcriptPath });
			return null;
		}

		const content = readFileSync(transcriptPath, 'utf-8');
		const lines = content.split('\n').filter(Boolean);

		// Search backwards for the last Write tool call to a plan-like file
		let lastPlanFilePath = null;
		let lastPlanContent = null;

		for (let i = lines.length - 1; i >= 0; i--) {
			try {
				const entry = JSON.parse(lines[i]);
				const msg = entry?.message;
				if (!msg || msg.role !== 'assistant') continue;

				const contentArr = msg.content;
				if (!Array.isArray(contentArr)) continue;

				for (const block of contentArr) {
					if (block?.type !== 'tool_use' || block?.name !== 'Write') continue;

					const filePath = block?.input?.file_path || '';
					// Match plan files: .claude/plan.md, plan.md, or any path with "plan" in the filename
					if (filePath.match(/plan[^/]*\.md$/i) || filePath.includes('.claude/plan')) {
						lastPlanFilePath = filePath;
						lastPlanContent = block?.input?.content;
						break;
					}
				}

				if (lastPlanContent) break;
			} catch {
				// Skip unparseable lines
			}
		}

		if (lastPlanContent) {
			log('info', 'Extracted plan from transcript Write call', { filePath: lastPlanFilePath, length: lastPlanContent.length });
			return lastPlanContent;
		}

		log('debug', 'No plan Write call found in transcript');
		return null;
	} catch (err) {
		log('warn', 'Failed to read transcript', { error: err.message });
		return null;
	}
}

/**
 * Try to read plan from common file locations.
 * @param {string} cwd - Working directory
 * @returns {string|null} Plan content or null
 */
function readPlanFromFile(cwd) {
	const candidates = [
		join(cwd, '.claude', 'plan.md'),
		join(cwd, 'plan.md'),
	];

	for (const path of candidates) {
		try {
			if (existsSync(path)) {
				const content = readFileSync(path, 'utf-8').trim();
				if (content) {
					log('info', 'Read plan from file', { path, length: content.length });
					return content;
				}
			}
		} catch {
			// Try next
		}
	}

	return null;
}

/**
 * Start a local HTTP server and wait for the review callback.
 * @param {number} port
 * @param {number} [timeoutMs=345600000] - 4 days default
 * @returns {Promise<{ decision: string, feedback: string }>}
 */
function showHelp() {
	console.log(`ls-cli — Review implementation plans in the browser

Usage:
  ls-cli [input]
  ls-cli help        Show this help message

This tool is typically invoked automatically as a Claude Code hook when you call
the ExitPlanMode action. It:

  1. Reads plan content from stdin or a file
  2. Uploads the plan to your Lightsprint project board
  3. Opens your browser for interactive review
  4. Allows you to approve or reject the plan
  5. Returns the decision back to Claude Code

Arguments:
  <input>                 (Optional) Path to a JSON file containing hook input
                          Defaults to reading from stdin if not provided
  help, --help, -h        Show this help message

Environment:
  Requires authentication via 'ls-cli connect' or the
  lightsprint:connect skill in Claude Code

Examples:

  # Typically invoked automatically by Claude Code hooks
  # But can be invoked manually with an input file:
  ls-cli /tmp/hook-input.json

  # Show help
  ls-cli help
  ls-cli --help

For more information on using Lightsprint with Claude Code, see:
  https://github.com/SprintsAI/lightsprint-claude-code-plugin
`);
}

function waitForCallback(port, timeoutMs = 345600000) {
	return new Promise((resolve, reject) => {
		const sockets = new Set();
		const server = createServer((req, res) => {
			const url = new URL(req.url, 'http://localhost');
			if (url.pathname === '/callback') {
				const decision = url.searchParams.get('decision') || 'allow';
				const feedback = url.searchParams.get('feedback') || '';

				res.writeHead(200, { 'Content-Type': 'text/html', 'Connection': 'close' });
				res.end('<html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="text-align:center"><h1>Review submitted!</h1><p>You can close this tab and return to your terminal.</p></div></body></html>');
				closeServer();
				resolve({ decision, feedback });
			}
		});

		server.on('connection', (socket) => {
			sockets.add(socket);
			socket.on('close', () => sockets.delete(socket));
		});

		function closeServer() {
			for (const socket of sockets) socket.destroy();
			server.close();
		}

		server.listen(port);

		const timer = setTimeout(() => {
			closeServer();
			reject(new Error('Plan review timed out.'));
		}, timeoutMs);

		server.on('close', () => clearTimeout(timer));
	});
}

async function main() {
	log('info', 'Hook invoked', { buildHash: BUILD_HASH, pid: process.pid, argv: process.argv.slice(2) });

	// Handle help flags early
	const firstArg = process.argv[2];
	if (!firstArg || firstArg === 'help' || firstArg === '--help' || firstArg === '-h') {
		return showHelp();
	}

	// 1. Read input — from file argument (preferred) or stdin (fallback)
	let input;
	let rawStdin;
	try {
		const inputFile = firstArg;
		if (inputFile) {
			// Read from file path argument (avoids stdin issues with compiled binaries)
			rawStdin = readFileSync(inputFile, 'utf-8');
			log('info', 'Input read from file', { path: inputFile, length: rawStdin.length, preview: rawStdin.substring(0, 200) });
		} else {
			// Fallback: read from stdin
			const chunks = [];
			for await (const chunk of process.stdin) {
				chunks.push(chunk);
			}
			rawStdin = Buffer.concat(chunks).toString();
			log('info', 'Stdin received', { length: rawStdin.length, preview: rawStdin.substring(0, 200) });
		}
		let toParse = rawStdin.trimEnd();
		try {
			input = JSON.parse(toParse);
		} catch (parseErr) {
			// Claude Code may send plan content with unescaped newlines; repair the plan string only
			if (/control character|Unexpected token/.test(parseErr.message) && /"plan"\s*:\s*"/.test(toParse)) {
				toParse = toParse.replace(/"plan"\s*:\s*"([\s\S]*?)"(?=\s*[,}\]])/g, (_, plan) =>
					`"plan":"${plan.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/"/g, '\\"')}"`);
				input = JSON.parse(toParse);
			} else {
				throw parseErr;
			}
		}
	} catch (err) {
		log('error', 'Failed to parse input', { error: err.message, stdinLength: rawStdin?.length, stdinPreview: rawStdin?.substring(0, 200) });
		outputAllow();
		process.exit(0);
	}

	log('info', 'Stdin parsed', {
		tool_name: input?.tool_name,
		hook_event_name: input?.hook_event_name,
		cwd: input?.cwd,
		has_transcript_path: !!input?.transcript_path,
		tool_input_keys: input?.tool_input ? Object.keys(input.tool_input) : [],
		has_plan: !!input?.tool_input?.plan,
		plan_length: input?.tool_input?.plan?.length
	});

	const allowedPrompts = input?.tool_input?.allowedPrompts;
	const transcriptPath = input?.transcript_path;
	const sessionId = input?.session_id;
	const hookCwd = input?.cwd || process.cwd();
	// 2. Config guard (use cwd from stdin, not process.cwd())
	let cfg = getConfig(hookCwd);
	if (!cfg) {
		// No config for this folder — trigger OAuth in the browser
		log('info', 'No project configured, triggering OAuth', { cwd: hookCwd });
		try {
			const defaultBaseUrl = getDefaultBaseUrl();
			const { authenticate } = await import('./lib/auth.js');
			const authResult = await authenticate(defaultBaseUrl, { cwd: hookCwd, quiet: true });
			if (!authResult || authResult.skipped || !authResult.accessToken) {
				log('info', 'OAuth skipped or failed, allowing', { cwd: hookCwd });
				outputAllow();
				process.exit(0);
			}
			cfg = authResult;
			// Inject fresh config into client module so apiRequest uses it
			setConfig(cfg);
			log('info', 'OAuth succeeded', { projectId: cfg.projectId, cwd: hookCwd });
		} catch (err) {
			log('error', 'OAuth failed', { error: err.message, cwd: hookCwd });
			outputAllow();
			process.exit(0);
		}
	}

	log('info', 'Config resolved', { baseUrl: cfg.baseUrl, cwd: hookCwd });

	// 2b. Extract plan content — PostToolUse includes plan in tool_input.plan
	let plan = input?.tool_input?.plan;
	log('info', 'Plan from tool_input', { found: !!plan, length: plan?.length });
	if (!plan) {
		// Fallback: try transcript or file
		plan = extractPlanFromTranscript(transcriptPath, hookCwd);
		log('info', 'Plan from transcript', { found: !!plan, length: plan?.length });
	}
	if (!plan) {
		plan = readPlanFromFile(hookCwd);
		log('info', 'Plan from file', { found: !!plan, length: plan?.length });
	}

	if (!plan) {
		log('warn', 'Could not find plan content', { cwd: hookCwd });
		outputAllow();
		process.exit(0);
	}

	log('info', 'Plan content resolved', { length: plan.length });

	try {
		// 3. Upload plan
		log('info', 'Getting project ID...');
		const projectId = await getProjectId();
		log('info', 'Got project ID', { projectId });
		let planId;

		const activePlan = getActivePlan();

		if (activePlan && activePlan.projectId === projectId && activePlan.sessionId === sessionId) {
			// Try PUT to create a new version on the existing plan
			try {
				const versionResult = await apiRequest(`/api/plans/${activePlan.planId}/versions`, {
					method: 'PUT',
					body: JSON.stringify({ content: plan })
				});
				planId = activePlan.planId;
				log('info', 'Created new plan version', { planId });
			} catch (err) {
				log('warn', 'PUT version failed, creating new plan', { error: err.message });
				// Fall through to POST new plan
				planId = null;
			}
		}

		if (!planId) {
			// POST new plan
			const createResult = await apiRequest(`/api/projects/${projectId}/plans`, {
				method: 'POST',
				body: JSON.stringify({ content: plan, allowedPrompts })
			});
			planId = createResult?.planId || createResult?.id;

			if (!planId) {
				log('error', 'No plan ID returned from POST');
				outputAllow();
				process.exit(0);
			}

			log('info', 'Created new plan', { planId, projectId });
		}

		// Update active plan tracker
		setActivePlan(planId, projectId, sessionId);

		// 4. Start callback server
		const port = await findFreePort();
		const callbackUrl = `http://localhost:${port}/callback`;
		const reviewUrl = `${cfg.baseUrl}/plans/${planId}?callback=${encodeURIComponent(callbackUrl)}`;

		// 5. Open browser (also print URL so user can open manually if browser doesn't pop)
		log('info', 'Opening browser for plan review', { reviewUrl, port });
		await openBrowser(reviewUrl);
		process.stderr.write(`\n→ Review plan: ${reviewUrl}\n\n`);

		// 6. Wait for callback
		const { decision, feedback } = await waitForCallback(port);

		log('info', 'Received review decision', { decision, feedback });

		// 7. Output decision
		if (decision === 'deny' || decision === 'denied' || decision === 'reject') {
			// Keep active plan for versioning on resubmission
			outputDeny(feedback || 'Plan rejected by reviewer.');
		} else {
			// Plan approved — clear active plan for next cycle
			clearActivePlan();
			outputAllow();
		}
	} catch (err) {
		log('error', 'review-plan failed', { error: err.message });
		outputAllow();
	}

	process.exit(0);
}

main();
