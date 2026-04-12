# Lightsprint Claude Code Plugin

Claude Code plugin for Lightsprint — task management, plan review, PR automation, and cloud agent orchestration.

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

### Custom base URL (self-hosted)

```bash
npx lightsprint --base-url https://your-instance.example.com
```

Or set an environment variable before installing:

```bash
export LIGHTSPRINT_BASE_URL=https://your-instance.example.com
npx lightsprint
```

---

## Authentication

Authentication is **on-demand** — the first time you use a `/lightsprint:` command in an unconnected folder, the plugin opens your browser to authorize. You pick a Lightsprint repo, and tokens are saved locally. Tokens refresh automatically.

### Token resolution

The plugin resolves tokens by:

1. Looking up the current git repository (`owner/repo`) in `~/.lightsprint/repos.json`
2. If no token found, opening the browser to authorize

A single authorization at your repo root works for all subdirectories and worktrees. Hooks silently skip if no authorization exists (they never prompt).

### Multiple repos

Each folder can connect to a different Lightsprint repo. The plugin prompts automatically when you use a command in a new folder.

### Manual connect / disconnect

```bash
lightsprint connect          # Re-run browser OAuth for this folder
lightsprint disconnect       # Remove credentials for this folder
lightsprint whoami           # Show current repo + auth info
lightsprint status           # Show connection status
```

### Optional: Custom base URL

For self-hosted Lightsprint instances:

```bash
export LIGHTSPRINT_BASE_URL=https://your-instance.example.com
```

Defaults to `https://lightsprint.ai`.

---

## How It Works

### Skills (slash commands)

#### Task management

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List tasks from the board. Supports filtering by status, complexity, assignee, project, dependencies, and more. |
| `/lightsprint:create <title>` | Create a new task. Options: `--description`, `--complexity`, `--status`, `--project`, `--depends-on`, `--parent`. |
| `/lightsprint:update <id>` | Update a task. Change title, description, status, complexity, assignee, project, position, or dependencies. |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, dependencies, complexity. |
| `/lightsprint:claim <id>` | Claim a task — sets it to `in_progress` and links it to the current Claude Code session. |
| `/lightsprint:delete <id>` | Permanently delete a task from the board. |
| `/lightsprint:comment <id> <text>` | Add a comment to a task. |
| `/lightsprint:current-task` | Get the Lightsprint task linked to the current Claude Code session (no task ID needed). |
| `/lightsprint:projects` | List projects in the workspace. Use to find project IDs for filtering tasks. |

#### Plan management

| Command | Description |
|---|---|
| `/lightsprint:create-plan` | Upload an implementation plan or design doc to Lightsprint for team review. |

#### PR & Review Hub

| Command | Description |
|---|---|
| `/lightsprint:link-pr` | Link a GitHub PR to a task. Sets the task to `in_review` and triggers automated PR review. |
| `/lightsprint:unlink-pr` | Remove a linked GitHub PR from a task. |
| `/lightsprint:merge` | Merge the GitHub PR linked to a task. Supports direct merge and GitHub merge queue. |
| `/lightsprint:review-hub-signals` | Get PR signals (CI checks, reviews, comments, deployments) for a task's linked PR. |
| `/lightsprint:review-hub-scores` | Get AI readiness analysis (score, summaries, callouts, suggested actions) for a task's linked PR. |

#### Cloud agents

| Command | Description |
|---|---|
| `/lightsprint:agent` | Launch, stop, or check settings for cloud agents (Anthropic, Cursor, Codex) on tasks. |
| `/lightsprint:agent-settings` | Check which cloud agent providers are configured and their default models. |
| `/lightsprint:agent-create-pr` | Create a GitHub PR from a cloud agent's working branch. |

---

### CLI reference

All skills map to the `lightsprint` binary. You can call it directly from the terminal or scripts.

```
lightsprint <command> [options]

Global flags:
  --output json|text    Output format (default: text; JSON when stdout is not a TTY)
  --json                Shorthand for --output json
  --dry-run             Validate inputs without calling the API
  --fields f1,f2        Return only specified fields (implies --output json)
  --help, -h            Show command-specific help
```

#### `tasks`

```
lightsprint tasks [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--status <status>` | all | Comma-separated: `backlog`, `todo`, `in_progress`, `in_review`, `done` |
| `--complexity <level>` | all | `low`, `medium`, or `high` |
| `--assignee <name>` | all | Case-insensitive substring match |
| `--mine` | — | Tasks assigned to the current user |
| `--unassigned` | — | Tasks with no assignee |
| `--deps <filter>` | all | `has-dependencies`, `has-no-dependencies`, `has-dependents`, `unblocked` |
| `--project <id>` | all | Project ID(s), comma-separated, or `none` |
| `--sort <field>` | `position` | `position`, `updated_at`, or `created_at` |
| `--limit N` | 20 | Max tasks (server max: 100) |
| `--offset N` | 0 | Skip first N tasks (pagination) |
| `--page-all` | — | Stream all tasks as NDJSON (ignores `--limit`/`--offset`) |
| `--output json` | text | Structured JSON output |

#### `create`

```
lightsprint create <title> [options]
lightsprint create --title <text> [options]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--title <text>` | Yes | Task title (max 500 chars) |
| `--description <text>` | No | Task description (max 50,000 chars) |
| `--complexity <level>` | No | `low`, `medium`, or `high` |
| `--status <status>` | No | Initial status (default: `backlog`) |
| `--project <id>` | No | Project ID (`lightsprint projects` to list) |
| `--depends-on <ids>` | No | Comma-separated task IDs this task depends on |
| `--parent <taskId>` | No | Create as a subtask of this parent |
| `--json-body <json>` | No | Raw JSON request body (replaces other flags) |
| `--dry-run` | No | Validate without calling the API |

#### `update`

```
lightsprint update <taskId> [options]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--title <text>` | No | New title |
| `--description <text>` | No | New description |
| `--status <status>` | No | `backlog`, `todo`, `in_progress`, `in_review`, `done` |
| `--complexity <level>` | No | `low`, `medium`, or `high` |
| `--assignee <name>` | No | Team member name |
| `--project <id>` | No | Move to a project |
| `--position <num>` | No | Reorder within section (0 = top) |
| `--add-dep <taskId>` | No | Add a dependency (repeatable) |
| `--remove-dep <taskId>` | No | Remove a dependency (repeatable) |
| `--json-body <json>` | No | Raw JSON request body |
| `--dry-run` | No | Validate without calling the API |

#### `get`

```
lightsprint get <taskId> [--fields <fields>]
```

Shows: title, status, assignee, complexity, project, description, todo list, related files, dependencies (depends-on and blocks).

The `--fields` flag accepts a comma-separated list: `task`, `dependencies`, `dependents`. Within `task`: `id`, `title`, `status`, `assignee`, `complexity`, `description`, `todoList`, `relatedFiles`, `creator`.

#### `claim`

```
lightsprint claim <taskId>
```

Sets the task to `in_progress`, assigns it to the current user, and links it to the active Claude Code session. Only root tasks (no parent) can be claimed.

#### `delete`

```
lightsprint delete <taskId>
```

Permanently removes a task from the board. Cannot be undone. Prefer `--status done` over deleting completed work.

#### `comment`

```
lightsprint comment <taskId> <body>
lightsprint comment --task <taskId> --body <text>
```

Max 10,000 characters. No control characters (newlines and tabs are allowed).

#### `projects`

```
lightsprint projects [--status active|completed|archived] [--output json]
```

Lists projects with task counts. Use the returned IDs with `lightsprint tasks --project <id>`.

#### `current-task`

```
lightsprint current-task --cc-pid $PPID
```

Finds the Lightsprint task linked to the current Claude Code session using the session PID.

#### `create-plan`

```
lightsprint create-plan --content <markdown> [--title <text>] [--task <taskId>] [--dry-run]
```

Uploads a plan (max 200,000 chars) to Lightsprint for team visibility. Optionally links to an existing task. Title is extracted from the first heading if not specified.

#### `link-pr` / `unlink-pr`

```
lightsprint link-pr --task <taskId> --pr-url <prUrl>
lightsprint unlink-pr <taskId>
```

`link-pr` sets the task status to `in_review` and triggers automated PR review. Every time you create a GitHub PR, link it immediately — do not wait for the user to ask.

#### `merge`

```
lightsprint merge <taskId> [--dry-run] [--output json]
```

Merges the PR linked to the task. If the repo uses GitHub merge queue, the PR is queued (status `queued`) rather than merged immediately.

#### `review-hub signals`

```
lightsprint review-hub signals <taskId> [--refresh] [--output json]
```

Returns CI checks, reviews, comments, deployments, and diff stats for the task's linked PR. Use `--refresh` to re-fetch from GitHub (use sparingly).

#### `review-hub scores`

```
lightsprint review-hub scores <taskId> [--refresh] [--output json]
```

Returns AI readiness score (0–100), section summaries, callouts, and suggested actions. `--refresh` triggers fresh AI analysis (consumes credits). May take up to 2 minutes.

#### `agent`

```
lightsprint agent launch --task <taskId> --provider <anthropic|cursor|codex> [--model <m>] [--environment-id <id>] [--output json]
lightsprint agent stop   --task <taskId> --provider <anthropic|cursor|codex> [--output json]
lightsprint agent settings [--provider <provider>] [--output json]
lightsprint agent create-pr --task <taskId> --provider <provider> --agent-id <id> [--output json]
```

Manage cloud agents on tasks. Check `agent settings` before launching to verify provider configuration. For Codex, `--environment-id` is required — use `agent settings --provider codex` to discover IDs. Multiple tasks can be launched concurrently using repeated `--task` flags.

#### `describe`

```
lightsprint describe <command>
```

Returns accepted parameters, types, required fields, and valid enum values as JSON. Useful for agents to self-serve schema information at runtime.

#### Utility commands

```
lightsprint open        # Open the repo board in your browser
lightsprint status      # Show connection status for this repository
lightsprint whoami      # Show repo/auth info
lightsprint connect     # Re-run browser OAuth for this folder
lightsprint disconnect  # Remove credentials for this folder
lightsprint upgrade     # Upgrade to the latest version
lightsprint version     # Show version and build info
```

---

### Claiming tasks

When you use `/lightsprint:claim`, the plugin:
1. Sets the task to `in_progress` and assigns it to you
2. Links the task to the active Claude Code session via `--cc-pid $PPID`
3. Subsequent `TaskUpdate` calls from Claude Code automatically sync to the correct Lightsprint task

---

## Automatic Hooks

The plugin registers several Claude Code hooks that run automatically:

| Hook | Trigger | What it does |
|------|---------|-------------|
| `PermissionRequest: ExitPlanMode` | Claude exits plan mode | Runs plan review (`lightsprint cc-review`) |
| `SessionStart` | CC session starts | Registers the session |
| `SessionEnd` | CC session ends | Cleans up session state |
| `UserPromptSubmit` | User sends a message | Records session activity |
| `Stop` | Claude stops | Records session activity |
| `TaskCompleted` | CC task completes | Syncs task status |
| `PostToolUse: Bash` | Bash tool runs | Detects `gh pr create` output and auto-links PRs |
| `PostToolUse: TaskCreate` | CC task created | Syncs task to Lightsprint |
| `PostToolUse: TaskUpdate` | CC task updated | Syncs status/metadata to Lightsprint |
| `SubagentStart` / `SubagentStop` | Subagent activity | Records agent lifecycle events |

Hooks silently skip if the current directory is not connected to a Lightsprint repo — they never prompt.

---

## Plugin Structure

```
lightsprint-claude-code-plugin/
├── hooks/
│   └── hooks.json              # Claude Code hook registrations
├── scripts/
│   ├── lightsprint.js          # Unified CLI entry point (compiled to `lightsprint` binary)
│   ├── review-plan.js          # Plan review handler
│   ├── ls-cli.js               # Task management command implementations
│   ├── cc-start.js             # SessionStart hook handler
│   ├── cc-end.js               # SessionEnd hook handler
│   ├── cc-event.js             # General CC event hook handler
│   ├── cc-review.js            # Plan review hook handler (ExitPlanMode)
│   ├── cc-pr-created.js        # PR auto-link hook handler (PostToolUse: Bash)
│   ├── cc-daemon.js            # Background daemon
│   ├── compile.sh              # Build script (Bun → compiled binary)
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── config.js           # Per-repo token resolution + on-demand auth trigger
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── task-map.js         # CC ↔ LS task ID mapping
│       ├── status-mapper.js    # Status mapping logic
│       ├── validate.js         # Input validation helpers (task IDs, enums, etc.)
│       ├── output.js           # Structured output helpers (text + JSON)
│       ├── schema.js           # Command schema for `lightsprint describe`
│       ├── options.js          # Shared CLI option parsing
│       ├── plan-tracker.js     # Plan deduplication tracking
│       ├── cc-utils.js         # Claude Code session utilities
│       ├── filelock.js         # File-based locking
│       ├── browser.js          # Browser launch helper
│       └── sentry.js           # Error reporting
├── skills/
│   ├── tasks/SKILL.md          # /lightsprint:tasks
│   ├── create/SKILL.md         # /lightsprint:create
│   ├── update/SKILL.md         # /lightsprint:update
│   ├── get/SKILL.md            # /lightsprint:get
│   ├── claim/SKILL.md          # /lightsprint:claim
│   ├── delete/SKILL.md         # /lightsprint:delete
│   ├── comment/SKILL.md        # /lightsprint:comment
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
├── install.sh                  # One-line plugin installer
├── uninstall.sh                # Clean removal
├── npx-install.js              # npx entry point (downloads and runs install.sh)
├── package.json
└── README.md
```

Zero npm runtime dependencies in the compiled binary — uses Node.js built-in `fetch`, `crypto`, and `fs`.

### Local files

| File | Purpose |
|------|---------|
| `~/.lightsprint/repos.json` | Per-repo OAuth tokens (access + refresh + expiry + repo ID) |
| `~/.lightsprint/config.json` | Plugin configuration (base URL) |
| `~/.lightsprint/preferences.json` | User preferences (e.g., `link-pr.no-task-behavior`) |
| `~/.lightsprint/daemon.log` | Background daemon log |
| `~/.lightsprint/sync.log` | Sync activity log |

### User preferences

```bash
lightsprint config get link-pr.no-task-behavior   # Check current setting
lightsprint config set link-pr.no-task-behavior <value>
```

| Preference | Values | Description |
|-----------|--------|-------------|
| `link-pr.no-task-behavior` | `prompt` (default), `always-skip`, `always-create` | What to do when a PR is created but no Lightsprint task is linked |

---

## Uninstalling

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/uninstall.sh | bash
```

This removes the plugin from Claude Code and deletes the authorization for the current folder. Other folders' authorizations in `~/.lightsprint/repos.json` are preserved.

---

## Troubleshooting

### Token expired / refresh failed

Use any `/lightsprint:` command — the plugin will re-prompt for authorization if the refresh token has expired. Or run `lightsprint connect` directly.

### Hook not firing

Verify the plugin is loaded:

```bash
claude --debug
```

Check that `hooks/hooks.json` is being picked up and that `PermissionRequest` and `PostToolUse` matchers are registered.

### Viewing logs

```bash
tail -f ~/.lightsprint/daemon.log ~/.lightsprint/sync.log
```

### Plugin not found after install

Ensure `~/.local/bin` (or `$XDG_DATA_HOME/bin`) is on your `$PATH`. The installer prints the path where the `lightsprint` binary was placed.

---

## Agent-Friendly CLI Design

The `lightsprint` CLI is designed primarily for AI agents (via skills). Key design principles:

- **Machine-readable output**: All commands support `--output json`. Errors are structured JSON to stderr.
- **Input validation**: Task IDs, status/complexity enums, and comment bodies are validated before hitting the API. Hallucinated inputs are rejected with clear error messages.
- **Raw JSON payloads**: `create` and `update` accept `--json-body <json>` for full request body control.
- **Dry-run support**: Mutating commands (`create`, `update`, `claim`, `comment`, `merge`) support `--dry-run` to validate without acting.
- **Schema introspection**: `lightsprint describe <command>` dumps accepted parameters and enum values as JSON for agent self-service.
- **Context window discipline**: `--fields` limits returned fields; `--page-all` streams NDJSON for large task lists.
