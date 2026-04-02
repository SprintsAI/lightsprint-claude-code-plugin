# Lightsprint Plugin

Lightsprint plugin for **Claude Code** and **[pi](https://github.com/nicobailon/pi-mono)** — plan review, task management, and repo board integration.

## Prerequisites

- **Claude Code** CLI or **pi** coding agent installed
- **Node.js >= 18** (for built-in `fetch`)
- A **Lightsprint repo** at [lightsprint.ai](https://lightsprint.ai)

## Quick Start

### Claude Code

Install the plugin (one time):

```bash
npx lightsprint
```

Then use any `/lightsprint:` command — the plugin opens your browser to connect on first use:

```
/lightsprint:tasks
```

### pi

Install the CLI, then add the pi extension:

```bash
npx lightsprint
cp -r pi-extension ~/.pi/agent/extensions/lightsprint
```

The extension registers native tools (e.g. `lightsprint_tasks`, `lightsprint_claim`) that the LLM calls directly — no slash commands needed.

That's it. Each new repo folder auto-prompts for authorization when you first use a command there.

---

## Installation

### Claude Code

#### npx (recommended)

```bash
npx lightsprint
```

#### Curl fallback

If you don't have npm/npx available, you can install via curl:

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/install.sh | bash
```

#### Non-interactive install

If you're installing from a non-interactive environment (e.g., Claude Code, CI, or a script):

```bash
npx -y lightsprint
```

Or with curl:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/install.sh)" <<< $'Y\nY'
```

The plugin will be installed but the repo connection step will be skipped. You can connect later by running `/lightsprint:tasks` inside a git repository.

### pi

The pi extension lives in the `pi-extension/` directory and wraps the same `lightsprint` CLI.

#### Step 1: Install the CLI

```bash
npx lightsprint
```

This installs the `lightsprint` binary and connects your first repo.

#### Step 2: Install the extension

**Global** (all projects):

```bash
cp -r pi-extension ~/.pi/agent/extensions/lightsprint
```

**Project-local** (single project):

```bash
cp -r pi-extension .pi/extensions/lightsprint
```

**Quick test** (single session, no copy):

```bash
pi -e ./pi-extension/index.ts
```

#### Step 3: Connect your repo

If you didn't connect during Step 1, run:

```bash
lightsprint connect
```

This opens your browser to authorize and link the current directory to a Lightsprint repo.

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

### Claude Code: Skills (slash commands)

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List tasks from the board. Options: `--status backlog\|todo\|in_progress\|in_review\|done`, `--limit N` |
| `/lightsprint:create <title>` | Create a new task. Options: `--description <text>`, `--complexity trivial\|low\|medium\|high\|critical`, `--status backlog\|todo\|in_progress\|in_review\|done` |
| `/lightsprint:update <id>` | Update a task. Options: `--title <text>`, `--description <text>`, `--status <status>`, `--complexity <level>`, `--assignee <name>` |
| `/lightsprint:get <id>` | Get full details of a task — title, status, description, todo list, related files, complexity |
| `/lightsprint:claim <id>` | Claim a task — sets it to in_progress and shows full details |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |

### pi: Tools & Commands

**Tools** (called by the LLM):

| Tool | Description |
|------|-------------|
| `lightsprint_tasks` | List tasks with filtering (status, assignee, complexity, deps) |
| `lightsprint_get` | Get full task details by ID |
| `lightsprint_create` | Create a new task |
| `lightsprint_update` | Update task fields or dependencies |
| `lightsprint_claim` | Claim a task (assign + set in_progress) |
| `lightsprint_comment` | Add a comment to a task |
| `lightsprint_current_task` | Get task linked to current session |
| `lightsprint_link_pr` | Link a GitHub PR to a task |
| `lightsprint_unlink_pr` | Remove a linked PR from a task |
| `lightsprint_whoami` | Show current user and repo info |
| `lightsprint_config` | Manage user preferences |

**Commands**:

| Command | Description |
|---------|-------------|
| `/lightsprint-status` | Show connection status |
| `/lightsprint-connect` | Authenticate with Lightsprint |
| `/lightsprint-open` | Open repo board in browser |
| `/lightsprint-upgrade` | Upgrade CLI to latest version |

**Keyboard shortcuts**: `Ctrl+Shift+L` opens the Lightsprint board in your browser.

The pi extension also auto-detects `gh pr create` output and prompts the LLM to link the PR to a task.

### Claiming tasks

When you claim a task (via `/lightsprint:claim` in Claude Code or `lightsprint_claim` in pi):
1. Sets the Lightsprint task to `in_progress`
2. Creates a linked session task via `metadata: { lightsprint_task_id: "<LS task ID>" }`
3. Subsequent task updates automatically sync to the correct Lightsprint task

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
│   └── comment/SKILL.md        # /lightsprint:comment
├── pi-extension/
│   ├── index.ts                # Pi extension entry point
│   └── README.md               # Pi-specific docs
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
