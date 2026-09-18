# Lightsprint Claude Code Plugin

Claude Code plugin for Lightsprint — task management skills, cloud agent control, and workspace board integration.

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

### Upgrading

```bash
lightsprint upgrade
```

Downloads and installs the latest release binary from GitHub releases.

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

Or connect to one directly:

```bash
lightsprint connect --base-url https://staging.lightsprint.ai
```

Defaults to `https://app.lightsprint.ai`.

---

## How It Works

### Skills (slash commands)

All skills operate on the connected workspace. Each one wraps the `lightsprint` CLI, so anything a skill does you can also do from a terminal.

#### Tasks

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List tasks from the workspace board. Options: `--status <s,s>`, `--complexity low\|medium\|high`, `--assignee <name>`, `--mine`, `--unassigned`, `--deps has-dependencies\|has-dependents\|unblocked`, `--project <id>\|none`, `--stack <ref>`, `--sort position\|updated_at\|created_at`, `--limit N`, `--offset N`, `--page-all` |
| `/lightsprint:create <title>` | Create a new task. Options: `--description <text>`, `--complexity <level>`, `--status <status>`, `--project <id>`, `--stack <ref>`, `--depends-on <ids>` |
| `/lightsprint:update <id>` | Update a task. Options: `--title`, `--description`, `--status`, `--complexity`, `--assignee`, `--project`, `--requires-schema-change <bool>`, `--add-dep <id>`, `--remove-dep <id>` |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, dependencies, complexity |
| `/lightsprint:claim <id>` | Claim a task — sets it to in_progress and shows full details |
| `/lightsprint:current-task` | Get the task linked to the current Claude Code session, discovered from the session PID — no task ID needed |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:delete <id>` | Delete a task permanently |
| `/lightsprint:projects` | List projects in the workspace. Options: `--status active\|completed\|archived` |

#### Pull requests and review

| Command | Description |
|---|---|
| `/lightsprint:link-pr` | Link a GitHub pull request to a task and move it to `in_review`. `--task <id> --pr-url <url> [--force]` |
| `/lightsprint:unlink-pr <id>` | Remove a linked pull request from a task |
| `/lightsprint:merge <id>` | Merge the PR linked to a task. Supports direct merge and the GitHub merge queue |
| `/lightsprint:review-hub-signals <id>` | PR signals — CI checks, reviews, comments, deployments. Option: `--refresh` |
| `/lightsprint:review-hub-scores <id>` | AI readiness analysis — score, summaries, callouts, suggested actions. Option: `--refresh` (consumes credits) |

#### Cloud agents

| Command | Description |
|---|---|
| `/lightsprint:agent` | Launch or stop a cloud agent on a task (`anthropic`, `cursor`, `codex`). Launch options: `--model`, `--base-ref`, `--environment-id`, `--auto-merge` / `--no-auto-merge`, `--yes` |
| `/lightsprint:agent-settings` | Show which agent providers are configured and their default models |
| `/lightsprint:agent-create-pr` | Open a GitHub PR from a cloud agent's working branch |

#### Ask

| Command | Description |
|---|---|
| `/lightsprint:ask` | Work with Codebase Ask threads: `list`, `create`, `get`, `messages` (list or send), `cancel`, `delete` |

Stacks group tasks within a workspace. List them with `lightsprint stacks`, inspect one with `lightsprint stacks get <stackId|prefix|name>`, and target a stack via `--stack <ref>` on `tasks`, `create`, and `ask create`.

### Agent-friendly output

The CLI is consumed mostly by agents, so every command takes the same global flags:

| Flag | Effect |
|---|---|
| `--output json\|text` | Output format. Defaults to `text` on a TTY and to `json` when stdout is piped |
| `--json` | Shorthand for `--output json` |
| `--fields f1,f2` | Return only the named fields (implies `--output json`) |
| `--dry-run` | Validate inputs locally without calling the API (`create`, `update`, `claim`, `comment`) |
| `--help`, `-h` | Show help |

Errors are emitted as structured JSON on stderr when JSON output is active, carrying an error code and the offending input. `create` and `update` also accept a full raw request body via `--json-body '{...}'`, and `lightsprint describe <command>` dumps a command's accepted parameters, types, and valid enum values as JSON so agents can self-serve instead of relying on a stale prompt.

### Claiming tasks

When you use `/lightsprint:claim`, the plugin:
1. Sets the Lightsprint task to `in_progress`
2. Creates a Claude Code task linked via `metadata: { lightsprint_task_id: "<LS task ID>" }`
3. Subsequent `TaskUpdate` calls on the Claude Code task automatically sync to the correct Lightsprint task

### Session hooks

`hooks/hooks.json` registers the plugin against Claude Code's session lifecycle. Every hook shells out to the `lightsprint` binary and exits quietly when no workspace is connected.

| Hook | Command |
|---|---|
| `SessionStart` / `SessionEnd` | `lightsprint cc-start` / `lightsprint cc-end` |
| `UserPromptSubmit`, `Stop`, `TaskCompleted`, `SubagentStart`, `SubagentStop` | `lightsprint cc-event` |
| `PostToolUse` (`TaskCreate`, `TaskUpdate`) | `lightsprint cc-event` |
| `PostToolUse` (`Bash`) | `lightsprint cc-pr-created` — detects a PR created from the shell and offers to link it |

A background daemon (`lightsprint cc-daemon`) keeps the session's state in sync over a WebSocket; `~/.lightsprint/daemon.log` is the first place to look when events stop flowing.

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
│   ├── ls-cli.js               # Command implementations (exports cliMain)
│   ├── cc-start.js             # SessionStart hook
│   ├── cc-end.js               # SessionEnd hook
│   ├── cc-event.js             # Prompt/stop/subagent/task hooks
│   ├── cc-pr-created.js        # PostToolUse(Bash) PR detection
│   ├── cc-daemon.js            # Background session-sync daemon
│   ├── compile.sh              # Build script for the lightsprint binary
│   ├── deploy-tag.sh           # Cut a release tag
│   ├── dev-local.sh            # Point a local build at a dev instance
│   ├── dev-restore.sh          # Restore the released build
│   ├── install.ps1             # Windows installer
│   ├── __tests__/              # bun test suite
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── browser.js          # Cross-platform browser launcher
│       ├── cc-utils.js         # Claude Code session state helpers
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── config.js           # Config/preferences resolution + on-demand auth trigger
│       ├── connection.js       # Active workspace connection file
│       ├── filelock.js         # Cross-process file locking
│       ├── options.js          # Global flag parsing (--output/--json/--dry-run/--fields)
│       ├── output.js           # JSON + text result and error formatting
│       ├── schema.js           # Command schemas behind `lightsprint describe`
│       ├── sentry.js           # Optional error reporting
│       ├── status-mapper.js    # Status mapping logic
│       ├── task-map.js         # CC↔LS task ID mapping
│       └── validate.js         # Input validation / hallucination hardening
├── skills/                     # One SKILL.md per slash command (see the tables above)
├── docs/                       # Local testing notes and design docs
├── pi-extension/               # The same integration as a `pi` extension
├── npx-install.js              # `npx lightsprint` installer shim (the published npm bin)
├── install.sh                  # One-line plugin installer
├── uninstall.sh                # Clean removal
├── package.json
└── README.md
```

One runtime dependency (`@sentry/node`, for optional error reporting); everything else uses Node.js built-ins — `fetch`, `crypto`, and `fs`.

### Building and testing

```bash
bun install
bun test           # scripts/__tests__
bun run build      # compile scripts/lightsprint.js to the `lightsprint` binary
```

`bun run build` stamps the binary with the current git hash, version, and build time, and copies it to `~/.local/bin` when that directory exists. Set `SENTRY_DSN` in a local `.env` (see `.env.example`) to bake in error reporting.

### Local files

| File | Purpose |
|---|---|
| `~/.lightsprint/connection.json` | Active workspace connection — OAuth tokens (access + refresh + expiry) and workspace ID/name |
| `~/.lightsprint/config.json` | Plugin configuration |
| `~/.lightsprint/preferences.json` | User preferences, managed with `lightsprint config get\|set\|delete\|list` |
| `~/.lightsprint/task-map.json` | Claude Code ↔ Lightsprint task ID mapping |
| `~/.lightsprint/cc-sessions/` | Per-session state written by the hooks |
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

### Events stop syncing

Tail the daemon log:

```bash
tail -f ~/.lightsprint/daemon.log
```
