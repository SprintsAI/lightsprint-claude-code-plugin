---
name: duplicate
description: Duplicate/clone an existing Lightsprint (ls) task. Use to create a copy of a task, optionally overriding the title, status, or project.
---

Run this command to duplicate a Lightsprint task:

```bash
lightsprint duplicate $ARGUMENTS
```

Usage: `duplicate <taskId> [options]` or `duplicate --task <taskId> [options]`

Both positional and flag syntax work: `lightsprint duplicate LIG-024` is the same as `lightsprint duplicate --task LIG-024`.

Task ID can be a display ID (e.g. `LIG-024`), bare task number (e.g. `24`), or raw ID. All formats are resolved server-side.

## Flags

| Flag | Required | Description |
|------|----------|-------------|
| `--task <taskId>` | Yes | Task ID to duplicate (alternative to positional). |
| `--title <text>` | No | Override title for the new task. Defaults to the original title. Max 500 chars. |
| `--status <status>` | No | Override status for the new task: `backlog` (default), `todo`, `in_progress`, `in_review`, `done`. |
| `--project <projectId>` | No | Assign the duplicate to a project by ID. Defaults to the original task's project. |
| `--dry-run` | No | Validate inputs without making API calls. |
| `--output json` | No | Return structured JSON instead of human-readable text. |

## What gets copied

The duplicate inherits the original task's:
- Title (unless `--title` is provided)
- Description
- Complexity
- Project (unless `--project` is provided)
- Todo list

The duplicate starts fresh with:
- Status: `backlog` (unless `--status` is provided)
- No assignee
- No linked PR
- No dependencies

## Examples

```bash
# Simple duplicate
lightsprint duplicate LIG-024

# Duplicate with custom title
lightsprint duplicate LIG-024 --title "Copy of login fix"

# Duplicate with status override
lightsprint duplicate LIG-024 --status todo

# Duplicate into a different project
lightsprint duplicate LIG-024 --project proj-abc123

# Dry run (validate without creating)
lightsprint duplicate LIG-024 --dry-run
```

## Output

```json
{
  "success": true,
  "sourceTaskId": "...",
  "task": {
    "id": "...",
    "displayId": "LIG-025",
    "title": "Copy of login fix",
    "status": "backlog",
    "complexity": "medium",
    "project": { "id": "...", "name": "Backend" }
  }
}
```

## Invariants

- The source task must exist — use `lightsprint get <taskId>` to confirm before duplicating
- The new task starts with `backlog` status by default (clean slate for planning)
- Cannot combine `--json-body` with individual flags
- Use `lightsprint create` instead if you want to create a task from scratch
