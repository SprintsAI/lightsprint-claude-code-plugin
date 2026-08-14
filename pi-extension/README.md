# Lightsprint Pi Extension

A [pi](https://github.com/badlogic/pi-mono) extension that integrates [Lightsprint](https://lightsprint.ai) task management directly into your coding workflow.

This is the pi equivalent of the Lightsprint Claude Code plugin — same functionality, native pi integration.

## Installation

### Option 1: Global (all projects)

```bash
cp -r pi-extension ~/.pi/agent/extensions/lightsprint
```

### Option 2: Project-local

```bash
cp -r pi-extension .pi/extensions/lightsprint
```

### Option 3: Quick test

```bash
pi -e ./pi-extension/index.ts
```

## Prerequisites

The `lightsprint` CLI must be installed and on your PATH. Install it via:

```bash
npx lightsprint@latest upgrade
```

Then connect to a Lightsprint workspace:

```bash
lightsprint connect
```

## Tools

The extension registers these tools that the LLM can call:

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
| `lightsprint_whoami` | Show the current user and connected workspace |
| `lightsprint_config` | Manage user preferences |

## Commands

| Command | Description |
|---------|-------------|
| `/lightsprint-status` | Show connection status |
| `/lightsprint-connect` | Authenticate with Lightsprint |
| `/lightsprint-open` | Open the connected workspace's task board in your browser |
| `/lightsprint-upgrade` | Upgrade CLI to latest version |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+L` | Open the workspace task board in your browser |

## Features

- **Task Management**: Full CRUD operations on Lightsprint tasks via natural language
- **PR Auto-Detection**: Automatically detects `gh pr create` output and prompts to link PRs to tasks
- **Session Status**: Shows connection status in the pi footer
- **Activity Forwarding**: Forwards tool execution events to the Lightsprint daemon when running

## How It Works

The extension wraps the `lightsprint` CLI, calling it with `--output json` for all operations. This means:

- All authentication is handled by the CLI (stored in `~/.lightsprint/`)
- All API communication goes through the CLI
- The extension adds the pi-native UX layer (tools, commands, shortcuts, status bar)

## Comparison with Claude Code Plugin

| Feature | Claude Code Plugin | Pi Extension |
|---------|-------------------|--------------|
| Task management | Skills (`.md` instructions) | Custom tools (native) |
| Session hooks | `hooks.json` (SessionStart, etc.) | `pi.on()` events |
| PR detection | PostToolUse hook + script | `tool_result` event handler |
| Status display | N/A | Footer status bar |
| Commands | N/A | `/lightsprint-*` commands |
| Keyboard shortcuts | N/A | `Ctrl+Shift+L` |
