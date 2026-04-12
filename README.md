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

#### Task Management

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List tasks from the board. Options: `--status backlog\|todo\|in_progress\|in_review\|done`, `--limit N` |
| `/lightsprint:create <title>` | Create a new task. Options: `--description <text>`, `--complexity low\|medium\|high`, `--status backlog\|todo\|in_progress\|in_review\|done` |
| `/lightsprint:update <id>` | Update a task. Options: `--title <text>`, `--description <text>`, `--status <status>`, `--complexity <level>`, `--assignee <name>` |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, complexity |
| `/lightsprint:claim <id>` | Claim a task — sets it to in_progress and shows full details |
| `/lightsprint:delete <id>` | Delete a task permanently |
| `/lightsprint:search <query>` | Full-text search across tasks. Options: `--status <status>`, `--assignee <name>`, `--limit N` |
| `/lightsprint:subtasks <id>` | List subtasks (child tasks / dependencies) of a parent task |

#### Comments

| Command | Description |
|---|---|
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:comments <id>` | List all comments on a task |
| `/lightsprint:comment --update <commentId> --body <text>` | Update an existing comment |
| `/lightsprint:comment --delete <commentId>` | Delete a comment |

#### Labels & Team

| Command | Description |
|---|---|
| `/lightsprint:labels` | List all labels in the workspace |
| `/lightsprint:label add <id> --label <labelId>` | Add a label to a task |
| `/lightsprint:label remove <id> --label <labelId>` | Remove a label from a task |
| `/lightsprint:members` | List team members in the workspace |

#### Projects & PRs

| Command | Description |
|---|---|
| `/lightsprint:projects` | List projects in the workspace |
| `/lightsprint:link-pr --task <id> --pr-url <url>` | Link a GitHub PR to a task |
| `/lightsprint:unlink-pr <id>` | Remove a linked PR from a task |
| `/lightsprint:merge <id>` | Merge the GitHub PR linked to a task |

#### Review Hub

| Command | Description |
|---|---|
| `/lightsprint:review-hub-signals <id>` | Get PR signals (CI checks, reviews, comments) |
| `/lightsprint:review-hub-scores <id>` | Get AI readiness analysis for a PR |

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
│   ├── compile.sh              # Build script for lightsprint binary
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── config.js           # Per-folder token resolution + on-demand auth trigger
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── task-map.js         # CC↔LS task ID mapping
│       └── status-mapper.js    # Status mapping logic
├── skills/
│   ├── tasks/SKILL.md          # /lightsprint:tasks
│   ├── create/SKILL.md         # /lightsprint:create
│   ├── update/SKILL.md         # /lightsprint:update
│   ├── get/SKILL.md            # /lightsprint:get
│   ├── claim/SKILL.md          # /lightsprint:claim
│   ├── delete/SKILL.md         # /lightsprint:delete
│   ├── comment/SKILL.md        # /lightsprint:comment
│   ├── comments/SKILL.md       # /lightsprint:comments (list + update/delete)
│   ├── search/SKILL.md         # /lightsprint:search
│   ├── labels/SKILL.md         # /lightsprint:labels
│   ├── label/SKILL.md          # /lightsprint:label add|remove
│   ├── members/SKILL.md        # /lightsprint:members
│   ├── subtasks/SKILL.md       # /lightsprint:subtasks
│   ├── projects/SKILL.md       # /lightsprint:projects
│   ├── link-pr/SKILL.md        # /lightsprint:link-pr
│   ├── unlink-pr/SKILL.md      # /lightsprint:unlink-pr
│   ├── merge/SKILL.md          # /lightsprint:merge
│   ├── review-hub-signals/SKILL.md   # /lightsprint:review-hub-signals
│   ├── review-hub-scores/SKILL.md    # /lightsprint:review-hub-scores
│   ├── create-plan/SKILL.md    # /lightsprint:create-plan
│   ├── agent/SKILL.md          # /lightsprint:agent launch|stop|settings
│   └── current-task/SKILL.md   # /lightsprint:current-task
├── install.sh                  # One-line plugin installer
├── uninstall.sh                # Clean removal
├── package.json
└── README.md
```

Zero npm dependencies — uses Node.js built-in `fetch`, `crypto`, and `fs`.

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

Check that `hooks/hooks.json` is being picked up and `PostToolUse` matchers are registered.
