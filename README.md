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

**Tasks**

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List tasks from the workspace board. Options: `--status backlog\|todo\|in_progress\|in_review\|done`, `--stack <ref>`, `--limit N` |
| `/lightsprint:create <title>` | Create a new task. Options: `--description <text>`, `--complexity low\|medium\|high`, `--status backlog\|todo\|in_progress\|in_review\|done`, `--stack <ref>` |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, dependencies, complexity |
| `/lightsprint:update <id>` | Update a task. Options: `--title <text>`, `--description <text>`, `--status <status>`, `--complexity <level>`, `--assignee <name>`, plus schema-change flag, position, and dependencies |
| `/lightsprint:claim <id>` | Claim a task — sets it to in_progress and shows full details |
| `/lightsprint:current-task` | Get the task linked to this Claude Code session, discovered from the session PID — no task ID needed |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:delete <id>` | Delete a task permanently from the board |
| `/lightsprint:projects` | List projects in the workspace |

**Pull requests**

| Command | Description |
|---|---|
| `/lightsprint:link-pr` | Link a GitHub pull request to a task |
| `/lightsprint:unlink-pr` | Remove a linked pull request from a task |
| `/lightsprint:merge` | Merge the pull request linked to a task. Supports direct merge and the GitHub merge queue |
| `/lightsprint:review-hub-signals` | PR signals for a task's linked PR — CI checks, reviews, comments, deployments |
| `/lightsprint:review-hub-scores` | AI readiness analysis for a task's linked PR — score, summaries, callouts, suggested actions |

**Cloud agents and Ask**

| Command | Description |
|---|---|
| `/lightsprint:agent` | Launch or stop a cloud agent on a task |
| `/lightsprint:agent-settings` | Show which agent providers are configured and their default models |
| `/lightsprint:agent-create-pr` | Open a pull request from a cloud agent's working branch |
| `/lightsprint:ask` | Create, list, and send messages to read-only Codebase Ask threads |

Stacks group tasks within a workspace. List them with `lightsprint stacks`, inspect one with `lightsprint stacks get <stackId|prefix|name>`, and target a stack on `tasks`/`create` via `--stack <ref>`.

### CLI flags for agents

The `lightsprint` CLI is written to be driven by agents, so every command takes the same global flags:

| Flag | Purpose |
|---|---|
| `--output json\|text` | Output format. Defaults to `text`; `--json` is shorthand for `--output json` |
| `--fields f1,f2` | Return only the named fields, to keep a large task out of the context window. Implies `--output json` |
| `--dry-run` | Validate inputs without calling the API (`create`, `update`, `claim`, `comment`) |

`lightsprint describe` dumps the available command names as JSON, and `lightsprint describe <command>` dumps one command's parameters, types, required fields, and valid enum values — so a schema can be read at runtime instead of from documentation that may have drifted.

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
│   ├── cc-start.js  cc-end.js  cc-event.js  cc-pr-created.js
│   │                           # Hook handlers, invoked as `lightsprint cc-*`
│   ├── cc-daemon.js            # Background task-sync daemon (~/.lightsprint/daemon.log)
│   ├── compile.sh              # Build script for lightsprint binary
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── config.js           # Per-folder token resolution + on-demand auth trigger
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── options.js          # Global flag parsing (--output, --json, --dry-run, --fields)
│       ├── output.js           # Text/JSON rendering
│       ├── schema.js           # Command schemas behind `describe` and per-command help
│       ├── task-map.js         # CC↔LS task ID mapping
│       └── status-mapper.js    # Status mapping logic
├── skills/                     # One directory per /lightsprint: command
│   ├── tasks/  create/  get/  update/  claim/  current-task/  comment/  delete/
│   ├── projects/  link-pr/  unlink-pr/  merge/
│   ├── review-hub-signals/  review-hub-scores/
│   └── agent/  agent-settings/  agent-create-pr/  ask/
├── pi-extension/               # The pi equivalent of this plugin, same functionality
├── docs/                       # Longer-form plugin docs
├── install.sh                  # One-line plugin installer
├── uninstall.sh                # Clean removal
├── npx-install.js              # `npx lightsprint` entry point
├── CLAUDE.md                   # Repo guidance for coding agents
├── package.json
└── README.md
```

The CLI itself runs on Node.js built-ins — `fetch`, `crypto`, and `fs`. The only npm dependency is `@sentry/node`, used by the background sync daemon (`scripts/cc-daemon.js`) for crash reporting.

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
