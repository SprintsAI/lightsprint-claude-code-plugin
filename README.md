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
| `/lightsprint:tasks` | List tasks from the workspace board. Options: `--status`, `--stack <ref>`, `--limit N` |
| `/lightsprint:projects` | List projects in the workspace |
| `/lightsprint:create <title>` | Create a new task. Options: `--description`, `--complexity`, `--status`, `--stack <ref>` |
| `/lightsprint:update <id>` | Update a task. Options: `--title`, `--description`, `--status`, `--complexity`, `--assignee` |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, complexity |
| `/lightsprint:claim <id>` | Claim a task — sets it to `in_progress` and shows full details |
| `/lightsprint:current-task` | Get the Lightsprint task linked to the current Claude Code session (auto-discovers via session PID) |
| `/lightsprint:delete <id>` | Delete a task permanently from the workspace board |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:link-pr` | Link a GitHub PR to a task. Options: `--task`, `--pr-url`, `--force` |
| `/lightsprint:unlink-pr` | Remove a linked GitHub PR from a task |
| `/lightsprint:merge <id>` | Merge the GitHub PR linked to a task |
| `/lightsprint:review-hub-scores <id>` | Get AI readiness analysis for a task's linked PR |
| `/lightsprint:review-hub-signals <id>` | Get PR signals (CI checks, reviews, comments, deployments) |
| `/lightsprint:agent` | Launch, stop, or check settings for cloud agents. Options: `--task`, `--provider`, `--auto-merge` |
| `/lightsprint:agent-settings` | Check which cloud agent providers are configured and their default models |
| `/lightsprint:agent-create-pr` | Create a GitHub PR from a cloud agent's working branch |
| `/lightsprint:ask` | Interact with Lightsprint Codebase Ask threads. Subcommands: `list`, `create`, `get`, `messages`, `cancel`, `delete` |

### Additional CLI commands

Beyond slash skills, the `lightsprint` CLI exposes workflow commands that run outside Claude Code's slash-command system:

| Command | Description |
|---|---|
| `lightsprint stacks` | List stacks in the workspace; `stacks get <ref>` to inspect one |
| `lightsprint connect` | Authorize and select a workspace |
| `lightsprint disconnect` | Clear the active workspace connection |
| `lightsprint whoami` / `status` | Show the connected workspace and user |
| `lightsprint config` | Manage local preferences (`get`, `set`, `delete`, `list`) |
| `lightsprint open <taskId>` | Open a task in the Lightsprint web app |
| `lightsprint describe <command>` | Show detailed help for any command |
| `lightsprint upgrade` | Update the plugin to the latest version |

All commands support `--output json` for machine-readable output.

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
│   └── lib/                    # Auth, config, client, validation, output, schema, etc.
├── skills/                     # Slash-command skill definitions
│   ├── tasks/
│   ├── create/
│   ├── update/
│   ├── get/
│   ├── claim/
│   ├── current-task/
│   ├── delete/
│   ├── comment/
│   ├── link-pr/
│   ├── unlink-pr/
│   ├── merge/
│   ├── review-hub-scores/
│   ├── review-hub-signals/
│   ├── agent/
│   ├── agent-settings/
│   ├── agent-create-pr/
│   ├── ask/
│   └── projects/
├── docs/
│   └── LOCAL_TESTING.md
├── pi-extension/
│   └── index.ts
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

## Related

- [Lightsprint](https://github.com/SprintsAI/lightsprint) — Main application and platform
- [AIGateway](https://github.com/SprintsAI/aigateway) — Standalone metered AI provider gateway

## Troubleshooting

### Token expired / refresh failed

Use any `/lightsprint:` command — the plugin will re-prompt for authorization if the refresh token has expired.

### Hook not firing

Verify the plugin is loaded:

```bash
claude --debug
```

Check that `hooks/hooks.json` is being picked up and `PostToolUse` matchers are registered.
