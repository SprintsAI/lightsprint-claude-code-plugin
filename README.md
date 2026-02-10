# Lightsprint Claude Code Plugin

Sync Claude Code tasks to your Lightsprint kanban board for team visibility. When agents create or update tasks, they automatically appear on your project board. Team members can see agent progress in real time without changing how they use Claude Code.

## Prerequisites

- **Claude Code** CLI installed
- **Node.js >= 18** (for built-in `fetch`)
- A **Lightsprint project** with a project API key

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/install.sh | bash
```

Then set your API key (get one from Lightsprint: **Project Settings > API Keys > Create**):

```bash
export LIGHTSPRINT_API_KEY=ls_pk_...
```

That's it — task sync is automatic from here.

---

## Installation

### From a local directory (development)

If you have the plugin source checked out locally:

```bash
claude plugin install ./lightsprint-claude-code-plugin
```

Or test without installing:

```bash
claude --plugin-dir ./lightsprint-claude-code-plugin
```

### From GitHub

```bash
claude plugin install SprintsAI/lightsprint-claude-code-plugin
```

### Installation scope

By default, plugins install to your **user** scope (all projects). You can choose a different scope:

```bash
# User scope (default) — available in all your projects
claude plugin install ./lightsprint-claude-code-plugin

# Project scope — shared with team via version control (.claude/settings.json)
claude plugin install ./lightsprint-claude-code-plugin --scope project

# Local scope — project-specific, gitignored (.claude/settings.local.json)
claude plugin install ./lightsprint-claude-code-plugin --scope local
```

---

## Configuration

### 1. Create a project API key

In your Lightsprint project, go to **Settings > API Keys > Create**. The key is shown once at creation — copy it immediately.

Key format: `ls_pk_<64 hex characters>`

Available scopes (all granted by default):
- `tasks:read` — List and view tasks
- `tasks:write` — Create, update, delete tasks
- `kanban:read` — View the kanban board
- `comments:write` — Add comments to tasks

### 2. Set the API key

Pick **one** of these methods (in priority order):

**Option A: Environment variable** (simplest)

```bash
export LIGHTSPRINT_API_KEY=ls_pk_...
```

**Option B: Claude Code project settings** (recommended for teams)

Add to `.claude/settings.local.json` in your project root (this file is gitignored):

```json
{
  "env": {
    "LIGHTSPRINT_API_KEY": "ls_pk_..."
  }
}
```

**Option C: macOS dialog prompt** (automatic fallback)

If no key is configured, the plugin will show a macOS dialog on first use asking for the key. The key is saved to `~/.lightsprint/config.json` so you're only prompted once.

### Optional: Custom base URL

If you self-host Lightsprint, set:

```bash
export LIGHTSPRINT_BASE_URL=https://your-instance.example.com
```

Defaults to `https://lightsprint.ai`.

---

## How It Works

### Transparent sync (hooks)

The plugin registers PostToolUse hooks on `TaskCreate` and `TaskUpdate`. When an agent uses these tools, the hook fires automatically and syncs the task to Lightsprint via the API:

| Agent action | What happens on Lightsprint |
|---|---|
| `TaskCreate({subject: "Fix bug"})` | New task appears in **Todo** column |
| `TaskUpdate({status: "in_progress"})` | Card moves to **In Progress** |
| `TaskUpdate({status: "completed"})` | Card moves to **Done** |
| `TaskUpdate({status: "deleted"})` | Task is deleted from the board |

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
| `/lightsprint:claim <id>` | Claim a task — sets it to in_progress and shows full details |
| `/lightsprint:kanban` | View the full kanban board with all columns |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |

### Task ID mapping

The plugin maintains a local mapping between Claude Code task IDs and Lightsprint task IDs in `~/.lightsprint/task-map.json`. This allows `TaskUpdate` hooks to find the corresponding Lightsprint task.

When claiming a task via `/lightsprint:claim`, the mapping is established by creating a Claude Code task with `metadata: { lightsprint_task_id: "<LS task ID>" }`.

---

## Plugin Structure

```
lightsprint-claude-code-plugin/
├── .claude-plugin/
│   └── plugin.json           # Plugin manifest
├── hooks/
│   └── hooks.json            # PostToolUse hooks for TaskCreate/TaskUpdate
├── scripts/
│   ├── sync-task.js          # Hook handler — reads stdin, syncs to LS API
│   ├── ls-cli.js             # CLI for skills — tasks, claim, kanban, comment
│   └── lib/
│       ├── config.js         # API key resolution (env → file → prompt)
│       ├── client.js         # HTTP client with Bearer auth
│       ├── task-map.js       # CC↔LS task ID mapping
│       └── status-mapper.js  # Status mapping logic
├── skills/
│   ├── tasks/SKILL.md        # /lightsprint:tasks
│   ├── claim/SKILL.md        # /lightsprint:claim
│   ├── kanban/SKILL.md       # /lightsprint:kanban
│   └── comment/SKILL.md      # /lightsprint:comment
├── package.json
└── README.md
```

Zero npm dependencies — uses Node.js built-in `fetch`, `crypto`, and `fs`.

---

## Packaging for Distribution

### As a GitHub repository

Push the plugin directory to a GitHub repo:

```bash
cd lightsprint-claude-code-plugin
git init
git add .
git commit -m "Initial plugin release"
git remote add origin https://github.com/SprintsAI/lightsprint-claude-code-plugin.git
git push -u origin main
```

Users install with:

```bash
claude plugin install SprintsAI/lightsprint-claude-code-plugin
```

### As an npm package

Add publish metadata to `package.json`:

```json
{
  "name": "lightsprint-claude-code-plugin",
  "version": "0.1.0",
  "description": "Sync Claude Code tasks to Lightsprint kanban board",
  "files": [
    ".claude-plugin/",
    "hooks/",
    "scripts/",
    "skills/",
    "README.md"
  ]
}
```

Publish:

```bash
npm publish
```

### As a local path (monorepo / development)

If the plugin lives inside your project repo (e.g., at `./lightsprint-claude-code-plugin/`), install from the local path:

```bash
claude plugin install ./lightsprint-claude-code-plugin --scope project
```

This copies the plugin into Claude Code's plugin cache. To iterate during development without reinstalling, use:

```bash
claude --plugin-dir ./lightsprint-claude-code-plugin
```

---

## Deploying the Backend (API Key Support)

The plugin requires the Lightsprint backend to have project API key support. If you're deploying a fresh instance:

1. **Run the migration** to create the `project_api_keys` table and `assignee` column:

   ```bash
   cd app
   bun run db:migrate
   ```

2. **Create a project API key** via the API (or future UI):

   ```bash
   curl -X POST https://your-instance/api/projects/<PROJECT_ID>/api-keys \
     -H "Cookie: <session cookie>" \
     -H "Content-Type: application/json" \
     -d '{"name": "Claude Code Plugin"}'
   ```

   The response includes the raw token (shown once):

   ```json
   {
     "id": "abc123",
     "name": "Claude Code Plugin",
     "token": "ls_pk_...",
     "tokenPrefix": "ls_pk_a1b2c3",
     "scopes": ["tasks:read", "tasks:write", "kanban:read", "comments:write"]
   }
   ```

3. **Verify the key works**:

   ```bash
   curl https://your-instance/api/project-key/info \
     -H "Authorization: Bearer ls_pk_..."
   ```

---

## Uninstalling

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/uninstall.sh | bash
```

This removes the plugin from Claude Code, removes the marketplace entry, and deletes all local data (`~/.lightsprint/`).

---

## Troubleshooting

### Tasks not appearing on the board

1. Check the sync log: `cat ~/.lightsprint/sync.log`
2. Verify the API key: `node scripts/ls-cli.js whoami`
3. Ensure Node.js >= 18: `node --version`

### "API key missing" errors

The plugin checks for the key in this order:
1. `LIGHTSPRINT_API_KEY` environment variable
2. `~/.lightsprint/config.json`
3. macOS dialog prompt (first run only)

### Stale task mappings

Task mappings in `~/.lightsprint/task-map.json` are session-scoped. If mappings become stale, you can safely delete the file:

```bash
rm ~/.lightsprint/task-map.json
```

### Hook not firing

Verify the plugin is loaded:

```bash
claude --debug
```

Check that `hooks/hooks.json` is being picked up and `PostToolUse` matchers are registered.
