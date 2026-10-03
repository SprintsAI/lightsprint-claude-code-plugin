# Lightsprint Claude Code Plugin

Claude Code plugin for Lightsprint — task management skills and workspace board integration.

## Prerequisites

- **Claude Code** CLI installed
- **Node.js >= 18** — only needed for the `npx` installer; the CLI itself ships as a self-contained binary
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

The installer downloads the prebuilt `lightsprint` binary for your platform from the latest GitHub release, places it in the plugin's `bin/` directory (also copying it to `~/.local/bin` so `lightsprint` is on your `PATH`), and registers the plugin with `claude plugin install`. On Windows, use `scripts/install.ps1`.

### Upgrading

```bash
lightsprint upgrade
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
**Tasks**

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List root tasks from the workspace board. Filters include `--status`, `--complexity`, `--assignee`, `--mine`, `--unassigned`, `--project`, `--stack <ref>`, `--sort`, `--limit N`, `--offset N` |
| `/lightsprint:projects` | List projects in the workspace. Option: `--status active\|completed\|archived` |
| `/lightsprint:create <title>` | Create a new task in the workspace default stack (or `--stack <ref>`) |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, dependencies, complexity. Option: `--fields <a,b>` |
| `/lightsprint:update <id>` | Update a task's title, description, status, complexity, schema-change flag, assignee, position, or dependencies |
| `/lightsprint:claim <id>` | Claim a task — sets it to `in_progress` and shows full details |
| `/lightsprint:current-task` | Show the task linked to the current Claude Code session (no ID needed) |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:delete <id>` | Permanently delete a task |

**Pull requests and review**

| Command | Description |
|---|---|
| `/lightsprint:link-pr --task <id> --pr-url <url>` | Link a GitHub PR to a task — moves it to `in_review` and triggers an automated review |
| `/lightsprint:unlink-pr <id>` | Remove a linked PR from a task |
| `/lightsprint:merge <id>` | Merge the task's linked PR (direct merge or GitHub merge queue) |
| `/lightsprint:review-hub-signals <id>` | Show CI checks, reviews, comments, and deployments for the task's PR |
| `/lightsprint:review-hub-scores <id>` | Show the AI readiness score, summaries, and suggested actions for the task's PR |

**Cloud agents and Ask**

| Command | Description |
|---|---|
| `/lightsprint:agent` | Launch or stop a cloud agent on a task (`anthropic`, `cursor`, or `codex`) |
| `/lightsprint:agent-settings` | Check which cloud agent providers are configured and their default models |
| `/lightsprint:agent-create-pr` | Open a PR from a cloud agent's working branch |
| `/lightsprint:ask` | Create, list, and message Codebase Ask threads — read-only Q&A across a stack's repos |

Every skill wraps a `lightsprint` CLI command, so you can also run them directly in a terminal. Run `lightsprint help` for the full reference, or `lightsprint describe <command>` for a command's parameters as JSON. Add `--json` to any command for machine-readable output.

Stacks group tasks within a workspace. List them with `lightsprint stacks`, inspect one with `lightsprint stacks get <stackId|prefix|name>`, and target a stack on `tasks`/`create` via `--stack <ref>`.

### Claiming tasks

When you use `/lightsprint:claim`, the plugin:
1. Sets the Lightsprint task to `in_progress`
2. Creates a Claude Code task linked via `metadata: { lightsprint_task_id: "<LS task ID>" }`
3. Subsequent `TaskUpdate` calls on the Claude Code task automatically sync to the correct Lightsprint task

### Session hooks

The plugin registers hooks in `hooks/hooks.json`; they run only when a workspace is connected:

| Hook | Command | What it does |
|---|---|---|
| `SessionStart` | `lightsprint cc-start` | Starts a per-session background daemon that streams session events to Lightsprint over a WebSocket |
| `SessionEnd` | `lightsprint cc-end` | Shuts the session daemon down |
| `UserPromptSubmit`, `Stop`, `TaskCompleted`, `SubagentStart`, `SubagentStop`, `PostToolUse` (`TaskCreate`/`TaskUpdate`) | `lightsprint cc-event` | Forwards session and task activity to the daemon |
| `PostToolUse` (`Bash`) | `lightsprint cc-pr-created` | Detects a successful `gh pr create` and prompts the agent to link the PR to its task |

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
│   ├── ls-cli.js               # CLI commands (tasks, create, link-pr, agent, ask, …)
│   ├── cc-start.js             # SessionStart hook — spawns the session daemon
│   ├── cc-daemon.js            # Per-session daemon streaming events to Lightsprint
│   ├── cc-event.js             # Forwards hook events to the daemon
│   ├── cc-end.js               # SessionEnd hook — stops the daemon
│   ├── cc-pr-created.js        # Detects `gh pr create` and prompts PR linking
│   ├── compile.sh              # Build script for lightsprint binary (Bun)
│   ├── install.ps1             # Windows installer
│   ├── __tests__/              # Bun test suite
│   └── lib/                    # Auth, HTTP client, config, validation, Sentry, …
├── skills/<name>/SKILL.md      # One directory per /lightsprint:<name> skill
├── pi-extension/               # Equivalent extension for the pi coding agent
├── docs/                       # Design specs, plans, local testing guide
├── install.sh                  # One-line plugin installer
├── uninstall.sh                # Clean removal
├── npx-install.js              # `npx lightsprint` entry point
├── package.json
└── README.md
```

The CLI is compiled with Bun into a single self-contained binary. Its only runtime dependency is `@sentry/node` for crash reporting.

### Local files

All state lives in `~/.lightsprint/` (override with `LIGHTSPRINT_CONFIG_DIR`).

| File | Purpose |
|---|---|
| `connection.json` | Active workspace connection — OAuth tokens (access + refresh + expiry) and workspace ID/name |
| `preferences.json` | User preferences set with `lightsprint config` |
| `task-map.json` | Mapping between Claude Code tasks and Lightsprint tasks |
| `cc-sessions/` | Per-session daemon state |
| `daemon.log` | Hook and daemon log — check this first when debugging |

---

## Development

```bash
bun install
bun test          # run the test suite
bun run build     # compile the lightsprint binary (copied to ~/.local/bin if it exists)
```

See [`docs/LOCAL_TESTING.md`](docs/LOCAL_TESTING.md) for testing against a local Lightsprint instance.

---

## Uninstalling

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/uninstall.sh | bash
```

This removes the plugin and its cache from Claude Code, deletes the `lightsprint` binary from `~/.local/bin`, and clears everything in `~/.lightsprint/` (connection, task map, session state, logs) except `preferences.json`.

---

## Troubleshooting

### Token expired / refresh failed

Use any `/lightsprint:` command — the plugin will re-prompt for authorization if the refresh token has expired.

### Hook not firing

Verify the plugin is loaded:

```bash
claude --debug
```

Check that `hooks/hooks.json` is being picked up and the `SessionStart` and `PostToolUse` hooks are registered. Then check the plugin's own log:

```bash
tail -f ~/.lightsprint/daemon.log
```

Set `LIGHTSPRINT_DEBUG=1` to have hook errors printed to stderr as well.
