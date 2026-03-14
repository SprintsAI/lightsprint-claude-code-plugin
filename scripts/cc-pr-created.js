/**
 * cc-pr-created.js — PostToolUse hook for Bash.
 *
 * Detects when `gh pr create` completes successfully and outputs
 * additionalContext instructing the agent to run the link-pr flow.
 *
 * Input: hook JSON via stdin (PostToolUse for Bash tool)
 * Output: JSON with hookSpecificOutput.additionalContext (if PR detected)
 */

import { readHookInput, createLogger } from './lib/cc-utils.js';

const PR_URL_RE = /https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/;
const log = createLogger('cc-pr-created');

export async function main(args) {
	try {
		const input = readHookInput(args);
		if (!input) {
			log('No hook input received');
			return;
		}

		const command = input.tool_input?.command || '';
		if (!command.includes('gh pr create')) return;

		log('gh pr create detected', {
			inputKeys: Object.keys(input),
			toolResponseType: typeof input.tool_response,
			toolResponseKeys: input.tool_response ? Object.keys(input.tool_response) : null,
			stdout: input.tool_response?.stdout?.substring(0, 300),
			stderr: input.tool_response?.stderr?.substring(0, 300),
		});

		// Extract PR URL from tool response
		// tool_response has { stdout, stderr, interrupted, isImage, noOutputExpected } for Bash
		// The PR URL may be in stdout or stderr depending on the command
		const response = input.tool_response;
		const candidates = [
			typeof response === 'string' ? response : null,
			response?.stdout,
			response?.stderr,
			response?.content,
		].filter(Boolean);
		const responseText = candidates.join('\n') || JSON.stringify(response || '');

		const match = responseText.match(PR_URL_RE);
		if (!match) {
			log('No PR URL found in response', {
				responseTextLength: responseText?.length,
				responseTextPreview: responseText?.substring(0, 200),
			});
			return;
		}

		const prUrl = match[0];
		log('PR URL extracted', { prUrl });

		// Output additionalContext so the agent is forced to run link-pr
		const output = {
			hookSpecificOutput: {
				additionalContext: [
				`<system-reminder>`,
				`MANDATORY: A GitHub PR was just created at ${prUrl}.`,
				`You MUST now run the link-pr flow. Do this IMMEDIATELY before responding to the user:`,
				``,
				`1. Run: lightsprint current-task --cc-pid $PPID`,
				`2. If a task is found: Run: lightsprint link-pr --task <taskId> --pr-url ${prUrl}`,
				`3. If NO task is found: Check preference with: lightsprint config get link-pr.no-task-behavior`,
				`   - If "always-skip": skip silently`,
				`   - Otherwise: ask the user with the 4 options (create new / link existing / skip / always skip)`,
				``,
				`This is a required step. Do NOT skip it. Do NOT wait for the user to ask.`,
				`</system-reminder>`,
			].join('\n'),
			},
		};

		console.log(JSON.stringify(output));
	} catch (err) {
		log('Hook error', { error: err.message, stack: err.stack });
		// Re-throw so Claude Code sees the failure
		throw err;
	}
}
