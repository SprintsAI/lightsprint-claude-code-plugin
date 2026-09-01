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

All skills operate on the connected workspace.

#### Tasks

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List tasks from the workspace board. Options: `--status backlog\|todo\|in_progress\|in_review\|done`, `--assignee <name>`, `--project <id>`, `--stack <ref>`, `--limit N`, `--offset N`, `--sort position\|updated_at\|created_at` |
| `/lightsprint:create <title>` | Create a new task. Options: `--description <text>`, `--complexity low\|medium\|high`, `--status <status>`, `--stack <ref>`, `--projectId <id>`, `--dependsOn <ids>` |
| `/lightsprint:update <id>` | Update a task. Options: `--title`, `--description`, `--status`, `--complexity`, `--assignee`, `--requiresSchemaChange`, `--position`, `--dependsOn` |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, dependencies, complexity |
| `/lightsprint:claim <id>` | Claim a task — sets it to in_progress, assigns it to you, and links the Claude Code session |
| `/lightsprint:current-task` | Get the task linked to the current Claude Code session, discovered by session PID — no task ID needed |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:delete <id>` | Delete a task permanently |
| `/lightsprint:projects` | List projects in the workspace. Options: `--status active\|completed\|archived` |

#### Pull requests

| Command | Description |
|---|---|
| `/lightsprint:link-pr <id> <url>` | Link a GitHub pull request to a task |
| `/lightsprint:unlink-pr <id>` | Remove a linked pull request from a task |
| `/lightsprint:merge <id>` | Merge the pull request linked to a task. Supports direct merge and the GitHub merge queue |
| `/lightsprint:review-hub-signals <id>` | PR signals — CI checks, reviews, comments, deployments. Options: `--refresh` |
| `/lightsprint:review-hub-scores <id>` | AI readiness analysis — score, summaries, callouts, suggested actions. Options: `--refresh` |

#### Cloud agents

| Command | Description |
|---|---|
| `/lightsprint:agent` | Launch or stop a cloud agent on a task. Providers: `anthropic`, `cursor`, `codex` |
| `/lightsprint:agent-settings` | Show which agent providers are configured and their default models |
| `/lightsprint:agent-create-pr` | Create a GitHub PR from a cloud agent's working branch |

#### Codebase Ask

| Command | Description |
|---|---|
| `/lightsprint:ask` | Create, list, inspect, message, cancel, or delete Codebase Ask threads |

Stacks group tasks within a workspace. List them with `lightsprint stacks`, inspect one with `lightsprint stacks get <stackId|prefix|name>`, and target a stack on `tasks`/`create` via `--stack <ref>`.

### Using the CLI directly

Every skill wraps the `lightsprint` binary, which you can also call yourself. It is built to be driven by agents:

```bash
lightsprint describe create        # JSON schema of a command's params, types, and enums
lightsprint tasks --output json    # structured output (also implied by --fields)
lightsprint get <id> --fields title,status
lightsprint create "Fix login" --dry-run   # validate locally without hitting the API
```

`describe` with no argument lists every command. Inputs are validated before they reach the API, and in JSON mode errors are emitted as structured JSON on stderr.

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
│   ├── ls-cli.js               # Command implementations (exports cliMain)
│   ├── cc-start.js             # SessionStart hook
│   ├── cc-end.js               # SessionEnd hook
│   ├── cc-event.js             # Task-sync hook (prompt, stop, task, subagent events)
│   ├── cc-pr-created.js        # PR detection hook (PostToolUse on Bash)
│   ├── cc-daemon.js            # Background sync daemon
│   ├── compile.sh              # Build script for the lightsprint binary
│   ├── dev-local.sh            # Point the install at a local checkout
│   ├── dev-restore.sh          # Restore the released install
│   ├── deploy-tag.sh           # Cut a release tag
│   ├── install.ps1             # Windows installer
│   ├── __tests__/              # CLI unit tests
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── browser.js          # Cross-platform browser launcher
│       ├── config.js           # Token resolution + on-demand auth trigger
│       ├── connection.js       # Active workspace connection file
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── options.js          # Cross-cutting flags (--output, --dry-run, --fields)
│       ├── output.js           # Text and JSON renderers, structured errors
│       ├── schema.js           # Command schemas behind `lightsprint describe`
│       ├── validate.js         # Input hardening (IDs, enums, control chars)
│       ├── filelock.js         # Cross-process file locking
│       ├── cc-utils.js         # Claude Code session helpers
│       ├── sentry.js           # Optional error reporting
│       ├── task-map.js         # CC↔LS task ID mapping
│       └── status-mapper.js    # Status mapping logic
├── skills/                     # One SKILL.md per /lightsprint: command (18 total)
├── pi-extension/               # Same integration as a pi extension
├── docs/                       # Local testing and design notes
├── install.sh                  # One-line plugin installer
├── uninstall.sh                # Clean removal
├── npx-install.js              # `npx lightsprint` entry point
├── CLAUDE.md                   # Repo guidance for Claude Code
├── package.json
└── README.md
```

One runtime dependency (`@sentry/node`, for optional error reporting). Everything else uses Node.js built-ins — `fetch`, `crypto`, and `fs`.

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
