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

### Upgrading

```bash
lightsprint upgrade
```

Downloads and installs the latest version from GitHub releases.

---

## Authentication

Authentication is **on-demand** — the first time you use a `/lightsprint:` command without an active connection, the plugin opens your browser to authorize. You pick a Lightsprint workspace, and tokens are saved locally. Tokens refresh automatically.

The active workspace is stored in a single connection file (`~/.lightsprint/connection.json`). All commands (`tasks`, `projects`, `stacks`, `create`, etc.) operate against that connected workspace. Hooks silently skip if no connection exists (they never prompt).

### Switching workspaces

Run `lightsprint connect` again to authorize and switch to a different workspace, or `lightsprint disconnect` to clear the active connection. Use `lightsprint status` / `lightsprint whoami` to see which workspace is currently connected.

### Optional: Custom base URL

For self-hosted Lightsprint instances, pass `--base-url` to `connect`, or export the env var before installing:

```bash
export LIGHTSPRINT_BASE_URL=https://your-instance.example.com
lightsprint connect --base-url https://your-instance.example.com
```

Defaults to `https://app.lightsprint.ai`.

---

## How It Works

### Skills (slash commands)

All skills operate on the connected workspace. Run any of them as `/lightsprint:<command>`, or invoke the underlying CLI directly with `lightsprint <command>`.

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List tasks from the workspace board. Options: `--status backlog\|todo\|in_progress\|in_review\|done`, `--complexity low\|medium\|high`, `--assignee <name>`, `--mine`, `--unassigned`, `--deps <filter>`, `--project <filter>`, `--stack <ref>`, `--sort <field>`, `--limit N`, `--offset N` |
| `/lightsprint:projects` | List projects in the workspace. Options: `--status active\|completed\|archived` |
| `/lightsprint:create <title>` | Create a new task. Options: `--description <text>`, `--complexity low\|medium\|high`, `--status backlog\|todo\|in_progress\|in_review\|done`, `--project <projectId>`, `--stack <ref>`, `--depends-on <id1,id2,...>` |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, dependencies, related files, complexity |
| `/lightsprint:update <id>` | Update a task. Options: `--title <text>`, `--description <text>`, `--status <status>`, `--complexity <level>`, `--assignee <name>`, `--project <projectId>`, `--add-dep <taskId>`, `--remove-dep <taskId>` |
| `/lightsprint:claim <id>` | Claim a task — sets it to `in_progress` and shows full details |
| `/lightsprint:current-task` | Get the task linked to the current Claude Code session (auto-discovered from the session PID) |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:link-pr` | Link a GitHub pull request to a task. Options: `--task <taskId> --pr-url <prUrl> [--force]` |
| `/lightsprint:unlink-pr <id>` | Remove a linked GitHub pull request from a task |
| `/lightsprint:delete <id>` | Delete a task permanently |
| `/lightsprint:merge <id>` | Merge the GitHub PR linked to a task (supports GitHub merge queue) |
| `/lightsprint:agent` | Launch, stop, or configure cloud agents. Subcommands: `launch --task <id> --provider anthropic\|cursor\|codex [--auto-merge]`, `stop`, `settings`, `create-pr` |
| `/lightsprint:review-hub` | PR readiness analysis. Subcommands: `signals <id>` (CI/reviews/comments) and `scores <id>` (AI readiness score). Both accept `--refresh` |

Stacks group tasks within a workspace. List them with `lightsprint stacks`, inspect one with `lightsprint stacks get <stackId|prefix|name>`, and target a stack on `tasks`/`create` via `--stack <ref>`.

### Additional CLI commands

Beyond the skills, the `lightsprint` CLI exposes a few extra utilities:

| Command | Description |
|---|---|
| `lightsprint config` | Manage user preferences (`~/.lightsprint/preferences.json`) |
| `lightsprint describe <command>` | Show accepted parameters, types, and valid enums as JSON |
| `lightsprint open` | Open the active workspace board in your browser |
| `lightsprint status` | Show connection status for the active workspace |
| `lightsprint whoami` | Display the connected workspace and auth info |
| `lightsprint connect [--base-url]` | Authenticate and connect to a workspace |
| `lightsprint disconnect` | Remove the active workspace's credentials |
| `lightsprint upgrade` | Upgrade to the latest version |

### Claiming tasks

When you use `/lightsprint:claim`, the plugin:

1. Sets the Lightsprint task to `in_progress`
2. Creates a Claude Code task linked via `metadata: { lightsprint_task_id: "<LS task ID>" }`
3. Subsequent `TaskUpdate` calls on the Claude Code task automatically sync to the correct Lightsprint task

### Hooks

The plugin registers session lifecycle and task-sync hooks that run automatically against the connected workspace:

- **SessionStart / SessionEnd** — record Claude Code session begin/end
- **UserPromptSubmit / Stop / TaskCompleted** — keep task state in sync with your session
- **PostToolUse** (`Bash`, `TaskCreate`, `TaskUpdate`) — detect PR creation and task changes
- **SubagentStart / SubagentStop** — track subagent activity

Hooks silently skip when no workspace is connected — they never prompt.

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
│   ├── install.sh              # One-line plugin installer
│   ├── uninstall.sh            # Clean removal
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── browser.js          # Browser-launch helpers for auth
│       ├── cc-utils.js         # Claude Code session/PID helpers
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── config.js           # Connection/preference resolution + on-demand auth trigger
│       ├── connection.js       # Connection-file read/write helpers
│       ├── filelock.js         # Cross-process file locking
│       ├── options.js          # Global flag parsing (--output, --dry-run, --fields)
│       ├── output.js           # Formatted/text + JSON output helpers
│       ├── schema.js           # Per-command parameter schemas
│       ├── sentry.js           # Error reporting
│       ├── status-mapper.js    # Status mapping logic
│       ├── task-map.js         # CC↔LS task ID mapping
│       └── validate.js         # Input validation
├── skills/
│   ├── agent/SKILL.md          # /lightsprint:agent (launch/stop/settings)
│   ├── agent-create-pr/        # /lightsprint:agent create-pr
│   ├── agent-settings/         # /lightsprint:agent settings
│   ├── claim/SKILL.md          # /lightsprint:claim
│   ├── comment/SKILL.md        # /lightsprint:comment
│   ├── create/SKILL.md         # /lightsprint:create
│   ├── current-task/SKILL.md   # /lightsprint:current-task
│   ├── delete/SKILL.md         # /lightsprint:delete
│   ├── get/SKILL.md            # /lightsprint:get
│   ├── link-pr/SKILL.md        # /lightsprint:link-pr
│   ├── merge/SKILL.md          # /lightsprint:merge
│   ├── projects/SKILL.md       # /lightsprint:projects
│   ├── review-hub-scores/      # /lightsprint:review-hub scores
│   ├── review-hub-signals/     # /lightsprint:review-hub signals
│   ├── tasks/SKILL.md          # /lightsprint:tasks
│   ├── unlink-pr/SKILL.md      # /lightsprint:unlink-pr
│   └── update/SKILL.md         # /lightsprint:update
├── install.sh                  # One-line plugin installer
├── uninstall.sh                # Clean removal
├── package.json
└── README.md
```

Zero runtime npm dependencies — uses Node.js built-in `fetch`, `crypto`, and `fs` (the only dependency is `@sentry/node` for error reporting).

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

Use any `/lightsprint:` command — the plugin will re-prompt for authorization if the refresh token has expired.

### Hook not firing

Verify the plugin is loaded:

```bash
claude --debug
```

Check that `hooks/hooks.json` is being picked up and `PostToolUse` matchers are registered.
