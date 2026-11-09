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

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List tasks from the workspace board. Options: `--status <status>`, `--complexity <level>`, `--assignee <name>`, `--mine`, `--unassigned`, `--deps <filter>`, `--project <filter>`, `--stack <ref>`, `--sort <field>`, `--limit N`, `--offset N` |
| `/lightsprint:projects` | List projects in the workspace. Option: `--status active\|completed\|archived` |
| `/lightsprint:create <title>` | Create a new task. Options: `--description <text>`, `--complexity low\|medium\|high`, `--status backlog\|todo\|in_progress\|in_review\|done`, `--project <projectId>`, `--stack <ref>`, `--depends-on <ids>`, `--parent <taskId>` |
| `/lightsprint:update <id>` | Update a task. Options: `--title <text>`, `--description <text>`, `--status <status>`, `--complexity <level>`, `--requires-schema-change true\|false`, `--assignee <name>`, `--position <num>`, `--add-dep <taskId>`, `--remove-dep <taskId>` |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, dependencies, complexity |
| `/lightsprint:claim <id>` | Claim a task — sets it to in_progress and shows full details |
| `/lightsprint:current-task` | Find the task linked to the current Claude Code session, discovered from the session PID |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:delete <id>` | Delete a task permanently from the workspace board |
| `/lightsprint:link-pr --task <id> --pr-url <url>` | Link a GitHub pull request to a task. Option: `--force` |
| `/lightsprint:unlink-pr <id>` | Remove a linked GitHub pull request from a task |
| `/lightsprint:merge <id>` | Merge a task's linked PR, directly or through the GitHub merge queue |
| `/lightsprint:review-hub-signals <id>` | Get PR signals (CI checks, reviews, comments, deployments). Option: `--refresh` |
| `/lightsprint:review-hub-scores <id>` | Get AI readiness analysis for a task's linked PR. Option: `--refresh` |
| `/lightsprint:ask` | Work with Codebase Ask threads. Subcommands: `list`, `create`, `get`, `messages`, `cancel`, `delete` |
| `/lightsprint:agent` | Launch, stop, or check settings for cloud agents. Subcommands: `launch`, `stop`, `settings` |
| `/lightsprint:agent-settings` | Check which cloud agent providers (anthropic, cursor, codex) are configured |
| `/lightsprint:agent-create-pr --task <id> --provider <provider> --agent-id <id>` | Create a GitHub PR from a cloud agent's working branch |

Stacks group tasks within a workspace. List them with `lightsprint stacks`, inspect one with `lightsprint stacks get <stackId|prefix|name>`, and target a stack on `tasks`/`create`/`ask` via `--stack <ref>`.

### Claiming tasks

When you use `/lightsprint:claim`, the plugin:
1. Sets the Lightsprint task to `in_progress` and assigns it to the token owner
2. Prints the task ID so you can link it in Claude Code with `metadata: { lightsprint_task_id: "<LS task ID>" }`
3. Syncs later `TaskCreate`/`TaskUpdate` events to the correct Lightsprint task through the session hooks

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
│   ├── cc-start.js             # SessionStart hook: registers the CC session
│   ├── cc-end.js               # SessionEnd hook: tears the session down
│   ├── cc-event.js             # Prompt/tool/subagent hooks: reports activity
│   ├── cc-pr-created.js        # PostToolUse (Bash) hook: detects a created PR
│   ├── cc-daemon.js            # Per-session daemon that forwards events and syncs tasks
│   ├── compile.sh              # Build script for lightsprint binary
│   ├── __tests__/              # Unit tests (bun test)
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── browser.js          # Browser profile detection and URL opening
│       ├── cc-utils.js         # Session state, logging, and hook input helpers
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── config.js           # Per-folder token resolution + on-demand auth trigger
│       ├── connection.js       # Reads and writes the connection file
│       ├── filelock.js         # Cross-process file locking
│       ├── options.js          # Shared CLI flag parsing
│       ├── output.js           # Text/JSON output and error formatting
│       ├── schema.js           # Parameter schemas for `lightsprint describe`
│       ├── sentry.js           # Optional Sentry crash reporting
│       ├── status-mapper.js    # Status mapping logic
│       ├── task-map.js         # CC↔LS task ID mapping
│       └── validate.js         # Input hardening (IDs, enums, control characters)
├── skills/                     # One folder per /lightsprint: slash command (18 total)
│   └── <name>/SKILL.md
├── pi-extension/               # The same integration for the pi coding agent
├── install.sh                  # One-line plugin installer
├── uninstall.sh                # Clean removal
├── package.json
└── README.md
```

The CLI itself uses only Node.js built-ins (`fetch`, `crypto`, `fs`). The one
runtime dependency is `@sentry/node`, for optional crash reporting.

### Local files

| File | Purpose |
|---|---|
| `~/.lightsprint/connection.json` | Active workspace connection — OAuth tokens (access + refresh + expiry) and workspace ID/name |
| `~/.lightsprint/config.json` | Base URL of the connected instance |
| `~/.lightsprint/preferences.json` | CLI preferences set with `lightsprint config` |
| `~/.lightsprint/task-map.json` | Claude Code ↔ Lightsprint task ID mapping |
| `~/.lightsprint/cc-sessions/` | Per-session state for the running Claude Code session |
| `~/.lightsprint/daemon.log` | Log from the per-session daemon |

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
