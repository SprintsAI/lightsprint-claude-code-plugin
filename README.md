# Lightsprint Claude Code Plugin

Claude Code plugin for Lightsprint — plan review, task management, PR tracking, and AI-powered code review integration.

## Prerequisites

- **Claude Code** CLI installed
- **Node.js >= 18** (for built-in `fetch`)
- A **Lightsprint repo** at [lightsprint.ai](https://lightsprint.ai)

## Quick Start

Install the plugin (one time):

```bash
npx lightsprint
```

Then use any `/lightsprint:` command — the plugin opens your browser to connect on first use:

```
/lightsprint:tasks
```

That's it. Each new repo folder auto-prompts for authorization when you first use a command there.

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

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/scripts/install.ps1 | iex
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

The plugin will be installed but the repo connection step will be skipped. You can connect later by running `/lightsprint:tasks` inside a git repository.

---

## Authentication

Authentication is **on-demand** — the first time you use a `/lightsprint:` command in an unconnected folder, the plugin opens your browser to authorize. You pick a Lightsprint repo, and tokens are saved locally. Tokens refresh automatically.

### Token resolution

The plugin resolves tokens by:

1. Walking up from the current directory (covers monorepos and subdirectories)
2. Falling back to the git main worktree (covers `git worktree` checkouts)
3. If no token found, opening the browser to authorize

A single authorization at your repo root works for all subdirectories and worktrees. Hooks silently skip if no authorization exists (they never prompt).

### Multiple repos

Each folder can connect to a different Lightsprint repo. The plugin prompts automatically when you use a command in a new folder.

### Optional: Custom base URL

For self-hosted Lightsprint instances:

```bash
export LIGHTSPRINT_BASE_URL=https://your-instance.example.com
```

Or pass it at install time:

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/install.sh | bash -s -- --base-url=https://your-instance.example.com
```

Defaults to `https://lightsprint.ai`.

---

## How It Works

### Skills (slash commands)

#### Task management

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List tasks from the board. Options: `--status backlog\|todo\|in_progress\|in_review\|done` (comma-separated), `--complexity low\|medium\|high`, `--assignee <name>`, `--mine`, `--unassigned`, `--deps has-dependencies\|has-dependents\|unblocked`, `--project <id\|none>`, `--sort position\|updated_at\|created_at`, `--limit N`, `--offset N`, `--page-all` |
| `/lightsprint:projects` | List projects in the repo's workspace. Options: `--status active\|completed\|archived` |
| `/lightsprint:create <title>` | Create a new task. Options: `--description <text>`, `--complexity low\|medium\|high`, `--status <status>`, `--project <id>`, `--depends-on <id1,id2,...>`, `--parent <taskId>`, `--json-body <json>` |
| `/lightsprint:update <id>` | Update a task. Options: `--title <text>`, `--description <text>`, `--status <status>`, `--complexity <level>`, `--assignee <name>`, `--project <id>`, `--add-dep <taskId>`, `--remove-dep <taskId>`, `--json-body <json>` |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, dependencies, complexity. Supports `--fields` to return specific fields only |
| `/lightsprint:claim <id>` | Claim a task — sets it to `in_progress` and returns full details |
| `/lightsprint:current-task` | Get the Lightsprint task linked to the current Claude Code session |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:delete <id>` | Permanently delete a task |
| `/lightsprint:create-plan` | Create a plan on Lightsprint from markdown. Options: `--content <markdown>`, `--title <text>`, `--task <taskId>` |

#### PR & review hub

| Command | Description |
|---|---|
| `/lightsprint:link-pr` | Link a GitHub PR to a task. Options: `--task <id>`, `--pr-url <url>` |
| `/lightsprint:unlink-pr <id>` | Remove a linked PR from a task |
| `/lightsprint:merge <id>` | Merge the GitHub PR linked to a task |
| `/lightsprint:review-hub signals <id>` | Get PR signals (CI checks, reviews, comments). Options: `--refresh` |
| `/lightsprint:review-hub scores <id>` | Get AI readiness analysis for a PR. Options: `--refresh` (consumes credits) |

#### Cloud agents

| Command | Description |
|---|---|
| `/lightsprint:agent launch` | Launch a cloud agent for a task. Options: `--task <id>`, `--provider anthropic\|cursor\|codex`, `--model <model>`, `--base-ref <branch>`, `--environment-id <id>` |
| `/lightsprint:agent stop` | Stop the active cloud agent. Options: `--task <id>`, `--provider <provider>` |
| `/lightsprint:agent settings` | Show cloud agent provider configuration. Options: `--provider <provider>` |
| `/lightsprint:agent create-pr` | Create a GitHub PR from an agent's working branch. Options: `--task <id>`, `--provider <provider>`, `--agent-id <id>` |

#### Connection & utility

| Command | Description |
|---|---|
| `/lightsprint:connect` | Authenticate and connect to Lightsprint. Options: `--base-url <url>` |
| `/lightsprint:disconnect` | Remove credentials for the current repository |
| `/lightsprint:status` | Show connection status for the current repository |
| `/lightsprint:whoami` | Display current repo and authentication info |
| `/lightsprint:open` | Open the repo board in your browser |
| `/lightsprint:config` | Manage user preferences. Subcommands: `get <key>`, `set <key> <value>`, `delete <key>`, `list` |
| `/lightsprint:describe [command]` | Show accepted parameters, types, and valid enum values as JSON for any command |
| `/lightsprint:upgrade` | Download and install the latest version |

### Global flags

All commands support these flags:

| Flag | Description |
|---|---|
| `--output json\|text` | Output format (default: `text`). Use `json` for machine-readable output |
| `--json` | Shorthand for `--output json` |
| `--dry-run` | Validate inputs without making API calls (`create`, `update`, `claim`, `comment`) |
| `--fields f1,f2` | Return only specified fields (implies `--output json`) |

### Claiming tasks

When you use `/lightsprint:claim`, the plugin:
1. Sets the Lightsprint task to `in_progress`
2. Returns full task details for you to start working

To link a Claude Code task to the Lightsprint task for automatic syncing:
- Use `TaskCreate` with `metadata: { lightsprint_task_id: "<LS task ID>" }`
- Subsequent `TaskUpdate` calls on the Claude Code task automatically sync to the correct Lightsprint task

### Hooks

The plugin registers the following Claude Code hooks automatically:

| Hook | Trigger | Action |
|---|---|---|
| `PermissionRequest` | `ExitPlanMode` | Runs the plan review flow (`lightsprint cc-review`) |
| `SessionStart` | Session begins | Records session start (`lightsprint cc-start`) |
| `SessionEnd` | Session ends | Records session end (`lightsprint cc-end`) |
| `UserPromptSubmit` | User sends a message | Syncs session event (`lightsprint cc-event`) |
| `Stop` | Claude stops responding | Syncs session event (`lightsprint cc-event`) |
| `TaskCompleted` | CC task completed | Syncs task completion (`lightsprint cc-event`) |
| `PostToolUse` (`Bash`) | Bash tool used | Detects newly created GitHub PRs (`lightsprint cc-pr-created`) |
| `PostToolUse` (`TaskCreate`) | CC task created | Syncs to Lightsprint (`lightsprint cc-event`) |
| `PostToolUse` (`TaskUpdate`) | CC task updated | Syncs to Lightsprint (`lightsprint cc-event`) |
| `SubagentStart` | Subagent launched | Syncs session event (`lightsprint cc-event`) |
| `SubagentStop` | Subagent stopped | Syncs session event (`lightsprint cc-event`) |

---

## Plugin Structure

```
lightsprint-claude-code-plugin/
├── .claude-plugin/
│   ├── plugin.json             # Plugin manifest
│   └── marketplace.json        # Marketplace registry entry
├── hooks/
│   └── hooks.json              # All Claude Code hook registrations
├── scripts/
│   ├── lightsprint.js          # Unified CLI entry point (compiled to `lightsprint` binary)
│   ├── ls-cli.js               # Task management commands
│   ├── review-plan.js          # Plan review handler
│   ├── cc-start.js             # SessionStart hook handler
│   ├── cc-end.js               # SessionEnd hook handler
│   ├── cc-event.js             # Generic session event hook handler
│   ├── cc-review.js            # ExitPlanMode plan review hook handler
│   ├── cc-pr-created.js        # PostToolUse Bash hook — PR auto-detection
│   ├── cc-daemon.js            # Background daemon for session sync
│   ├── compile.sh              # Build script for lightsprint binary
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── browser.js          # Cross-platform browser launcher
│       ├── cc-utils.js         # Claude Code session utilities
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── config.js           # Per-folder token resolution + on-demand auth trigger
│       ├── filelock.js         # File-based locking for concurrent access
│       ├── options.js          # Global CLI flag parser
│       ├── output.js           # Structured output helpers (JSON/text/dry-run)
│       ├── plan-tracker.js     # Plan deduplication and tracking
│       ├── schema.js           # Command schema for `describe` and `--help`
│       ├── sentry.js           # Error reporting
│       ├── status-mapper.js    # Status mapping between CC and Lightsprint
│       ├── task-map.js         # CC↔LS task ID mapping
│       └── validate.js         # Input validation helpers
├── skills/
│   ├── tasks/SKILL.md              # /lightsprint:tasks
│   ├── projects/SKILL.md           # /lightsprint:projects
│   ├── create/SKILL.md             # /lightsprint:create
│   ├── update/SKILL.md             # /lightsprint:update
│   ├── get/SKILL.md                # /lightsprint:get
│   ├── claim/SKILL.md              # /lightsprint:claim
│   ├── current-task/SKILL.md       # /lightsprint:current-task
│   ├── comment/SKILL.md            # /lightsprint:comment
│   ├── delete/SKILL.md             # /lightsprint:delete
│   ├── create-plan/SKILL.md        # /lightsprint:create-plan
│   ├── link-pr/SKILL.md            # /lightsprint:link-pr
│   ├── unlink-pr/SKILL.md          # /lightsprint:unlink-pr
│   ├── merge/SKILL.md              # /lightsprint:merge
│   ├── review-hub-signals/SKILL.md # /lightsprint:review-hub signals
│   ├── review-hub-scores/SKILL.md  # /lightsprint:review-hub scores
│   ├── agent/SKILL.md              # /lightsprint:agent launch & stop
│   ├── agent-settings/SKILL.md     # /lightsprint:agent settings
│   └── agent-create-pr/SKILL.md    # /lightsprint:agent create-pr
├── scripts/
│   └── install.ps1                 # Windows PowerShell installer
├── install.sh                  # One-line plugin installer (macOS/Linux)
├── uninstall.sh                # Clean removal
├── npx-install.js              # npx entry point
├── package.json
└── README.md
```

### Local files

| File | Purpose |
|---|---|
| `~/.lightsprint/repos.json` | Per-folder OAuth tokens (access + refresh + expiry + repo ID) |
| `~/.lightsprint/config.json` | Global config (e.g., custom `baseUrl`) |
| `~/.lightsprint/preferences.json` | User preferences (e.g., `link-pr.no-task-behavior`) |
| `~/.lightsprint/daemon.log` | Background daemon log |
| `~/.lightsprint/sync.log` | Session sync log |

---

## Uninstalling

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/uninstall.sh | bash
```

This removes the plugin from Claude Code, clears the plugin cache, removes the binary, and deletes all authorization and config files. User preferences in `~/.lightsprint/preferences.json` are preserved.

---

## Troubleshooting

### Token expired / refresh failed

Use any `/lightsprint:` command — the plugin will re-prompt for authorization if the refresh token has expired. Or run explicitly:

```bash
lightsprint connect
```

### Hook not firing

Verify the plugin is loaded:

```bash
claude --debug
```

Check that `hooks/hooks.json` is being picked up and the expected hook matchers are registered.

### Debugging daemon and sync logs

```bash
tail -f ~/.lightsprint/daemon.log ~/.lightsprint/sync.log
```

### PATH not configured

If the `lightsprint` binary isn't found after install, add the install directory to your PATH:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Add this line to your shell profile (`.bashrc`, `.zshrc`, etc.) to make it permanent.
