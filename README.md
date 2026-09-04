# Lightsprint Claude Code Plugin

Claude Code plugin for Lightsprint — work the workspace board, manage pull requests, and drive cloud agents without leaving your session.

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
| `/lightsprint:update <id>` | Update a task. Options: `--title <text>`, `--description <text>`, `--status <status>`, `--complexity <level>`, `--assignee <name>`, `--position`, `--dependencies` |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, dependencies, complexity |
| `/lightsprint:claim <id>` | Claim a task — sets it to in_progress and shows full details |
| `/lightsprint:current-task` | Show the task linked to the current Claude Code session, discovered from the session PID — no task ID needed |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:delete <id>` | Delete a task permanently from the workspace board |
| `/lightsprint:projects` | List projects in the workspace |

**Pull requests**

| Command | Description |
|---|---|
| `/lightsprint:link-pr <id> <url>` | Link a GitHub pull request to a task |
| `/lightsprint:unlink-pr <id>` | Remove a linked pull request from a task |
| `/lightsprint:merge <id>` | Merge the pull request linked to a task. Supports direct merge and the GitHub merge queue |
| `/lightsprint:review-hub-signals <id>` | PR signals for the task's linked PR — CI checks, reviews, comments, deployments |
| `/lightsprint:review-hub-scores <id>` | AI readiness analysis for the task's linked PR — score, summaries, callouts, suggested actions |

**Cloud agents**

| Command | Description |
|---|---|
| `/lightsprint:agent <launch\|stop>` | Launch or stop a cloud agent on a task. Providers: `anthropic`, `cursor`, `codex` |
| `/lightsprint:agent-settings` | Show which agent providers are configured and their default models |
| `/lightsprint:agent-create-pr` | Open a GitHub PR from a cloud agent's working branch |
| `/lightsprint:ask` | Create, list, and send messages to Codebase Ask threads |

Stacks group tasks within a workspace. List them with `lightsprint stacks`, inspect one with `lightsprint stacks get <stackId|prefix|name>`, and target a stack on `tasks`/`create` via `--stack <ref>`.

### CLI

Every skill is backed by the same `lightsprint` binary, which is usable directly. Run `lightsprint --help` for the full command list, `lightsprint <command> --help` for one command, or `lightsprint describe <command>` for its accepted parameters as JSON. Global flags: `--output json|text` (`--json` for short), `--fields f1,f2`, and `--dry-run` to validate a call without hitting the API.

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
│   ├── cc-event.js             # Prompt/Stop/Task/Subagent hooks
│   ├── cc-pr-created.js        # PostToolUse:Bash hook — detects PR creation
│   ├── cc-daemon.js            # Background daemon streaming session events
│   ├── compile.sh              # Build script for the lightsprint binary
│   ├── deploy-tag.sh           # Cut a release tag
│   ├── dev-local.sh            # Point the install at a local server and build from source
│   ├── dev-restore.sh          # Restore the production config after dev-local.sh
│   ├── install.ps1             # Windows installer
│   ├── __tests__/              # Test suite (bun test)
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── browser.js          # Cross-platform browser launcher
│       ├── config.js           # Token resolution + on-demand auth trigger
│       ├── connection.js       # Active workspace connection state
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── cc-utils.js         # Claude Code session helpers
│       ├── filelock.js         # Atomic writes to files under ~/.lightsprint
│       ├── options.js          # Argument and flag parsing
│       ├── output.js           # Text and JSON output formatting
│       ├── schema.js           # Command parameter schemas (backs `describe`)
│       ├── sentry.js           # Crash reporting
│       ├── task-map.js         # CC↔LS task ID mapping
│       ├── status-mapper.js    # Status mapping logic
│       └── validate.js         # Input validation
├── skills/                     # One SKILL.md per slash command (see table above)
├── pi-extension/               # Same functionality as a pi extension
├── docs/                       # Design notes and plans
├── npx-install.js              # `npx lightsprint` entry point
├── install.sh                  # One-line plugin installer
├── uninstall.sh                # Clean removal
├── package.json
└── README.md
```

The runtime leans on Node.js built-ins (`fetch`, `crypto`, `fs`); the only npm dependency is `@sentry/node` for crash reporting.

### Local files

| File | Purpose |
|---|---|
| `~/.lightsprint/connection.json` | Active workspace connection — OAuth tokens (access + refresh + expiry) and workspace ID/name |
| `~/.lightsprint/config.json` | CLI configuration, including `baseUrl` |
| `~/.lightsprint/preferences.json` | Persisted CLI preferences |
| `~/.lightsprint/task-map.json` | Claude Code ↔ Lightsprint task ID mapping |
| `~/.lightsprint/cc-sessions/` | Per-session state used to resolve the current task from the session PID |
| `~/.lightsprint/daemon.log` | Background daemon log |

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
