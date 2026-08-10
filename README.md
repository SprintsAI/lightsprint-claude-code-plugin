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

Then use any `lightsprint` command — the plugin opens your browser to connect on first use:

```bash
lightsprint tasks
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

The plugin will be installed but the workspace connection step will be skipped. You can connect later by running `lightsprint connect`, which prompts you to authorize and pick a workspace.

---

## Authentication

Authentication is **on-demand** — the first time you run a `lightsprint` command without an active connection, the plugin opens your browser to authorize. You pick a Lightsprint workspace, and tokens are saved locally. Tokens refresh automatically.

The active workspace is stored in a single connection file (`~/.lightsprint/connection.json`). All commands (`tasks`, `projects`, `stacks`, `create`, etc.) operate against that connected workspace. Hooks silently skip if no connection exists (they never prompt).

### Switching workspaces

Run `lightsprint connect` again to authorize and switch to a different workspace, or `lightsprint disconnect` to clear the active connection. Use `lightsprint status` / `lightsprint whoami` to see which workspace is currently connected.

### Optional: Custom base URL

For self-hosted Lightsprint instances:

```bash
export LIGHTSPRINT_BASE_URL=https://your-instance.example.com
```

Defaults to `https://app.lightsprint.ai`. You can also pass `--base-url` to `lightsprint connect`.

---

## Commands

All commands operate on the connected workspace. Each accepts either positional arguments or explicit flags (e.g. `lightsprint get abc123` is the same as `lightsprint get --task abc123`).

| Command | Description |
|---|---|
| `lightsprint tasks` | List tasks from the workspace board. Options: `--status`, `--complexity`, `--assignee`, `--mine`, `--unassigned`, `--deps`, `--project`, `--stack`, `--sort`, `--limit`, `--offset`, `--page-all` |
| `lightsprint projects` | List projects in the workspace. Options: `--status active\|completed\|archived` |
| `lightsprint stacks` | List stacks in the workspace; `lightsprint stacks get <ref>` inspects one |
| `lightsprint create <title>` | Create a new task. Options: `--title`, `--description`, `--complexity`, `--status`, `--project`, `--stack`, `--depends-on`, `--parent`, `--cc-pid`, `--json-body`, `--dry-run`. Aliases: `create-task`, `new`, `add` |
| `lightsprint update <id>` | Update a task. Options: `--title`, `--description`, `--status`, `--complexity`, `--requires-schema-change`, `--assignee`, `--project`, `--add-dep`, `--remove-dep`, `--json-body` |
| `lightsprint get <id>` | Get full details of a task — title, status, description, todo list, related files, dependencies, complexity. Options: `--fields` |
| `lightsprint claim <id>` | Claim a task — sets it to in_progress and shows full details |
| `lightsprint current-task` | Get the task linked to the current Claude Code session (auto-discovered by PID) |
| `lightsprint comment <id> <text>` | Add a comment to a task |
| `lightsprint delete <id>` | Delete a task permanently |
| `lightsprint link-pr` | Link a GitHub PR to a task (`--task`, `--pr-url`, `--force`). Sets the task to in_review |
| `lightsprint unlink-pr <id>` | Remove a linked GitHub PR from a task |
| `lightsprint merge <id>` | Merge the GitHub PR linked to a task |
| `lightsprint agent launch` / `stop` / `settings` / `create-pr` | Manage cloud agents (anthropic, cursor, codex) on a task |
| `lightsprint review-hub signals <id>` | Get PR signals (CI checks, reviews, comments, deployments) |
| `lightsprint review-hub scores <id>` | Get AI readiness analysis for a task's linked PR (options: `--refresh`) |
| `lightsprint config` | Manage user preferences (`get`, `set`, `delete`, `list`) |
| `lightsprint describe <command>` | Show accepted parameters, types, and valid enums as JSON |
| `lightsprint open` | Open the active workspace board in your browser |
| `lightsprint status` / `whoami` | Show connection / workspace info |
| `lightsprint connect` / `disconnect` | Auth and switch / clear the active workspace |
| `lightsprint upgrade` | Update the CLI binary to the latest release |

### Claiming tasks

When you use `lightsprint claim`, the plugin:
1. Sets the Lightsprint task to `in_progress`
2. Creates a Claude Code task linked via `metadata: { lightsprint_task_id: "<LS task ID>" }`
3. Subsequent `TaskUpdate` calls on the Claude Code task automatically sync to the correct Lightsprint task

### Linking pull requests

Whenever you create a GitHub PR for a task, link it to the task so the board advances. See `lightsprint link-pr --help` for the automatic-link workflow.

---

## How It Works

### Hooks

The plugin registers Claude Code hooks that keep the Lightsprint board in sync as you work:

| Hook | Script |
|---|---|
| `SessionStart` | `lightsprint cc-start` |
| `SessionEnd` | `lightsprint cc-end` |
| `UserPromptSubmit` / `Stop` / `TaskCompleted` / `SubagentStart` / `SubagentStop` | `lightsprint cc-event` |
| `PostToolUse` (`Bash`) | `lightsprint cc-pr-created` — detects PRs created during a session and auto-links them |
| `PostToolUse` (`TaskCreate`) | `lightsprint cc-event` |
| `PostToolUse` (`TaskUpdate`) | `lightsprint cc-event` |

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
│   ├── cc-daemon.js            # Claude Code session daemon
│   ├── cc-start.js / cc-end.js # Session lifecycle hooks
│   ├── cc-event.js             # Task update / event hooks
│   ├── cc-pr-created.js        # PR auto-link hook
│   ├── compile.sh              # Build script for lightsprint binary
│   ├── deploy-tag.sh           # Release tagging helper
│   ├── install.ps1             # Windows installer
│   ├── dev-local.sh / dev-restore.sh # Local development helpers
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── config.js           # Per-folder token resolution + on-demand auth trigger
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── connection.js       # Workspace connection management
│       ├── task-map.js         # CC↔LS task ID mapping
│       ├── status-mapper.js    # Status mapping logic
│       ├── schema.js           # Command schemas / validation
│       ├── options.js          # CLI option parsing
│       ├── output.js           # Output formatting (text/json)
│       ├── validate.js         # Input validation
│       ├── cc-utils.js         # Claude Code session helpers
│       ├── browser.js          # Browser open / auth helpers
│       ├── filelock.js         # Cross-process lock for shared files
│       └── sentry.js           # Error reporting
├── skills/
│   ├── tasks/SKILL.md          # lightsprint tasks
│   ├── projects/SKILL.md       # lightsprint projects
│   ├── create/SKILL.md         # lightsprint create
│   ├── update/SKILL.md         # lightsprint update
│   ├── get/SKILL.md            # lightsprint get
│   ├── claim/SKILL.md          # lightsprint claim
│   ├── current-task/SKILL.md   # lightsprint current-task
│   ├── comment/SKILL.md        # lightsprint comment
│   ├── delete/SKILL.md         # lightsprint delete
│   ├── link-pr/SKILL.md        # lightsprint link-pr
│   ├── unlink-pr/SKILL.md      # lightsprint unlink-pr
│   ├── merge/SKILL.md          # lightsprint merge
│   ├── agent/SKILL.md          # lightsprint agent
│   ├── agent-create-pr/SKILL.md # lightsprint agent create-pr
│   ├── agent-settings/SKILL.md # lightsprint agent settings
│   ├── review-hub-scores/SKILL.md   # lightsprint review-hub scores
│   └── review-hub-signals/SKILL.md  # lightsprint review-hub signals
├── install.sh                  # One-line plugin installer
├── uninstall.sh                # Clean removal
├── package.json
└── README.md
```

Minimal runtime dependencies — the CLI uses Node.js built-in `fetch`, `crypto`, and `fs` (the only npm dependency is `@sentry/node` for error reporting).

### Local files

| File | Purpose |
|---|---|
| `~/.lightsprint/connection.json` | Active workspace connection — OAuth tokens (access + refresh + expiry) and workspace ID/name |
| `~/.lightsprint/active-task.json` | Currently in-progress task |
| `~/.lightsprint/preferences.json` | User preferences (managed via `lightsprint config`) |

---

## Uninstalling

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/uninstall.sh | bash
```

This removes the plugin from Claude Code and clears the active workspace connection in `~/.lightsprint/connection.json`.

---

## Troubleshooting

### Token expired / refresh failed

Use any `lightsprint` command — the plugin will re-prompt for authorization if the refresh token has expired.

### Hook not firing

Verify the plugin is loaded:

```bash
claude --debug
```

Check that `hooks/hooks.json` is being picked up and `PostToolUse` matchers are registered.
