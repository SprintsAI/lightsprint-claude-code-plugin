# Lightsprint Claude Code Plugin

Claude Code plugin for Lightsprint — `/lightsprint:` slash commands for managing tasks, cloud agents, PRs, and Codebase Ask from inside Claude Code, plus hooks that stream your Claude Code session to the workspace board.

## Prerequisites

- **Claude Code** CLI installed
- **macOS or Linux** (x64 or arm64), or **Windows** via the PowerShell installer
- **Node.js >= 18**, only if you install with `npx` — the CLI itself ships as a self-contained binary
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

The installer registers the Lightsprint marketplace with Claude Code, installs the plugin, and downloads the pre-compiled `lightsprint` CLI from the latest GitHub release. The binary is placed in the plugin cache and copied to `~/.local/bin/lightsprint` so you can run it from a terminal too.

### npx (recommended)

```bash
npx lightsprint
```

Once installed, `npx lightsprint <command>` (e.g. `npx lightsprint status`) runs the installed CLI instead of reinstalling.

### Curl fallback

If you don't have npm/npx available, you can install via curl:

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/install.sh | bash
```

### Windows

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

The plugin will be installed but the workspace connection step will be skipped. You can connect later by running `/lightsprint:tasks`, which prompts you to authorize and pick a workspace.

### Upgrading

```bash
lightsprint upgrade
```

---

## Authentication

Authentication is **on-demand** — the first time you use a `/lightsprint:` command without an active connection, the plugin opens your browser to authorize. You pick a Lightsprint workspace, and tokens are saved locally. Tokens refresh automatically.

The active workspace is stored in a single connection file (`~/.lightsprint/connection.json`). All commands (`tasks`, `projects`, `stacks`, `create`, etc.) operate against that connected workspace. Hooks silently skip if no connection exists (they never prompt).

### Switching workspaces

Run `lightsprint connect` again to authorize and switch to a different workspace, or `lightsprint disconnect` to clear the active connection. Use `lightsprint status` / `lightsprint whoami` to see which workspace is currently connected.

### Environment variables

| Variable | Purpose |
|---|---|
| `LIGHTSPRINT_BASE_URL` | Point at a self-hosted or non-production instance. Defaults to `https://app.lightsprint.ai`. `lightsprint connect --base-url <url>` does the same for one connection. |
| `LIGHTSPRINT_CONFIG_DIR` | Override where local state is stored. Defaults to `~/.lightsprint`. |
| `LIGHTSPRINT_NO_BROWSER` | Set to `1` to print the authorization URL instead of opening a browser (useful over SSH). |
| `LIGHTSPRINT_DEBUG` | Set to any value for verbose hook logging. |

---

## How It Works

### Skills (slash commands)

All skills operate on the connected workspace. Task IDs can be a display ID (`LIG-024`), a bare task number (`24`), or a raw ID.

**Tasks**

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List root tasks from the workspace board. Options: `--status <status,...>`, `--complexity`, `--assignee <name>`, `--mine`, `--unassigned`, `--deps has-dependencies\|has-dependents\|unblocked`, `--project <id\|none>`, `--stack <ref>`, `--sort position\|updated_at\|created_at`, `--limit N`, `--offset N` |
| `/lightsprint:projects` | List projects in the workspace. Options: `--status active\|completed\|archived` |
| `/lightsprint:create <title>` | Create a new task. Options: `--description <text>`, `--complexity low\|medium\|high`, `--status <status>`, `--project <id>`, `--stack <ref>`, `--depends-on <id,...>` |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, dependencies, complexity. Option: `--fields <f1,f2>` |
| `/lightsprint:update <id>` | Update a task. Options: `--title`, `--description`, `--status`, `--complexity`, `--assignee <name>`, `--project <id>`, `--requires-schema-change true\|false`, `--add-dep <id>`, `--remove-dep <id>` |
| `/lightsprint:claim <id>` | Claim a root task — sets it to `in_progress` and shows full details |
| `/lightsprint:current-task` | Show the task linked to the current Claude Code session, without needing an ID |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:delete <id>` | Delete a task permanently |

**Pull requests**

| Command | Description |
|---|---|
| `/lightsprint:link-pr` | Link a GitHub PR to a task (`--task <id> --pr-url <url>`). Moves the task to `in_review` and triggers an automated PR review. `--force` moves a PR already linked to another task. |
| `/lightsprint:unlink-pr <id>` | Remove the linked PR from a task |
| `/lightsprint:review-hub-signals <id>` | CI checks, reviews, comments, and deployments on the task's linked PR. `--refresh` re-fetches from GitHub. |
| `/lightsprint:review-hub-scores <id>` | AI readiness analysis — score, summaries, callouts, suggested actions. `--refresh` triggers a fresh analysis (consumes credits). |
| `/lightsprint:merge <id>` | Merge the task's linked PR. Supports direct merge and GitHub merge queue. |

**Cloud agents**

| Command | Description |
|---|---|
| `/lightsprint:agent-settings` | Show which providers (`anthropic`, `cursor`, `codex`) are configured and their default models |
| `/lightsprint:agent` | `launch`, `stop`, or check `settings` for cloud agents. `launch` accepts several `--task` flags to run agents in parallel, and `--auto-merge` / `--no-auto-merge` to control auto-merge. |
| `/lightsprint:agent-create-pr` | Open a PR from a cloud agent's working branch (`--task <id> --provider <provider> --agent-id <id>`) |

**Codebase Ask**

| Command | Description |
|---|---|
| `/lightsprint:ask` | Read-only Q&A over every repo in a stack. Subcommands: `list`, `create [--stack <ref>] [--title <text>]`, `get <threadId>`, `messages <threadId> [--content <text>] [--last N]`, `cancel <threadId>`, `delete <threadId>` |

Stacks group tasks within a workspace. List them with `lightsprint stacks`, inspect one with `lightsprint stacks get <stackId|prefix|name>`, and target a stack on `tasks`/`create`/`ask create` via `--stack <ref>`.

### Session sync (hooks)

When a Claude Code session starts in a connected workspace, the `SessionStart` hook launches a small background daemon for that session. It holds a WebSocket to Lightsprint and streams session events — prompts, stops, subagent activity, and `TaskCreate`/`TaskUpdate` calls — so the session shows up live on the board. The daemon shuts down when the session ends or the Claude Code process exits.

The `PostToolUse` hook on `Bash` also watches for `gh pr create`. When it sees a new PR URL, it tells Claude to link that PR to the session's current task. If the session has no task, Claude asks whether to link an existing task, skip, or always skip. To always skip without asking, run:

```bash
lightsprint config set link-pr.no-task-behavior always-skip
```

### Claiming tasks

When you use `/lightsprint:claim`, the plugin:
1. Sets the Lightsprint task to `in_progress` and links it to the current Claude Code session
2. Shows the task details and asks whether to start working on it
3. If you confirm, creates a Claude Code task linked via `metadata: { lightsprint_task_id: "<LS task ID>" }`
4. Subsequent `TaskUpdate` calls on the Claude Code task automatically sync to the correct Lightsprint task

Only root tasks can be claimed — claim the parent instead of a subtask.

### Using the CLI directly

Every skill is a thin wrapper around the `lightsprint` CLI, which you can also run in a terminal. Run `lightsprint help` for the full reference, or `lightsprint <command> --help` for one command. Commands beyond the skills:

| Command | Description |
|---|---|
| `lightsprint stacks [get <ref>]` | List stacks, or show one stack and its member repos |
| `lightsprint open` | Open the workspace board in your browser |
| `lightsprint status` / `whoami` | Show the connected workspace and auth info |
| `lightsprint connect` / `disconnect` | Connect to (or switch) a workspace, or clear the connection |
| `lightsprint config get\|set\|delete\|list` | Manage preferences in `~/.lightsprint/preferences.json` |
| `lightsprint describe [command]` | Dump a command's parameters, types, and valid enum values as JSON |
| `lightsprint upgrade` | Upgrade to the latest release |

The CLI is designed for agents as much as humans. Global flags:

- `--output json|text` — structured output (also accepted as `--json`); JSON is the default when stdout isn't a terminal, and errors go to stderr as JSON
- `--fields f1,f2` — return only the fields you need
- `--dry-run` — validate a mutating command locally without calling the API
- `--json-body '<json>'` — pass a raw request body to `create`/`update`
- `--page-all` — stream all tasks as NDJSON from `tasks`

---

## Plugin Structure

```
lightsprint-claude-code-plugin/
├── .claude-plugin/
│   ├── plugin.json             # Plugin manifest
│   └── marketplace.json        # Marketplace registry entry
├── hooks/
│   └── hooks.json              # Session lifecycle, event streaming, and PR-detection hooks
├── scripts/
│   ├── lightsprint.js          # Unified CLI entry point (compiled to `lightsprint` binary)
│   ├── ls-cli.js               # Skill commands (exports cliMain)
│   ├── cc-start.js             # SessionStart hook — spawns the session daemon
│   ├── cc-daemon.js            # Per-session daemon — WebSocket to Lightsprint + local HTTP for hooks
│   ├── cc-event.js             # Forwards hook events to the daemon
│   ├── cc-end.js               # SessionEnd hook
│   ├── cc-pr-created.js        # PostToolUse hook — detects `gh pr create`
│   ├── compile.sh              # Build script for the lightsprint binary
│   ├── install.ps1             # Windows installer
│   ├── __tests__/              # bun test suite
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── config.js           # Connection, base URL, and preferences
│       ├── connection.js       # Connection file I/O
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── validate.js         # Input hardening for IDs, enums, and text
│       ├── schema.js           # Command schemas (powers `describe` and `--help`)
│       ├── output.js           # JSON/text output and structured errors
│       ├── task-map.js         # CC↔LS task ID mapping
│       ├── status-mapper.js    # Status mapping logic
│       └── sentry.js           # Crash reporting
├── skills/                     # One SKILL.md per /lightsprint: command
├── pi-extension/               # Equivalent integration for the pi coding agent
├── npx-install.js              # `npx lightsprint` entry point
├── install.sh                  # One-line plugin installer (macOS/Linux)
├── uninstall.sh                # Clean removal
├── package.json
└── README.md
```

The only runtime dependency is `@sentry/node` for crash reporting; everything else uses Node.js built-ins. The CLI is compiled with Bun into a single binary, so users don't need Node or Bun to run it.

### Local files

All stored under `~/.lightsprint/` (or `$LIGHTSPRINT_CONFIG_DIR`):

| File | Purpose |
|---|---|
| `connection.json` | Active workspace connection — OAuth tokens (access + refresh + expiry) and workspace ID/name |
| `preferences.json` | User preferences set with `lightsprint config` |
| `task-map.json` | Claude Code task ID ↔ Lightsprint task ID mapping, scoped per session |
| `cc-sessions/` | Per-session daemon state |
| `daemon.log` | Hook and daemon log |

---

## Development

```bash
bun install
bun run test     # bun test
bun run build    # compile the lightsprint binary (also copies it to ~/.local/bin)
```

See [docs/LOCAL_TESTING.md](./docs/LOCAL_TESTING.md) for running the plugin end-to-end against a local Lightsprint server.

---

## Uninstalling

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/uninstall.sh | bash
```

This removes the plugin, the marketplace entry, the plugin cache, and the `~/.local/bin/lightsprint` binary, and clears the workspace connection and session state in `~/.lightsprint/`. Your `preferences.json` is kept.

---

## Troubleshooting

### Token expired / refresh failed

Use any `/lightsprint:` command — the plugin will re-prompt for authorization if the refresh token has expired.

### Session not showing on the board

Check the daemon log:

```bash
tail -f ~/.lightsprint/daemon.log
```

Hooks skip silently when there's no connection, so run `lightsprint status` to confirm you're connected.

### Hook not firing

Verify the plugin is loaded:

```bash
claude --debug
```

Check that `hooks/hooks.json` is being picked up and the `SessionStart` and `PostToolUse` hooks are registered.
