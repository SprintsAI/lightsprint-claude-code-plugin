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
| `/lightsprint:tasks` | List tasks from the workspace board. Options: `--status`, `--assignee`, `--mine`, `--unassigned`, `--deps`, `--project`, `--stack`, `--sort`, `--limit`, `--offset` |
| `/lightsprint:projects` | List projects in the workspace |
| `/lightsprint:create <title>` | Create a new task. Options: `--description`, `--complexity`, `--status`, `--project`, `--depends-on`, `--stack` |
| `/lightsprint:update <id>` | Update a task. Options: `--title`, `--description`, `--status`, `--complexity`, `--assignee`, `--project`, `--add-dep`, `--remove-dep` |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, dependencies, complexity |
| `/lightsprint:claim <id>` | Claim a task — sets it to `in_progress` and shows full details |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:delete <id>` | Delete a task permanently |
| `/lightsprint:link-pr <id>` | Link a GitHub PR to a task (`--pr-url <url>`) |
| `/lightsprint:unlink-pr <id>` | Remove a linked PR from a task |
| `/lightsprint:merge <id>` | Merge the linked PR for a task |
| `/lightsprint:current-task` | Get the task linked to the current Claude Code session |
| `/lightsprint:agent launch` | Launch a cloud agent for a task (`--task`, `--provider`, `--auto-merge`) |
| `/lightsprint:agent stop` | Stop the active cloud agent for a task |
| `/lightsprint:agent settings` | Show configured cloud agent providers and models |
| `/lightsprint:agent create-pr` | Create a PR from a cloud agent's branch (`--task`, `--provider`, `--agent-id`) |
| `/lightsprint:review-hub signals <id>` | Get PR signals (CI, reviews, comments) for a task's linked PR |
| `/lightsprint:review-hub scores <id>` | Get AI readiness analysis for a task's linked PR |
| `/lightsprint:ask list` | List Codebase Ask threads |
| `/lightsprint:ask create` | Create a new Ask thread |
| `/lightsprint:ask get <id>` | Show an Ask thread and its messages |
| `/lightsprint:ask messages <id>` | Send a message or list messages in an Ask thread |
| `/lightsprint:ask cancel <id>` | Cancel the running turn on an Ask thread |
| `/lightsprint:ask delete <id>` | Delete an Ask thread permanently |

Stacks group tasks within a workspace. List them with `lightsprint stacks`, inspect one with `lightsprint stacks get <stackId|prefix|name>`, and target a stack on `tasks`/`create`/`ask` via `--stack <ref>`.

### Claiming tasks

When you use `/lightsprint:claim`, the plugin:
1. Sets the Lightsprint task to `in_progress`
2. Creates a Claude Code task linked via `metadata: { lightsprint_task_id: "<LS task ID>" }`
3. Subsequent `TaskUpdate` calls on the Claude Code task automatically sync to the correct Lightsprint task

### Hooks and lifecycle events

The plugin registers Claude Code lifecycle hooks that run automatically in the background:

| Hook | What it does |
|---|---|
| `SessionStart` / `SessionEnd` | Starts and stops the background daemon that syncs CC task state to Lightsprint |
| `UserPromptSubmit` / `Stop` | Records prompt and stop events for session telemetry |
| `TaskCompleted` | Marks the linked Lightsprint task as complete when a CC task finishes |
| `PostToolUse` (Bash) | Detects `gh pr create` and auto-links the new PR to the task |
| `PostToolUse` (TaskCreate / TaskUpdate) | Syncs CC task creation and updates to Lightsprint |
| `SubagentStart` / `SubagentStop` | Tracks subagent lifecycle for telemetry |

Hooks silently skip if no workspace is connected — they never prompt for auth.

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
│   ├── npx-install.js          # npx entry point
│   ├── cc-*.js                 # Claude Code daemon and event handlers
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── browser.js          # Browser-opening helpers
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── config.js           # Per-folder token resolution + on-demand auth trigger
│       ├── connection.js       # Connection state persistence
│       ├── cc-utils.js         # Daemon discovery and session helpers
│       ├── options.js          # Global flag parsing
│       ├── output.js           # Result formatting (text / JSON)
│       ├── schema.js           # Command schema and validation metadata
│       ├── status-mapper.js    # Status mapping logic
│       ├── task-map.js         # CC↔LS task ID mapping
│       ├── validate.js         # Input validation helpers
│       ├── sentry.js           # Error reporting
│       └── filelock.js         # Atomic file operations
├── skills/
│   ├── tasks/SKILL.md          # /lightsprint:tasks
│   ├── projects/SKILL.md       # /lightsprint:projects
│   ├── create/SKILL.md         # /lightsprint:create
│   ├── update/SKILL.md         # /lightsprint:update
│   ├── get/SKILL.md            # /lightsprint:get
│   ├── claim/SKILL.md          # /lightsprint:claim
│   ├── comment/SKILL.md        # /lightsprint:comment
│   ├── delete/SKILL.md         # /lightsprint:delete
│   ├── link-pr/SKILL.md        # /lightsprint:link-pr
│   ├── unlink-pr/SKILL.md      # /lightsprint:unlink-pr
│   ├── merge/SKILL.md          # /lightsprint:merge
│   ├── current-task/SKILL.md   # /lightsprint:current-task
│   ├── agent/SKILL.md          # /lightsprint:agent
│   ├── agent-create-pr/SKILL.md# /lightsprint:agent-create-pr
│   ├── agent-settings/SKILL.md # /lightsprint:agent-settings
│   ├── review-hub-signals/SKILL.md   # /lightsprint:review-hub signals
│   ├── review-hub-scores/SKILL.md    # /lightsprint:review-hub scores
│   └── ask/SKILL.md            # /lightsprint:ask list|create|get|messages|cancel|delete
├── install.sh                  # One-line plugin installer
├── install.ps1                 # Windows installer
├── uninstall.sh                # Clean removal
├── package.json
└── README.md
```

Zero npm dependencies — uses Node.js built-in `fetch`, `crypto`, and `fs`.

### Local files

| File | Purpose |
|---|---|
| `~/.lightsprint/connection.json` | Active workspace connection — OAuth tokens (access + refresh + expiry) and workspace ID/name |
| `~/.lightsprint/preferences.json` | User preferences (e.g. `link-pr.no-task-behavior`) |
| `~/.lightsprint/task-map.json` | CC↔Lightsprint task ID mappings |
| `~/.lightsprint/cc-sessions/` | Per-session state files for the background daemon |
| `~/.lightsprint/daemon.log` | Background daemon log output |
| `~/.lightsprint/active-task.json` | Currently in-progress task (legacy)

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
