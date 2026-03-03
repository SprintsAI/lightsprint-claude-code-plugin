import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";

const LIGHTSPRINT_BIN = "lightsprint";

type CommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

type ReviewDecision = {
	hookSpecificOutput?: {
		decision?: {
			behavior?: string;
			message?: string;
		};
	};
};

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

function missingBinaryMessage(): string {
	return [
		"lightsprint binary not found in PATH.",
		"",
		"Install Lightsprint first, then restart OpenCode:",
		"  macOS/Linux: curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/install.sh | bash",
		"  Windows:      irm https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/scripts/install.ps1 | iex",
	].join("\n");
}

async function runLightsprint(
	args: string[],
	cwd: string,
	signal?: AbortSignal,
): Promise<CommandResult> {
	const spawned = Bun.spawn({
		cmd: [LIGHTSPRINT_BIN, ...args],
		cwd,
		stdout: "pipe",
		stderr: "pipe",
		signal,
	});

	const [exitCode, stdout, stderr] = await Promise.all([
		spawned.exited,
		new Response(spawned.stdout).text(),
		new Response(spawned.stderr).text(),
	]);

	return {
		exitCode,
		stdout: stdout.trim(),
		stderr: stderr.trim(),
	};
}

function parseReviewDecision(stdout: string): ReviewDecision | null {
	const trimmed = stdout.trim();
	if (!trimmed) {
		return null;
	}

	try {
		return JSON.parse(trimmed) as ReviewDecision;
	} catch {
		const lines = trimmed
			.split("\n")
			.map(line => line.trim())
			.filter(Boolean);

		for (let i = lines.length - 1; i >= 0; i -= 1) {
			try {
				return JSON.parse(lines[i]) as ReviewDecision;
			} catch {
				// Keep scanning backwards.
			}
		}
	}

	return null;
}

function formatFailure(commandArgs: string[], result: CommandResult): string {
	const lines = [
		`lightsprint ${commandArgs.join(" ")} failed (exit ${result.exitCode}).`,
	];

	if (result.stderr) {
		lines.push("", "stderr:", result.stderr);
	}
	if (result.stdout) {
		lines.push("", "stdout:", result.stdout);
	}

	return lines.join("\n");
}

async function runTaskCommand(
	commandArgs: string[],
	cwd: string,
	binaryCheckError: string | null,
	signal?: AbortSignal,
): Promise<string> {
	if (binaryCheckError) {
		return binaryCheckError;
	}

	try {
		const result = await runLightsprint(commandArgs, cwd, signal);
		if (result.exitCode !== 0) {
			return formatFailure(commandArgs, result);
		}
		return result.stdout || "Command completed with no output.";
	} catch (error) {
		return `Failed to execute lightsprint ${commandArgs.join(" ")}: ${toErrorMessage(error)}`;
	}
}

const LightsprintOpenCodePlugin: Plugin = async ctx => {
	let binaryCheckError: string | null = null;
	try {
		const check = await runLightsprint(["--version"], ctx.directory);
		if (check.exitCode !== 0) {
			binaryCheckError = missingBinaryMessage();
		}
	} catch {
		binaryCheckError = missingBinaryMessage();
	}

	return {
		tool: {
			submit_plan: tool({
				description: "Submit a markdown implementation plan for Lightsprint review.",
				args: {
					plan: tool.schema
						.string()
						.min(1)
						.describe("Implementation plan content in markdown format."),
				},
				async execute(args, toolCtx) {
					if (binaryCheckError) {
						return binaryCheckError;
					}

					let tempDir = "";
					try {
						tempDir = await mkdtemp(join(tmpdir(), "lightsprint-opencode-"));
						const inputPath = join(tempDir, "review-plan-input.json");
						const hookInput = {
							tool_name: "ExitPlanMode",
							tool_input: { plan: args.plan },
							cwd: ctx.directory,
						};

						await writeFile(inputPath, JSON.stringify(hookInput), "utf8");
						const result = await runLightsprint(["review-plan", inputPath], ctx.directory, toolCtx.abort);

						if (result.exitCode !== 0) {
							return formatFailure(["review-plan", inputPath], result);
						}

						const decision = parseReviewDecision(result.stdout);
						if (!decision) {
							return [
								"lightsprint review-plan returned unexpected output.",
								"stdout:",
								result.stdout || "(empty)",
								result.stderr ? `\nstderr:\n${result.stderr}` : "",
							]
								.filter(Boolean)
								.join("\n");
						}

						const behavior = decision.hookSpecificOutput?.decision?.behavior;
						const feedback = decision.hookSpecificOutput?.decision?.message?.trim();
						if (behavior === "deny") {
							return feedback
								? `Plan rejected by reviewer:\n${feedback}`
								: "Plan rejected by reviewer.";
						}

						if (behavior === "allow") {
							return "Plan approved by reviewer.";
						}

						return [
							`Unknown review decision behavior: ${behavior ?? "undefined"}.`,
							result.stdout ? `stdout:\n${result.stdout}` : "",
						]
							.filter(Boolean)
							.join("\n\n");
					} catch (error) {
						return `submit_plan failed: ${toErrorMessage(error)}`;
					} finally {
						if (tempDir) {
							await rm(tempDir, { recursive: true, force: true });
						}
					}
				},
			}),
			lightsprint_tasks: tool({
				description: "List Lightsprint tasks with optional status and limit filters.",
				args: {
					status: tool.schema
						.enum(["todo", "in_progress", "in_review", "done"])
						.optional()
						.describe("Optional status filter."),
					limit: tool.schema
						.number()
						.int()
						.min(1)
						.max(200)
						.optional()
						.describe("Optional result limit."),
				},
				async execute(args, toolCtx) {
					const commandArgs = ["tasks"];
					if (args.status) {
						commandArgs.push("--status", args.status);
					}
					if (typeof args.limit === "number") {
						commandArgs.push("--limit", String(args.limit));
					}
					return runTaskCommand(commandArgs, ctx.directory, binaryCheckError, toolCtx.abort);
				},
			}),
			lightsprint_create: tool({
				description: "Create a new Lightsprint task.",
				args: {
					title: tool.schema
						.string()
						.min(1)
						.describe("Task title."),
					description: tool.schema
						.string()
						.optional()
						.describe("Optional task description."),
					complexity: tool.schema
						.enum(["trivial", "low", "medium", "high", "critical"])
						.optional()
						.describe("Optional task complexity."),
					status: tool.schema
						.enum(["todo", "in_progress", "in_review", "done"])
						.optional()
						.describe("Optional initial status."),
				},
				async execute(args, toolCtx) {
					const commandArgs = ["create", args.title];
					if (args.description) {
						commandArgs.push("--description", args.description);
					}
					if (args.complexity) {
						commandArgs.push("--complexity", args.complexity);
					}
					if (args.status) {
						commandArgs.push("--status", args.status);
					}
					return runTaskCommand(commandArgs, ctx.directory, binaryCheckError, toolCtx.abort);
				},
			}),
			lightsprint_update: tool({
				description: "Update fields on an existing Lightsprint task.",
				args: {
					taskId: tool.schema
						.string()
						.min(1)
						.describe("Task ID to update."),
					title: tool.schema
						.string()
						.optional()
						.describe("Optional updated title."),
					description: tool.schema
						.string()
						.optional()
						.describe("Optional updated description."),
					status: tool.schema
						.enum(["todo", "in_progress", "in_review", "done"])
						.optional()
						.describe("Optional updated status."),
					complexity: tool.schema
						.enum(["trivial", "low", "medium", "high", "critical"])
						.optional()
						.describe("Optional updated complexity."),
					assignee: tool.schema
						.string()
						.optional()
						.describe("Optional assignee display name."),
				},
				async execute(args, toolCtx) {
					const commandArgs = ["update", args.taskId];
					if (args.title) {
						commandArgs.push("--title", args.title);
					}
					if (args.description) {
						commandArgs.push("--description", args.description);
					}
					if (args.status) {
						commandArgs.push("--status", args.status);
					}
					if (args.complexity) {
						commandArgs.push("--complexity", args.complexity);
					}
					if (args.assignee) {
						commandArgs.push("--assignee", args.assignee);
					}
					return runTaskCommand(commandArgs, ctx.directory, binaryCheckError, toolCtx.abort);
				},
			}),
			lightsprint_get: tool({
				description: "Fetch full details for a Lightsprint task.",
				args: {
					taskId: tool.schema
						.string()
						.min(1)
						.describe("Task ID to retrieve."),
				},
				async execute(args, toolCtx) {
					return runTaskCommand(["get", args.taskId], ctx.directory, binaryCheckError, toolCtx.abort);
				},
			}),
			lightsprint_claim: tool({
				description: "Claim a Lightsprint task and set it in progress.",
				args: {
					taskId: tool.schema
						.string()
						.min(1)
						.describe("Task ID to claim."),
				},
				async execute(args, toolCtx) {
					return runTaskCommand(["claim", args.taskId], ctx.directory, binaryCheckError, toolCtx.abort);
				},
			}),
			lightsprint_comment: tool({
				description: "Post a comment on a Lightsprint task.",
				args: {
					taskId: tool.schema
						.string()
						.min(1)
						.describe("Task ID to comment on."),
					body: tool.schema
						.string()
						.min(1)
						.describe("Comment body."),
				},
				async execute(args, toolCtx) {
					return runTaskCommand(["comment", args.taskId, args.body], ctx.directory, binaryCheckError, toolCtx.abort);
				},
			}),
		},
	};
};

export default LightsprintOpenCodePlugin;
