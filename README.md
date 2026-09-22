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
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, dependencies, complexity |
| `/lightsprint:create <title>` | Create a new task. Options: `--description <text>`, `--complexity low\|medium\|high`, `--status backlog\|todo\|in_progress\|in_review\|done`, `--stack <ref>` |
| `/lightsprint:update <id>` | Update a task. Options: `--title <text>`, `--description <text>`, `--status <status>`, `--complexity <level>`, `--assignee <name>`, `--requires-schema-change`, plus position and dependencies |
| `/lightsprint:claim <id>` | Claim a task — sets it to in_progress and shows full details |
| `/lightsprint:current-task` | Get the task linked to the current Claude Code session, discovered from the session PID (no task ID needed) |
| `/lightsprint:delete <id>` | Permanently delete a task from the board |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:projects` | List projects in the workspace |

**Pull requests**

| Command | Description |
|---|---|
| `/lightsprint:link-pr <id> <url>` | Link a GitHub pull request to a task |
| `/lightsprint:unlink-pr <id>` | Remove a linked pull request from a task |
| `/lightsprint:merge <id>` | Merge the pull request linked to a task. Supports direct merge and the GitHub merge queue |
| `/lightsprint:review-hub-signals <id>` | PR signals — CI checks, reviews, comments, deployments |
| `/lightsprint:review-hub-scores <id>` | AI readiness analysis — score, summaries, callouts, suggested actions |

**Cloud agents**

| Command | Description |
|---|---|
| `/lightsprint:agent` | Launch or stop a cloud agent on a task. Providers: `anthropic`, `cursor`, `codex`. Supports `--auto-merge` |
| `/lightsprint:agent-settings` | Show which providers are configured and their default models |
| `/lightsprint:agent-create-pr` | Open a GitHub PR from a cloud agent's working branch |

Stacks group tasks within a workspace. List them with `lightsprint stacks`, inspect one with `lightsprint stacks get <stackId|prefix|name>`, and target a stack on `tasks`/`create` via `--stack <ref>`.

### CLI

The skills call a `lightsprint` binary you can also drive directly. Run `lightsprint --help` for the full surface, or `lightsprint <command> --help` for one command.

| Command | Description |
|---|---|
| `lightsprint connect` / `disconnect` | Authorize and switch workspaces, or clear the connection |
| `lightsprint status` / `whoami` | Show the current connection and auth info |
| `lightsprint open` | Open the workspace board in your browser |
| `lightsprint stacks [get <ref>]` | List stacks, or inspect one |
| `lightsprint describe [command]` | Dump accepted parameters, types, and enum values as JSON |
| `lightsprint config <get\|set\|delete\|list>` | Read and write local CLI config |
| `lightsprint upgrade` | Upgrade to the latest version |
| `lightsprint version` | Show version and build info |

Global flags, available on every command:

| Flag | Description |
|---|---|
| `--output json\|text` | Output format (default `text`) |
| `--json` | Shorthand for `--output json` |
| `--dry-run` | Validate inputs locally without calling the API |
| `--fields f1,f2` | Return only the named fields (implies `--output json`) |
| `--help`, `-h` | Command-specific help |

Because the CLI is consumed mostly by agents rather than humans, task IDs and enum values are validated before they reach the API — see [`CLAUDE.md`](./CLAUDE.md) for the design principles behind that.

### Claiming tasks

When you use `/lightsprint:claim`, the plugin:
1. Sets the Lightsprint task to `in_progress`
2. Creates a Claude Code task linked via `metadata: { lightsprint_task_id: "<LS task ID>" }`
3. Subsequent `TaskUpdate` calls on the Claude Code task automatically sync to the correct Lightsprint task

### Hooks

`hooks/hooks.json` registers the plugin against Claude Code's session lifecycle. Every handler is a `lightsprint` subcommand, and all of them exit quietly when no workspace connection exists — hooks never prompt for authorization.

| Hook | Handler | Purpose |
|---|---|---|
| `SessionStart` | `lightsprint cc-start` | Register the session and start the daemon |
| `SessionEnd` | `lightsprint cc-end` | Tear the session down |
| `UserPromptSubmit`, `Stop` | `lightsprint cc-event` | Report session activity |
| `TaskCompleted`, `SubagentStart`, `SubagentStop` | `lightsprint cc-event` | Report task and subagent progress |
| `PostToolUse` (`TaskCreate`, `TaskUpdate`) | `lightsprint cc-event` | Sync task state back to the board |
| `PostToolUse` (`Bash`) | `lightsprint cc-pr-created` | Detect `gh pr create` and link the PR to the task |

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
│   ├── cc-start.js             # SessionStart hook handler
│   ├── cc-end.js               # SessionEnd hook handler
│   ├── cc-event.js             # Prompt/Stop/Task/Subagent hook handler
│   ├── cc-pr-created.js        # Detects `gh pr create` and links the PR
│   ├── cc-daemon.js            # Background session daemon
│   ├── compile.sh              # Build script for the lightsprint binary
│   ├── install.ps1             # Windows installer
│   ├── dev-local.sh            # Point Claude Code at your working copy
│   ├── dev-restore.sh          # Restore the released build
│   ├── __tests__/              # Bun test suite
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── browser.js          # Cross-platform browser launcher
│       ├── config.js           # Token resolution + on-demand auth trigger
│       ├── connection.js       # Active workspace connection state
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── output.js           # text/json output formatting
│       ├── options.js          # Global flag parsing
│       ├── schema.js           # Parameter schemas behind `describe`
│       ├── validate.js         # Task ID / enum / control-char validation
│       ├── filelock.js         # Atomic writes to local state files
│       ├── sentry.js           # Error reporting
│       ├── cc-utils.js         # Claude Code hook helpers
│       ├── task-map.js         # CC↔LS task ID mapping
│       └── status-mapper.js    # Status mapping logic
├── skills/                     # One SKILL.md per slash command (see table above)
├── pi-extension/               # Same functionality as a pi extension
├── docs/                       # Local testing notes and design docs
├── install.sh                  # One-line plugin installer
├── uninstall.sh                # Clean removal
├── npx-install.js              # `npx lightsprint` entry point (the published package)
├── package.json
└── README.md
```

One runtime dependency (`@sentry/node`, for error reporting). Everything else uses Node.js built-ins — `fetch`, `crypto`, `fs`.

### Local files

| File | Purpose |
|---|---|
| `~/.lightsprint/connection.json` | Active workspace connection — OAuth tokens (access + refresh + expiry) and workspace ID/name |
| `~/.lightsprint/task-map.json` | Claude Code ↔ Lightsprint task ID mapping |
| `~/.lightsprint/preferences.json` | Local CLI preferences (`lightsprint config`) |
| `~/.lightsprint/cc-sessions/` | Per-session state for the hook handlers |
| `~/.lightsprint/daemon.log` | Session daemon log — start here when debugging hooks |

---

## Development

```bash
bun install          # Install dependencies
bun test             # Run the test suite (scripts/__tests__)
bun run build        # Compile the lightsprint binary (scripts/compile.sh)
```

To test a working copy against your own Claude Code install, run `scripts/dev-local.sh` to point the plugin at this checkout, and `scripts/dev-restore.sh` to switch back to the released build. `docs/LOCAL_TESTING.md` has the details.

There is also a [pi](https://github.com/badlogic/pi-mono) build of the same functionality under [`pi-extension/`](./pi-extension/).

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

Check that `hooks/hooks.json` is being picked up and `PostToolUse` matchers are registered. Then tail the daemon log, which records what each handler did:

```bash
tail -f ~/.lightsprint/daemon.log
```

Hooks exit silently when no workspace is connected, so an empty log usually means there is no connection — run `lightsprint status` to confirm.
