# Lightsprint Claude Code Plugin

Sync Claude Code tasks to your Lightsprint kanban board for team visibility. When agents create or update tasks, they automatically appear on your project board. Team members can see agent progress in real time without changing how they use Claude Code.

## Prerequisites

- **Claude Code** CLI installed
- **Node.js >= 18** (for built-in `fetch`)
- A **Lightsprint project** at [lightsprint.ai](https://lightsprint.ai)

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/install.sh | bash
```

The installer opens your browser to authorize with Lightsprint, then installs the plugin automatically. That's it — task sync is active from here.

---

## Installation

### One-line install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/install.sh | bash
```

This will:
1. Open your browser to authorize with your Lightsprint project
2. Store OAuth tokens locally for the current folder
3. Install the plugin into Claude Code (hooks + skills)

### From GitHub (manual)

```bash
claude plugin marketplace add SprintsAI/lightsprint-claude-code-plugin
claude plugin install lightsprint
```

Then run `install.sh` separately to authorize:

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/install.sh | bash
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

The plugin uses **per-folder OAuth** — each project folder has its own authorization linked to a Lightsprint project.

### How it works

1. `install.sh` opens your browser to `lightsprint.ai/authorize-cli`
2. You select which Lightsprint project to connect
3. OAuth tokens are returned to a local callback server
4. Tokens are stored in `~/.lightsprint/projects.json`, keyed by folder path

```json
{
  "/path/to/your/project": {
    "accessToken": "...",
    "refreshToken": "...",
    "expiresAt": 1700000000000,
    "projectId": "abc123",
    "projectName": "My Project"
  }
}
```

### Token refresh

Tokens refresh automatically. Before each API call, the plugin checks expiry and refreshes if needed. If a refresh fails, re-run `install.sh` to re-authorize.

### Monorepo support

Token lookup walks up from the current working directory, so a single authorization at the repo root covers all subdirectories.

### Multiple projects

Run `install.sh` from different project folders to connect each one to a different Lightsprint project. Each folder's tokens are stored independently.

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
│       ├── config.js           # Per-folder OAuth token resolution
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
├── install.sh                  # One-line installer with OAuth flow
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

### "Lightsprint not connected for this folder"

Run `install.sh` from the project folder to authorize:

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/install.sh | bash
```

### Token expired / refresh failed

Re-run `install.sh` to re-authorize. The installer is idempotent and will overwrite the existing tokens for the current folder.

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
