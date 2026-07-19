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

**Task board**

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List tasks from the workspace board. Options: `--status backlog\|todo\|in_progress\|in_review\|done`, `--complexity`, `--assignee`, `--mine`, `--unassigned`, `--deps`, `--project`, `--stack <ref>`, `--limit N` |
| `/lightsprint:projects` | List projects in the workspace. Option: `--status active\|completed\|archived` |
| `/lightsprint:create <title>` | Create a new task. Options: `--description <text>`, `--complexity low\|medium\|high`, `--status <status>`, `--project <id>`, `--stack <ref>`, `--depends-on <ids>` |
| `/lightsprint:update <id>` | Update a task. Options: `--title`, `--description`, `--status`, `--complexity`, `--assignee`, `--add-dep`, `--remove-dep` |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, dependencies, complexity |
| `/lightsprint:claim <id>` | Claim a task — sets it to in_progress and shows full details |
| `/lightsprint:current-task` | Get the task linked to the current Claude Code session (auto-discovered via session PID — no ID needed) |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:delete <id>` | Delete a task permanently from the board |

**Pull requests**

| Command | Description |
|---|---|
| `/lightsprint:link-pr <id> <pr-url>` | Link a GitHub PR to a task. Option: `--force` to move a PR already linked elsewhere |
| `/lightsprint:unlink-pr <id>` | Remove the linked GitHub PR from a task |
| `/lightsprint:merge <id>` | Merge the GitHub PR linked to a task (direct merge or GitHub merge queue) |
| `/lightsprint:review-hub-signals <id>` | Get PR signals (CI checks, reviews, comments, deployments) for a task's linked PR. Option: `--refresh` |
| `/lightsprint:review-hub-scores <id>` | Get AI readiness analysis (score, summaries, callouts, suggested actions) for a task's linked PR. Option: `--refresh` |

**Cloud agents**

| Command | Description |
|---|---|
| `/lightsprint:agent` | Launch, stop, or check settings for cloud agents on a task. Providers: `anthropic`, `cursor`, `codex` |
| `/lightsprint:agent-settings` | Show which cloud agent providers are configured and their default models |
| `/lightsprint:agent-create-pr` | Create a GitHub PR from a cloud agent's working branch |

Stacks group tasks within a workspace. List them with `lightsprint stacks`, inspect one with `lightsprint stacks get <stackId|prefix|name>`, and target a stack on `tasks`/`create` via `--stack <ref>`.

Run `lightsprint help` for the full CLI reference, or `lightsprint describe <command>` for a machine-readable schema of any command's parameters.

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
│   ├── ls-cli.js               # CLI command router (exports cliMain)
│   ├── cc-start.js             # SessionStart hook handler
│   ├── cc-end.js               # SessionEnd hook handler
│   ├── cc-event.js             # PostToolUse task-sync hook handler
│   ├── cc-pr-created.js        # PR-created hook handler
│   ├── cc-daemon.js            # Background sync daemon
│   ├── compile.sh              # Build script for lightsprint binary
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── browser.js          # Cross-platform browser opener
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── config.js           # Preferences + plugin config resolution
│       ├── connection.js       # Active workspace connection read/write
│       ├── cc-utils.js         # Claude Code session helpers
│       ├── filelock.js         # File-based locking for concurrent writes
│       ├── options.js          # Global flag parsing (--output, --dry-run, --fields)
│       ├── output.js           # JSON/text output formatting
│       ├── schema.js           # Command schemas (help, describe, validation)
│       ├── validate.js         # Input hardening (task IDs, enums, control chars)
│       ├── task-map.js         # CC↔LS task ID mapping
│       ├── status-mapper.js    # Status mapping logic
│       └── sentry.js           # Error reporting
├── skills/                     # One SKILL.md per slash command (tasks, projects,
│   └── …                       #   create, update, get, claim, current-task, comment,
│                               #   delete, link-pr, unlink-pr, merge, review-hub-*, agent*)
├── install.sh                  # One-line plugin installer
├── install.ps1                 # Windows installer
├── uninstall.sh                # Clean removal
├── package.json
└── README.md
```

Zero npm dependencies — uses Node.js built-in `fetch`, `crypto`, and `fs`.

### Local files

All plugin state lives under `~/.lightsprint/`:

| File | Purpose |
|---|---|
| `~/.lightsprint/connection.json` | Active workspace connection — OAuth tokens (access + refresh + expiry) and workspace ID/name |
| `~/.lightsprint/task-map.json` | Claude Code ↔ Lightsprint task ID mapping |
| `~/.lightsprint/preferences.json` | User preferences set via `lightsprint config` |

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
