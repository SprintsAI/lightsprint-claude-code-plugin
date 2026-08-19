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

The active workspace is stored in a single connection file (`~/.lightsprint/connection.json`). All commands (`tasks`, `projects`, `stacks`, `create`, `agent`, etc.) operate against that connected workspace. Hooks silently skip if no connection exists (they never prompt).

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
| `/lightsprint:tasks` | List tasks from the workspace board. Options: `--status <status>`, `--complexity <level>`, `--assignee <name>`, `--mine`, `--unassigned`, `--project <filter>`, `--stack <ref>`, `--sort position\|updated_at\|created_at`, `--limit N`, `--offset N` |
| `/lightsprint:projects` | List projects in the workspace. Options: `--status active\|completed\|archived` |
| `/lightsprint:create <title>` | Create a new task in the workspace. Options: `--description <text>`, `--complexity low\|medium\|high`, `--status <status>`, `--project <projectId>`, `--depends-on <id1,id2,...>`, `--stack <ref>` |
| `/lightsprint:update <id>` | Update a task. Options: `--title <text>`, `--description <text>`, `--status <status>`, `--complexity <level>`, `--requires-schema-change`, `--assignee <name>`, `--position <n>`, `--add-dep <id>`, `--remove-dep <id>`, `--project <projectId>` |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, dependencies, complexity. Options: `--fields <f1,f2>` |
| `/lightsprint:claim <id>` | Claim a task — sets it to `in_progress`, assigns it to you, and links the active Claude Code session |
| `/lightsprint:current-task` | Discover the task linked to the active Claude Code session |
| `/lightsprint:comment <id> <body>` | Add a comment to a task |
| `/lightsprint:delete <id>` | Delete a task permanently |
| `/lightsprint:link-pr` | Link a GitHub pull request URL to a task. Options: `--task <taskId> --pr-url <url> [--force]` |
| `/lightsprint:unlink-pr <id>` | Unlink a GitHub pull request from a task |
| `/lightsprint:merge <id>` | Merge the GitHub PR linked to a task (supports direct merge and merge queues) |
| `/lightsprint:review-hub-signals <id>` | Inspect PR signals (CI checks, reviews, comments) for a task's linked PR. Options: `[--refresh]` |
| `/lightsprint:review-hub-scores <id>` | Get AI readiness analysis (score, summaries, callouts, suggested actions) for a task's linked PR. Options: `[--refresh]` |
| `/lightsprint:agent` | Launch, stop, or check settings for cloud agents. Subcommands: `launch`, `stop`, `settings`, `create-pr` |
| `/lightsprint:agent-create-pr` | Create a GitHub PR from a cloud agent's working branch |
| `/lightsprint:agent-settings` | Check cloud agent provider configuration and available environments |

### Stacks

Stacks group repositories and tasks within a workspace.
- List stacks: `lightsprint stacks`
- Inspect a stack: `lightsprint stacks get <stackId|prefix|name>`
- Target a stack when listing or creating tasks: `--stack <ref>`

### CLI Flags & Automation Features

The CLI supports flags designed for automated and agentic usage:
- `--output json` (or `--json`): Output structured JSON responses instead of text.
- `--dry-run`: Validate inputs locally and preview actions without hitting the API.
- `--fields <field1,field2,...>`: Request only specific fields to conserve context window.
- `lightsprint describe <command>`: Introspect parameter schemas and types at runtime.

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
│       ├── config.js           # Token resolution + on-demand auth triggers
│       ├── client.js           # HTTP/SSE client with automatic token refresh
│       ├── schema.js           # Parameter schemas for `describe` command
│       ├── task-map.js         # CC↔LS task ID mapping
│       ├── status-mapper.js    # Status mapping logic
│       └── validate.js         # Input validation & sanitization
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
│   ├── merge/SKILL.md          # /lightsprint:merge
│   ├── review-hub-signals/     # /lightsprint:review-hub-signals
│   ├── review-hub-scores/      # /lightsprint:review-hub-scores
│   ├── agent/SKILL.md          # /lightsprint:agent
│   ├── agent-create-pr/        # /lightsprint:agent-create-pr
│   ├── agent-settings/         # /lightsprint:agent-settings
│   └── projects/SKILL.md       # /lightsprint:projects
├── install.sh                  # One-line plugin installer
├── uninstall.sh                # Clean removal
├── package.json
└── README.md
```

Zero npm dependencies for runtime CLI commands — uses Node.js built-in `fetch`, `crypto`, and `fs`.

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
