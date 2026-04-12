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
| `/lightsprint:tasks` | List tasks from the board. Options: `--status`, `--assignee`, `--project`, `--sort`, `--limit N`, `--page-all` |
| `/lightsprint:search <query>` | Full-text search across tasks. Options: `--status`, `--project`, `--assignee`, `--limit N` |
| `/lightsprint:create <title>` | Create a new task. Options: `--description`, `--complexity`, `--status`, `--project`, `--depends-on`, `--parent` |
| `/lightsprint:update <id>` | Update a task. Options: `--title`, `--description`, `--status`, `--complexity`, `--assignee`, `--add-dep`, `--remove-dep`, `--project` |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, dependencies, labels, relations |
| `/lightsprint:claim <id>` | Claim a task — sets it to in_progress and links to current CC session |
| `/lightsprint:delete <id>` | Delete a task permanently |

#### Comments

| Command | Description |
|---|---|
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:list-comments <id>` | List all comments on a task (alias: `comments`) |

#### Labels

| Command | Description |
|---|---|
| `/lightsprint:labels` | List all labels in the workspace (alias: `tags`) |
| `/lightsprint:create-label --name <name>` | Create a new label. Options: `--color <hex>`, `--description` |
| `/lightsprint:update-label <id>` | Update a label's name, color, or description |
| `/lightsprint:delete-label <id>` | Delete a label permanently |
| `/lightsprint:add-label <taskId> <labelId>` | Add a label to a task |
| `/lightsprint:remove-label <taskId> <labelId>` | Remove a label from a task |

#### Task Relations

| Command | Description |
|---|---|
| `/lightsprint:relate <taskId> --type <type> --target <taskId>` | Create a relation between tasks (types: `blocking`, `related`, `duplicate`) |
| `/lightsprint:unrelate <taskId> --relation-id <id>` | Remove a relation between tasks |
| `/lightsprint:relations <taskId>` | List all relations for a task |

#### Projects

| Command | Description |
|---|---|
| `/lightsprint:projects` | List all projects in the workspace |
| `/lightsprint:create-project --name <name>` | Create a new project. Options: `--description`, `--color` |
| `/lightsprint:update-project <id>` | Update a project's name, description, status, or color |

#### Team

| Command | Description |
|---|---|
| `/lightsprint:members` | List workspace members with name, email, and role (alias: `team`) |

#### PR & Review

| Command | Description |
|---|---|
| `/lightsprint:link-pr <taskId> --pr-url <url>` | Link a GitHub PR to a task |
| `/lightsprint:unlink-pr <taskId>` | Remove a linked PR from a task |
| `/lightsprint:merge <taskId>` | Merge the GitHub PR linked to a task |
| `/lightsprint:review-hub signals <id>` | Get PR signals (CI checks, reviews, comments) |
| `/lightsprint:review-hub scores <id>` | Get AI readiness analysis for the linked PR |

#### Cloud Agents

| Command | Description |
|---|---|
| `/lightsprint:agent launch --task <id> --provider <provider>` | Launch a cloud agent (providers: anthropic, cursor, codex) |
| `/lightsprint:agent stop --task <id> --provider <provider>` | Stop the active agent |
| `/lightsprint:agent settings` | Check which providers are configured |
| `/lightsprint:agent create-pr --task <id> --provider <provider> --agent-id <id>` | Create a PR from an agent's working branch |

#### Utility

| Command | Description |
|---|---|
| `/lightsprint:current-task` | Get the Lightsprint task linked to the current CC session |
| `/lightsprint:create-plan --content <markdown>` | Upload an implementation plan for team review |
| `/lightsprint:whoami` | Show current repo and auth info |
| `/lightsprint:describe <command>` | Show accepted parameters and valid values as JSON |
| `/lightsprint:open` | Open repo board in browser |

### Feature Parity with Linear MCP

The Lightsprint plugin provides equivalent functionality to the Linear MCP integration:

| Linear MCP Capability | Lightsprint Equivalent |
|---|---|
| `linear_search_issues` | `lightsprint search <query>` |
| `linear_create_issue` | `lightsprint create` |
| `linear_update_issue` | `lightsprint update` |
| `linear_get_issue` | `lightsprint get` |
| `linear_get_team_issues` | `lightsprint tasks` |
| `linear_create_comment` | `lightsprint comment` |
| `linear_get_issue_comments` | `lightsprint list-comments` |
| `linear_get_labels` | `lightsprint labels` |
| `linear_create_label` | `lightsprint create-label` |
| `linear_update_label` | `lightsprint update-label` |
| `linear_get_viewer` | `lightsprint whoami` |
| `linear_get_teams` / members | `lightsprint members` |
| `linear_get_projects` | `lightsprint projects` |
| `linear_create_relation` | `lightsprint relate` |
| `linear_get_issue_relations` | `lightsprint relations` |

### Claiming tasks

When you use `/lightsprint:claim`, the plugin:
1. Sets the Lightsprint task to `in_progress`
2. Creates a Claude Code task linked via `metadata: { lightsprint_task_id: "<LS task ID>" }`
3. Subsequent `TaskUpdate` calls on the Claude Code task automatically sync to the correct Lightsprint task

---

## Global Flags

All commands support these flags:

| Flag | Description |
|---|---|
| `--output json` | Machine-readable JSON output (default when stdout is not a TTY) |
| `--json` | Shorthand for `--output json` |
| `--dry-run` | Validate inputs without making API calls |
| `--fields f1,f2` | Return only specified fields (implies `--output json`) |
| `--help`, `-h` | Show command-specific help |

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
│       ├── options.js          # Global flag parser (--output, --dry-run, --fields)
│       ├── output.js           # Structured output helpers (JSON + text)
│       ├── schema.js           # Command schema definitions for `describe`
│       ├── validate.js         # Input validation (IDs, enums, lengths)
│       ├── task-map.js         # CC↔LS task ID mapping
│       └── status-mapper.js    # Status mapping logic
├── skills/
│   ├── tasks/SKILL.md          # /lightsprint:tasks
│   ├── search/SKILL.md         # /lightsprint:search
│   ├── create/SKILL.md         # /lightsprint:create
│   ├── update/SKILL.md         # /lightsprint:update
│   ├── get/SKILL.md            # /lightsprint:get
│   ├── claim/SKILL.md          # /lightsprint:claim
│   ├── delete/SKILL.md         # /lightsprint:delete
│   ├── comment/SKILL.md        # /lightsprint:comment
│   ├── list-comments/SKILL.md  # /lightsprint:list-comments
│   ├── labels/SKILL.md         # /lightsprint:labels
│   ├── create-label/SKILL.md   # /lightsprint:create-label
│   ├── update-label/SKILL.md   # /lightsprint:update-label
│   ├── delete-label/SKILL.md   # /lightsprint:delete-label
│   ├── add-label/SKILL.md      # /lightsprint:add-label
│   ├── remove-label/SKILL.md   # /lightsprint:remove-label
│   ├── members/SKILL.md        # /lightsprint:members
│   ├── relate/SKILL.md         # /lightsprint:relate
│   ├── relations/SKILL.md      # /lightsprint:relations
│   ├── projects/SKILL.md       # /lightsprint:projects
│   ├── create-project/SKILL.md # /lightsprint:create-project
│   ├── update-project/SKILL.md # /lightsprint:update-project
│   ├── link-pr/SKILL.md        # /lightsprint:link-pr
│   ├── unlink-pr/SKILL.md      # /lightsprint:unlink-pr
│   ├── merge/SKILL.md          # /lightsprint:merge
│   ├── review-hub-signals/SKILL.md  # /lightsprint:review-hub signals
│   ├── review-hub-scores/SKILL.md   # /lightsprint:review-hub scores
│   └── ...
├── install.sh                  # One-line plugin installer
├── package.json
└── README.md
```

Zero npm dependencies — uses Node.js built-in `fetch`, `crypto`, and `fs`.

### Local files

| File | Purpose |
|---|---|
| `~/.lightsprint/repos.json` | Per-folder OAuth tokens (access + refresh + expiry + repo ID) |
| `~/.lightsprint/cc-sessions/` | Active Claude Code session data |

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

Check that `hooks/hooks.json` is being picked up and `PermissionRequest` matchers are registered.
