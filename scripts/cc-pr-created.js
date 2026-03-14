/**
 * cc-pr-created.js — PostToolUse hook for Bash.
 *
 * Detects when `gh pr create` completes successfully and outputs
 * additionalContext instructing the agent to run the link-pr flow.
 *
 * Input: hook JSON via stdin (PostToolUse for Bash tool)
 * Output: JSON with hookSpecificOutput.additionalContext (if PR detected)
 */

import { readHookInput } from './lib/cc-utils.js';

const PR_URL_RE = /https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/;

export async function main(args) {
	const input = readHookInput(args);
	if (!input) return;

	const command = input.tool_input?.command || '';
	if (!command.includes('gh pr create')) return;

	// Extract PR URL from tool response
	// tool_response may be a string or an object with stdout
	const response = input.tool_response;
	const responseText = typeof response === 'string'
		? response
		: (response?.stdout || response?.content || JSON.stringify(response || ''));

	const match = responseText.match(PR_URL_RE);
	if (!match) return;

	const prUrl = match[0];

	// Output additionalContext so the agent is forced to run link-pr
	const output = {
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
	};

	console.log(JSON.stringify(output));
}
