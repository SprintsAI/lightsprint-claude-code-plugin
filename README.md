# Lightsprint Claude Code Plugin

Claude Code plugin for Lightsprint — plan review, task management skills, and repo board integration.

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

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List tasks from the board. Options: `--status backlog\|todo\|in_progress\|in_review\|done`, `--limit N` |
| `/lightsprint:create <title>` | Create a new task. Options: `--description <text>`, `--complexity trivial\|low\|medium\|high\|critical`, `--status backlog\|todo\|in_progress\|in_review\|done` |
| `/lightsprint:update <id>` | Update a task. Options: `--title <text>`, `--description <text>`, `--status <status>`, `--complexity <level>`, `--assignee <name>` |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, complexity |
| `/lightsprint:claim <id>` | Claim a task — sets it to in_progress and shows full details |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:delete <id>` | Delete a task permanently from the board |
| `/lightsprint:current-task` | Get the task linked to the current Claude Code session (auto-discovered by PID) |
| `/lightsprint:projects` | List projects in the workspace (e.g. to find a project ID for filtering) |
| `/lightsprint:create-plan` | Create a plan on Lightsprint from markdown content |

#### PR linking & merge

| Command | Description |
|---|---|
| `/lightsprint:link-pr <id> <pr>` | Link a GitHub PR to a task |
| `/lightsprint:unlink-pr <id>` | Remove a linked PR from a task |
| `/lightsprint:merge <id>` | Merge the PR linked to a task (direct merge or merge queue) |
| `/lightsprint:review-hub-scores <id>` | AI readiness analysis (score, summaries, callouts) for a task's linked PR |
| `/lightsprint:review-hub-signals <id>` | PR signals (CI checks, reviews, comments, deployments) for a task's linked PR |

#### Cloud agents

| Command | Description |
|---|---|
| `/lightsprint:agent` | Launch, stop, or check cloud agents on a task (anthropic, cursor, codex providers) |
| `/lightsprint:agent-settings` | Show which cloud agent providers are configured and their default models |
| `/lightsprint:agent-create-pr` | Open a GitHub PR from a cloud agent's working branch |

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
│   └── hooks.json              # PermissionRequest hook for plan review
├── scripts/
│   ├── lightsprint.js          # Unified CLI entry point (compiled to `lightsprint` binary)
│   ├── review-plan.js          # Plan review handler (exports reviewPlanMain)
│   ├── ls-cli.js               # Task management commands (exports cliMain)
│   ├── cc-*.js                 # Claude Code hook handlers (cc-daemon, cc-start, cc-end, cc-event, cc-review, cc-pr-created)
│   ├── compile.sh              # Build script for lightsprint binary
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── browser.js          # Opens the system browser for auth
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── config.js           # Per-folder token resolution + on-demand auth trigger
│       ├── cc-utils.js         # Claude Code session/PID helpers
│       ├── filelock.js         # File-based locking for concurrent safety
│       ├── options.js          # CLI flag parsing
│       ├── output.js           # JSON / human output formatting
│       ├── plan-tracker.js     # Plan review state tracking
│       ├── schema.js           # Command schema (drives `describe`)
│       ├── sentry.js           # Error tracking init
│       ├── status-mapper.js    # Status mapping logic
│       ├── task-map.js         # CC↔LS task ID mapping
│       └── validate.js         # Input validation (task IDs, enums, control chars)
├── skills/                     # One SKILL.md per slash command (tasks, create, update, get,
│   └── …                       #   claim, comment, delete, current-task, projects, create-plan,
│                               #   link-pr, unlink-pr, merge, review-hub-scores/-signals,
│                               #   agent, agent-settings, agent-create-pr)
├── install.sh                  # One-line plugin installer
├── uninstall.sh                # Clean removal
├── package.json
└── README.md
```

A single npm dependency (`@sentry/node` for error tracking); otherwise relies on Node.js built-ins (`fetch`, `crypto`, `fs`).

### Local files

| File | Purpose |
|---|---|
| `~/.lightsprint/repos.json` | Per-folder OAuth tokens (access + refresh + expiry + repo ID) |
| `~/.lightsprint/active-task.json` | Currently in-progress task |

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

Check that `hooks/hooks.json` is being picked up and its matchers are registered — `PermissionRequest` (plan review on `ExitPlanMode`), `PostToolUse` (task create/update sync), and the session lifecycle hooks (`SessionStart`, `SessionEnd`, `Stop`, `UserPromptSubmit`, `TaskCompleted`, `SubagentStart`/`SubagentStop`).
