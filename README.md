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

All skills operate on the connected workspace. Each skill wraps one `lightsprint` CLI command.

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List root tasks from the workspace board. Filters include `--status`, `--mine`, `--unassigned`, `--complexity`, `--deps`, `--project`, `--stack` and `--limit`. |
| `/lightsprint:projects` | List projects in the workspace. |
| `/lightsprint:create <title>` | Create a task in the workspace default stack. Options include `--description`, `--complexity`, `--status`, `--project` and `--stack`. |
| `/lightsprint:update <id>` | Update a task's title, description, status, complexity, schema-change flag, assignee, position or dependencies. |
| `/lightsprint:get <id>` | Show full task details: title, status, description, todo list, related files, dependencies and complexity. |
| `/lightsprint:claim <id>` | Claim a root task. It sets the task to `in_progress` and links it to the Claude Code session. |
| `/lightsprint:current-task` | Show the task linked to the current Claude Code session. |
| `/lightsprint:comment <id> <text>` | Add a comment to a task. |
| `/lightsprint:delete <id>` | Delete a task permanently. |
| `/lightsprint:link-pr --task <id> --pr-url <url>` | Link a GitHub pull request to a task. The task moves to `in_review`. Pass `--force` to move a link from another task. |
| `/lightsprint:unlink-pr <id>` | Remove a linked pull request from a task. |
| `/lightsprint:merge <id>` | Merge the pull request linked to a task. Supports the GitHub merge queue. |
| `/lightsprint:review-hub-signals <id>` | Show CI checks, reviews, comments and deployments for the linked pull request. |
| `/lightsprint:review-hub-scores <id>` | Show the AI readiness score and suggested actions for the linked pull request. |
| `/lightsprint:agent` | Launch or stop a cloud agent on a task, or show provider settings. Providers are `anthropic`, `cursor` and `codex`. |
| `/lightsprint:agent-settings` | Show the configured cloud agent providers and their default models. |
| `/lightsprint:agent-create-pr` | Open a GitHub pull request from a finished cloud agent's branch. |
| `/lightsprint:ask` | Manage read-only agent sessions. See `lightsprint session --help`. |

Stacks group tasks within a workspace. List them with `lightsprint stacks`, inspect one with `lightsprint stacks get <stackId|prefix|name>`, and target a stack on `tasks`/`create` via `--stack <ref>`.

### CLI

The skills call the `lightsprint` binary. You can also run it directly. These global flags work on every command:

| Flag | Effect |
|---|---|
| `--output json\|text` | Select the output format. The default is `text`. |
| `--json` | Shorthand for `--output json`. |
| `--dry-run` | Validate the input without an API call. |
| `--fields f1,f2` | Return only the given fields. Implies `--output json`. |

Other commands include `describe [command]` (parameter schema as JSON), `config get|set|delete|list` (preferences), `open`, `status`, `whoami`, `connect`, `disconnect`, `upgrade` and `version`. Run `lightsprint help` for the full list.

### Sessions

`lightsprint session` manages read-only agent sessions (ADR 0027). It replaces the retired Ask thread API routes with `/sessions` and `/agent-sessions` endpoints; `lightsprint ask` remains as a deprecated alias for `lightsprint session`.

```bash
lightsprint session list
lightsprint session create --title "Review authentication"
lightsprint session send <sessionId> "How does auth work?"
lightsprint session events <sessionId>   # stored history; pass --follow for a live tail
lightsprint session get <sessionId>
```

Run `lightsprint session --help` for the full subcommand list.

### Claiming tasks

When you use `/lightsprint:claim`, the plugin:
1. Sets the Lightsprint task to `in_progress`
2. Creates a Claude Code task linked via `metadata: { lightsprint_task_id: "<LS task ID>" }`
3. Subsequent `TaskUpdate` calls on the Claude Code task automatically sync to the correct Lightsprint task

### Hooks

`hooks/hooks.json` registers these Claude Code hooks. Each hook calls a `lightsprint cc-*` subcommand.

| Hook | Command | Purpose |
|---|---|---|
| `SessionStart` | `cc-start` | Start a per-session daemon that streams events to Lightsprint over a WebSocket. |
| `SessionEnd` | `cc-end` | Stop the session daemon. |
| `UserPromptSubmit`, `Stop`, `TaskCompleted`, `SubagentStart`, `SubagentStop` | `cc-event` | Send session activity to the daemon. |
| `PostToolUse` (`TaskCreate`, `TaskUpdate`) | `cc-event` | Sync Claude Code task changes to the linked Lightsprint task. |
| `PostToolUse` (`Bash`) | `cc-pr-created` | Detect `gh pr create` and tell the agent to run the link-pr flow. |

Hooks skip silently when no workspace connection exists.

---

## Plugin Structure

```
lightsprint-claude-code-plugin/
├── .claude-plugin/
│   ├── plugin.json             # Plugin manifest
│   └── marketplace.json        # Marketplace registry entry
├── hooks/
│   └── hooks.json              # Session lifecycle, activity and task sync hooks
├── scripts/
│   ├── lightsprint.js          # Unified CLI entry point (compiled to `lightsprint` binary)
│   ├── ls-cli.js               # CLI commands (exports cliMain)
│   ├── cc-start.js             # SessionStart hook: starts the session daemon
│   ├── cc-daemon.js            # Per-session daemon (WebSocket to Lightsprint + local HTTP)
│   ├── cc-event.js             # Activity hook handler
│   ├── cc-end.js               # SessionEnd hook: stops the daemon
│   ├── cc-pr-created.js        # PostToolUse hook: detects new GitHub PRs
│   ├── compile.sh              # Build script for the lightsprint binary
│   ├── deploy-tag.sh           # Release tagging
│   ├── install.ps1             # Windows installer
│   ├── lib/                    # Auth, connection, HTTP client, validation, output, Sentry and helpers
│   └── __tests__/              # Bun tests
├── skills/                     # One SKILL.md per /lightsprint: command
├── pi-extension/               # Same integration for the pi coding agent (see its README)
├── docs/                       # Local testing guide and design notes
├── install.sh                  # One-line plugin installer
├── npx-install.js              # `npx lightsprint` installer
├── uninstall.sh                # Clean removal
├── CHANGELOG.md
├── package.json
└── README.md
```

The CLI uses Node.js built-in `fetch`, `crypto` and `fs`. Its only npm dependency is `@sentry/node` for error reports.

### Local files

All files live in `~/.lightsprint/`. Set `LIGHTSPRINT_CONFIG_DIR` to use a different directory.

| File | Purpose |
|---|---|
| `connection.json` | Active workspace connection: OAuth tokens (access, refresh, expiry) and workspace ID and name |
| `config.json` | Plugin configuration |
| `preferences.json` | User preferences, managed with `lightsprint config` |
| `task-map.json` | Map of Claude Code task IDs to Lightsprint task IDs |
| `cc-sessions/` | State for each running Claude Code session |
| `daemon.log` | Log of the hooks and session daemon |

### Environment variables

| Variable | Purpose |
|---|---|
| `LIGHTSPRINT_BASE_URL` | Lightsprint server URL. The default is `https://app.lightsprint.ai`. |
| `LIGHTSPRINT_CONFIG_DIR` | Directory for local files. The default is `~/.lightsprint`. |
| `LIGHTSPRINT_NO_BROWSER` | Set to `1` to stop the CLI from opening a browser. |

---

## Development

Requires [Bun](https://bun.sh).

```bash
bun install
bun test          # Run the test suite
bun run build     # Compile the lightsprint binary
```

See [docs/LOCAL_TESTING.md](docs/LOCAL_TESTING.md) for an end-to-end test against a local Lightsprint server.

---

## Uninstalling

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/uninstall.sh | bash
```

This removes the plugin, the marketplace entry, the plugin cache and the `lightsprint` binary. It also deletes the connection and config files in `~/.lightsprint/`. It keeps `preferences.json`.

---

## Troubleshooting

### Token expired / refresh failed

Use any `/lightsprint:` command — the plugin will re-prompt for authorization if the refresh token has expired.

### Hook not firing

Read the hook log:

```bash
tail -f ~/.lightsprint/daemon.log
```


Verify the plugin is loaded:

```bash
claude --debug
```

Check that `hooks/hooks.json` is being picked up and `PostToolUse` matchers are registered.
