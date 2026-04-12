---
name: subtasks
description: List subtasks (child tasks) of a Lightsprint (ls) parent task. Use to see all the work items that a parent task depends on.
---

Run this command to list subtasks of a parent task:

```bash
lightsprint subtasks $ARGUMENTS
```

Usage: `subtasks <taskId>` or `subtasks --task <taskId>`

Both positional and flag syntax work: `lightsprint subtasks LIG-024` is the same as `lightsprint subtasks --task LIG-024`.

Task ID can be a display ID (e.g. `LIG-024`), bare task number (e.g. `24`), or raw ID. All formats are resolved server-side.

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--task <taskId>` | required | Task ID (alternative to positional). |
| `--status <status>` | all | Filter subtasks by status (comma-separated): `backlog`, `todo`, `in_progress`, `in_review`, `done`. |
| `--output json` | text | Return structured JSON instead of human-readable text. |

## Output

Returns a list of subtasks with: displayId, id, title, status, assignee, and complexity.

```json
{
  "parentTaskId": "...",
  "subtasks": [
    {
      "displayId": "LIG-025",
      "id": "...",
      "title": "Implement login endpoint",
      "status": "in_progress",
      "assignee": "Alice Smith",
      "complexity": "medium"
    }
  ],
  "totalCount": 1
}
```

## Examples

```bash
lightsprint subtasks LIG-024
lightsprint subtasks LIG-024 --status todo,in_progress
lightsprint subtasks --task LIG-024 --output json
```

## Dependency Vocabulary

In Lightsprint, a **parent task** (root task) **depends on** its **subtasks** (child tasks). The subtasks are prerequisites that must be completed before the parent is done.

- **Parent task** = root task = the task you pass to `subtasks`
- **Subtasks** = child tasks = prerequisite tasks the parent depends on
- A task is **unblocked** when all its subtasks (dependencies) are `done`

## Invariants

- This is a read-only command — it does not modify any tasks
- Only root tasks have subtasks. If a task has no subtasks, the list will be empty.
- Use `lightsprint get <taskId>` to see dependencies in the full task view (includes both subtasks and blockers)
- Use `lightsprint tasks --deps has-dependencies` to find all parent tasks that have subtasks
- Subtasks cannot be claimed directly — claim their parent task instead
