# Lightsprint Claude Code Plugin

Claude Code plugin for Lightsprint. It adds `/lightsprint:` slash commands for working with your workspace board, plus a `lightsprint` CLI. It also syncs your Claude Code session activity to Lightsprint through hooks.

## Prerequisites

- **Claude Code** CLI installed
- **Node.js >= 18** (for built-in `fetch`)
- A **Lightsprint workspace** at [lightsprint.ai](https://lightsprint.ai)

## Quick Start

Install the plugin once:

```bash
npx lightsprint
```

Then run any `/lightsprint:` command. On first use, the plugin opens your browser so you can connect a workspace:

```
/lightsprint:tasks
```

The first command asks you to authorize, then connects you to the Lightsprint workspace you pick.

---

## Installation

### npx (recommended)

```bash
npx lightsprint
```

This command installs the Claude Code plugin, plus the `lightsprint` CLI binary at `~/.local/bin/lightsprint`. If that directory isn't on your `PATH`, the installer tells you what to add. When you pass arguments, as in `npx lightsprint status`, npx runs the installed CLI instead of reinstalling.

### Curl (macOS / Linux)

If npm/npx isn't available, install with curl:

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/install.sh | bash
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/scripts/install.ps1 | iex
```

### Non-interactive install

To install without a terminal (for example from Claude Code, CI, or a script):

```bash
npx -y lightsprint
```

The installer doesn't ask any questions. It only tries to connect a workspace when it runs inside a git repository, and that step needs an interactive terminal. If the installer can't connect, you can do it later with `/lightsprint:tasks` or `lightsprint connect`.

---

## Authentication

Authentication happens **on demand**. The first time you run a `/lightsprint:` command without a connection, the plugin opens your browser so you can authorize. You pick a Lightsprint workspace and the plugin saves the tokens locally. Tokens refresh on their own.

The active workspace is stored in a single connection file, `~/.lightsprint/connection.json`. Every command works against that workspace. Hooks never prompt: if no connection exists, they do nothing.

### Switching workspaces

- `lightsprint connect`: authorize again and switch to another workspace
- `lightsprint disconnect`: clear the active connection
- `lightsprint status` / `lightsprint whoami`: show which workspace you're connected to

### Optional: Custom base URL

For a self-hosted or non-production Lightsprint instance, set the base URL when you install:

```bash
LIGHTSPRINT_BASE_URL=https://your-instance.example.com npx lightsprint
```

You can also set it when you connect:

```bash
lightsprint connect --base-url https://your-instance.example.com
```

The default is `https://app.lightsprint.ai`. The installer saves the URL to `~/.lightsprint/config.json` so hooks use it too. Setting `LIGHTSPRINT_BASE_URL` in your environment overrides it.

---

## How It Works

### Skills (slash commands)

Each skill is a thin wrapper around a `lightsprint` CLI command and works on the connected workspace. Task IDs can be a display ID (`LIG-024`), a bare task number (`24`), or a raw ID.

**Tasks**

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List root tasks on the board. Filters: `--status`, `--complexity`, `--assignee`, `--mine`, `--unassigned`, `--deps`, `--project`, `--stack`, `--sort`, `--limit`, `--offset` |
| `/lightsprint:get <id>` | Show a task's full details: title, status, description, todo list, related files, dependencies, complexity. `--fields` limits the output |
| `/lightsprint:create <title>` | Create a task. Options: `--description`, `--complexity low\|medium\|high`, `--status`, `--project`, `--stack`, `--depends-on` |
| `/lightsprint:update <id>` | Update a task: `--title`, `--description`, `--status`, `--complexity`, `--requires-schema-change`, `--assignee`, `--project`, `--add-dep`, `--remove-dep` |
| `/lightsprint:claim <id>` | Claim a root task: sets it to `in_progress` and shows its details |
| `/lightsprint:current-task` | Show the task linked to the current Claude Code session |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:delete <id>` | Permanently delete a task |
| `/lightsprint:projects` | List projects in the workspace (`--status active\|completed\|archived`) |

Statuses are `backlog`, `todo`, `in_progress`, `in_review` and `done`.

**Pull requests and review**

| Command | Description |
|---|---|
| `/lightsprint:link-pr` | Link a GitHub PR to a task (`--task <id> --pr-url <url> [--force]`). Moves the task to `in_review` and starts an automated PR review |
| `/lightsprint:unlink-pr <id>` | Remove the PR linked to a task |
| `/lightsprint:review-hub-signals <id>` | Show CI checks, reviews, comments and deployments for the task's PR (`--refresh` fetches them again) |
| `/lightsprint:review-hub-scores <id>` | Show the AI readiness analysis (score, callouts, suggested actions) for the task's PR. `--refresh` runs a fresh analysis, which uses credits |
| `/lightsprint:merge <id>` | Merge the task's linked PR. Works with GitHub merge queues |

**Cloud agents and Ask**

| Command | Description |
|---|---|
| `/lightsprint:agent` | Launch or stop a cloud agent on a task (`anthropic`, `cursor` or `codex`), or check provider settings. `agent launch --auto-merge` turns on auto-merge |
| `/lightsprint:agent-settings` | Show which agent providers are configured, with their default models |
| `/lightsprint:agent-create-pr` | Open a GitHub PR from a cloud agent's working branch |
| `/lightsprint:ask` | Use Codebase Ask threads (read-only Q&A over a stack's repos): `list`, `create`, `get`, `messages`, `cancel`, `delete` |

Stacks group tasks within a workspace. List them with `lightsprint stacks`, inspect one with `lightsprint stacks get <stackId|prefix|name>`, and target a stack on `tasks`, `create` or `ask create` with `--stack <ref>`.

### The `lightsprint` CLI

You can also run the skills' commands directly, along with a few CLI-only ones:

| Command | Description |
|---|---|
| `lightsprint connect` / `disconnect` | Connect to a workspace or clear the connection |
| `lightsprint status` / `whoami` | Show the connected workspace and auth info |
| `lightsprint open` | Open the workspace board in your browser |
| `lightsprint stacks [get <ref>]` | List stacks, or show one stack and its member repos |
| `lightsprint config get\|set\|delete\|list` | Manage preferences in `~/.lightsprint/preferences.json` |
| `lightsprint describe [command]` | Print a command's accepted parameters and enum values as JSON |
| `lightsprint upgrade` | Install the latest release from GitHub |
| `lightsprint version` | Show version and build info |

Global flags, built for agents: `--output json|text` (or `--json`), `--fields f1,f2`, and `--dry-run` to validate a command without calling the API. `create` and `update` also accept `--json-body '<json>'` for a raw request body. Run `lightsprint help` or `lightsprint <command> --help` for the full reference.

### Session sync (hooks)

The plugin registers these Claude Code hooks in `hooks/hooks.json`. They load automatically with the plugin, so you don't need to edit `~/.claude/settings.json`.

| Hook | What it does |
|---|---|
| `SessionStart` | `lightsprint cc-start` starts a background daemon for the session. The daemon streams events to Lightsprint over a WebSocket. |
| `UserPromptSubmit`, `Stop`, `TaskCompleted`, `SubagentStart`, `SubagentStop`, `PostToolUse` (`TaskCreate`, `TaskUpdate`) | `lightsprint cc-event` forwards session activity to the daemon |
| `PostToolUse` (`Bash`) | `lightsprint cc-pr-created` spots a successful `gh pr create` and prompts the agent to link the PR to its task |
| `SessionEnd` | `lightsprint cc-end` ends the session and stops the daemon |

### Claiming tasks

When you use `/lightsprint:claim` (or create a task and choose to start it):

1. The Lightsprint task is set to `in_progress`.
2. The agent creates a Claude Code task linked with `metadata: { lightsprint_task_id: "<LS task ID>" }`.
3. Later `TaskUpdate` calls on that Claude Code task sync to the Lightsprint task. Claude Code statuses map like this: `pending` → `backlog`, `in_progress` → `in_progress`, `completed` → `done`.

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
│   ├── lightsprint.js          # Unified CLI entry point (compiled to the `lightsprint` binary)
│   ├── ls-cli.js               # Task, PR, agent and Ask commands
│   ├── cc-start.js             # SessionStart hook: spawns the session daemon
│   ├── cc-daemon.js            # Per-session daemon (WebSocket to Lightsprint + local HTTP for hooks)
│   ├── cc-event.js             # Forwards hook events to the daemon
│   ├── cc-pr-created.js        # Detects `gh pr create` and prompts PR linking
│   ├── cc-end.js               # SessionEnd hook
│   ├── compile.sh              # Builds the `lightsprint` binary
│   ├── install.ps1             # Windows installer
│   ├── lib/                    # Auth, config, HTTP client, validation, output, task mapping, etc.
│   └── __tests__/              # Bun tests
├── skills/<name>/SKILL.md      # One directory per /lightsprint:<name> skill
├── pi-extension/               # Same integration for the pi coding agent
├── docs/                       # Local testing guide, design specs and plans
├── install.sh                  # macOS / Linux installer
├── npx-install.js              # `npx lightsprint` entry point
├── uninstall.sh                # Clean removal
└── package.json
```

At runtime the CLI uses Node.js built-ins (`fetch`, `crypto`, `fs`). Its only npm dependency is `@sentry/node`, which handles crash reporting.

### Local files

All of these live in `~/.lightsprint/`. Set `LIGHTSPRINT_CONFIG_DIR` to use a different directory.

| File | Purpose |
|---|---|
| `connection.json` | Active workspace connection: OAuth tokens (access, refresh, expiry) and workspace ID and name |
| `config.json` | Base URL saved by the installer |
| `preferences.json` | User preferences set with `lightsprint config` |
| `task-map.json` | Links between Claude Code tasks and Lightsprint tasks |
| `cc-sessions/` | Per-session daemon state |
| `daemon.log` | Daemon and hook log |

---

## Development

```bash
bun install
bun test          # run the test suite
bun run build     # compile the `lightsprint` binary
```

To install from a local checkout instead of GitHub:

```bash
LIGHTSPRINT_LOCAL_PATH=$(pwd) bash install.sh
```

See [docs/LOCAL_TESTING.md](docs/LOCAL_TESTING.md) to test end to end against a local Lightsprint server.

---

## Uninstalling

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/uninstall.sh | bash
```

This removes the plugin and its marketplace entry from Claude Code, the plugin cache, and the `lightsprint` binary. It also deletes your connection, config and session files from `~/.lightsprint`, but keeps `preferences.json`.

---

## Troubleshooting

### Token expired / refresh failed

Run any `/lightsprint:` command, or `lightsprint connect`. If the refresh token has expired, the plugin asks you to authorize again.

### Hook not firing

Check that the plugin is loaded:

```bash
claude --debug
```

Confirm that Claude Code picks up `hooks/hooks.json` and registers the `PostToolUse` matchers. For daemon problems, watch the log:

```bash
tail -f ~/.lightsprint/daemon.log
```
