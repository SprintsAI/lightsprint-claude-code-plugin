# Lightsprint Claude Code Plugin

Claude Code plugin for Lightsprint — task management skills and workspace board integration.

## Prerequisites

- **Claude Code** CLI installed
- **Node.js >= 18** (for built-in `fetch`)
- A **Lightsprint workspace** at [lightsprint.ai](https://lightsprint.ai)

## Quick Start

Install the plugin (one time):

```bash
npx lightsprint
```

Then use any `/lightsprint:` command — the plugin opens your browser to connect on first use:

```
/lightsprint:tasks
```

That's it. The first command auto-prompts for authorization and connects you to a Lightsprint workspace.

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

The plugin will be installed but the workspace connection step will be skipped. You can connect later by running `/lightsprint:tasks`, which prompts you to authorize and pick a workspace.

---

## Authentication

Authentication is **on-demand** — the first time you use a `/lightsprint:` command without an active connection, the plugin opens your browser to authorize. You pick a Lightsprint workspace, and tokens are saved locally. Tokens refresh automatically.

The active workspace is stored in a single connection file (`~/.lightsprint/connection.json`). All commands (`tasks`, `projects`, `stacks`, `create`, etc.) operate against that connected workspace. Hooks silently skip if no connection exists (they never prompt).

### Switching workspaces

Run `lightsprint connect` again to authorize and switch to a different workspace, or `lightsprint disconnect` to clear the active connection. Use `lightsprint status` / `lightsprint whoami` to see which workspace is currently connected.

### Optional: Custom base URL

For self-hosted Lightsprint instances:

```bash
export LIGHTSPRINT_BASE_URL=https://your-instance.example.com
```

Defaults to `https://app.lightsprint.ai`.

---

## How It Works

### Skills (slash commands)

All skills operate on the connected workspace.

**Tasks**

| Command | Description |
|---|---|
| `/lightsprint:tasks` | List tasks from the workspace board. Options: `--status backlog\|todo\|in_progress\|in_review\|done`, `--stack <ref>`, `--limit N` |
| `/lightsprint:create <title>` | Create a task in the workspace default stack. Options: `--description <text>`, `--complexity low\|medium\|high`, `--status <status>`, `--stack <ref>` |
| `/lightsprint:get <id>` | Full details of a task — title, status, description, todo list, related files, dependencies, complexity |
| `/lightsprint:update <id>` | Update a task's title, description, status, complexity, schema-change flag, assignee, position, or dependencies |
| `/lightsprint:claim <id>` | Claim a task — sets it to in_progress and shows full details |
| `/lightsprint:current-task` | The task linked to this Claude Code session, auto-discovered from the session PID (no ID needed) |
| `/lightsprint:comment <id> <text>` | Add a comment to a task |
| `/lightsprint:delete <id>` | Delete a task permanently |
| `/lightsprint:projects` | List projects in the workspace |

**Pull requests**

| Command | Description |
|---|---|
| `/lightsprint:link-pr` | Link a GitHub PR to a task |
| `/lightsprint:unlink-pr` | Remove a linked PR from a task |
| `/lightsprint:merge` | Merge the PR linked to a task — direct merge or GitHub merge queue |
| `/lightsprint:review-hub-signals` | CI checks, reviews, comments, and deployments on the task's PR |
| `/lightsprint:review-hub-scores` | AI readiness analysis — score, summaries, callouts, suggested actions |

**Cloud agents**

| Command | Description |
|---|---|
| `/lightsprint:agent` | Launch or stop a cloud agent on a task (anthropic, cursor, codex) |
| `/lightsprint:agent-settings` | Which providers are configured and their default models — check before launching |
| `/lightsprint:agent-create-pr` | Open a PR from a cloud agent's working branch |

Stacks group tasks within a workspace. List them with `lightsprint stacks`, inspect one with `lightsprint stacks get <stackId|prefix|name>`, and target a stack on `tasks`/`create` via `--stack <ref>`.

### CLI

The skills are thin wrappers over the `lightsprint` binary, which is also usable
directly. Beyond the commands above it offers `whoami`, `status`, `open`, `connect`,
`disconnect`, `upgrade`, and `config get|set|delete|list`.

The CLI is designed to be driven by agents, not typed by humans: pass `--output json`
for structured output, and `lightsprint describe <command>` to get a command's accepted
parameters, types, and valid enum values as JSON rather than relying on documentation
baked into a skill prompt.

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
│   └── hooks.json              # Session lifecycle + task sync hooks
├── scripts/
│   ├── lightsprint.js          # Unified CLI entry point (compiled to `lightsprint` binary)
│   ├── ls-cli.js               # Command implementations (exports cliMain)
│   ├── cc-daemon.js            # Background session daemon
│   ├── cc-start.js             # SessionStart hook
│   ├── cc-end.js               # SessionEnd hook
│   ├── cc-event.js             # Tool-activity forwarding hook
│   ├── cc-pr-created.js        # PostToolUse hook — detects `gh pr create`
│   ├── compile.sh              # Build script for the lightsprint binary
│   ├── deploy-tag.sh           # Release tagging
│   ├── dev-local.sh            # Point the CLI at a local Lightsprint server + build from source
│   ├── dev-restore.sh          # Restore the production config after dev-local.sh
│   ├── install.ps1             # Windows installer
│   ├── __tests__/              # bun test suites
│   └── lib/
│       ├── auth.js             # On-demand OAuth flow (browser → callback → save)
│       ├── browser.js          # Cross-platform browser launch
│       ├── cc-utils.js         # Claude Code session helpers
│       ├── client.js           # HTTP client with automatic token refresh
│       ├── config.js           # Config resolution + on-demand auth trigger
│       ├── connection.js       # Active workspace connection state
│       ├── filelock.js         # Cross-process file locking
│       ├── options.js          # Argument parsing
│       ├── output.js           # Human vs `--output json` rendering
│       ├── schema.js           # Command schema behind `lightsprint describe`
│       ├── sentry.js           # Error reporting
│       ├── status-mapper.js    # Status mapping logic
│       ├── task-map.js         # CC↔LS task ID mapping
│       └── validate.js         # Input hardening (IDs, enums, control characters)
├── skills/                     # One directory per /lightsprint: command (see the table above)
├── pi-extension/               # pi equivalent of this plugin (see pi-extension/README.md)
├── docs/                       # Local testing guide + design notes
├── npx-install.js              # `npx lightsprint` entry point (the published bin)
├── install.sh                  # One-line plugin installer
├── uninstall.sh                # Clean removal
├── package.json
└── README.md
```

One runtime dependency (`@sentry/node`, for error reporting); everything else uses
Node.js built-ins — `fetch`, `crypto`, and `fs`.

## Development

```bash
bun install
bun test              # scripts/__tests__
bun run build         # compile the lightsprint binary (scripts/compile.sh)
```

`scripts/dev-local.sh [port]` rewrites `baseUrl` in `~/.lightsprint/` to
`http://localhost:5173`, builds the binary from source, and installs it to
`~/.local/bin/lightsprint`, so you can develop against a local Lightsprint server.
`scripts/dev-restore.sh` restores the production config (it does not rebuild the binary —
run `bun run build` for that). See `docs/LOCAL_TESTING.md`.

### Local files

| Path | Purpose |
|---|---|
| `~/.lightsprint/connection.json` | Active workspace connection — OAuth tokens (access + refresh + expiry) and workspace ID/name |
| `~/.lightsprint/config.json` | CLI config, including `baseUrl` |
| `~/.lightsprint/preferences.json` | User preferences (`lightsprint config get\|set`) |
| `~/.lightsprint/task-map.json` | Claude Code ↔ Lightsprint task ID mapping |
| `~/.lightsprint/cc-sessions/` | Per-session state used by `current-task` and the hooks |
| `~/.lightsprint/daemon.log` | Session daemon log — `tail -f` it when debugging hooks |

---

## Uninstalling

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/uninstall.sh | bash
```

This removes the plugin from Claude Code and clears the active workspace connection in `~/.lightsprint/connection.json`.

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
