---
name: create
description: Create a new task on the Lightsprint project board. Use to add work items directly from Claude Code.
---

Run this command to create a new Lightsprint task:

```bash
lightsprint create $ARGUMENTS
```

Usage: `create <title> [--description <text>] [--complexity low|medium|high] [--status backlog|todo|in_progress|in_review|done] [--depends-on <taskId1,taskId2,...>]`

## Flags

| Flag | Required | Description |
|------|----------|-------------|
| `<title>` | Yes | Task title (positional, all non-flag tokens are joined). Max 500 chars. |
| `--description <text>` | No | Task description. Supports multiline text. Max 50000 chars. |
| `--complexity <level>` | No | Complexity estimate: `low`, `medium`, or `high`. |
| `--status <status>` | No | Initial status: `backlog`, `todo` (default), `in_progress`, `in_review`, or `done`. |
| `--depends-on <ids>` | No | Comma-separated list of task IDs this task depends on. Supports raw IDs or display IDs (e.g. `LIG-024`). |
| `--json-body <json>` | No | Raw JSON request body (replaces individual flags). Cannot combine with positional title or other field flags. |
| `--dry-run` | No | Validate inputs without calling the API. |
| `--output json` | No | Return structured JSON instead of human-readable text. |

## Output

Returns the created task's title, ID, status, complexity, and description. Also prints the `metadata` snippet needed to link this task to a Claude Code task.

After creating, the task ID is returned. You can link it to a Claude Code task with:
- Use TaskCreate with `metadata: { lightsprint_task_id: "<the LS task ID>" }`
- This links the CC task to the LS task so future updates sync automatically
