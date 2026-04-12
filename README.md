# Lightsprint Claude Code Plugin

Claude Code plugin for Lightsprint — task management, plan review, PR tracking, cloud agent orchestration, and repo board integration.

## Prerequisites

- **Claude Code** CLI installed
- **Node.js >= 18** (for built-in `fetch`)
- A **Lightsprint repo** at [lightsprint.ai](https://lightsprint.ai)

## Quick Start

Install the plugin (one time):

```bash
npx lightsprint
```

Then use any `/lightsprint:` command — the plugin opens your browser to connect on first use:

```
/lightsprint:tasks
```

Each new repo folder auto-prompts for authorization when you first use a command there.

---

## Installation

### npx (recommended)

```bash
npx lightsprint
```

### Curl fallback

If you don't have npm/npx available:

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/install.sh | bash
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/scripts/install.ps1 | iex
```

### Non-interactive install

For CI, scripts, or non-interactive environments:

```bash
npx -y lightsprint
```

Or with curl:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/install.sh)" <<< $'Y\nY'
```

The plugin will be installed but the repo connection step will be skipped. Connect later by running `/lightsprint:tasks` inside a git repository.

### Self-hosted / custom base URL

```bash
LIGHTSPRINT_BASE_URL=https://your-instance.example.com npx lightsprint
```

Or set it in your environment:

```bash
export LIGHTSPRINT_BASE_URL=https://your-instance.example.com
```

Defaults to `https://lightsprint.ai`.

---

## Authentication

Authentication is **on-demand** — the first time you use a `/lightsprint:` command in an unconnected folder, the plugin opens your browser to authorize. You pick a Lightsprint repo, and tokens are saved locally. Tokens refresh automatically.

You can also connect or disconnect explicitly:

```bash
lightsprint connect       # Trigger OAuth for the current folder
lightsprint disconnect    # Remove authorization for the current folder
lightsprint whoami        # Show connected user and repo info
```

### Token resolution

The plugin resolves tokens by:

1. Walking up from the current directory (covers monorepos and subdirectories)
2. Falling back to the git main worktree (covers `git worktree` checkouts)
3. If no token found, opening the browser to authorize

A single authorization at your repo root covers all subdirectories and worktrees. Hooks silently skip if no authorization exists (they never prompt).

### Multiple repos

Each folder can connect to a different Lightsprint repo. The plugin prompts automatically when you use a command in a new folder.

---

## How It Works

### Skills (slash commands)

#### Task Management

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List tasks. Flags: `--status backlog\|todo\|in_progress\|in_review\|done`, `--complexity low\|medium\|high`, `--assignee <name>`, `--mine`, `--unassigned`, `--deps has-dependencies\|has-no-dependencies\|has-dependents\|unblocked`, `--project <id>`, `--sort position\|updated_at\|created_at`, `--limit N`, `--offset N`, `--page-all` |
| `/lightsprint:create <title>` | Create a task. Flags: `--description <text>`, `--complexity low\|medium\|high`, `--status <status>`, `--project <id>`, `--depends-on <ids>`, `--parent <taskId>`, `--json-body <json>`, `--dry-run` |
| `/lightsprint:update <id>` | Update a task. Flags: `--title`, `--description`, `--status`, `--complexity`, `--assignee`, `--add-dep <taskId>`, `--remove-dep <taskId>`, `--json-body <json>`, `--dry-run` |
| `/lightsprint:get <id>` | Get full task details — title, status, description, todo list, related files, dependencies, complexity. Supports `--fields` for partial responses. |
| `/lightsprint:claim <id>` | Claim a task — sets it to `in_progress` and returns full details |
| `/lightsprint:delete <id>` | Permanently delete a task |
| `/lightsprint:comment <id> <text>` | Add a comment to a task (max 10,000 chars) |
| `/lightsprint:current-task` | Get the Lightsprint task linked to the current Claude Code session |
| `/lightsprint:projects` | List workspace projects. Flags: `--status active\|completed\|archived` |
| `/lightsprint:create-plan` | Upload a plan (markdown) to Lightsprint. Flags: `--content <markdown>`, `--title <text>`, `--task <taskId>`, `--dry-run` |

#### PR & Review

| Command | Description |
|---|---|
| `/lightsprint:link-pr` | Link a GitHub PR to a task. Flags: `--task <taskId>`, `--pr-url <url>` |
| `/lightsprint:unlink-pr <id>` | Remove the linked PR from a task |
| `/lightsprint:merge <id>` | Merge the GitHub PR linked to a task (supports merge queue) |
| `/lightsprint:review-hub-signals <id>` | Get PR signals (CI, reviews, comments, deployments). Flags: `--refresh` |
| `/lightsprint:review-hub-scores <id>` | Get AI readiness scores for a PR (0–100). Flags: `--refresh` |

#### Cloud Agents

| Command | Description |
|---|---|
| `/lightsprint:agent` | Launch, stop, or inspect cloud agents (anthropic, cursor, codex) |
| `/lightsprint:agent-settings` | Check which cloud agent providers are configured and their default models |
| `/lightsprint:agent-create-pr` | Create a GitHub PR from a completed cloud agent's working branch |

### Global output flags

All commands accept these flags:

| Flag | Description |
|---|---|
| `--output json` | Machine-readable JSON output (default when stdout is not a TTY) |
| `--fields <f1,f2>` | Return only the specified fields (implies `--output json`) |
| `--dry-run` | Validate inputs locally without calling the API (mutating commands only) |

### Command aliases

| Alias | Resolves to |
|---|---|
| `create-task`, `new`, `add` | `create` |
| `show`, `view` | `get` |
| `edit` | `update` |
| `list`, `ls` | `tasks` |
| `remove`, `rm` | `delete` |
| `link` | `link-pr` |
| `unlink` | `unlink-pr` |

### Utility commands

```bash
lightsprint whoami                  # Show connected user, repo, and version
lightsprint status                  # Show plugin status and linked repo
lightsprint open                    # Open the Lightsprint board in your browser
lightsprint connect                 # Trigger OAuth for the current folder
lightsprint disconnect              # Remove authorization for the current folder
lightsprint upgrade                 # Upgrade the CLI to the latest version
lightsprint config get <key>        # Read a preference
lightsprint config set <key> <val>  # Write a preference
lightsprint describe <command>      # Show parameter schema for a command as JSON
```

### Claiming tasks

When you use `/lightsprint:claim`, the plugin:
1. Sets the Lightsprint task to `in_progress`
2. Returns full task details for you to start working
3. After confirming with the user, create a Claude Code task with `metadata: { lightsprint_task_id: "<LS task ID>" }` to link the sessions — subsequent `TaskUpdate` calls sync automatically to Lightsprint

### PR auto-linking

Every time a GitHub PR is created (detected via `gh pr create`), the plugin automatically checks for a linked task and prompts to link the PR. This keeps the team's tracking in sync without manual steps. Behaviour can be configured:

```bash
lightsprint config set link-pr.no-task-behavior always-skip    # Never ask
lightsprint config set link-pr.no-task-behavior always-create  # Always auto-create
lightsprint config set link-pr.no-task-behavior prompt         # Ask each time (default)
```

---

## Plugin Structure

```
lightsprint-claude-code-plugin/
├── hooks/
│   └── hooks.json              # Claude Code hooks (PermissionRequest, SessionStart, etc.)
├── scripts/
│   ├── lightsprint.js          # Unified CLI entry point (compiled to `lightsprint` binary)
│   ├── review-plan.js          # Plan review handler
│   ├── ls-cli.js               # Task management commands
│   ├── cc-daemon.js            # Background sync daemon
│   ├── cc-start.js             # SessionStart hook handler
│   ├── cc-end.js               # SessionEnd hook handler
│   ├── cc-event.js             # General event handler (TaskCreate, TaskUpdate, Stop, etc.)
│   ├── cc-pr-created.js        # PostToolUse Bash hook — detects `gh pr create` output
│   ├── cc-review.js            # PermissionRequest ExitPlanMode handler
│   ├── compile.sh              # Build script for lightsprint binary
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── browser.js          # Cross-platform browser launcher
│       ├── cc-utils.js         # Claude Code session utilities
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── config.js           # Per-folder token resolution + preferences
│       ├── filelock.js         # File-based locking for concurrent access
│       ├── options.js          # Global CLI option parser
│       ├── output.js           # Structured output helpers (JSON / text)
│       ├── plan-tracker.js     # Plan deduplication logic
│       ├── schema.js           # Command schema for `describe` and `--help`
│       ├── sentry.js           # Error reporting
│       ├── status-mapper.js    # Status mapping logic
│       ├── task-map.js         # CC↔LS task ID mapping
│       └── validate.js         # Input validation helpers
├── skills/
│   ├── tasks/SKILL.md
│   ├── create/SKILL.md
│   ├── update/SKILL.md
│   ├── get/SKILL.md
│   ├── claim/SKILL.md
│   ├── comment/SKILL.md
│   ├── delete/SKILL.md
│   ├── current-task/SKILL.md
│   ├── create-plan/SKILL.md
│   ├── link-pr/SKILL.md
│   ├── unlink-pr/SKILL.md
│   ├── merge/SKILL.md
│   ├── projects/SKILL.md
│   ├── review-hub-signals/SKILL.md
│   ├── review-hub-scores/SKILL.md
│   ├── agent/SKILL.md
│   ├── agent-settings/SKILL.md
│   └── agent-create-pr/SKILL.md
├── pi-extension/               # Lightsprint extension for the pi coding agent
├── install.sh                  # macOS/Linux installer
├── scripts/install.ps1         # Windows PowerShell installer
├── uninstall.sh                # Clean removal
├── package.json
└── README.md
```

### Local files

| File | Purpose |
|---|---|
| `~/.lightsprint/repos.json` | Per-folder OAuth tokens (access + refresh + expiry + repo ID) |
| `~/.lightsprint/config.json` | Plugin-level config (e.g. `baseUrl`) |
| `~/.lightsprint/preferences.json` | User preferences (e.g. `link-pr.no-task-behavior`) |
| `~/.lightsprint/daemon.log` | Background daemon log |
| `~/.lightsprint/sync.log` | Sync activity log |

Use `LIGHTSPRINT_CONFIG_DIR` to override the default `~/.lightsprint` directory.

### Hooks registered

| Hook | Trigger | Handler |
|---|---|---|
| `PermissionRequest` (ExitPlanMode) | Before Claude exits plan mode | Plan review |
| `SessionStart` | New Claude Code session | Register session with daemon |
| `SessionEnd` | Session ends | Clean up session state |
| `UserPromptSubmit` | User sends a message | Forward event to daemon |
| `Stop` | Claude stops responding | Forward event to daemon |
| `TaskCompleted` | Claude Code task completed | Forward event to daemon |
| `PostToolUse` (Bash) | After any Bash tool call | Detect `gh pr create` and prompt to link PR |
| `PostToolUse` (TaskCreate) | After a CC task is created | Forward event to daemon |
| `PostToolUse` (TaskUpdate) | After a CC task is updated | Sync status to Lightsprint |
| `SubagentStart` | Subagent spawned | Forward event to daemon |
| `SubagentStop` | Subagent exits | Forward event to daemon |

---

## Pi Extension

A companion extension for the [pi](https://github.com/badlogic/pi-mono) coding agent is included in the `pi-extension/` directory. It wraps the same `lightsprint` CLI and provides native pi tools, commands, and a status bar indicator.

See [`pi-extension/README.md`](pi-extension/README.md) for setup instructions.

---

## Uninstalling

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/uninstall.sh | bash
```

This removes the plugin from Claude Code and deletes the authorization for the current folder. Other folders' authorizations in `~/.lightsprint/repos.json` are preserved.

---

## Troubleshooting

### Token expired / refresh failed

Run any `/lightsprint:` command — the plugin will re-prompt for authorization if the refresh token has expired. You can also run `lightsprint connect` explicitly.

### Hook not firing

Verify the plugin is loaded:

```bash
claude --debug
```

Check that `hooks/hooks.json` is being picked up and the expected hooks are registered.

### Checking logs

```bash
tail -f ~/.lightsprint/daemon.log ~/.lightsprint/sync.log
```

### Upgrade to latest version

```bash
lightsprint upgrade
```
