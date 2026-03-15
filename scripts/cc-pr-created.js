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

/**
 * Extract --title and --body values from a gh pr create command string.
 * Handles both quoted ("...") and heredoc ($(cat <<'EOF'...EOF)) forms.
 */
function extractPrMeta(command) {
	let title = '';
	let body = '';

	// Extract --title "..." (handles escaped quotes)
	const titleMatch = command.match(/--title\s+"((?:\\"|[^"`])*)"/);
	if (titleMatch) title = titleMatch[1];

	// Extract --body: try heredoc first, then simple quotes
	const heredocMatch = command.match(/--body\s+"\$\(cat\s+<<'?EOF'?\n([\s\S]*?)\nEOF\s*\)"/);
	if (heredocMatch) {
		body = heredocMatch[1];
	} else {
		const bodyMatch = command.match(/--body\s+"((?:\\"|[^"`])*)"/);
		if (bodyMatch) body = bodyMatch[1];
	}

	return { title, body };
}

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
		const prMeta = extractPrMeta(command);
		log('PR URL extracted', { prUrl, prTitle: prMeta.title?.substring(0, 100), hasBody: !!prMeta.body });

		// Build the "create new task" instruction block
		const createTaskLines = [];
		if (prMeta.title || prMeta.body) {
			createTaskLines.push(`   - If creating a new task, use the PR metadata below to populate BOTH --title AND --description.`);
			createTaskLines.push(`     --description is REQUIRED — do NOT omit it. Use --status in_review.`);
			if (prMeta.title) createTaskLines.push(`     PR title:\n\`\`\`\n${prMeta.title}\n\`\`\``);
			if (prMeta.body) createTaskLines.push(`     PR body:\n\`\`\`\n${prMeta.body}\n\`\`\``);
		} else {
			createTaskLines.push(`   - If creating a new task: look at the PR body and commit messages already in this conversation. Create the task with BOTH --title AND --description. --description is REQUIRED. Use --status in_review.`);
		}

		// Output additionalContext so the agent is forced to run link-pr
		const output = {
			hookSpecificOutput: {
				hookEventName: 'PostToolUse',
				additionalContext: [
				`<system-reminder>`,
				`MANDATORY: A GitHub PR was just created at ${prUrl}.`,
				`You MUST now run the link-pr flow. Do this IMMEDIATELY before responding to the user:`,
				``,
				`1. Run: lightsprint current-task --cc-pid $PPID`,
				`2. If a task is found: Run: lightsprint link-pr --task <taskId> --pr-url ${prUrl}`,
				`3. If NO task is found: Check preference with: lightsprint config get link-pr.no-task-behavior`,
				`   - If "always-skip": skip silently`,
				`   - If "always-create": skip the prompt and directly create a new task from PR context (use Option 1 from link-pr skill), then link it`,
				`   - Otherwise: ask the user with the 5 options (create new / link existing / skip / always skip / always create)`,
				`   - IMPORTANT for "link existing" option: run "lightsprint tasks --mine --status backlog,todo,in_progress --limit 10" and show the numbered task list so the user can pick — do NOT just ask for a task ID`,
				...createTaskLines,
				``,
				`This is a required step. Do NOT skip it. Do NOT wait for the user to ask.`,
				`</system-reminder>`,
			].join('\n'),
			},
		};

		const json = JSON.stringify(output);
		log('Output', { json: json.substring(0, 200) });
		process.stdout.write(json);
	} catch (err) {
		log('Hook error', { error: err.message, stack: err.stack });
		// Re-throw so Claude Code sees the failure
		throw err;
	}
}
