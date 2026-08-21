# Lightsprint Claude Code Plugin

Claude Code plugin for Lightsprint — task management skills and workspace board integration.

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

All skills operate on the connected workspace. The full set of `/lightsprint:` commands is:

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List tasks from the workspace board. Options: `--status backlog\|todo\|in_progress\|in_review\|done`, `--stack <ref>`, `--limit N` |
| `/lightsprint:create <title>` | Create a new task. Options: `--description <text>`, `--complexity low\|medium\|high`, `--status backlog\|todo\|in_progress\|in_review\|done`, `--stack <ref>` |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, dependencies, complexity |
| `/lightsprint:update <id>` | Update a task. Options: `--title <text>`, `--description <text>`, `--status <status>`, `--complexity <level>`, `--requires-schema-change <bool>`, `--assignee <name>`, `--position <n>`, `--dependencies <ids>` |
| `/lightsprint:claim <id>` | Claim a task — sets it to in_progress and shows full details |
| `/lightsprint:current-task` | Get the task linked to the current Claude Code session (auto-discovers via session PID) |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:projects` | List projects in the workspace |
| `/lightsprint:delete <id>` | Permanently delete a task from the workspace board |
| `/lightsprint:link-pr` | Link a GitHub PR to a task. Options: `--task <taskId>`, `--pr-url <prUrl>`, `--force` |
| `/lightsprint:unlink-pr <id> [prId]` | Remove a linked GitHub pull request from a task |
| `/lightsprint:merge <id>` | Merge the GitHub PR linked to a task (supports direct merge and merge queue) |
| `/lightsprint:agent <id> [launch\|stop\|settings]` | Launch, stop, or inspect settings for cloud agents (anthropic, cursor, codex) |
| `/lightsprint:agent-create-pr <id>` | Create a GitHub PR from a cloud agent's working branch |
| `/lightsprint:agent-settings` | Check which cloud agent providers are configured and their default models |
| `/lightsprint:review-hub-scores <id>` | Get AI readiness analysis (score, summaries, callouts, suggested actions) for a task's linked PR |
| `/lightsprint:review-hub-signals <id>` | Get PR signals (CI checks, reviews, comments, deployments) for a task's linked PR |
| `/lightsprint:ask [list\|create\|get\|messages\|cancel\|delete]` | Interact with Codebase Ask threads — read-only Q&A over every repo in a stack. Send a message via `ask messages --content <text>`. Options: `--stack <ref>`, `--title <text>`, `--limit N`, `--offset N`, `--content <text>`, `--last N` |

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
│   └── hooks.json              # Session lifecycle + task sync hooks
├── scripts/
│   ├── lightsprint.js          # Unified CLI entry point (compiled to `lightsprint` binary)
│   ├── ls-cli.js               # Task management commands (exports cliMain)
│   ├── compile.sh              # Build script for lightsprint binary
│   ├── cc-daemon.js            # Background sync daemon (task ↔ board)
│   ├── cc-start.js             # SessionStart hook
│   ├── cc-end.js               # SessionEnd hook
│   ├── cc-event.js             # UserPromptSubmit / Stop hook
│   ├── cc-pr-created.js        # TaskCompleted / PR created hook
│   ├── install.sh / install.ps1# Cross-platform installers
│   ├── uninstall.sh            # Clean removal
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── browser.js          # Browser open/launch helpers
│       ├── cc-utils.js         # Claude Code session helpers
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── config.js           # Per-folder token resolution + on-demand auth trigger
│       ├── connection.js       # Connection file + workspace resolution
│       ├── filelock.js         # Cross-process file locking
│       ├── options.js          # CLI flag parsing
│       ├── output.js           # Human / JSON output formatting
│       ├── schema.js           # Enums & validation rules
│       ├── sentry.js           # Error reporting
│       ├── status-mapper.js    # Status mapping logic
│       ├── task-map.js         # CC↔LS task ID mapping
│       └── validate.js         # Input validation helpers
├── skills/                     # One directory per /lightsprint: skill
│   ├── agent/                  # /lightsprint:agent (launch/stop/settings)
│   ├── agent-create-pr/        # /lightsprint:agent-create-pr
│   ├── agent-settings/         # /lightsprint:agent-settings
│   ├── ask/                    # /lightsprint:ask (Codebase Ask threads)
│   ├── claim/                  # /lightsprint:claim
│   ├── comment/                # /lightsprint:comment
│   ├── create/                 # /lightsprint:create
│   ├── current-task/           # /lightsprint:current-task
│   ├── delete/                 # /lightsprint:delete
│   ├── get/                    # /lightsprint:get
│   ├── link-pr/                # /lightsprint:link-pr
│   ├── merge/                  # /lightsprint:merge
│   ├── projects/               # /lightsprint:projects
│   ├── review-hub-scores/      # /lightsprint:review-hub-scores
│   ├── review-hub-signals/     # /lightsprint:review-hub-signals
│   ├── tasks/                  # /lightsprint:tasks
│   ├── unlink-pr/              # /lightsprint:unlink-pr
│   └── update/                 # /lightsprint:update
├── install.sh                  # One-line plugin installer
├── uninstall.sh                # Clean removal
├── package.json
└── README.md
```

Zero npm dependencies — uses Node.js built-in `fetch`, `crypto`, and `fs`.

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

Check that `hooks/hooks.json` is being picked up and `PostToolUse` matchers are registered.
