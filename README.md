# Lightsprint Claude Code Plugin

Claude Code plugin for Lightsprint — task management skills, workspace board integration, cloud agent control, and PR automation.

## Prerequisites

- **Claude Code** CLI installed
- **Node.js >= 18** (for built-in `fetch`)
- A **Lightsprint workspace** at [lightsprint.ai](https://lightsprint.ai)

## Quick Start

Install the plugin (one time):

```bash
npx lightsprint
```

Then use any `/lightsprint:` command — the plugin opens your browser to connect on first use:

```
/lightsprint:tasks
```

That's it. The first command auto-prompts for authorization and connects you to a Lightsprint workspace.

---

## Installation

### npx (recommended)

```bash
npx lightsprint
```

### Curl fallback

If you don't have npm/npx available, you can install via curl:

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/install.sh | bash
```

### Non-interactive install

If you're installing from a non-interactive environment (e.g., Claude Code, CI, or a script):

```bash
npx -y lightsprint
```

Or with curl:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/install.sh)" <<< $'Y\nY'
```

The plugin will be installed but the workspace connection step will be skipped. You can connect later by running `/lightsprint:tasks`, which prompts you to authorize and pick a workspace.

---

## Authentication

Authentication is **on-demand** — the first time you use a `/lightsprint:` command without an active connection, the plugin opens your browser to authorize. You pick a Lightsprint workspace, and tokens are saved locally. Tokens refresh automatically.

The active workspace is stored in a single connection file (`~/.lightsprint/connection.json`). All commands (`tasks`, `projects`, `stacks`, `create`, etc.) operate against that connected workspace. Hooks silently skip if no connection exists (they never prompt).

### Switching workspaces

Run `lightsprint connect` again to authorize and switch to a different workspace, or `lightsprint disconnect` to clear the active connection. Use `lightsprint status` / `lightsprint whoami` to see which workspace is currently connected.

### Optional: Custom base URL

For self-hosted Lightsprint instances:

```bash
export LIGHTSPRINT_BASE_URL=https://your-instance.example.com
```

Defaults to `https://app.lightsprint.ai`.

---

## How It Works

### Skills (slash commands)

All skills operate on the connected workspace.

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List tasks from the workspace board. Options: `--status`, `--complexity`, `--assignee`, `--mine`, `--unassigned`, `--deps`, `--project`, `--stack`, `--sort`, `--limit`, `--offset`, `--page-all`, `--output json` |
| `/lightsprint:projects` | List projects in the workspace. Options: `--status active\|completed\|archived` |
| `/lightsprint:create <title>` | Create a new task. Options: `--title`, `--description`, `--status`, `--complexity`, `--assignee`, `--project`, `--stack`, `--parent`, `--depends-on`, `--output json`. Aliases: `create-task`, `new`, `add` |
| `/lightsprint:update <taskId>` | Update a task. Options: `--title`, `--description`, `--status`, `--complexity`, `--assignee`, `--project`, `--requires-schema-change`, `--position`, `--add-dep`, `--remove-dep`, `--output json` |
| `/lightsprint:get <taskId>` | Get full details of a task — title, status, description, todo list, related files, dependencies, dependents, complexity. Options: `--fields` |
| `/lightsprint:claim <taskId>` | Claim a task — sets it to `in_progress`, shows details, and links the Claude Code session |
| `/lightsprint:current-task` | Resolve the task linked to the current session from its PID |
| `/lightsprint:comment <taskId> <text>` | Add a comment to a task |
| `/lightsprint:delete <taskId>` | Permanently delete a task from the workspace board |
| `/lightsprint:link-pr` | Link a GitHub pull request to a task (with `--force` to re-link) |
| `/lightsprint:unlink-pr <taskId>` | Remove a linked pull request from a task |
| `/lightsprint:merge <taskId>` | Merge the PR linked to a task (direct merge or GitHub merge queue) |
| `/lightsprint:agent` | Launch, stop, or check settings for cloud agents (`anthropic`, `cursor`, `codex`) on tasks |
| `/lightsprint:agent-create-pr` | Create a PR from a cloud agent's working branch |
| `/lightsprint:agent-settings` | Check which agent providers are configured and their default models |
| `/lightsprint:ask` | Interact with Codebase Ask threads — list, create, get, messages, send, cancel, delete |
| `/lightsprint:review-hub-signals` | Get PR signals (CI, reviews, comments, deployments) for a task's linked PR |
| `/lightsprint:review-hub-scores` | Get AI review-readiness analysis (score, callouts, suggested actions) for a task's linked PR |

#### Core CLI commands

The plugin also installs a `lightsprint` CLI with the full command surface, consumed by agents and humans alike:

```text
tasks, projects, stacks (get), create, update, get, claim, current-task,
link-pr, unlink-pr, delete, merge, review-hub (scores|signals), agent
(launch|stop|settings|create-pr), ask (list|create|get|messages|send|cancel|delete),
whoami, open, status, connect, disconnect, upgrade, config (get|set|delete|list), describe, help
```

`describe <command>` dumps the accepted parameters, types, and valid enum values for any command, so agents and humans can introspect the CLI at runtime rather than relying on stale docs. All commands accept `--output json` for machine-readable output.

### Auto-linking PRs and task sync

The plugin keeps Claude Code tasks and Lightsprint tasks in sync automatically:

1. `/lightsprint:claim <taskId>` sets the task to `in_progress`, then you create the Claude Code task with `metadata: { lightsprint_task_id: "<LS task ID>" }`.
2. `TaskUpdate` hooks (`cc-event`) stream status changes back to the Lightsprint task.
3. When you create a PR (`gh pr create`), the plugin's `cc-pr-created` hook auto-links it to the task — including `--force` relinking when the PR branch did not follow the `ls/...` convention and was already claimed by another auto-created task.

### CLI internals

- Default output is human-readable text when attached to a TTY, structured JSON otherwise (`--output json` always requests JSON). Errors are JSON on stderr with `error` and `message` fields.
- Inputs are validated hard against hallucinated IDs and enums (`validate.js`): task IDs reject path-traversal/query-param characters, statuses must be in the allowed set, control characters are stripped.
- The `cc-start` / `cc-daemon` / `cc-end` / `cc-event` / `cc-pr-created` hooks are session lifecycle + task sync hooks managed by `hooks/hooks.json`.

---

## Claiming tasks

When you use `/lightsprint:claim`, the plugin:
1. Sets the Lightsprint task to `in_progress`
2. Creates a Claude Code task linked via `metadata: { lightsprint_task_id: "<LS task ID>" }`
3. Subsequent `TaskUpdate` calls on the Claude Code task auto-sync to the correct Lightsprint task

Only **root** tasks (no parent) can be claimed. Subtasks cannot be claimed directly — claim the parent instead.

---

## Plugin Structure

```
lightsprint-claude-code-plugin/
├── .claude-plugin/
│   ├── plugin.json             # Plugin manifest
│   └── marketplace.json        # Marketplace registry entry
├── hooks/
│   └── hooks.json              # Session lifecycle + task sync hooks
├── scripts/
│   ├── lightsprint.js          # Unified CLI entry point (compiled to `lightsprint` binary)
│   ├── ls-cli.js               # Task management commands (exports cliMain)
│   ├── cc-start.js             # SessionStart hook handler
│   ├── cc-daemon.js            # Background daemon for session streaming
│   ├── cc-end.js               # SessionEnd hook handler
│   ├── cc-event.js             # TaskUpdate/Stop/Subagent hook dispatcher
│   ├── cc-pr-created.js        # PostToolUse Bash hook that auto-links PRs
│   ├── compile.sh              # Build script for lightsprint binary
│   ├── install.ps1             # Windows PowerShell installer
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── config.js           # Per-folder token resolution + on-demand auth trigger
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── connection.js       # Active workspace connection (write/read `~/.lightsprint/connection.json`)
│       ├── options.js          # Argument parser for CLI flags
│       ├── output.js          # Human/JSON output helpers
│       ├── task-map.js         # Claude Code ↔ Lightsprint task ID mapping
│       ├── validate.js         # Input hardening for IDs, enums, control chars
│       ├── status-mapper.js    # Status mapping logic
│       └── ...
├── skills/
│   ├── tasks/SKILL.md          # /lightsprint:tasks
│   ├── create/SKILL.md          # /lightsprint:create
│   ├── update/SKILL.md          # /lightsprint:update
│   ├── get/SKILL.md              # /lightsprint:get
│   ├── claim/SKILL.md          # /lightsprint:claim
│   ├── comment/SKILL.md         # /lightsprint:comment
│   ├── delete/SKILL.md           # /lightsprint:delete
│   ├── link-pr/SKILL.md        # /lightsprint:link-pr
│   ├── unlink-pr/SKILL.md      # /lightsprint:unlink-pr
│   ├── merge/SKILL.md          # /lightsprint:merge
│   ├── agent/SKILL.md         # /lightsprint:agent (launch/stop/settings)
│   ├── ask/SKILL.md           # /lightsprint:ask
│   ├── review-hub-scores/SKILL.md  # /lightsprint:review-hub:scores
│   ├── review-hub-signals/SKILL.md # /lightsprint:review-hub:signals
│   └── ... (each skill is a SKILL.md that wraps the CLI)
├── docs/                       # Design notes and LOCAL_TESTING.md
├── .gemini/                    # Gemini Code Assist config
├── pi-extension/              # Extension support
├── install.sh                  # One-line plugin installer
├── uninstall.sh                # Clean removal
├── package.json
└── README.md
```

Zero npm dependencies — uses Node.js built-in `fetch`, `crypto`, and `fs`. (`@sentry/node` is used for error reporting.)

### Local files

| File | Purpose |
|---|---|
| `~/.lightsprint/connection.json` | Active workspace connection — OAuth tokens (access + refresh + expiry) and workspace ID/name |
| `~/.lightsprint/daemon.log` / `~/.lightsprint/sync.log` | Debugging logs for the session-tracking daemon |

---

## Uninstalling

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/uninstall.sh | bash
```

This removes the plugin from Claude Code and clears the active workspace connection in `~/.lightsprint/connection.json`.

---

## Troubleshooting

### Token expired / refresh failed

Run any `/lightsprint:` command — the plugin will re-prompt for authorization if the refresh token has expired.

### Hook not firing

Verify the plugin is loaded:

```bash
claude --debug
```

Check that `hooks/hooks.json` is being picked up and `PostToolUse` matchers are registered.

### Daemon / sync issues

```bash
tail -f ~/.lightsprint/daemon.log ~/.lightsprint/sync.log
```