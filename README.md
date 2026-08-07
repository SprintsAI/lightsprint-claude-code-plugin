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

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List tasks from the workspace board. Options: `--status backlog\|todo\|in_progress\|in_review\|done`, `--assignee <name>`, `--project <filter>`, `--stack <ref>`, `--sort <field>`, `--limit N`, `--offset N` |
| `/lightsprint:projects` | List projects in the workspace. Options: `--status active\|completed\|archived` |
| `/lightsprint:create <title>` | Create a new task. Options: `--description <text>`, `--complexity low\|medium\|high`, `--status <status>`, `--depends-on <taskId>`, `--project <filter>`, `--stack <ref>` |
| `/lightsprint:update <id>` | Update a task. Options: `--title <text>`, `--description <text>`, `--status <status>`, `--complexity <level>`, `--requires-schema-change <bool>`, `--assignee <name>`, `--position <n>`, `--add-dep <taskId>`, `--remove-dep <taskId>`, `--project <filter>` |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, dependencies, complexity |
| `/lightsprint:claim <id>` | Claim a task — sets it to in_progress and shows full details |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:delete <id>` | Delete a task permanently |
| `/lightsprint:current-task` | Get the Lightsprint task linked to the current Claude Code session (auto-discovered from the session PID) |
| `/lightsprint:link-pr` | Link a GitHub PR to a task, setting it to `in_review` and triggering an automated PR review. Options: `--task <id>`, `--pr-url <url>`, `--force` |
| `/lightsprint:unlink-pr` | Remove a linked GitHub PR from a task |
| `/lightsprint:merge <id>` | Merge the GitHub PR linked to a task (supports direct merge and GitHub merge queue) |
| `/lightsprint:agent <launch\|stop\|settings>` | Launch, stop, or check settings for a cloud agent on a task. Providers: `anthropic`, `cursor`, `codex` |
| `/lightsprint:agent create-pr` | Create a GitHub PR from a cloud agent's working branch. Options: `--task <id>`, `--provider <provider>`, `--agent-id <id>` |
| `/lightsprint:review-hub signals <id>` | Get PR signals (CI checks, reviews, comments, deployments) for a task's linked PR. Options: `--refresh` |
| `/lightsprint:review-hub scores <id>` | Get AI readiness analysis (score, summaries, callouts, suggested actions) for a task's linked PR. Options: `--refresh` |

Stacks group tasks within a workspace. List them with `lightsprint stacks`, inspect one with `lightsprint stacks get <stackId|prefix|name>`, and target a stack on `tasks`/`create` via `--stack <ref>`.

### Agent commands

`lightsprint agent` manages cloud agents running on Lightsprint tasks — providers `anthropic`, `cursor`, and `codex` are supported. Check which are configured with `lightsprint agent settings`, launch one with `lightsprint agent launch`, and stop it with `lightsprint agent stop`.

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
│   ├── ls-cli.js               # Task management commands (exports cliMain)
│   ├── cc-daemon.js            # Background CC session daemon
│   ├── cc-start.js             # Session-start hook handler
│   ├── cc-end.js               # Session-end hook handler
│   ├── cc-event.js             # Post-tool-use event handler
│   ├── cc-pr-created.js        # PR-created event handler
│   ├── compile.sh              # Build script for lightsprint binary
│   ├── install.ps1             # Windows (PowerShell) installer
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── browser.js          # Browser launch/selection helpers
│       ├── cc-utils.js         # Claude Code session utils
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── config.js           # Per-folder token resolution + on-demand auth trigger
│       ├── connection.js       # Workspace connection + switching
│       ├── options.js          # Argument/flag parsing
│       ├── output.js           # Text/JSON output formatting
│       ├── schema.js           # Command parameter schemas (drives --help + validation)
│       ├── sentry.js           # Error reporting
│       ├── status-mapper.js    # Status mapping logic
│       ├── task-map.js         # CC↔LS task ID mapping
│       └── validate.js         # Argument validation
├── skills/
│   ├── tasks/SKILL.md          # /lightsprint:tasks
│   ├── create/SKILL.md         # /lightsprint:create
│   ├── update/SKILL.md         # /lightsprint:update
│   ├── get/SKILL.md            # /lightsprint:get
│   ├── claim/SKILL.md          # /lightsprint:claim
│   ├── comment/SKILL.md        # /lightsprint:comment
│   ├── delete/SKILL.md         # /lightsprint:delete
│   ├── current-task/SKILL.md   # /lightsprint:current-task
│   ├── link-pr/SKILL.md        # /lightsprint:link-pr
│   ├── unlink-pr/SKILL.md      # /lightsprint:unlink-pr
│   ├── merge/SKILL.md          # /lightsprint:merge
│   ├── agent/SKILL.md          # /lightsprint:agent launch|stop|settings
│   ├── agent-create-pr/SKILL.md# /lightsprint:agent create-pr
│   ├── agent-settings/SKILL.md # /lightsprint:agent settings
│   ├── projects/SKILL.md       # /lightsprint:projects
│   ├── review-hub-signals/SKILL.md # /lightsprint:review-hub signals
│   └── review-hub-scores/SKILL.md  # /lightsprint:review-hub scores
├── install.sh                  # One-line plugin installer
├── uninstall.sh                # Clean removal
├── package.json
└── README.md
```

Zero npm dependencies — uses Node.js built-in `fetch`, `crypto`, and `fs`.

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
