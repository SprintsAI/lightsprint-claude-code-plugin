---
name: update
description: Update an existing Lightsprint (ls) task. Change its title, description, status, complexity, assignee, position, or dependencies.
---

Run this command to update a Lightsprint task:

```bash
lightsprint update $ARGUMENTS
```

Usage: `update --task <taskId> [--title <text>] [--description <text>] [--status backlog|todo|in_progress|in_review|done] [--complexity low|medium|high] [--assignee <name>] [--position <num>] [--section-id <id>] [--layout-type kanban|list] [--add-dep <taskId>] [--remove-dep <taskId>]`

## Flags

| Flag | Required | Description |
|------|----------|-------------|
| `--task <taskId>` | Yes | Task ID. Supports display IDs (e.g. `LIG-024`), bare task numbers (e.g. `24`), or raw IDs. All formats are resolved server-side. |
| `--title <text>` | No | New task title. Max 500 chars. |
| `--description <text>` | No | New task description. Supports multiline. Max 50000 chars. |
| `--status <status>` | No | New status: `backlog`, `todo`, `in_progress`, `in_review`, or `done`. |
| `--complexity <level>` | No | Complexity: `low`, `medium`, or `high`. |
| `--assignee <name>` | No | Assign to a team member by name. |
| `--position <num>` | No | New position within section (0-based). Position 0 = top of section. |
| `--section-id <id>` | No | Section to move task to. Can be combined with `--position`. |
| `--layout-type <type>` | No | Layout type for position update: `kanban` or `list`. Defaults to `kanban`. |
| `--add-dep <taskId>` | No | Add a dependency (this task depends on the given task). Repeatable for multiple deps. Supports display IDs, bare task numbers, or raw IDs. |
| `--remove-dep <taskId>` | No | Remove a dependency. Repeatable for multiple deps. Supports display IDs, bare task numbers, or raw IDs. |
| `--json-body <json>` | No | Raw JSON request body (replaces individual field flags). Cannot combine with --title/--description/etc. |
| `--dry-run` | No | Validate inputs without calling the API. |
| `--output json` | No | Return structured JSON instead of human-readable text. |

At least one flag is required. Only the provided fields will be updated. Field updates and dependency changes are applied independently — a dependency failure won't prevent field updates.

## Invariants

- Always run `lightsprint get --task <taskId>` before updating to confirm current state
- Prefer `lightsprint claim --task <taskId>` over `lightsprint update --task <taskId> --status in_progress` — claim also assigns the task and links the CC session
- Title: max 500 chars. Description: max 50,000 chars
