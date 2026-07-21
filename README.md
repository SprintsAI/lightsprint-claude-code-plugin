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

All skills operate on the connected workspace. Every skill is backed by a `lightsprint <command>` CLI call, so the same options are available whether you use the slash command or the binary directly.

**Task board**

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List tasks from the workspace board. Options: `--status backlog\|todo\|in_progress\|in_review\|done`, `--assignee <name>`, `--project <id,…\|none>`, `--stack <ref>`, `--limit N`, `--offset N`, `--sort position\|updated_at\|created_at` |
| `/lightsprint:projects` | List projects in the workspace. Options: `--status active\|completed\|archived` |
| `/lightsprint:create <title>` | Create a new task. Options: `--description <text>`, `--complexity low\|medium\|high`, `--status <status>`, `--stack <ref>`, `--project <id>`, `--depends-on <id,…>` |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, dependencies, complexity |
| `/lightsprint:update <id>` | Update a task. Options: `--title`, `--description`, `--status`, `--complexity`, `--requires-schema-change true\|false`, `--assignee <name>`, `--position N`, `--add-dep <id>`, `--remove-dep <id>`, `--project <id>` |
| `/lightsprint:claim <id>` | Claim a task — sets it to `in_progress`, assigns it to you, and links the current Claude Code session |
| `/lightsprint:current-task` | Show the task linked to the current Claude Code session (auto-discovered via session PID — no ID needed) |
| `/lightsprint:delete <id>` | Permanently delete a task from the board |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |

**Pull requests & review**

| Command | Description |
|---|---|
| `/lightsprint:link-pr <id> <pr-url>` | Link a GitHub PR to a task. Options: `--force` (move a PR already linked to another task) |
| `/lightsprint:unlink-pr <id>` | Remove the linked PR from a task |
| `/lightsprint:merge <id>` | Merge the GitHub PR linked to a task (direct merge or GitHub merge queue) |
| `/lightsprint:review-hub-signals <id>` | Inspect PR signals — CI checks, reviews, comments, deployments. Options: `--refresh` |
| `/lightsprint:review-hub-scores <id>` | AI readiness analysis (score, summaries, callouts, suggested actions) for the linked PR |

**Cloud agents**

| Command | Description |
|---|---|
| `/lightsprint:agent` | Launch, stop, or check settings for cloud agents on a task. Providers: `anthropic`, `cursor`, `codex` |
| `/lightsprint:agent-create-pr` | Open a GitHub PR from a cloud agent's working branch |
| `/lightsprint:agent-settings` | Show which cloud agent providers are configured and their default models |

### Workspace & connection commands

These are exposed by the `lightsprint` binary (not as slash commands):

| Command | Description |
|---|---|
| `lightsprint connect` | Authorize and connect to a Lightsprint workspace (`--base-url <url>` for self-hosted) |
| `lightsprint disconnect` | Clear the active workspace connection |
| `lightsprint status` / `lightsprint whoami` | Show the connected workspace and auth info |
| `lightsprint open` | Open the active workspace board in your browser |
| `lightsprint stacks` / `lightsprint stacks get <ref>` | List stacks, or inspect one and its member repos (accepts stack ID, task prefix, or name) |
| `lightsprint upgrade` | Download and install the latest plugin version |
| `lightsprint config` | Get/set/list local CLI configuration |
| `lightsprint describe <command>` | Print the accepted parameters, types, defaults, and valid enum values for a command as JSON |

Stacks group tasks within a workspace. Target a stack on `tasks`/`create` via `--stack <ref>`.

### Machine-readable output

The CLI is designed to be driven by AI agents as well as humans, so every command speaks JSON:

- Add `--output json` (or `--json` with no body) to any command for structured output; errors are emitted as structured JSON to stderr. Output defaults to JSON automatically when stdout is not a TTY.
- `--fields <a,b,c>` trims the response to just the fields you need (implies JSON) to conserve context.
- Mutating commands (`create`, `update`, `claim`, `comment`, `merge`, `agent launch/stop/create-pr`) accept `--dry-run` to validate inputs locally and print what *would* happen without hitting the API.
- `create` and `update` accept a raw request body via `--json '{...}'` in addition to the convenience flags.
- `lightsprint describe <command>` dumps a command's parameter schema at runtime so agents can self-serve instead of relying on stale docs.

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
│   ├── cc-start.js             # SessionStart hook — links the CC session to a task
│   ├── cc-daemon.js            # Background daemon that syncs task state
│   ├── cc-event.js             # PostToolUse hook — forwards TaskUpdate events
│   ├── cc-end.js               # SessionEnd hook
│   ├── cc-pr-created.js        # Hook fired when a PR is created
│   ├── compile.sh              # Build script for the lightsprint binary
│   ├── deploy-tag.sh           # Release tagging helper
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── browser.js          # Cross-platform browser launcher
│       ├── config.js           # Config + on-demand auth trigger
│       ├── connection.js       # Active workspace connection file I/O
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── options.js          # Global flag parser (--output, --json, --dry-run, --fields)
│       ├── output.js           # JSON / text output + error formatting
│       ├── schema.js           # Command parameter schemas for `describe`
│       ├── validate.js         # Input hardening (task IDs, enums, lengths)
│       ├── filelock.js         # File locking for concurrent CLI runs
│       ├── task-map.js         # CC↔LS task ID mapping
│       ├── status-mapper.js    # Status mapping logic
│       └── sentry.js           # Optional crash reporting
├── skills/                     # One directory per slash command (tasks, create, update,
│                               #   get, claim, current-task, delete, comment, projects,
│                               #   link-pr, unlink-pr, merge, review-hub-signals,
│                               #   review-hub-scores, agent, agent-create-pr, agent-settings)
├── install.sh                  # One-line plugin installer
├── uninstall.sh                # Clean removal
├── package.json
└── README.md
```

Minimal dependencies — the CLI relies on Node.js built-in `fetch`, `crypto`, and `fs`, with `@sentry/node` as the only runtime dependency (optional crash reporting).

### Local files

| File | Purpose |
|---|---|
| `~/.lightsprint/connection.json` | Active workspace connection — OAuth tokens (access + refresh + expiry) and workspace ID/name |
| `~/.lightsprint/active-task.json` | Currently in-progress task |

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
