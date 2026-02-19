# Lightsprint Claude Code Plugin

Sync Claude Code tasks to your Lightsprint kanban board for team visibility. When agents create or update tasks, they automatically appear on your project board. Team members can see agent progress in real time without changing how they use Claude Code.

## Prerequisites

- **Claude Code** CLI installed
- **Node.js >= 18** (for built-in `fetch`)
- A **Lightsprint project** at [lightsprint.ai](https://lightsprint.ai)

## Quick Start

Install the plugin (one time):

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/install.sh | bash
```

Then use any `/lightsprint:` command — the plugin opens your browser to connect on first use:

```
/lightsprint:kanban
```

That's it. Each new project folder auto-prompts for authorization when you first use a command there.

---

## Installation

### One-line install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/install.sh | bash
```

### From GitHub (manual)

```bash
claude plugin marketplace add SprintsAI/lightsprint-claude-code-plugin
claude plugin install lightsprint
```

### From a local directory (development)

```bash
claude plugin install ./lightsprint-claude-code-plugin
```

Or test without installing:

```bash
claude --plugin-dir ./lightsprint-claude-code-plugin
```

---

## Authentication

Authentication is **on-demand** — the first time you use a `/lightsprint:` command in an unconnected folder, the plugin opens your browser to authorize. You pick a Lightsprint project, and tokens are saved locally. Tokens refresh automatically.

### Token resolution

The plugin resolves tokens by:

1. Walking up from the current directory (covers monorepos and subdirectories)
2. Falling back to the git main worktree (covers `git worktree` checkouts)
3. If no token found, opening the browser to authorize

A single authorization at your repo root works for all subdirectories and worktrees. Hooks silently skip if no authorization exists (they never prompt).

### Multiple projects

Each folder can connect to a different Lightsprint project. The plugin prompts automatically when you use a command in a new folder.

### Optional: Custom base URL

For self-hosted Lightsprint instances:

```bash
export LIGHTSPRINT_BASE_URL=https://your-instance.example.com
```

Defaults to `https://lightsprint.ai`.

---

## How It Works

### Transparent sync (hooks)

The plugin registers `PostToolUse` hooks on `TaskCreate`, `TaskUpdate`, and `Task` (subagent). When an agent uses these tools, the hook fires automatically and syncs to Lightsprint:

| Agent action | What happens on Lightsprint |
|---|---|
| `TaskCreate({subject: "Fix bug"})` | New task appears in **Todo** column |
| `TaskUpdate({status: "in_progress"})` | Card moves to **In Progress** |
| `TaskUpdate({status: "completed"})` | Card moves to **Done** |
| `TaskUpdate({status: "deleted"})` | Task is deleted from the board |
| `Task` (subagent spawned) | Comment posted on the active task |

**Status mapping:**

| Claude Code | Lightsprint |
|---|---|
| `pending` | `todo` |
| `in_progress` | `in_progress` |
| `completed` | `done` |

Additional fields synced: `title`, `description`, `assignee`, `complexity`, `todoList`, `relatedFiles`.

Hooks run asynchronously and never block the agent. Failures are logged to `~/.lightsprint/sync.log`.

### Skills (slash commands)

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List tasks from the board. Options: `--status todo\|in_progress\|in_review\|done`, `--limit N` |
| `/lightsprint:create <title>` | Create a new task. Options: `--description <text>`, `--complexity trivial\|low\|medium\|high\|critical`, `--status todo\|in_progress\|in_review\|done` |
| `/lightsprint:update <id>` | Update a task. Options: `--title <text>`, `--description <text>`, `--status <status>`, `--complexity <level>`, `--assignee <name>` |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, complexity |
| `/lightsprint:claim <id>` | Claim a task — sets it to in_progress and shows full details |
| `/lightsprint:kanban` | View the full kanban board with all columns |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |

### Task ID mapping

The plugin maintains a local mapping between Claude Code task IDs and Lightsprint task IDs in `~/.lightsprint/task-map.json`. This allows `TaskUpdate` hooks to find the corresponding Lightsprint task.

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
│   └── hooks.json              # PostToolUse hooks for TaskCreate/TaskUpdate/Task
├── scripts/
│   ├── sync-task.js            # Hook handler — reads stdin, syncs to LS API
│   ├── ls-cli.js               # CLI for skills — tasks, create, update, get, claim, kanban, comment
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
│   ├── kanban/SKILL.md         # /lightsprint:kanban
│   └── comment/SKILL.md        # /lightsprint:comment
├── install.sh                  # One-line plugin installer
├── uninstall.sh                # Clean removal
├── package.json
└── README.md
```

Zero npm dependencies — uses Node.js built-in `fetch`, `crypto`, and `fs`.

### Local files

| File | Purpose |
|---|---|
| `~/.lightsprint/projects.json` | Per-folder OAuth tokens (access + refresh + expiry + project ID) |
| `~/.lightsprint/task-map.json` | Claude Code ↔ Lightsprint task ID mapping |
| `~/.lightsprint/active-task.json` | Currently in-progress task (for subagent comments) |
| `~/.lightsprint/sync.log` | Hook execution log |

---

## Uninstalling

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/uninstall.sh | bash
```

This removes the plugin from Claude Code and deletes the authorization for the current folder. Other folders' authorizations in `~/.lightsprint/projects.json` are preserved.

---

## Troubleshooting

### Tasks not appearing on the board

1. Check the sync log: `cat ~/.lightsprint/sync.log`
2. Verify authorization: `node scripts/ls-cli.js whoami`
3. Ensure Node.js >= 18: `node --version`

### Token expired / refresh failed

Use any `/lightsprint:` command — the plugin will re-prompt for authorization if the refresh token has expired.

### Stale task mappings

Task mappings in `~/.lightsprint/task-map.json` are session-scoped. If mappings become stale, delete the file:

```bash
rm ~/.lightsprint/task-map.json
```

### Hook not firing

Verify the plugin is loaded:

```bash
claude --debug
```

Check that `hooks/hooks.json` is being picked up and `PostToolUse` matchers are registered.
