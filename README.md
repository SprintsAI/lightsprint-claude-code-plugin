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

Or pass it when connecting: `lightsprint connect --base-url https://your-instance.example.com`. Defaults to `https://app.lightsprint.ai`.

---

## How It Works

### Skills (slash commands)

All skills operate on the connected workspace. Task IDs accept either the raw ID or the display ID (e.g. `LIG-024`).

**Tasks**

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List tasks from the workspace board. Options: `--status backlog\|todo\|in_progress\|in_review\|done`, `--assignee <name>`, `--project <id,...\|none>`, `--stack <ref>`, `--limit N`, `--offset N`, `--sort position\|updated_at\|created_at` |
| `/lightsprint:projects` | List projects in the workspace. Options: `--status active\|completed\|archived` |
| `/lightsprint:create <title>` | Create a new task (default stack unless `--stack` is given). Options: `--description <text>`, `--status <status>`, `--complexity <level>`, `--depends-on <id,...>`, `--project <id>`, `--stack <ref>` |
| `/lightsprint:update <id>` | Update a task. Options: `--title <text>`, `--description <text>`, `--status <status>`, `--complexity <level>`, `--requires-schema-change`, `--assignee <name>`, `--position N`, `--add-dep <id>`, `--remove-dep <id>`, `--project <id>` |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, dependencies, complexity |
| `/lightsprint:claim <id>` | Claim a task — sets it to `in_progress`, assigns it to you, and links it to the current Claude Code session |
| `/lightsprint:current-task` | Show the task linked to the current Claude Code session |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:delete <id>` | Permanently delete a task |

**Pull requests**

| Command | Description |
|---|---|
| `/lightsprint:link-pr` | Link a GitHub PR to a task (`--task <id> --pr-url <url>`) |
| `/lightsprint:unlink-pr <id>` | Remove a linked PR from a task |
| `/lightsprint:merge <id>` | Merge the PR linked to a task. Supports direct merge and the GitHub merge queue |
| `/lightsprint:review-hub-signals <id>` | Show CI checks, reviews, comments and deployments for a task's linked PR. Options: `--refresh` |
| `/lightsprint:review-hub-scores <id>` | Show the AI readiness analysis (score, summaries, callouts, suggested actions) for a task's linked PR. Options: `--refresh` |

**Cloud agents**

| Command | Description |
|---|---|
| `/lightsprint:agent` | Launch or stop a cloud agent on one or more tasks. Options: `--task <id>` (repeatable), `--provider anthropic\|cursor\|codex`, `--model`, `--base-ref`, `--environment-id`, `--auto-merge` / `--no-auto-merge` |
| `/lightsprint:agent-settings` | Show which cloud agent providers are configured and their default models |
| `/lightsprint:agent-create-pr` | Open a GitHub PR from a cloud agent's working branch |

**Codebase Ask**

| Command | Description |
|---|---|
| `/lightsprint:ask` | Create, list, read, message, cancel or delete Codebase Ask threads |

Stacks group tasks within a workspace. List them with `lightsprint stacks`, inspect one with `lightsprint stacks get <stackId|prefix|name>`, and target a stack on `tasks`/`create` via `--stack <ref>`.

### The `lightsprint` CLI

The skills are thin wrappers around the `lightsprint` CLI, which you can also run directly. It is designed for agents first:

- `--output json|text` (or `--json`) — machine-readable output
- `--fields f1,f2` — return only the listed fields (implies JSON)
- `--dry-run` — validate inputs without calling the API (`create`, `update`, `claim`, `comment`)
- `--json-body '<json>'` — send a raw request body to `create` / `update`
- `lightsprint describe [command]` — dump a command's parameters, types and allowed values as JSON
- `lightsprint config get|set|delete|list` — manage preferences (e.g. `link-pr.no-task-behavior prompt|always-skip`)
- `lightsprint open` — open the workspace board in your browser
- `lightsprint upgrade` — install the latest version

Run `lightsprint --help` for the full command list.

### Claiming tasks

When you use `/lightsprint:claim`, the plugin:
1. Sets the Lightsprint task to `in_progress` and assigns it to you
2. Creates a Claude Code task linked via `metadata: { lightsprint_task_id: "<LS task ID>" }`
3. Subsequent `TaskUpdate` calls on the Claude Code task automatically sync to the correct Lightsprint task

### Hooks

The plugin registers Claude Code hooks in `hooks/hooks.json`. They do nothing if no workspace is connected.

| Hook | Command | Purpose |
|---|---|---|
| `SessionStart` | `lightsprint cc-start` | Starts a per-session daemon that streams session events to Lightsprint |
| `SessionEnd` | `lightsprint cc-end` | Ends the session and stops the daemon |
| `UserPromptSubmit`, `Stop`, `TaskCompleted`, `SubagentStart`, `SubagentStop` | `lightsprint cc-event` | Forwards session activity to the daemon |
| `PostToolUse` (`TaskCreate`, `TaskUpdate`) | `lightsprint cc-event` | Syncs Claude Code task changes to the linked Lightsprint task |
| `PostToolUse` (`Bash`) | `lightsprint cc-pr-created` | Detects `gh pr create` and prompts the agent to link the new PR to its task |

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
│   ├── cc-start.js             # SessionStart hook — spawns the session daemon
│   ├── cc-end.js               # SessionEnd hook
│   ├── cc-event.js             # Forwards hook events to the daemon
│   ├── cc-pr-created.js        # PostToolUse(Bash) hook — detects `gh pr create`
│   ├── cc-daemon.js            # Per-session daemon (WebSocket to Lightsprint + local HTTP)
│   ├── compile.sh              # Build script for lightsprint binary
│   ├── deploy-tag.sh           # Release tagging
│   ├── dev-local.sh            # Use a local Lightsprint server + build from source
│   ├── dev-restore.sh          # Restore production config
│   ├── install.ps1             # Windows installer
│   ├── __tests__/              # bun tests
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── browser.js          # Browser profile detection + URL opening
│       ├── cc-utils.js         # Session state, logging and hook helpers
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── config.js           # Base URL, preferences + on-demand auth trigger
│       ├── connection.js       # Reads/writes the active workspace connection
│       ├── filelock.js         # Advisory file locking across processes
│       ├── options.js          # CLI flag parsing
│       ├── output.js           # Text/JSON output formatting
│       ├── schema.js           # Command schemas (used by `describe` and validation)
│       ├── sentry.js           # Sentry crash reporting
│       ├── status-mapper.js    # Status mapping logic
│       ├── task-map.js         # CC↔LS task ID mapping
│       └── validate.js         # Input validation
├── skills/                     # One SKILL.md per /lightsprint:<name> command (see table above)
├── pi-extension/               # Equivalent integration for the pi coding agent
├── docs/                       # Design notes and LOCAL_TESTING.md
├── install.sh                  # One-line plugin installer
├── npx-install.js              # `npx lightsprint` installer
├── uninstall.sh                # Clean removal
├── package.json
└── README.md
```

The only runtime npm dependency is `@sentry/node` for error reporting. Everything else uses Node.js built-ins (`fetch`, `crypto`, `fs`, `http`).

### Local files

All state lives in `~/.lightsprint/` (override with `LIGHTSPRINT_CONFIG_DIR`).

| File | Purpose |
|---|---|
| `connection.json` | Active workspace connection — OAuth tokens (access + refresh + expiry) and workspace ID/name |
| `config.json` | Plugin config, e.g. a custom `baseUrl` |
| `preferences.json` | Preferences set with `lightsprint config set` |
| `task-map.json` | Links between Claude Code tasks and Lightsprint tasks |
| `cc-sessions/` | One state file per running Claude Code session daemon |
| `daemon.log` | Hook and daemon log — `tail -f ~/.lightsprint/daemon.log` when debugging |

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
