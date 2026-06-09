# Lightsprint Claude Code Plugin

Claude Code plugin for Lightsprint — task management, plan review, cloud agents, PR linking, and workspace board integration.

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

Defaults to `https://lightsprint.ai`.

---

## How It Works

### Skills (slash commands)

All skills operate on the connected workspace.

**Task management**

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List tasks from the workspace board. Options: `--status backlog\|todo\|in_progress\|in_review\|done`, `--stack <ref>`, `--limit N` |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, dependencies, complexity |
| `/lightsprint:create <title>` | Create a new task. Options: `--description <text>`, `--complexity low\|medium\|high`, `--status backlog\|todo\|in_progress\|in_review\|done`, `--stack <ref>` |
| `/lightsprint:update <id>` | Update a task. Options: `--title <text>`, `--description <text>`, `--status <status>`, `--complexity <level>`, `--assignee <name>`, `--position`, `--dependencies` |
| `/lightsprint:delete <id>` | Delete a task permanently from the board |
| `/lightsprint:claim <id>` | Claim a task — sets it to in_progress and shows full details |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:current-task` | Get the task linked to the current Claude Code session (auto-discovered via session PID) |
| `/lightsprint:projects` | List projects in the workspace |
| `/lightsprint:create-plan` | Upload an implementation plan / design doc from markdown for team review |

**Cloud agents**

| Command | Description |
|---|---|
| `/lightsprint:agent` | Launch, stop, or check settings for cloud agents on a task (anthropic, cursor, codex providers) |
| `/lightsprint:agent-settings` | Check which agent providers are configured and their default models |
| `/lightsprint:agent-create-pr` | Create a GitHub PR from a cloud agent's working branch |

**Pull requests & review hub**

| Command | Description |
|---|---|
| `/lightsprint:link-pr <id> <pr>` | Link a GitHub PR to a task |
| `/lightsprint:unlink-pr <id>` | Remove a linked PR from a task |
| `/lightsprint:merge <id>` | Merge the PR linked to a task (direct merge or merge queue) |
| `/lightsprint:review-hub-scores <id>` | Get AI readiness analysis (score, summaries, callouts, suggested actions) for a task's PR |
| `/lightsprint:review-hub-signals <id>` | Get PR signals (CI checks, reviews, comments, deployments) for a task's PR |

Stacks group tasks within a workspace. List them with `lightsprint stacks`, inspect one with `lightsprint stacks get <stackId|prefix|name>`, and target a stack on `tasks`/`create` via `--stack <ref>`.

### Claiming tasks

When you use `/lightsprint:claim`, the plugin:
1. Sets the Lightsprint task to `in_progress`
2. Creates a Claude Code task linked via `metadata: { lightsprint_task_id: "<LS task ID>" }`
3. Subsequent `TaskUpdate` calls on the Claude Code task automatically sync to the correct Lightsprint task

---

## Plugin Structure

```
lightsprint-claude-code-plugin/
├── .claude-plugin/
│   ├── plugin.json             # Plugin manifest
│   └── marketplace.json        # Marketplace registry entry
├── hooks/
│   └── hooks.json              # Lifecycle hooks (plan review, session tracking, PR detection)
├── scripts/
│   ├── lightsprint.js          # Unified CLI entry point (compiled to `lightsprint` binary)
│   ├── ls-cli.js               # Task management commands (exports cliMain)
│   ├── review-plan.js          # Plan review handler (exports reviewPlanMain)
│   ├── cc-start.js             # SessionStart hook — connect + start tracking
│   ├── cc-end.js               # SessionEnd hook — flush + stop tracking
│   ├── cc-event.js             # Activity/lifecycle event reporter
│   ├── cc-review.js            # ExitPlanMode plan-review hook
│   ├── cc-pr-created.js        # Detects `gh pr create` and links the PR
│   ├── cc-daemon.js            # Background sync daemon
│   ├── compile.sh              # Build script for lightsprint binary
│   └── lib/                    # auth, client, config, connection, task-map,
│                               #   status-mapper, validate, output, schema, sentry, …
├── skills/                     # One SKILL.md per /lightsprint: command (see table above)
├── install.sh                  # One-line plugin installer
├── uninstall.sh                # Clean removal
├── package.json
└── README.md
```

Runtime dependencies are minimal — Node.js built-ins (`fetch`, `crypto`, `fs`) plus `@sentry/node` for error reporting. The CLI is compiled to a self-contained `lightsprint` binary with Bun.

### Local files

| File | Purpose |
|---|---|
| `~/.lightsprint/connection.json` | Active workspace connection — OAuth tokens (access + refresh + expiry) and workspace ID/name |
| `~/.lightsprint/active-task.json` | Currently in-progress task |

---

## Uninstalling

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/uninstall.sh | bash
```

This removes the plugin from Claude Code and clears the active workspace connection in `~/.lightsprint/connection.json`.

---

## Troubleshooting

### Token expired / refresh failed

Use any `/lightsprint:` command — the plugin will re-prompt for authorization if the refresh token has expired.

### Hook not firing

Verify the plugin is loaded:

```bash
claude --debug
```

Check that `hooks/hooks.json` is being picked up and the hook matchers are registered. The plugin registers `PermissionRequest` (plan review on `ExitPlanMode`), `SessionStart`/`SessionEnd`, `UserPromptSubmit`, `Stop`, and `PostToolUse` hooks (PR detection on `Bash`, task sync on `TaskCreate`/`TaskUpdate`).
