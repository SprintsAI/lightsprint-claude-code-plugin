# Lightsprint Claude Code Plugin

Claude Code plugin for Lightsprint — task management, plan review, cloud agent launching, PR review hub, and repo board integration.

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

## How It Works

### Skills (slash commands)

#### Task Management

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List tasks from the board. Options: `--status backlog\|todo\|in_progress\|in_review\|done`, `--complexity low\|medium\|high`, `--assignee <name>`, `--mine`, `--unassigned`, `--deps <filter>`, `--project <filter>`, `--sort <field>`, `--limit N`, `--offset N`, `--page-all`, `--output json` |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, dependencies, complexity. Supports `--fields` for partial output. |
| `/lightsprint:create <title>` | Create a new task. Options: `--description <text>`, `--complexity low\|medium\|high`, `--status backlog\|todo\|in_progress\|in_review\|done`, `--project <projectId>`, `--depends-on <ids>`, `--parent <taskId>`, `--dry-run`, `--output json` |
| `/lightsprint:update <id>` | Update a task. Options: `--title <text>`, `--description <text>`, `--status <status>`, `--complexity <level>`, `--assignee <name>`, `--project <projectId>`, `--position <num>`, `--add-dep <taskId>`, `--remove-dep <taskId>`, `--dry-run`, `--output json` |
| `/lightsprint:claim <id>` | Claim a task — sets it to `in_progress`, assigns it, and shows full details |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:delete <id>` | Permanently delete a task from the board |
| `/lightsprint:current-task` | Get the Lightsprint task linked to the current Claude Code session (auto-discovered via session PID) |

#### Projects

| Command | Description |
|---|---|
| `/lightsprint:projects` | List projects from the workspace. Options: `--status active\|completed\|archived`, `--output json` |

#### Planning

| Command | Description |
|---|---|
| `/lightsprint:create-plan` | Upload a markdown plan, design doc, or structured document for team visibility and review. Options: `--content <markdown>`, `--title <text>`, `--task <taskId>`, `--dry-run`, `--output json` |

#### Pull Requests

| Command | Description |
|---|---|
| `/lightsprint:link-pr` | Link a GitHub PR to a task (`--task <id>`, `--pr-url <url>`). Triggered automatically after `gh pr create`. |
| `/lightsprint:unlink-pr <id>` | Remove a linked PR from a task |
| `/lightsprint:merge <id>` | Merge the GitHub PR linked to a task. Supports direct merge and GitHub merge queue. |

#### Review Hub

| Command | Description |
|---|---|
| `/lightsprint:review-hub-signals <id>` | Get PR signals (CI checks, reviews, comments, deployments) for a task's linked PR. Use `--refresh` to re-fetch from GitHub. |
| `/lightsprint:review-hub-scores <id>` | Get AI readiness analysis (score, summaries, callouts, suggested actions) for a task's linked PR. Use `--refresh` to trigger fresh analysis (consumes credits). |

#### Cloud Agents

| Command | Description |
|---|---|
| `/lightsprint:agent` | Launch, stop, or check settings for cloud agents (`anthropic`, `cursor`, `codex`) on tasks |
| `/lightsprint:agent-settings` | Check which cloud agent providers are configured and their default models |
| `/lightsprint:agent-create-pr` | Create a GitHub PR from a cloud agent's working branch |

### Claiming tasks

When you use `/lightsprint:claim`, the plugin:
1. Sets the Lightsprint task to `in_progress`
2. Creates a Claude Code task linked via `metadata: { lightsprint_task_id: "<LS task ID>" }`
3. Subsequent `TaskUpdate` calls on the Claude Code task automatically sync to the correct Lightsprint task

### PR auto-linking

Every time you create a GitHub PR via `gh pr create`, the plugin automatically:
1. Detects the PR creation via the `PostToolUse` hook
2. Runs `lightsprint current-task` to find the linked Lightsprint task
3. Links the PR to the task via `lightsprint link-pr`
4. If no task is linked, prompts you to create one, pick an existing task, or skip

### Plan review

When you exit plan mode in Claude Code, the `PermissionRequest` hook triggers `lightsprint cc-review`, which sends the plan to Lightsprint for team visibility.

---

## Plugin Structure

```
lightsprint-claude-code-plugin/
├── .claude-plugin/
│   ├── plugin.json             # Plugin manifest
│   └── marketplace.json        # Marketplace registry entry
├── hooks/
│   └── hooks.json              # All Claude Code event hooks
├── scripts/
│   ├── lightsprint.js          # Unified CLI entry point (compiled to `lightsprint` binary)
│   ├── review-plan.js          # Plan review handler
│   ├── ls-cli.js               # Task management commands
│   ├── cc-daemon.js            # Background daemon for session tracking
│   ├── cc-start.js             # SessionStart hook handler
│   ├── cc-end.js               # SessionEnd hook handler
│   ├── cc-event.js             # General event hook handler (TaskCreate, TaskUpdate, etc.)
│   ├── cc-review.js            # Plan review hook handler (ExitPlanMode)
│   ├── cc-pr-created.js        # PR auto-link hook handler (PostToolUse/Bash)
│   ├── compile.sh              # Build script for lightsprint binary
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── browser.js          # Browser launch utilities
│       ├── cc-utils.js         # Claude Code session utilities
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── config.js           # Per-folder token resolution + on-demand auth trigger
│       ├── filelock.js         # Atomic file locking
│       ├── options.js          # Shared CLI option parsing
│       ├── output.js           # Structured output helpers
│       ├── plan-tracker.js     # Plan deduplication and tracking
│       ├── schema.js           # API schema definitions
│       ├── sentry.js           # Error reporting
│       ├── status-mapper.js    # Status mapping logic
│       ├── task-map.js         # CC↔LS task ID mapping
│       └── validate.js         # Input validation helpers
├── skills/
│   ├── tasks/SKILL.md          # /lightsprint:tasks
│   ├── get/SKILL.md            # /lightsprint:get
│   ├── create/SKILL.md         # /lightsprint:create
│   ├── update/SKILL.md         # /lightsprint:update
│   ├── claim/SKILL.md          # /lightsprint:claim
│   ├── comment/SKILL.md        # /lightsprint:comment
│   ├── delete/SKILL.md         # /lightsprint:delete
│   ├── current-task/SKILL.md   # /lightsprint:current-task
│   ├── projects/SKILL.md       # /lightsprint:projects
│   ├── create-plan/SKILL.md    # /lightsprint:create-plan
│   ├── link-pr/SKILL.md        # /lightsprint:link-pr
│   ├── unlink-pr/SKILL.md      # /lightsprint:unlink-pr
│   ├── merge/SKILL.md          # /lightsprint:merge
│   ├── review-hub-signals/SKILL.md  # /lightsprint:review-hub-signals
│   ├── review-hub-scores/SKILL.md   # /lightsprint:review-hub-scores
│   ├── agent/SKILL.md          # /lightsprint:agent
│   ├── agent-settings/SKILL.md # /lightsprint:agent-settings
│   └── agent-create-pr/SKILL.md # /lightsprint:agent-create-pr
├── pi-extension/               # Pi agent extension (same functionality, native pi integration)
├── install.sh                  # One-line plugin installer
├── uninstall.sh                # Clean removal
├── package.json
└── README.md
```

Zero runtime npm dependencies in the core CLI — uses Node.js built-in `fetch`, `crypto`, and `fs`.

### Hooks registered

| Hook | Trigger | Handler |
|---|---|---|
| `SessionStart` | Claude Code session begins | `lightsprint cc-start` |
| `SessionEnd` | Claude Code session ends | `lightsprint cc-end` |
| `UserPromptSubmit` | User submits a prompt | `lightsprint cc-event` |
| `Stop` | Claude Code stops | `lightsprint cc-event` |
| `TaskCompleted` | A Claude Code task completes | `lightsprint cc-event` |
| `SubagentStart` | A subagent starts | `lightsprint cc-event` |
| `SubagentStop` | A subagent stops | `lightsprint cc-event` |
| `PostToolUse / TaskCreate` | Claude Code creates a task | `lightsprint cc-event` |
| `PostToolUse / TaskUpdate` | Claude Code updates a task | `lightsprint cc-event` |
| `PostToolUse / Bash` | Bash command runs (PR detection) | `lightsprint cc-pr-created` |
| `PermissionRequest / ExitPlanMode` | User exits plan mode | `lightsprint cc-review` |

### Local files

| File | Purpose |
|---|---|
| `~/.lightsprint/repos.json` | Per-folder OAuth tokens (access + refresh + expiry + repo ID) |
| `~/.lightsprint/task-map.json` | Claude Code ↔ Lightsprint task ID mapping |
| `~/.lightsprint/config.json` | Plugin configuration |
| `~/.lightsprint/preferences.json` | User preferences (e.g. PR linking behavior) |
| `~/.lightsprint/daemon.log` | Background daemon log |

---

## Pi Extension

The `pi-extension/` directory contains a [pi](https://github.com/badlogic/pi-mono) agent extension with the same functionality as the Claude Code plugin, but with native pi integration (custom tools, commands, keyboard shortcuts, and a footer status bar).

See [`pi-extension/README.md`](pi-extension/README.md) for installation and usage details.

---

## Uninstalling

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/uninstall.sh | bash
```

This removes the plugin from Claude Code and deletes the authorization for the current folder. Other folders' authorizations in `~/.lightsprint/repos.json` are preserved.

---

## Troubleshooting

### Token expired / refresh failed

Use any `/lightsprint:` command — the plugin will re-prompt for authorization if the refresh token has expired. You can also run:

```bash
lightsprint connect
```

### Hook not firing

Verify the plugin is loaded:

```bash
claude --debug
```

Check that `hooks/hooks.json` is being picked up and hooks are registered for the relevant events (`SessionStart`, `PermissionRequest`, `PostToolUse`, etc.).

### View daemon logs

```bash
tail -f ~/.lightsprint/daemon.log
```

### Upgrade to latest version

```bash
lightsprint upgrade
```

### Check connection status

```bash
lightsprint whoami
```
