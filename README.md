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

#### Core Task Management

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List tasks from the board. Options: `--status`, `--assignee`, `--mine`, `--unassigned`, `--deps`, `--project`, `--sort`, `--limit`, `--page-all` |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, dependencies, complexity |
| `/lightsprint:create <title>` | Create a new task. Options: `--description`, `--complexity`, `--status`, `--project`, `--depends-on`, `--parent` |
| `/lightsprint:update <id>` | Update a task. Options: `--title`, `--description`, `--status`, `--complexity`, `--assignee`, `--project`, `--add-dep`, `--remove-dep`, `--add-label`, `--remove-label` |
| `/lightsprint:claim <id>` | Claim a task — sets it to in_progress and links the Claude Code session |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:delete <id>` | Permanently delete a task |

#### Search & Discovery

| Command | Description |
|---|---|
| `/lightsprint:search <query>` | Search tasks by text across title and description. Options: `--status`, `--assignee`, `--project`, `--limit` |
| `/lightsprint:projects` | List projects in the workspace. Options: `--status active\|completed\|archived` |
| `/lightsprint:members` | List workspace members — useful for finding valid assignee names before assigning tasks |
| `/lightsprint:labels` | List available labels — returns label IDs needed for `update --add-label` |

#### Task Details & History

| Command | Description |
|---|---|
| `/lightsprint:comments <id>` | List all comments on a task. Options: `--limit` |
| `/lightsprint:subtasks <id>` | List subtasks (child tasks) of a parent task. Options: `--status` |
| `/lightsprint:current-task` | Get the task linked to the current Claude Code session |

#### Task Lifecycle

| Command | Description |
|---|---|
| `/lightsprint:archive <id>` | Archive a task (soft delete — preserves history). Use `--unarchive` to restore. |
| `/lightsprint:duplicate <id>` | Duplicate/clone a task. Options: `--title`, `--status`, `--project` |

#### PR & Review

| Command | Description |
|---|---|
| `/lightsprint:link-pr <id>` | Link a GitHub PR to a task |
| `/lightsprint:unlink-pr <id>` | Remove a linked PR from a task |
| `/lightsprint:merge <id>` | Merge the GitHub PR linked to a task |
| `/lightsprint:review-hub signals <id>` | Get PR signals (CI checks, reviews, comments) |
| `/lightsprint:review-hub scores <id>` | Get AI readiness analysis for the PR |

#### Cloud Agents

| Command | Description |
|---|---|
| `/lightsprint:agent launch` | Launch a cloud agent (anthropic, cursor, codex) for a task |
| `/lightsprint:agent stop` | Stop the active cloud agent for a task |
| `/lightsprint:agent settings` | Show cloud agent provider configuration |
| `/lightsprint:agent create-pr` | Create a GitHub PR from a cloud agent's working branch |

### Claiming tasks

When you use `/lightsprint:claim`, the plugin:
1. Sets the Lightsprint task to `in_progress`
2. Creates a Claude Code task linked via `metadata: { lightsprint_task_id: "<LS task ID>" }`
3. Subsequent `TaskUpdate` calls on the Claude Code task automatically sync to the correct Lightsprint task

### Label management

To add or remove labels from a task:

```bash
# Find available label IDs
lightsprint labels

# Add a label
lightsprint update LIG-024 --add-label lbl-abc123

# Remove a label
lightsprint update LIG-024 --remove-label lbl-abc123
```

### Archive vs Delete

| | Archive | Delete |
|---|---------|--------|
| Removed from active board | ✓ | ✓ |
| Preserved in history | ✓ | ✗ |
| Recoverable | ✓ (`--unarchive`) | ✗ |

Prefer `archive` for obsolete tasks. Use `delete` only for mistakes.

---

## Gap Analysis vs Linear MCP

This plugin provides feature parity with the core capabilities of the [Linear MCP server](https://linear.app/docs/mcp):

| Linear MCP Feature | Lightsprint Equivalent |
|---|---|
| `list_issues` with filtering | `lightsprint tasks` |
| `get_issue` | `lightsprint get` |
| `search_issues` | `lightsprint search` ✨ |
| `create_issue` | `lightsprint create` |
| `update_issue` | `lightsprint update` |
| `create_comment` | `lightsprint comment` |
| `get_comments` | `lightsprint comments` ✨ |
| `get_users` / member listing | `lightsprint members` ✨ |
| `get_labels` | `lightsprint labels` ✨ |
| `add_issue_label` / `remove_issue_label` | `lightsprint update --add-label / --remove-label` ✨ |
| `get_projects` | `lightsprint projects` |
| `archive_issue` | `lightsprint archive` ✨ |
| `duplicate_issue` | `lightsprint duplicate` ✨ |
| Sub-issue listing | `lightsprint subtasks` ✨ |
| `assign_issue` | `lightsprint update --assignee` |
| PR linking | `lightsprint link-pr / merge` |

✨ = Added in this release for Linear MCP feature parity

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
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── config.js           # Per-folder token resolution + on-demand auth trigger
│       ├── schema.js           # Command schemas for `lightsprint describe`
│       ├── validate.js         # Input validation helpers
│       ├── task-map.js         # CC↔LS task ID mapping
│       └── status-mapper.js    # Status mapping logic
├── skills/
│   ├── tasks/SKILL.md          # /lightsprint:tasks
│   ├── search/SKILL.md         # /lightsprint:search ✨
│   ├── get/SKILL.md            # /lightsprint:get
│   ├── create/SKILL.md         # /lightsprint:create
│   ├── update/SKILL.md         # /lightsprint:update (extended with labels)
│   ├── claim/SKILL.md          # /lightsprint:claim
│   ├── comment/SKILL.md        # /lightsprint:comment (add)
│   ├── comments/SKILL.md       # /lightsprint:comments (list) ✨
│   ├── members/SKILL.md        # /lightsprint:members ✨
│   ├── labels/SKILL.md         # /lightsprint:labels ✨
│   ├── subtasks/SKILL.md       # /lightsprint:subtasks ✨
│   ├── archive/SKILL.md        # /lightsprint:archive ✨
│   ├── duplicate/SKILL.md      # /lightsprint:duplicate ✨
│   ├── projects/SKILL.md       # /lightsprint:projects
│   ├── delete/SKILL.md         # /lightsprint:delete
│   └── ...                     # PR review, agent, merge, plan skills
├── install.sh                  # One-line plugin installer
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
