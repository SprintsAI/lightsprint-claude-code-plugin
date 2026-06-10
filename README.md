# Lightsprint Claude Code Plugin

Claude Code plugin for Lightsprint — plan review, task management skills, and workspace board integration.

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

Defaults to `https://lightsprint.ai`.

---

## How It Works

### Skills (slash commands)

All skills operate on the connected workspace.

**Tasks & projects**

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List tasks from the workspace board. Options: `--status backlog\|todo\|in_progress\|in_review\|done`, `--stack <ref>`, `--limit N` |
| `/lightsprint:projects` | List projects in the workspace |
| `/lightsprint:create <title>` | Create a new task. Options: `--description <text>`, `--complexity low\|medium\|high`, `--status <status>`, `--stack <ref>` |
| `/lightsprint:update <id>` | Update a task — title, description, status, complexity, assignee, position, dependencies |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, dependencies, complexity |
| `/lightsprint:claim <id>` | Claim a task — sets it to in_progress and links it to the current Claude Code session |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:delete <id>` | Permanently delete a task from the board |
| `/lightsprint:current-task` | Show the Lightsprint task linked to the current Claude Code session |

**Plans**

| Command | Description |
|---|---|
| `/lightsprint:create-plan` | Create a plan on Lightsprint from markdown content |

**Pull requests & review**

| Command | Description |
|---|---|
| `/lightsprint:link-pr <id> <pr>` | Link a GitHub PR to a task and trigger auto-review |
| `/lightsprint:unlink-pr <id>` | Remove the linked GitHub PR from a task |
| `/lightsprint:merge <id>` | Merge the GitHub PR linked to a task (direct merge or merge queue) |
| `/lightsprint:review-hub-signals` | Get PR signals (CI checks, reviews, comments, deployments) for a task's linked PR |
| `/lightsprint:review-hub-scores` | Get AI readiness analysis (score, summaries, callouts) for a task's linked PR |

**Cloud agents**

| Command | Description |
|---|---|
| `/lightsprint:agent <launch\|stop\|settings>` | Launch or stop a cloud agent, or check settings (anthropic / cursor / codex providers) |
| `/lightsprint:agent-settings` | Show which cloud agent providers are configured and their default models |
| `/lightsprint:agent-create-pr` | Create a GitHub PR from a cloud agent's working branch |

Stacks group tasks within a workspace. Target a stack on `tasks`/`create` via `--stack <ref>` (a stack ID, prefix, or name).

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
│   └── hooks.json              # Claude Code lifecycle hooks (see "Hooks" below)
├── scripts/
│   ├── lightsprint.js          # Unified CLI entry point (compiled to `lightsprint` binary)
│   ├── ls-cli.js               # Task/PR/agent commands (exports cliMain)
│   ├── review-plan.js          # Plan review handler (exports reviewPlanMain)
│   ├── cc-*.js                 # Hook handlers (cc-review, cc-start, cc-end, cc-event, cc-pr-created)
│   ├── cc-daemon.js            # Background daemon (HTTP server + WebSocket client to Lightsprint)
│   ├── compile.sh              # Build script for the lightsprint binary
│   └── lib/                    # auth, config, client, task-map, status-mapper, …
├── skills/                     # One SKILL.md per /lightsprint: command (18 total — see above)
├── pi-extension/               # Integration for the pi framework (tools, commands, shortcuts)
├── docs/                       # LOCAL_TESTING.md and design specs
├── install.sh / install.ps1    # One-line plugin installers (bash / PowerShell)
├── uninstall.sh                # Clean removal
├── package.json
└── README.md
```

Zero runtime npm dependencies beyond `@sentry/node` — uses Node.js built-in `fetch`, `crypto`, and `fs`.

### Hooks

`hooks/hooks.json` registers the plugin against Claude Code lifecycle events. They run the `lightsprint` binary and silently no-op when no workspace is connected:

| Event | Handler | Purpose |
|---|---|---|
| `PermissionRequest` (`ExitPlanMode`) | `cc-review` | Opens the plan review UI when you exit plan mode |
| `SessionStart` / `SessionEnd` | `cc-start` / `cc-end` | Start/stop the background daemon and log the session |
| `PostToolUse` (`Bash`) | `cc-pr-created` | Detects `gh pr create` and links the new PR to the active task |
| `UserPromptSubmit`, `Stop`, `TaskCompleted`, `PostToolUse` (`TaskCreate`/`TaskUpdate`), `SubagentStart`/`SubagentStop` | `cc-event` | Records session activity and syncs task updates |

### Local files

| File | Purpose |
|---|---|
| `~/.lightsprint/connection.json` | Active workspace connection — OAuth tokens (access + refresh + expiry) and workspace ID/name |
| `~/.lightsprint/config.json` | Base URL configuration |
| `~/.lightsprint/active-plan.json` | Currently tracked plan |
| `~/.lightsprint/task-map.json` | Claude Code ↔ Lightsprint task ID mapping |

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

Check that `hooks/hooks.json` is being picked up and its matchers (e.g. `PermissionRequest` for `ExitPlanMode`, `PostToolUse` for `Bash`) are registered.
