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

All skills operate on the connected workspace. Task IDs accept display IDs (`LIG-024`), bare task numbers (`24`), or raw IDs. Each skill's `SKILL.md` documents its full set of flags and output fields.

#### Tasks

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List tasks from the workspace board. Options include `--status <list>`, `--mine`, `--unassigned`, `--assignee <name>`, `--project <id>`, `--stack <ref>`, `--deps <filter>`, `--sort <field>`, `--limit N` |
| `/lightsprint:projects` | List projects in the workspace |
| `/lightsprint:create <title>` | Create a new task. Options include `--description <text>`, `--complexity low\|medium\|high`, `--status <status>`, `--project <id>`, `--stack <ref>`, `--depends-on <ids>`, `--parent <id>` |
| `/lightsprint:update <id>` | Update a task. Options include `--title`, `--description`, `--status`, `--complexity`, `--assignee`, `--project`, `--requires-schema-change` |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, dependencies, complexity |
| `/lightsprint:claim <id>` | Claim a task — sets it to in_progress and shows full details |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:delete <id>` | Permanently delete a task. Prefer `update --status done` for finished work |
| `/lightsprint:current-task` | Show the task linked to the current Claude Code session, without needing an ID |

#### Pull requests

| Command | Description |
|---|---|
| `/lightsprint:link-pr` | Link a GitHub PR to a task: `--task <id> --pr-url <url> [--force]` |
| `/lightsprint:unlink-pr <id>` | Remove a linked PR from a task |
| `/lightsprint:merge <id>` | Merge the task's linked PR, directly or via the GitHub merge queue |
| `/lightsprint:review-hub-signals <id>` | CI checks, reviews, comments, and deployments on the task's linked PR. `--refresh` re-fetches from GitHub |
| `/lightsprint:review-hub-scores <id>` | AI readiness analysis (score, summaries, callouts, suggested actions) for the linked PR. `--refresh` runs a fresh analysis and consumes credits |

#### Cloud agents and Ask

| Command | Description |
|---|---|
| `/lightsprint:agent` | Launch or stop cloud agents on tasks (`anthropic`, `cursor`, or `codex`). Repeat `--task` to launch several in parallel |
| `/lightsprint:agent-settings` | Show which agent providers are configured and their default models. `--provider codex` also lists environments |
| `/lightsprint:agent-create-pr` | Open a PR from a finished agent's branch: `--task <id> --provider <provider> --agent-id <id>` |
| `/lightsprint:ask` | Work with Codebase Ask threads: `list`, `create`, `get`, `messages`, `cancel`, `delete` |

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
│   └── hooks.json              # Session lifecycle, subagent, and task sync hooks
├── scripts/
│   ├── lightsprint.js          # Unified CLI entry point (compiled to `lightsprint` binary)
│   ├── ls-cli.js               # Task management commands (exports cliMain)
│   ├── cc-start.js / cc-end.js # Session start/end hooks
│   ├── cc-event.js             # Forwards Claude Code hook events to the daemon
│   ├── cc-pr-created.js        # Prompts the link-pr flow after `gh pr create`
│   ├── cc-daemon.js            # Per-session background daemon that syncs with Lightsprint
│   ├── compile.sh              # Build script for lightsprint binary
│   ├── __tests__/              # bun test suite
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── connection.js       # Reads/writes the active workspace connection
│       ├── config.js           # Plugin config, preferences, on-demand auth trigger
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── validate.js         # Input validation for IDs and enums
│       ├── output.js           # JSON / human output formatting
│       ├── task-map.js         # CC↔LS task ID mapping
│       ├── status-mapper.js    # Status mapping logic
│       └── sentry.js           # Error reporting
├── skills/                     # One SKILL.md per /lightsprint: command (see table above)
├── pi-extension/               # Lightsprint extension for the pi coding agent
├── install.sh                  # One-line plugin installer
├── uninstall.sh                # Clean removal
├── package.json
└── README.md
```

The CLI is built with `bun run build` into a single self-contained `lightsprint` binary; run the tests with `bun test`.

### Local files

All files live in `~/.lightsprint/` (override with `LIGHTSPRINT_CONFIG_DIR`).

| File | Purpose |
|---|---|
| `connection.json` | Active workspace connection — OAuth tokens (access + refresh + expiry) and workspace ID/name |
| `config.json` | Plugin-level config, e.g. a custom base URL set during install |
| `preferences.json` | User preferences set with `lightsprint config set` (e.g. `link-pr.no-task-behavior`) |
| `task-map.json` | Mapping between Claude Code tasks and Lightsprint tasks |
| `daemon.log` | Hook and daemon log — check here first when debugging |

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
