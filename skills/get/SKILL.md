---
name: get
description: Get full details of a Lightsprint (ls) task by ID. Shows title, status, description, todo list, related files, dependencies, and complexity.
---

Run this command to get a Lightsprint task's details:

```bash
lightsprint get $ARGUMENTS
```

Usage: `get <taskId> [--fields <field1,field2,...>]`

Task ID can be a display ID (e.g. `LIG-024`), bare task number (e.g. `24`), or raw ID. All formats are resolved server-side.

The `--fields` flag accepts a comma-separated list of field names to return only specific fields (implies `--output json`). Available fields: `task`, `dependencies`, `dependents`. Within `task`: `id`, `title`, `status`, `assignee`, `complexity`, `description`, `todoList`, `relatedFiles`, `creator`. The `lightsprint tasks` command also supports `--fields`.

## Output fields

| Field | Always shown | Description |
|-------|-------------|-------------|
| Title | Yes | Task title |
| ID | Yes | Raw task ID |
| Status | Yes | Current status (`backlog`, `todo`, `in_progress`, `in_review`, `done`) |
| Assignee | If assigned | Assigned team member |
| Complexity | If set | `low`, `medium`, or `high` |
| Description | If set | Full task description (no truncation) |
| Todo list | If non-empty | Implementation steps with `[x]`/`[ ]` completion status |
| Related files | If non-empty | File paths referenced by the task |
| Depends on | If non-empty | Tasks this task depends on (shown as `#<number> <title> [<status>]`) |
| Blocks | If non-empty | Tasks that depend on this task (shown as `#<number> <title> [<status>]`) |

## Examples

```bash
lightsprint get LIG-003
lightsprint get 3
lightsprint get abc123def
lightsprint get LIG-003 --fields task,dependencies
```

## Invariants

- This is a read-only command — it does not modify any tasks
- Always use `lightsprint get <taskId>` before `lightsprint update` to confirm current state
- Task ID can be a display ID (e.g. `LIG-003`), bare number (e.g. `3`), or raw ID — all formats are resolved server-side
