/**
 * Lightsprint Pi Extension
 *
 * Integrates Lightsprint task management into pi. Equivalent to the
 * Claude Code plugin but built on pi's extension API.
 *
 * Features:
 * - Custom tools for all lightsprint CLI commands (tasks, create, update, get, claim, etc.)
 * - Session lifecycle hooks (daemon start/stop)
 * - Activity event forwarding to the daemon
 * - Plan review integration
 *
 * Requires: `lightsprint` CLI binary on PATH.
 *
 * Install:
 *   Copy this directory to ~/.pi/agent/extensions/lightsprint/
 *   Or add to .pi/extensions/lightsprint/ in your project
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

// ─── Constants ───────────────────────────────────────────────────────────

const LS_CONFIG_DIR = process.env.LIGHTSPRINT_CONFIG_DIR || join(homedir(), ".lightsprint");
const VALID_STATUSES = ["backlog", "todo", "in_progress", "in_review", "done"] as const;
const VALID_COMPLEXITIES = ["low", "medium", "high"] as const;
const VALID_SORT_FIELDS = ["position", "updated_at", "created_at"] as const;
const VALID_DEPS_FILTERS = ["has-dependencies", "has-no-dependencies", "has-dependents", "unblocked"] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Run the lightsprint CLI and return parsed JSON output.
 */
function runLsCli(
  args: string[],
  options: { timeout?: number; signal?: AbortSignal; cwd?: string } = {}
): { success: boolean; data?: any; error?: string } {
  try {
    const result = execFileSync("lightsprint", [...args, "--output", "json"], {
      encoding: "utf-8",
      timeout: options.timeout ?? 30000,
      cwd: options.cwd,
      maxBuffer: 1024 * 1024,
      env: { ...process.env },
    });

    try {
      return { success: true, data: JSON.parse(result.trim()) };
    } catch {
      // Not JSON — return raw text
      return { success: true, data: result.trim() };
    }
  } catch (err: any) {
    const stderr = err.stderr?.toString() || "";
    const stdout = err.stdout?.toString() || "";

    // Try to parse structured error from stderr or stdout
    for (const output of [stderr, stdout]) {
      try {
        const parsed = JSON.parse(output.trim());
        if (parsed.error) {
          return { success: false, error: parsed.message || parsed.error };
        }
      } catch {}
    }

    return {
      success: false,
      error: stderr || stdout || err.message || "Unknown error",
    };
  }
}

/**
 * Format a tool result for the LLM.
 */
function toolResult(result: { success: boolean; data?: any; error?: string }) {
  if (result.success) {
    const text = typeof result.data === "string" ? result.data : JSON.stringify(result.data, null, 2);
    return {
      content: [{ type: "text" as const, text }],
      details: result.data ?? {},
    };
  }
  throw new Error(result.error || "Command failed");
}

/**
 * Read daemon session state for the current session.
 */
function readDaemonState(sessionId: string): { port: number; daemonToken?: string; lsSessionId?: string } | null {
  const statePath = join(LS_CONFIG_DIR, "sessions", `${sessionId}.json`);
  try {
    return JSON.parse(readFileSync(statePath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Send an event to the daemon's local HTTP server.
 */
async function sendDaemonEvent(
  state: { port: number; daemonToken?: string },
  endpoint: string,
  body: any,
  timeoutMs = 3000
): Promise<void> {
  try {
    await fetch(`http://127.0.0.1:${state.port}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(state.daemonToken ? { Authorization: `Bearer ${state.daemonToken}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // Daemon may be busy or dead — never block pi
  }
}

// ─── Extension Entry Point ──────────────────────────────────────────────

export default function lightsprintExtension(pi: ExtensionAPI) {
  // Track the pi session → lightsprint session mapping
  let piSessionId: string | null = null;
  let daemonState: { port: number; daemonToken?: string; lsSessionId?: string } | null = null;

  // ─── Session Lifecycle ───────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    // Generate a stable session ID for this pi session
    piSessionId = `pi-${randomBytes(8).toString("hex")}`;

    // Check if lightsprint is configured for this repo
    const statusResult = runLsCli(["status"], { cwd: ctx.cwd });
    if (statusResult.success && statusResult.data?.connected) {
      const repoLabel = statusResult.data.repoName || statusResult.data.repo || "";
      ctx.ui.notify(`Connected to Lightsprint: ${repoLabel}`, "info");
      ctx.ui.setStatus("lightsprint", `LS: ${repoLabel || "connected"}`);
    }

    // Try to discover any running daemon (from a parallel Claude Code session)
    if (piSessionId) {
      daemonState = readDaemonState(piSessionId);
    }
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    // Tell daemon to shut down
    if (daemonState) {
      await sendDaemonEvent(daemonState, "/session-end", {});
    }
  });

  // ─── Activity Event Forwarding ───────────────────────────────────────

  // Forward tool execution events to daemon
  pi.on("tool_execution_end", async (event, _ctx) => {
    if (!daemonState) return;

    await sendDaemonEvent(daemonState, "/event", {
      eventType: "PostToolUse",
      payload: {
        tool_name: event.toolName,
        tool_call_id: event.toolCallId,
      },
    });
  });

  // Forward turn events as activity signals
  pi.on("turn_start", async (_event, _ctx) => {
    if (!daemonState) return;
    await sendDaemonEvent(daemonState, "/event", {
      eventType: "UserPromptSubmit",
      payload: {},
    });
  });

  pi.on("turn_end", async (_event, _ctx) => {
    if (!daemonState) return;
    await sendDaemonEvent(daemonState, "/event", {
      eventType: "TaskCompleted",
      payload: {},
    });
  });

  // ─── Custom Tools ────────────────────────────────────────────────────

  // --- lightsprint_tasks ---
  pi.registerTool({
    name: "lightsprint_tasks",
    label: "Lightsprint Tasks",
    description:
      "List tasks from the Lightsprint repo board. Returns task IDs, titles, statuses, assignees, and complexity.",
    promptSnippet: "List Lightsprint tasks with filtering by status, assignee, complexity, dependencies",
    promptGuidelines: [
      "Use lightsprint_tasks to see available work before starting on a task.",
      "After reviewing tasks, use lightsprint_claim to claim a task, or lightsprint_get for full details.",
    ],
    parameters: Type.Object({
      status: Type.Optional(
        Type.String({
          description:
            "Filter by status (comma-separated): backlog, todo, in_progress, in_review, done",
        })
      ),
      complexity: Type.Optional(
        StringEnum([...VALID_COMPLEXITIES], {
          description: "Filter by complexity: low, medium, high",
        })
      ),
      assignee: Type.Optional(Type.String({ description: "Filter by assignee name/email" })),
      mine: Type.Optional(Type.Boolean({ description: "Show only tasks assigned to me" })),
      unassigned: Type.Optional(Type.Boolean({ description: "Show only unassigned tasks" })),
      deps: Type.Optional(
        StringEnum([...VALID_DEPS_FILTERS], {
          description: "Filter by dependencies: has-dependencies, has-dependents, unblocked",
        })
      ),
      sort: Type.Optional(
        StringEnum([...VALID_SORT_FIELDS], {
          description: "Sort by: position (default), updated_at, created_at",
        })
      ),
      limit: Type.Optional(Type.Number({ description: "Max results (default: 20)" })),
      offset: Type.Optional(Type.Number({ description: "Skip first N results" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const args: string[] = ["tasks"];
      if (params.status) args.push("--status", params.status);
      if (params.complexity) args.push("--complexity", params.complexity);
      if (params.assignee) args.push("--assignee", params.assignee);
      if (params.mine) args.push("--mine");
      if (params.unassigned) args.push("--unassigned");
      if (params.deps) args.push("--deps", params.deps);
      if (params.sort) args.push("--sort", params.sort);
      if (params.limit != null) args.push("--limit", String(params.limit));
      if (params.offset != null) args.push("--offset", String(params.offset));
      return toolResult(runLsCli(args, { cwd: ctx.cwd }));
    },
  });

  // --- lightsprint_get ---
  pi.registerTool({
    name: "lightsprint_get",
    label: "Lightsprint Get Task",
    description:
      "Get full details of a Lightsprint task including title, status, description, todo list, dependencies, and related files.",
    promptSnippet: "Get full details of a Lightsprint task by ID",
    promptGuidelines: [
      "Always use lightsprint_get before lightsprint_update to confirm current task state.",
      "Task IDs can be display IDs (e.g. LIG-024), bare numbers (e.g. 24), or raw IDs.",
    ],
    parameters: Type.Object({
      task: Type.String({ description: "Task ID — display ID (e.g. LIG-024), bare number, or raw ID" }),
      fields: Type.Optional(
        Type.String({ description: "Comma-separated fields to return (e.g. task,dependencies)" })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const args = ["get", "--task", params.task];
      if (params.fields) args.push("--fields", params.fields);
      return toolResult(runLsCli(args, { cwd: ctx.cwd }));
    },
  });

  // --- lightsprint_create ---
  pi.registerTool({
    name: "lightsprint_create",
    label: "Lightsprint Create Task",
    description: "Create a new task on the Lightsprint repo board.",
    promptSnippet: "Create a new Lightsprint task with title, description, complexity, status",
    promptGuidelines: [
      "After creating a task, the returned ID can be used to link it via task metadata.",
    ],
    parameters: Type.Object({
      title: Type.String({ description: "Task title (max 500 chars)" }),
      description: Type.Optional(Type.String({ description: "Task description (max 50000 chars)" })),
      complexity: Type.Optional(
        StringEnum([...VALID_COMPLEXITIES], { description: "Complexity: low, medium, high" })
      ),
      status: Type.Optional(
        StringEnum([...VALID_STATUSES], {
          description: "Initial status (default: backlog)",
        })
      ),
      depends_on: Type.Optional(
        Type.String({ description: "Comma-separated task IDs this task depends on" })
      ),
      parent: Type.Optional(
        Type.String({ description: "Parent task ID — links new task as subtask" })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const args = ["create", "--title", params.title];
      if (params.description) args.push("--description", params.description);
      if (params.complexity) args.push("--complexity", params.complexity);
      if (params.status) args.push("--status", params.status);
      if (params.depends_on) args.push("--depends-on", params.depends_on);
      if (params.parent) args.push("--parent", params.parent);
      return toolResult(runLsCli(args, { cwd: ctx.cwd }));
    },
  });

  // --- lightsprint_update ---
  pi.registerTool({
    name: "lightsprint_update",
    label: "Lightsprint Update Task",
    description: "Update an existing Lightsprint task. Change title, description, status, complexity, assignee, or dependencies.",
    promptSnippet: "Update a Lightsprint task's fields or dependencies",
    promptGuidelines: [
      "Always use lightsprint_get before lightsprint_update to confirm current state.",
      "Prefer lightsprint_claim over updating status to in_progress — claim also assigns and links the session.",
    ],
    parameters: Type.Object({
      task: Type.String({ description: "Task ID to update" }),
      title: Type.Optional(Type.String({ description: "New title (max 500 chars)" })),
      description: Type.Optional(Type.String({ description: "New description" })),
      status: Type.Optional(
        StringEnum([...VALID_STATUSES], { description: "New status" })
      ),
      complexity: Type.Optional(
        StringEnum([...VALID_COMPLEXITIES], { description: "New complexity" })
      ),
      assignee: Type.Optional(Type.String({ description: "Assign to team member by name" })),
      position: Type.Optional(Type.Integer({ minimum: 0, description: "New position within section (0-based)" })),
      add_dep: Type.Optional(
        Type.Array(Type.String(), { description: "Task IDs to add as dependencies" })
      ),
      remove_dep: Type.Optional(
        Type.Array(Type.String(), { description: "Task IDs to remove from dependencies" })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const args = ["update", "--task", params.task];
      if (params.title) args.push("--title", params.title);
      if (params.description) args.push("--description", params.description);
      if (params.status) args.push("--status", params.status);
      if (params.complexity) args.push("--complexity", params.complexity);
      if (params.assignee) args.push("--assignee", params.assignee);
      if (params.position !== undefined) args.push("--position", String(params.position));
      if (params.add_dep) {
        for (const dep of params.add_dep) args.push("--add-dep", dep);
      }
      if (params.remove_dep) {
        for (const dep of params.remove_dep) args.push("--remove-dep", dep);
      }
      return toolResult(runLsCli(args, { cwd: ctx.cwd }));
    },
  });

  // --- lightsprint_claim ---
  pi.registerTool({
    name: "lightsprint_claim",
    label: "Lightsprint Claim Task",
    description:
      "Claim a Lightsprint task — sets status to in_progress, assigns to you, and links the current session. Only root tasks can be claimed.",
    promptSnippet: "Claim a Lightsprint task to start working on it",
    promptGuidelines: [
      "After claiming, show the task details and ask the user before starting work.",
      "Only root tasks (no parent) can be claimed. Subtasks cannot be claimed directly.",
    ],
    parameters: Type.Object({
      task: Type.String({ description: "Task ID to claim" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return toolResult(runLsCli(["claim", "--task", params.task], { cwd: ctx.cwd }));
    },
  });

  // --- lightsprint_comment ---
  pi.registerTool({
    name: "lightsprint_comment",
    label: "Lightsprint Comment",
    description: "Add a comment to a Lightsprint task. Visible to the whole team.",
    promptSnippet: "Add a comment to a Lightsprint task",
    promptGuidelines: ["Keep comment bodies under 2000 characters."],
    parameters: Type.Object({
      task: Type.String({ description: "Task ID to comment on" }),
      body: Type.String({ description: "Comment text (max 10000 chars)" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return toolResult(
        runLsCli(["comment", "--task", params.task, "--body", params.body], { cwd: ctx.cwd })
      );
    },
  });

  // --- lightsprint_current_task ---
  pi.registerTool({
    name: "lightsprint_current_task",
    label: "Lightsprint Current Task",
    description:
      "Get the Lightsprint task linked to the current session. No arguments needed — discovered automatically.",
    promptSnippet: "Get the Lightsprint task linked to this session",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      return toolResult(runLsCli(["current-task"], { cwd: ctx.cwd }));
    },
  });

  // --- lightsprint_link_pr ---
  pi.registerTool({
    name: "lightsprint_link_pr",
    label: "Lightsprint Link PR",
    description:
      "Link a GitHub pull request to a Lightsprint task. Sets the task to in_review and triggers automated PR review.",
    promptSnippet: "Link a GitHub PR to a Lightsprint task",
    promptGuidelines: [
      "CRITICAL: Every time you create a GitHub PR, you MUST immediately link it.",
      "First run lightsprint_current_task to find the linked task, then link the PR.",
      "If no task is found, ask the user how to proceed (create new, link existing, or skip).",
    ],
    parameters: Type.Object({
      task: Type.String({ description: "Task ID to link the PR to" }),
      pr_url: Type.String({
        description: "Full GitHub PR URL (e.g. https://github.com/owner/repo/pull/123)",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return toolResult(
        runLsCli(["link-pr", "--task", params.task, "--pr-url", params.pr_url], { cwd: ctx.cwd })
      );
    },
  });

  // --- lightsprint_unlink_pr ---
  pi.registerTool({
    name: "lightsprint_unlink_pr",
    label: "Lightsprint Unlink PR",
    description: "Remove a linked GitHub pull request from a Lightsprint task.",
    promptSnippet: "Remove a linked PR from a Lightsprint task",
    parameters: Type.Object({
      task: Type.String({ description: "Task ID to unlink the PR from" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return toolResult(runLsCli(["unlink-pr", "--task", params.task], { cwd: ctx.cwd }));
    },
  });

  // --- lightsprint_whoami ---
  pi.registerTool({
    name: "lightsprint_whoami",
    label: "Lightsprint Whoami",
    description: "Show current Lightsprint user and repo info.",
    promptSnippet: "Show current Lightsprint user and repo info",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      return toolResult(runLsCli(["whoami"], { cwd: ctx.cwd }));
    },
  });

  // --- lightsprint_config ---
  pi.registerTool({
    name: "lightsprint_config",
    label: "Lightsprint Config",
    description: "Manage Lightsprint user preferences. Subcommands: get, set, delete, list.",
    promptSnippet: "Manage Lightsprint user preferences",
    parameters: Type.Object({
      action: StringEnum(["get", "set", "delete", "list"] as const, {
        description: "Config action",
      }),
      key: Type.Optional(Type.String({ description: "Preference key" })),
      value: Type.Optional(Type.String({ description: "Preference value (for set)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const args = ["config", params.action];
      if (params.key) args.push(params.key);
      if (params.value) args.push(params.value);
      return toolResult(runLsCli(args, { cwd: ctx.cwd }));
    },
  });

  // ─── Commands ────────────────────────────────────────────────────────

  // /lightsprint-status — quick connection check
  pi.registerCommand("lightsprint-status", {
    description: "Show Lightsprint connection status",
    handler: async (_args, ctx) => {
      const result = runLsCli(["status"], { cwd: ctx.cwd });
      if (result.success && result.data?.connected) {
        ctx.ui.notify(
          `Lightsprint: ${result.data.repoName || result.data.repo || "connected"} (${result.data.baseUrl})`,
          "success"
        );
      } else {
        ctx.ui.notify("Not connected to Lightsprint. Run `lightsprint connect` in your terminal.", "warning");
      }
    },
  });

  // /lightsprint-connect — initiate auth flow
  pi.registerCommand("lightsprint-connect", {
    description: "Connect to Lightsprint (opens browser for auth)",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Starting Lightsprint authentication...", "info");
      const result = runLsCli(["connect"], { cwd: ctx.cwd, timeout: 120000 });
      if (result.success) {
        ctx.ui.notify("Connected to Lightsprint!", "success");
      } else {
        ctx.ui.notify(`Connection failed: ${result.error}`, "error");
      }
    },
  });

  // /lightsprint-open — open board in browser
  pi.registerCommand("lightsprint-open", {
    description: "Open the Lightsprint repo board in your browser",
    handler: async (_args, ctx) => {
      const result = runLsCli(["open"], { cwd: ctx.cwd });
      if (result.success) {
        ctx.ui.notify(`Opened: ${result.data?.url || "Lightsprint board"}`, "info");
      } else {
        ctx.ui.notify(`Failed: ${result.error}`, "error");
      }
    },
  });

  // /lightsprint-upgrade — upgrade CLI
  pi.registerCommand("lightsprint-upgrade", {
    description: "Upgrade Lightsprint CLI to latest version",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Checking for updates...", "info");
      const result = runLsCli(["upgrade"], { cwd: ctx.cwd, timeout: 60000 });
      if (result.success) {
        if (result.data?.upgraded) {
          ctx.ui.notify(`Upgraded: v${result.data.from} → v${result.data.to}`, "success");
        } else {
          ctx.ui.notify(`Already up to date (v${result.data?.latest || "?"})`, "info");
        }
      } else {
        ctx.ui.notify(`Upgrade failed: ${result.error}`, "error");
      }
    },
  });

  // ─── PR Detection (tool_result hook) ─────────────────────────────────

  const PR_URL_RE = /https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/;

  pi.on("tool_result", async (event, ctx) => {
    // Detect gh pr create output in bash tool results
    if (event.toolName !== "bash") return;

    const input = event.input as { command?: string };
    const command = input?.command || "";
    if (!command.includes("gh pr create")) return;

    // Check if the output contains a PR URL
    const outputText =
      event.content
        ?.filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n") || "";

    const prMatch = outputText.match(PR_URL_RE);
    if (!prMatch) return;

    const prUrl = prMatch[0];

    // Inject a message telling the LLM to link the PR
    return {
      content: [
        ...event.content,
        {
          type: "text" as const,
          text: `\n\n[Lightsprint] A GitHub PR was created: ${prUrl}\n\nIMPORTANT: You MUST now link this PR to a Lightsprint task:\n1. Use lightsprint_current_task to find the linked task\n2. If found, use lightsprint_link_pr to link the PR\n3. If no task found, ask the user how to proceed`,
        },
      ],
    };
  });

  // ─── Keyboard Shortcut ───────────────────────────────────────────────

  pi.registerShortcut("ctrl+shift+l", {
    description: "Open Lightsprint board in browser",
    handler: async (ctx) => {
      runLsCli(["open"], { cwd: ctx.cwd });
      ctx.ui.notify("Opening Lightsprint board...", "info");
    },
  });
}
