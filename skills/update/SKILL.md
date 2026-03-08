---
name: update
description: Update an existing Lightsprint task. Change its title, description, status, complexity, assignee, or dependencies.
---

Run this command to update a Lightsprint task:

```bash
lightsprint update $ARGUMENTS
```

Usage: `update <taskId> [--title <text>] [--description <text>] [--status backlog|todo|in_progress|in_review|done] [--complexity low|medium|high] [--assignee <name>] [--add-dep <taskId>] [--remove-dep <taskId>]`

## Flags

| Flag | Required | Description |
|------|----------|-------------|
| `<taskId>` | Yes | Task ID (positional, first arg). Supports raw IDs or display IDs (e.g. `LIG-024`). |
| `--title <text>` | No | New task title. Max 500 chars. |
| `--description <text>` | No | New task description. Supports multiline. Max 50000 chars. |
| `--status <status>` | No | New status: `backlog`, `todo`, `in_progress`, `in_review`, or `done`. |
| `--complexity <level>` | No | Complexity: `low`, `medium`, or `high`. |
| `--assignee <name>` | No | Assign to a team member by name. |
| `--add-dep <taskId>` | No | Add a dependency (this task depends on the given task). Repeatable for multiple deps. Supports display IDs. |
| `--remove-dep <taskId>` | No | Remove a dependency. Repeatable for multiple deps. Supports display IDs. |
| `--json-body <json>` | No | Raw JSON request body (replaces individual field flags). Cannot combine with --title/--description/etc. |
| `--dry-run` | No | Validate inputs without calling the API. |
| `--output json` | No | Return structured JSON instead of human-readable text. |

At least one flag is required. Only the provided fields will be updated. Field updates and dependency changes are applied independently — a dependency failure won't prevent field updates.

## Invariants

- Always run `lightsprint get <taskId>` before updating to confirm current state
- Prefer `lightsprint claim <taskId>` over `lightsprint update <taskId> --status in_progress` — claim also assigns the task and links the CC session
- Title: max 500 chars. Description: max 50,000 chars
