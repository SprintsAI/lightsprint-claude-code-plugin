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
| `/lightsprint:tasks` | List tasks from the workspace board. Supports status, stack, project, assignee, dependency, sorting, pagination, and JSON output filters. |
| `/lightsprint:projects` | List workspace projects. |
| `/lightsprint:create <title>` | Create a task with an optional description, complexity, status, stack, project, or dependencies. |
| `/lightsprint:update <id>` | Update a task's title, description, status, complexity, assignee, project, schema-change flag, or dependencies. |
| `/lightsprint:get <id>` | Get full task details, including todos, related files, dependencies, and complexity. |
| `/lightsprint:claim <id>` | Claim a task, set it to `in_progress`, and link it to the current Claude Code session. |
| `/lightsprint:current-task` | Find the task linked to the current Claude Code session. |
| `/lightsprint:comment <id> <text>` | Add a comment to a task. |
| `/lightsprint:delete <id>` | Delete a task permanently. |
| `/lightsprint:link-pr <id> <url>` | Link a GitHub pull request to a task. |
| `/lightsprint:unlink-pr <id>` | Remove a linked pull request from a task. |
| `/lightsprint:agent <action>` | Launch, stop, or inspect settings for a cloud agent. |
| `/lightsprint:agent-create-pr` | Create a GitHub pull request from a cloud agent branch. |
| `/lightsprint:merge <id>` | Merge the pull request linked to a task. |
| `/lightsprint:review-hub-signals <id>` | Inspect CI, review, comment, and deployment signals for a linked pull request. |
| `/lightsprint:review-hub-scores <id>` | Get the AI readiness analysis for a linked pull request. |
| `/lightsprint:ask <action>` | List, create, inspect, or message Codebase Ask threads. |

The CLI also exposes these workspace commands:

```bash
lightsprint status
lightsprint whoami
lightsprint connect
lightsprint disconnect
lightsprint stacks
lightsprint config get <key>
lightsprint describe <command>
```

Commands support `--output json` for machine-readable results. Run `lightsprint help`
or `lightsprint <command> --help` for the complete option list.

Stacks group tasks within a workspace. List them with `lightsprint stacks`, inspect one with `lightsprint stacks get <stackId|prefix|name>`, and target a stack on `tasks`/`create` via `--stack <ref>`.

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
│   ├── compile.sh              # Build script for lightsprint binary
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── config.js           # Per-folder token resolution + on-demand auth trigger
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── task-map.js         # CC↔LS task ID mapping
│       └── status-mapper.js    # Status mapping logic
├── skills/
│   ├── tasks/SKILL.md          # /lightsprint:tasks
│   ├── create/SKILL.md         # /lightsprint:create
│   ├── update/SKILL.md         # /lightsprint:update
│   ├── get/SKILL.md            # /lightsprint:get
│   ├── claim/SKILL.md          # /lightsprint:claim
│   ├── current-task/SKILL.md   # /lightsprint:current-task
│   ├── comment/SKILL.md        # /lightsprint:comment
│   ├── delete/SKILL.md         # /lightsprint:delete
│   ├── link-pr/SKILL.md        # /lightsprint:link-pr
│   ├── unlink-pr/SKILL.md      # /lightsprint:unlink-pr
│   ├── agent/SKILL.md          # /lightsprint:agent
│   ├── agent-settings/SKILL.md # /lightsprint:agent-settings
│   ├── agent-create-pr/SKILL.md # /lightsprint:agent-create-pr
│   ├── merge/SKILL.md          # /lightsprint:merge
│   ├── ask/SKILL.md            # /lightsprint:ask
│   ├── projects/SKILL.md       # /lightsprint:projects
│   ├── review-hub-signals/SKILL.md # /lightsprint:review-hub-signals
│   └── review-hub-scores/SKILL.md  # /lightsprint:review-hub-scores
├── install.sh                  # One-line plugin installer
├── uninstall.sh                # Clean removal
├── package.json
└── README.md
```

The CLI uses Node.js built-in `fetch`, `crypto`, and `fs` for its core behavior.
The package also declares `@sentry/node` for error reporting.

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
