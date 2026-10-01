# Lightsprint Claude Code Plugin

Claude Code plugin for Lightsprint. It adds `/lightsprint:` slash commands for working with your workspace board, a `lightsprint` CLI that those commands call, and session hooks that stream Claude Code activity to Lightsprint.

## Prerequisites

- **Claude Code** CLI installed
- **Node.js >= 18** (only needed for the `npx` installer; the CLI itself ships as a standalone binary)
- A **Lightsprint workspace** at [lightsprint.ai](https://lightsprint.ai)

## Quick Start

Install the plugin (one time):

```bash
npx lightsprint
```

Then use any `/lightsprint:` command. On first use the plugin opens your browser so you can connect a workspace:

```
/lightsprint:tasks
```

That's it.

---

## Installation

### npx (recommended)

```bash
npx lightsprint
```

### Curl fallback (macOS / Linux)

If you don't have npm/npx available:

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

The plugin is installed but the workspace connection step is skipped. Connect later by running `/lightsprint:tasks` or `lightsprint connect`.

### Upgrading

```bash
lightsprint upgrade
```

Downloads and installs the latest release from GitHub.

---

## Authentication

Authentication is **on-demand**. The first time you use a `/lightsprint:` command without an active connection, the plugin opens your browser to authorize. You pick a Lightsprint workspace and the tokens are saved locally. Tokens refresh automatically.

The active workspace is stored in a single connection file (`~/.lightsprint/connection.json`). All commands operate against that connected workspace. Hooks silently skip if no connection exists (they never prompt).

### Switching workspaces

Run `lightsprint connect` again to authorize and switch to a different workspace, or `lightsprint disconnect` to clear the active connection. Use `lightsprint status` or `lightsprint whoami` to see which workspace is connected.

### Optional: Custom base URL

For self-hosted Lightsprint instances:

```bash
export LIGHTSPRINT_BASE_URL=https://your-instance.example.com
```

Defaults to `https://app.lightsprint.ai`. You can also pass `--base-url=<url>` to `install.sh`, `-BaseUrl <url>` to `install.ps1`, or `--base-url <url>` to `lightsprint connect`.

---

## How It Works

### Skills (slash commands)

All skills operate on the connected workspace. Each one is a thin wrapper around a `lightsprint` CLI command, so `lightsprint <command> --help` shows the full set of flags.

**Tasks**

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List root tasks on the board. Filter with `--status`, `--complexity`, `--assignee`, `--mine`, `--unassigned`, `--deps`, `--project`, `--stack <ref>`; page with `--sort`, `--limit N`, `--offset N` |
| `/lightsprint:projects` | List projects in the workspace. Options: `--status active\|completed\|archived` |
| `/lightsprint:create <title>` | Create a task in the workspace's default stack. Options include `--description`, `--complexity`, `--status`, `--stack <ref>` |
| `/lightsprint:get <id>` | Full details of a task: title, status, description, todo list, related files, dependencies, complexity. Use `--fields` to trim the output |
| `/lightsprint:update <id>` | Update a task's title, description, status, complexity, schema-change flag, assignee, position or dependencies |
| `/lightsprint:claim <id>` | Claim a task: sets it to `in_progress` and links it to the current Claude Code session |
| `/lightsprint:current-task` | Show the task linked to the current Claude Code session (no ID needed) |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:delete <id>` | Permanently delete a task |

**Pull requests**

| Command | Description |
|---|---|
| `/lightsprint:link-pr` | Link a GitHub PR to a task (`--task <id> --pr-url <url>`). Moves the task to `in_review` and triggers an automated review |
| `/lightsprint:unlink-pr <id>` | Remove the linked PR from a task |
| `/lightsprint:merge <id>` | Merge the task's linked PR (direct merge or GitHub merge queue) |
| `/lightsprint:review-hub-signals <id>` | CI checks, reviews, comments and deployments on the task's linked PR |
| `/lightsprint:review-hub-scores <id>` | AI readiness score, summaries, callouts and suggested actions for the linked PR |

**Cloud agents and Ask**

| Command | Description |
|---|---|
| `/lightsprint:agent` | Launch or stop a cloud agent on a task (`anthropic`, `cursor` or `codex` provider) |
| `/lightsprint:agent-settings` | Show which cloud agent providers are configured and their default models |
| `/lightsprint:agent-create-pr` | Open a GitHub PR from a cloud agent's working branch |
| `/lightsprint:ask` | Codebase Ask threads, a read-only Q&A over every repo in a stack: `list`, `create`, `get`, `messages`, `cancel`, `delete` |

Stacks group tasks within a workspace. List them with `lightsprint stacks`, inspect one with `lightsprint stacks get <stackId|prefix|name>`, and target a stack on `tasks`/`create` via `--stack <ref>`.

### CLI-only commands

These have no slash command but are available from the `lightsprint` binary:

| Command | Description |
|---|---|
| `lightsprint connect` / `disconnect` | Connect to a workspace or clear the connection |
| `lightsprint status` / `whoami` | Show the connected workspace and auth info |
| `lightsprint open` | Open the workspace board in your browser |
| `lightsprint stacks [get <ref>]` | List stacks or inspect one |
| `lightsprint config get\|set\|delete\|list` | Manage preferences in `~/.lightsprint/preferences.json` (e.g. `link-pr.no-task-behavior`) |
| `lightsprint describe [command]` | Dump a command's parameters, types and valid enum values as JSON |
| `lightsprint upgrade` | Install the latest release |

Global flags: `--output json|text` (or `--json`), `--fields f1,f2`, and `--dry-run` on `create`, `update`, `claim` and `comment`. `create` and `update` also accept a raw request body via `--json-body '<json>'`.

### Session hooks

The plugin registers Claude Code hooks in `hooks/hooks.json`. They run the `lightsprint` binary and do nothing if you aren't connected.

| Hook | Command | What it does |
|---|---|---|
| `SessionStart` | `lightsprint cc-start` | Starts a per-session daemon that connects to Lightsprint over a WebSocket |
| `UserPromptSubmit`, `Stop`, `TaskCompleted`, `SubagentStart`, `SubagentStop`, `PostToolUse` (`TaskCreate`, `TaskUpdate`) | `lightsprint cc-event` | Forwards session and task events to the daemon, which streams them to Lightsprint |
| `PostToolUse` (`Bash`) | `lightsprint cc-pr-created` | Spots a successful `gh pr create` and prompts the agent to link the PR to its task |
| `SessionEnd` | `lightsprint cc-end` | Shuts the session daemon down |

### Claiming tasks

When you use `/lightsprint:claim`, the plugin:
1. Sets the Lightsprint task to `in_progress` and links it to the current Claude Code session
2. Turns every Claude Code task created in that session (`TaskCreate`) into a Lightsprint subtask that the claimed task depends on
3. Syncs status changes from `TaskUpdate` to the matching subtask, and when a task gains a blocker (`addBlockedBy`) moves its subtask under that blocker

---

## Plugin Structure

```
lightsprint-claude-code-plugin/
├── .claude-plugin/
│   ├── plugin.json             # Plugin manifest
│   └── marketplace.json        # Marketplace registry entry
├── hooks/
│   └── hooks.json              # Session lifecycle + task sync hooks
├── skills/                     # One SKILL.md per /lightsprint: command (18 skills)
├── scripts/
│   ├── lightsprint.js          # Unified CLI entry point (compiled to the `lightsprint` binary)
│   ├── ls-cli.js               # Task, PR, agent and Ask commands (exports cliMain)
│   ├── cc-start.js             # SessionStart hook: spawns the session daemon
│   ├── cc-daemon.js            # Per-session daemon: WebSocket to Lightsprint + local HTTP for hooks
│   ├── cc-event.js             # Event hook: forwards events to the daemon
│   ├── cc-pr-created.js        # Bash PostToolUse hook: detects new PRs
│   ├── cc-end.js               # SessionEnd hook: stops the daemon
│   ├── compile.sh              # Builds the binary with Bun
│   ├── deploy-tag.sh           # Release tagging
│   ├── dev-local.sh / dev-restore.sh  # Switch to a local Lightsprint server and back
│   ├── install.ps1             # Windows installer
│   ├── lib/                    # auth, client, connection, config, validation, output, Sentry, etc.
│   └── __tests__/              # Bun test suite
├── pi-extension/               # Equivalent extension for the pi coding agent
├── docs/                       # LOCAL_TESTING.md and design notes
├── install.sh                  # One-line installer (macOS / Linux)
├── uninstall.sh                # Clean removal
├── npx-install.js              # `npx lightsprint` entry point
├── package.json
└── README.md
```

The CLI is compiled into a single binary with Bun. Its only runtime dependency is `@sentry/node` for error reporting.

### Local files

| File | Purpose |
|---|---|
| `~/.lightsprint/connection.json` | Active workspace connection: OAuth tokens (access, refresh, expiry) and workspace ID/name |
| `~/.lightsprint/config.json` | Base URL written by the installer, so hooks use the same instance |
| `~/.lightsprint/preferences.json` | User preferences set with `lightsprint config` (kept on uninstall) |
| `~/.lightsprint/task-map.json` | Claude Code task ID ↔ Lightsprint task ID mapping |
| `~/.lightsprint/cc-sessions/` | Per-session daemon state |
| `~/.lightsprint/daemon.log` | Hook and daemon log |

### Environment variables

| Variable | Purpose |
|---|---|
| `LIGHTSPRINT_BASE_URL` | Lightsprint instance to talk to (default `https://app.lightsprint.ai`) |
| `LIGHTSPRINT_CONFIG_DIR` | Override the `~/.lightsprint` directory |
| `LIGHTSPRINT_NO_BROWSER=1` | Don't open a browser during authorization |
| `LIGHTSPRINT_DEBUG` | Extra hook logging |
| `LIGHTSPRINT_LOCAL_PATH` | Install from a local checkout (`install.sh` compiles from source with Bun) |

---

## Development

```bash
bun install
bun test          # run the test suite
bun run build     # compile the lightsprint binary
```

See [docs/LOCAL_TESTING.md](docs/LOCAL_TESTING.md) for testing end-to-end against a local Lightsprint server.

---

## Uninstalling

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/uninstall.sh | bash
```

This removes the plugin and marketplace from Claude Code, deletes the plugin cache and the `lightsprint` binary, and clears `~/.lightsprint` (your connection, config and session state). `preferences.json` is kept.

---

## Troubleshooting

### Token expired / refresh failed

Use any `/lightsprint:` command. The plugin re-prompts for authorization if the refresh token has expired.

### Hook not firing

Verify the plugin is loaded:

```bash
claude --debug
```

Check that `hooks/hooks.json` is being picked up and its matchers are registered, then look at the hook log:

```bash
tail -f ~/.lightsprint/daemon.log
```
