# Lightsprint Claude Code Plugin

Claude Code plugin for Lightsprint — task management skills, plan review, session tracking, and repo board integration.

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

That's it. Each new repo folder auto-prompts for authorization when you first use a command there.

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

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/scripts/install.ps1 | iex
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

The plugin will be installed but the repo connection step will be skipped. You can connect later by running `lightsprint connect` or `/lightsprint:tasks` inside a git repository.

---

## Authentication

Authentication is **on-demand** — the first time you use a `/lightsprint:` command in an unconnected folder, the plugin opens your browser to authorize. You pick a Lightsprint repo, and tokens are saved locally. Tokens refresh automatically.

You can also authenticate explicitly:

```bash
lightsprint connect
```

For a custom Lightsprint instance:

```bash
lightsprint connect --base-url https://your-instance.example.com
```

### Token resolution

The plugin resolves tokens by:

1. Walking up from the current directory (covers monorepos and subdirectories)
2. Falling back to the git main worktree (covers `git worktree` checkouts)
3. If no token found, opening the browser to authorize

A single authorization at your repo root works for all subdirectories and worktrees. Hooks silently skip if no authorization exists (they never prompt).

### Multiple repos

Each folder can connect to a different Lightsprint repo. The plugin prompts automatically when you use a command in a new folder.

### Optional: Custom base URL

For self-hosted Lightsprint instances:

```bash
export LIGHTSPRINT_BASE_URL=https://your-instance.example.com
```

Defaults to `https://lightsprint.ai`.

---

## How It Works

### Skills (slash commands)

All commands support `--output json` for machine-readable output and `--dry-run` for mutating operations. Global flags:

| Flag | Description |
|---|---|
| `--output json\|text` | Output format (default: text). JSON is stable and machine-readable. |
| `--json` | Shorthand for `--output json` |
| `--dry-run` | Validate inputs without making API calls (`create`, `update`, `claim`, `comment`, `merge`) |
| `--fields f1,f2` | Return only specified fields (implies `--output json`) |

#### Task management

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List tasks from the board. Options: `--status backlog\|todo\|in_progress\|in_review\|done` (comma-separated), `--complexity low\|medium\|high`, `--assignee <name>`, `--mine`, `--unassigned`, `--deps has-dependencies\|has-no-dependencies\|has-dependents\|unblocked`, `--project <id\|none>`, `--sort position\|updated_at\|created_at`, `--limit N`, `--offset N`, `--page-all` (NDJSON stream) |
| `/lightsprint:create <title>` | Create a new task. Options: `--description <text>`, `--complexity low\|medium\|high`, `--status backlog\|todo\|in_progress\|in_review\|done`, `--project <id>`, `--depends-on <ids>`, `--parent <taskId>`, `--json-body <json>` |
| `/lightsprint:update <id>` | Update a task. Options: `--title <text>`, `--description <text>`, `--status <status>`, `--complexity <level>`, `--assignee <name>`, `--project <id>`, `--add-dep <taskId>`, `--remove-dep <taskId>`, `--json-body <json>` |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, dependencies, complexity. Supports `--fields task,dependencies,dependents` |
| `/lightsprint:claim <id>` | Claim a task — sets it to `in_progress` and shows full details |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:delete <id>` | Permanently delete a task |
| `/lightsprint:current-task` | Get the Lightsprint task linked to the current Claude Code session |
| `/lightsprint:projects` | List projects in the workspace. Options: `--status active\|completed\|archived` |

#### Pull request workflow

| Command | Description |
|---|---|
| `/lightsprint:link-pr` | Link a GitHub PR to a task (`--task <id> --pr-url <url>`). Sets task to `in_review` and triggers automated review. |
| `/lightsprint:unlink-pr <id>` | Remove a linked PR from a task |
| `/lightsprint:merge <id>` | Merge the GitHub PR linked to a task. Supports direct merge and merge queue. |

#### Review Hub

| Command | Description |
|---|---|
| `/lightsprint:review-hub-signals <id>` | Get PR signals (CI checks, reviews, deployments, comments). Use `--refresh` to re-fetch from GitHub. |
| `/lightsprint:review-hub-scores <id>` | Get AI readiness analysis (score 0–100, summaries, callouts, suggested actions). Use `--refresh` to trigger fresh analysis (consumes credits). |

#### Plan management

| Command | Description |
|---|---|
| `/lightsprint:create-plan` | Upload a markdown plan to Lightsprint for team visibility and review (`--content <markdown>`, `--title <text>`, `--task <id>`) |

#### Cloud agents

| Command | Description |
|---|---|
| `/lightsprint:agent` | Launch, stop, or configure cloud agents (Anthropic, Cursor, Codex). Subcommands: `launch`, `stop`, `settings`, `create-pr` |

---

### Claiming tasks

When you use `/lightsprint:claim`, the plugin:
1. Sets the Lightsprint task to `in_progress`
2. Shows full task details (description, todo list, related files, dependencies)
3. If you confirm you want to start working, create a Claude Code task with:
   ```
   metadata: { lightsprint_task_id: "<LS task ID>" }
   ```
4. Subsequent `TaskUpdate` calls on the Claude Code task automatically sync to the correct Lightsprint task

---

### Hooks

The plugin registers the following Claude Code lifecycle hooks:

| Hook | Event | What it does |
|---|---|---|
| `PermissionRequest` | `ExitPlanMode` | Intercepts plan mode exit, uploads plan to Lightsprint, opens browser for team review, blocks until approved/rejected |
| `SessionStart` | — | Spawns the background daemon, connects to Lightsprint via WebSocket, registers session |
| `SessionEnd` | — | Signals the daemon to send `session:end` and clean up |
| `UserPromptSubmit` | — | Sends prompt event to daemon for session activity tracking |
| `Stop` | — | Sends stop event to daemon |
| `TaskCompleted` | — | Syncs Claude Code task completion to Lightsprint |
| `PostToolUse` | `Bash` | Detects `gh pr create` output and auto-links new PRs to the current task |
| `PostToolUse` | `TaskCreate` | Syncs new Claude Code tasks to Lightsprint |
| `PostToolUse` | `TaskUpdate` | Syncs task status changes to Lightsprint |
| `SubagentStart` | — | Tracks subagent spawning for session telemetry |
| `SubagentStop` | — | Tracks subagent completion for session telemetry |

---

## CLI Reference

The `lightsprint` binary is also usable directly from the terminal. All skill commands are available as CLI subcommands:

```bash
# Task management
lightsprint tasks --status todo,in_progress --mine
lightsprint create "Fix login bug" --description "..." --complexity high
lightsprint update LIG-024 --status done
lightsprint get LIG-024 --output json
lightsprint claim LIG-024
lightsprint comment LIG-024 "Implemented — see PR"
lightsprint delete LIG-024
lightsprint current-task
lightsprint projects --status active

# PR workflow
lightsprint link-pr --task LIG-024 --pr-url https://github.com/owner/repo/pull/123
lightsprint unlink-pr LIG-024
lightsprint merge LIG-024

# Review Hub
lightsprint review-hub signals LIG-024
lightsprint review-hub scores LIG-024 --refresh

# Plans
lightsprint create-plan --content "## Plan\n\n1. Do X\n2. Do Y" --task LIG-024

# Cloud agents
lightsprint agent settings --output json
lightsprint agent launch --task LIG-024 --provider anthropic --output json
lightsprint agent stop --task LIG-024 --provider anthropic
lightsprint agent create-pr --task LIG-024 --provider anthropic --agent-id abc123

# Connection & auth
lightsprint connect
lightsprint connect --base-url https://staging.lightsprint.ai
lightsprint disconnect
lightsprint whoami
lightsprint status
lightsprint open   # opens repo board in browser

# Config / preferences
lightsprint config set link-pr.no-task-behavior always-skip
lightsprint config get link-pr.no-task-behavior
lightsprint config list

# Schema introspection (for agents)
lightsprint describe
lightsprint describe create

# Self-update
lightsprint upgrade
```

### Task ID formats

All commands that accept a task ID support three formats — the server resolves them all:

- **Display ID**: `LIG-024`, `LS-100`
- **Bare number**: `24`, `100`
- **Raw ID**: `YCRFHw7OeZUbogdOtYnFh`

### Command aliases

The following aliases are recognized to handle common variations:

| Alias | Resolves to |
|---|---|
| `create-task`, `new`, `add` | `create` |
| `show`, `view` | `get` |
| `edit` | `update` |
| `list`, `ls` | `tasks` |
| `remove`, `rm` | `delete` |
| `link` | `link-pr` |
| `unlink` | `unlink-pr` |
| `review-hub-signals` | `review-hub signals` |
| `review-hub-scores` | `review-hub scores` |

---

## Plugin Structure

```
lightsprint-claude-code-plugin/
├── .claude-plugin/
│   ├── plugin.json             # Plugin manifest
│   └── marketplace.json        # Marketplace registry entry
├── hooks/
│   └── hooks.json              # All Claude Code lifecycle hooks
├── scripts/
│   ├── lightsprint.js          # Unified CLI entry point (compiled to `lightsprint` binary)
│   ├── ls-cli.js               # Task management commands
│   ├── review-plan.js          # Plan review handler (ExitPlanMode hook)
│   ├── cc-daemon.js            # Long-lived background process per CC session
│   ├── cc-start.js             # SessionStart hook handler
│   ├── cc-end.js               # SessionEnd hook handler
│   ├── cc-event.js             # Event hook handler (prompts, tasks, subagents)
│   ├── cc-pr-created.js        # PostToolUse/Bash hook — auto-links new PRs
│   ├── compile.sh              # Build script for lightsprint binary
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── config.js           # Per-folder token resolution + on-demand auth trigger
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── task-map.js         # CC↔LS task ID mapping
│       ├── status-mapper.js    # Status mapping logic
│       ├── validate.js         # Input validation (IDs, enums, titles, bodies)
│       ├── schema.js           # Command schema for `describe` introspection
│       ├── output.js           # Structured output helpers (JSON / text)
│       ├── options.js          # Global flag parsing
│       ├── plan-tracker.js     # Active plan state for ExitPlanMode flow
│       ├── cc-utils.js         # Daemon discovery, session state, PID helpers
│       ├── sentry.js           # Error reporting
│       └── filelock.js         # Atomic file operations
├── skills/
│   ├── tasks/SKILL.md
│   ├── create/SKILL.md
│   ├── update/SKILL.md
│   ├── get/SKILL.md
│   ├── claim/SKILL.md
│   ├── comment/SKILL.md
│   ├── delete/SKILL.md
│   ├── current-task/SKILL.md
│   ├── projects/SKILL.md
│   ├── link-pr/SKILL.md
│   ├── unlink-pr/SKILL.md
│   ├── merge/SKILL.md
│   ├── create-plan/SKILL.md
│   ├── review-hub-signals/SKILL.md
│   ├── review-hub-scores/SKILL.md
│   ├── agent/SKILL.md
│   ├── agent-settings/SKILL.md
│   └── agent-create-pr/SKILL.md
├── install.sh                  # One-line plugin installer (macOS/Linux)
├── scripts/install.ps1         # PowerShell installer (Windows)
├── uninstall.sh                # Clean removal
├── package.json
└── README.md
```

### Local files

| File | Purpose |
|---|---|
| `~/.lightsprint/repos.json` | Per-folder OAuth tokens (access + refresh + expiry + repo ID) |
| `~/.lightsprint/config.json` | Global config (e.g. `baseUrl` for self-hosted instances) |
| `~/.lightsprint/preferences.json` | User preferences (e.g. `link-pr.no-task-behavior`) |
| `~/.lightsprint/cc-sessions/*.json` | Active daemon session state (one file per CC session) |
| `~/.lightsprint/daemon.log` | Background daemon log (WebSocket, session lifecycle) |
| `~/.lightsprint/sync.log` | Plan review hook log |

---

## Uninstalling

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/uninstall.sh | bash
```

This removes the plugin from Claude Code and deletes the authorization for the current folder. Other folders' authorizations in `~/.lightsprint/repos.json` are preserved.

---

## Troubleshooting

### Token expired / refresh failed

Run `lightsprint connect` or use any `/lightsprint:` command — the plugin will re-prompt for authorization if the refresh token has expired.

### Hook not firing

Verify the plugin is loaded:

```bash
claude --debug
```

Check that `hooks/hooks.json` is being picked up and the `PermissionRequest`, `SessionStart`, and other hook matchers are registered.

### Daemon not connecting

```bash
# Check if the daemon process is running
ps aux | grep cc-daemon

# Tail the logs
tail -f ~/.lightsprint/daemon.log ~/.lightsprint/sync.log

# Check session state
cat ~/.lightsprint/cc-sessions/*.json

# Hit the daemon health endpoint (find port in daemon.log)
curl http://127.0.0.1:<port>/health
```

### Plugin out of date

Self-update to the latest release:

```bash
lightsprint upgrade
```

### Connection status

Check which Lightsprint repo the current folder is connected to:

```bash
lightsprint status
lightsprint whoami
```
