# Lightsprint Claude Code Plugin

Claude Code plugin for Lightsprint — sync Claude Code tasks to your Lightsprint repo board, claim work, review plans, manage PRs, and launch cloud agents directly from the CLI.

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

Defaults to `https://lightsprint.ai`.

---

## Skills (slash commands)

### Task management

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List tasks from the board. Filter by `--status`, `--complexity`, `--assignee`, `--mine`, `--unassigned`, `--deps`, `--project`, `--sort`, `--limit`, `--offset`, `--page-all`. |
| `/lightsprint:create <title>` | Create a new task. Supports `--description`, `--complexity`, `--status`, `--project`, `--depends-on`, `--parent`, `--json-body`, `--dry-run`. |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, dependencies, complexity. |
| `/lightsprint:update <id>` | Update a task — title, description, status, complexity, assignee, position, or dependencies. |
| `/lightsprint:delete <id>` | Permanently delete a task from the board. |
| `/lightsprint:claim <id>` | Claim a task — sets it to `in_progress` and returns full details. |
| `/lightsprint:comment <id> <text>` | Add a comment to a task. |
| `/lightsprint:current-task` | Get the Lightsprint task linked to the current Claude Code session (auto-discovers via session PID). |
| `/lightsprint:projects` | List projects in the workspace. Useful for finding project IDs. |
| `/lightsprint:create-plan` | Upload a markdown plan/design doc to Lightsprint for team visibility and review. |

### PR workflow

| Command | Description |
|---|---|
| `/lightsprint:link-pr` | Link a GitHub PR to a Lightsprint task. |
| `/lightsprint:unlink-pr` | Remove the linked PR from a task. |
| `/lightsprint:merge` | Merge the PR linked to a task. Supports direct merge and GitHub merge queue. |
| `/lightsprint:review-hub-scores` | Get AI readiness analysis (score, summaries, callouts, suggested actions) for a task's linked PR. |
| `/lightsprint:review-hub-signals` | Get PR signals (CI checks, reviews, comments, deployments) for a task's linked PR. |

### Cloud agents

| Command | Description |
|---|---|
| `/lightsprint:agent` | Launch, stop, or check cloud agents on tasks. Supports `anthropic`, `cursor`, and `codex` providers. |
| `/lightsprint:agent-settings` | Check which cloud agent providers are configured and their default models. |
| `/lightsprint:agent-create-pr` | Create a GitHub PR from a cloud agent's working branch after it finishes work. |

Every CLI command supports `--output json` for structured output and `--dry-run` on mutating operations. Run `lightsprint describe <command>` for full schema introspection.

---

## How It Works

### Plan review

When you exit plan mode in Claude Code, the plugin's `PermissionRequest` hook captures the plan and routes it to Lightsprint for review — giving your team visibility into proposed work before code is written.

### Claiming tasks

When you run `/lightsprint:claim`, the plugin:
1. Sets the Lightsprint task to `in_progress`
2. Links the Claude Code session (via PID) to the Lightsprint task
3. Subsequent session events (task updates, tool use, stop, subagent activity) automatically sync status and progress back to Lightsprint

### Session sync

The plugin registers hooks for `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `TaskCompleted`, `PostToolUse` (Bash / TaskCreate / TaskUpdate), `SubagentStart`, and `SubagentStop`. These emit events to a local daemon that mirrors them to Lightsprint — no blocking, no prompts.

---

## Plugin Structure

```
lightsprint-claude-code-plugin/
├── .claude-plugin/
│   ├── plugin.json             # Plugin manifest
│   └── marketplace.json        # Marketplace registry entry
├── hooks/
│   └── hooks.json              # PermissionRequest, Session, PostToolUse, Subagent hooks
├── scripts/
│   ├── lightsprint.js          # Unified CLI entry point (compiled to `lightsprint` binary)
│   ├── ls-cli.js               # Task / PR / agent commands
│   ├── review-plan.js          # Plan review handler
│   ├── cc-daemon.js            # Local daemon that mirrors session events to Lightsprint
│   ├── cc-start.js             # SessionStart hook
│   ├── cc-end.js               # SessionEnd hook
│   ├── cc-event.js             # UserPromptSubmit / Stop / Task* / Subagent* hook
│   ├── cc-pr-created.js        # PostToolUse Bash hook (detects `gh pr create`)
│   ├── cc-review.js            # PermissionRequest hook for ExitPlanMode
│   ├── compile.sh              # Build script for the `lightsprint` binary
│   ├── deploy-tag.sh           # Release tagging script
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── browser.js          # Cross-platform browser opener
│       ├── cc-utils.js         # Claude Code session helpers
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── config.js           # Per-folder token resolution + on-demand auth trigger
│       ├── filelock.js         # Cross-process file locking
│       ├── options.js          # CLI option parsing
│       ├── output.js           # Human / JSON output formatting
│       ├── plan-tracker.js     # Plan review state
│       ├── schema.js           # `describe` command schemas
│       ├── sentry.js           # Error reporting
│       ├── status-mapper.js    # Lightsprint ↔ Claude Code status mapping
│       ├── task-map.js         # CC session ↔ LS task mapping
│       └── validate.js         # Input validation (task IDs, enums, control chars)
├── skills/                     # One SKILL.md per slash command
├── install.sh                  # One-line plugin installer
├── uninstall.sh                # Clean removal
├── npx-install.js              # `npx lightsprint` entry point
├── package.json
└── README.md
```

### Local files

| File | Purpose |
|---|---|
| `~/.lightsprint/repos.json` | Per-folder OAuth tokens (access + refresh + expiry + repo ID) |
| `~/.lightsprint/active-task.json` | Currently in-progress task |
| `~/.lightsprint/daemon.log` | Daemon event log |
| `~/.lightsprint/sync.log` | Sync activity log |

---

## Uninstalling

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/uninstall.sh | bash
```

This removes the plugin from Claude Code and deletes the authorization for the current folder. Other folders' authorizations in `~/.lightsprint/repos.json` are preserved.

---

## Troubleshooting

### Token expired / refresh failed

Use any `/lightsprint:` command — the plugin will re-prompt for authorization if the refresh token has expired.

### Hook not firing

Verify the plugin is loaded:

```bash
claude --debug
```

Check that `hooks/hooks.json` is being picked up and the relevant hook matchers (e.g. `PermissionRequest` → `ExitPlanMode`) are registered.

### Daemon / sync debugging

Tail the daemon and sync logs:

```bash
tail -f ~/.lightsprint/daemon.log ~/.lightsprint/sync.log
```
