# Lightsprint Claude Code Plugin

Claude Code plugin for Lightsprint — task board sync, pull request tracking, cloud agents, and Codebase Ask, driven from inside your editor.

## Prerequisites

- **Claude Code** CLI installed
- **Node.js >= 18** (for built-in `fetch`)
- A **Lightsprint workspace** at [lightsprint.ai](https://lightsprint.ai)

Bun is only needed for local development (the compile step in `install.sh`).

## Quick Start

Install the plugin (one time):

```bash
npx lightsprint
```

Then use any `/lightsprint:` command — the plugin opens your browser to connect on first use:

```
/lightsprint:tasks
```

The first command prompts for authorization and connects you to a Lightsprint workspace.

---

## Installation

### npx (recommended)

```bash
npx lightsprint
```

### Curl fallback

If you don't have npm/npx available, install via curl:

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/install.sh | bash
```

### Windows

```powershell
irm https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/scripts/install.ps1 | iex
```

Windows installs the production build only. Local development mode is macOS and Linux.

### Custom base URL

Pass a base URL to point the installer at a self-hosted or staging instance:

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/install.sh | bash -s -- --base-url=https://staging.lightsprint.ai
```

`install.sh` writes the value to `~/.lightsprint/config.json` so hooks keep using it across sessions.

### Non-interactive install

If you're installing from a non-interactive environment (e.g., Claude Code, CI, or a script):

```bash
npx -y lightsprint
```

Or with curl:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/install.sh)" <<< $'Y\nY'
```

The plugin installs, but the workspace connection step is skipped. Connect later by running `/lightsprint:tasks`, which prompts you to authorize and pick a workspace.

### Development install

To install from a local checkout, set `LIGHTSPRINT_LOCAL_PATH`. The installer compiles the CLI with Bun, symlinks the plugin into the marketplace, and links your working tree:

```bash
LIGHTSPRINT_LOCAL_PATH=$(pwd) npx lightsprint
```

See [docs/LOCAL_TESTING.md](docs/LOCAL_TESTING.md) for the full local workflow.

---

## Authentication

Authentication is **on-demand** — the first time you use a `/lightsprint:` command without an active connection, the plugin opens your browser to authorize. You pick a Lightsprint workspace, and tokens are saved locally. Tokens refresh automatically.

The active workspace is stored in a single connection file (`~/.lightsprint/connection.json`). All commands (`tasks`, `projects`, `stacks`, `create`, etc.) operate against that connected workspace. Hooks silently skip when no connection exists, so they never prompt.

### Switching workspaces

Run `lightsprint connect` to authorize and switch to a different workspace, or `lightsprint disconnect` to clear the active connection. Use `lightsprint status` or `lightsprint whoami` to see which workspace is connected.

### Optional: Custom base URL

For self-hosted Lightsprint instances:

```bash
export LIGHTSPRINT_BASE_URL=https://your-instance.example.com
```

You can also set it once in `~/.lightsprint/config.json`:

```json
{ "baseUrl": "https://your-instance.example.com" }
```

The default is `https://app.lightsprint.ai`.

---

## Commands

Every command runs through the `lightsprint` CLI. Each `/lightsprint:<name>` skill wraps one command and passes its arguments through.

### Global flags

| Flag | Effect |
|---|---|
| `--output json\|text` | Output format. Default is `text`. |
| `--json` | Shorthand for `--output json`. |
| `--dry-run` | Validate inputs without calling the API (`create`, `update`, `claim`, `comment`). |
| `--fields f1,f2` | Return only the named fields. Implies `--output json`. |
| `--help`, `-h` | Show help for the command. |

### Tasks

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List tasks from the board. Flags: `--status`, `--complexity`, `--assignee`, `--mine`, `--unassigned`, `--deps has-dependencies\|has-dependents\|unblocked`, `--project`, `--stack`, `--sort position\|updated_at\|created_at`, `--limit`, `--offset`, `--page-all`. |
| `/lightsprint:create <title>` | Create a task in the workspace default stack. Flags: `--title`, `--description`, `--complexity low\|medium\|high`, `--status`, `--project`, `--stack`, `--depends-on`, `--json-body`. |
| `/lightsprint:get <id>` | Show full task details. Add `--fields` to narrow the output. |
| `/lightsprint:update <id>` | Update a task. Flags: `--title`, `--description`, `--status`, `--complexity`, `--requires-schema-change`, `--assignee`, `--project`, `--position`, `--add-dep`, `--remove-dep`, `--json-body`. |
| `/lightsprint:claim <id>` | Claim a task — sets it to `in_progress` and shows full details. |
| `/lightsprint:current-task` | Get the task linked to the current Claude Code session. Uses `--cc-pid` to find it. |
| `/lightsprint:comment <id> <text>` | Add a comment to a task. |
| `/lightsprint:delete <id>` | Delete a task permanently. |

A task ID can be positional or passed with `--task`. Unfinished work keeps `position` and `status` in separate sections: use `--position` to reorder inside a section, and `--status` to move between sections. The command rejects both at once.

### Pull requests and review

| Command | Description |
|---|---|
| `/lightsprint:link-pr --task <id> --pr-url <url>` | Link a pull request to a task. Sets the task to `in_review` and starts the automated review. Add `--force` to move a link from another task. |
| `/lightsprint:unlink-pr <id>` | Remove a linked pull request. |
| `/lightsprint:merge <id>` | Merge the task's linked pull request. Handles direct merges and the GitHub merge queue. |
| `/lightsprint:review-hub-signals <id>` | Show CI checks, reviews, comments, and deployments for the linked pull request. `--refresh` re-fetches from GitHub. |
| `/lightsprint:review-hub-scores <id>` | Show the AI readiness score, section summaries, callouts, and suggested actions. `--refresh` starts a fresh analysis and consumes credits. |

`merge` reports `merged` or `queued`. A `queued` result means the repository uses the GitHub merge queue, and the pull request merges when the required checks pass.

### Cloud agents

| Command | Description |
|---|---|
| `/lightsprint:agent` | Launch, stop, or inspect cloud agents. Subcommands: `launch`, `stop`, `settings`. |
| `/lightsprint:agent-settings` | Show which providers (anthropic, cursor, codex) are configured and their default models. |
| `/lightsprint:agent-create-pr` | Create a pull request from a cloud agent's working branch. |

`agent launch` takes `--task` (repeatable, launches in parallel), `--provider anthropic\|cursor\|codex`, `--model`, `--base-ref`, `--environment-id`, and `--auto-merge` / `--no-auto-merge`. Codex usually needs `--environment-id`; discover one with `agent settings --provider codex`. Only one agent runs per task per provider.

Omitting `--auto-merge` inherits the task's current setting. Pass `--no-auto-merge` to guarantee a human merges. Arming auto-merge needs merge permission, and the flag is refused with more than one `--task` unless you also pass `--yes`.

### Codebase Ask

| Command | Description |
|---|---|
| `/lightsprint:ask` | Work with Ask threads. Subcommands: `list`, `create`, `get`, `messages`, `cancel`, `delete`. |

```
lightsprint ask list [--limit N] [--offset N]
lightsprint ask create [--stack <ref>] [--title <text>]
lightsprint ask get <threadId>
lightsprint ask messages <threadId> [--content <text>] [--last N]
lightsprint ask cancel <threadId>
lightsprint ask delete <threadId>
```

`ask messages --content` dispatches an agent turn and streams the reply. Omitting `--content` lists existing messages. Ask is read-only: it never edits code, commits, or opens pull requests.

### Workspace and connection

| Command | Description |
|---|---|
| `lightsprint stacks` | List stacks. `lightsprint stacks get <stackId\|prefix\|name>` inspects one. |
| `/lightsprint:projects` | List projects. Filter with `--status active\|completed\|archived`. |
| `lightsprint status` | Show connection status for the active workspace. |
| `lightsprint whoami` | Show the connected workspace and authentication info. |
| `lightsprint open` | Open the workspace board in your browser. |
| `lightsprint connect [--base-url <url>]` | Authenticate and connect to a workspace. |
| `lightsprint disconnect` | Remove the active workspace's credentials. |
| `lightsprint upgrade` | Download and install the latest version from GitHub releases. |
| `lightsprint config <get\|set\|delete\|list>` | Read or write local preferences. |
| `lightsprint describe [command]` | Print a command's parameters, types, and enum values as JSON. |

Stacks group tasks within a workspace. Target one on `tasks`, `create`, or `ask create` with `--stack <ref>`, where the ref is a stack ID, task prefix, or name.

---

## How It Works

### Skills (slash commands)

Each skill in `skills/` is a thin Markdown wrapper that calls one `lightsprint` command and passes `$ARGUMENTS` through. The skill files hold the invariants an agent cannot infer from `--help` — for example, always link a pull request right after creating one, and read cached readiness scores before paying for a refresh.

### Session hooks

`hooks/hooks.json` registers hooks that keep the board in sync without any manual step:

| Hook | Runs | Purpose |
|---|---|---|
| `SessionStart` | `lightsprint cc-start` | Spawns the daemon for this session and opens the WebSocket. |
| `SessionEnd` | `lightsprint cc-end` | Closes the session. |
| `UserPromptSubmit`, `Stop`, `TaskCompleted`, `SubagentStart`, `SubagentStop` | `lightsprint cc-event` | Forwards activity to the daemon. |
| `PostToolUse` (`TaskCreate`, `TaskUpdate`) | `lightsprint cc-event` | Mirrors Claude Code task changes to Lightsprint. |
| `PostToolUse` (`Bash`) | `lightsprint cc-pr-created` | Detects `gh pr create` output and prompts to link the pull request. |

Hooks exit silently when no workspace connection exists.

### Claiming tasks

When you use `/lightsprint:claim`, the plugin:

1. Sets the Lightsprint task to `in_progress`.
2. Creates a Claude Code task linked through `metadata: { lightsprint_task_id: "<LS task ID>" }`.
3. Syncs later `TaskUpdate` calls on that Claude Code task to the correct Lightsprint task.

---

## Plugin Structure

```
lightsprint-claude-code-plugin/
├── .claude-plugin/
│   ├── plugin.json             # Plugin manifest
│   └── marketplace.json        # Marketplace registry entry
├── hooks/
│   └── hooks.json              # Session lifecycle, task sync, and PR detection hooks
├── scripts/
│   ├── lightsprint.js          # Unified CLI entry point (compiled to the `lightsprint` binary)
│   ├── ls-cli.js               # Command dispatch and task, project, agent, and Ask commands
│   ├── cc-start.js             # SessionStart hook: spawns the daemon
│   ├── cc-daemon.js            # Per-session HTTP server and WebSocket client
│   ├── cc-end.js               # SessionEnd hook: closes the session
│   ├── cc-event.js             # Activity forwarding hook
│   ├── cc-pr-created.js        # PostToolUse hook: detects new pull requests
│   ├── compile.sh              # Build script for the `lightsprint` binary
│   ├── install.ps1             # Windows installer
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── browser.js          # Browser launcher for the OAuth flow
│       ├── cc-utils.js         # Session state, logging, port allocation
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── config.js           # Config, preferences, and connection resolution
│       ├── connection.js       # Active workspace connection file
│       ├── filelock.js         # Cross-process file locking
│       ├── options.js          # Global flag parsing
│       ├── output.js           # Text and JSON output formatting
│       ├── schema.js           # Command schemas for `describe` and `--help`
│       ├── sentry.js           # Crash reporting for the daemon
│       ├── status-mapper.js    # Status mapping logic
│       ├── task-map.js         # Claude Code ↔ Lightsprint task ID mapping
│       └── validate.js         # Input validation
├── skills/                     # One directory per /lightsprint: command
├── pi-extension/               # Equivalent integration for pi
├── docs/
│   └── LOCAL_TESTING.md        # End-to-end local test guide
├── install.sh                  # macOS and Linux installer
├── uninstall.sh                # Clean removal
├── npx-install.js              # npx entry point
├── package.json
└── README.md
```

The only runtime dependency is `@sentry/node`, which the daemon uses for crash reporting.

### Local files

| File | Purpose |
|---|---|
| `~/.lightsprint/connection.json` | Active workspace connection — OAuth tokens (access, refresh, expiry) and workspace ID/name |
| `~/.lightsprint/config.json` | Installer-level config, such as `baseUrl` |
| `~/.lightsprint/preferences.json` | Local preferences, for example `link-pr.no-task-behavior` |
| `~/.lightsprint/task-map.json` | Claude Code to Lightsprint task ID map |
| `~/.lightsprint/cc-sessions/` | Per-session daemon state, keyed by Claude Code session |
| `~/.lightsprint/daemon.log` | Daemon and hook log |

Set `LIGHTSPRINT_CONFIG_DIR` to point all of these at another directory, which is useful for isolated test runs.

### Preferences

```bash
lightsprint config set link-pr.no-task-behavior always-skip
lightsprint config get link-pr.no-task-behavior
lightsprint config list
```

---

## Uninstalling

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/uninstall.sh | bash
```

This removes the plugin from Claude Code and clears the active workspace connection in `~/.lightsprint/connection.json`.

---

## Troubleshooting

### Token expired or refresh failed

Run any `/lightsprint:` command — the plugin re-prompts for authorization when the refresh token has expired.

### Hook not firing

Verify the plugin is loaded:

```bash
claude --debug
```

Check that `hooks/hooks.json` is picked up and the `PostToolUse` matchers are registered.

### Daemon not connecting

```bash
tail -f ~/.lightsprint/daemon.log
ps aux | grep cc-daemon
cat ~/.lightsprint/cc-sessions/*.json
```

The log shows whether the daemon started, which port it bound, and whether the WebSocket connected. A missing connection in `~/.lightsprint/connection.json` stops hooks before they start.

### Reset the connection

```bash
lightsprint disconnect
lightsprint connect
```
