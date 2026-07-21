---
name: update
description: Update an existing Lightsprint (ls) task. Change its title, description, status, complexity, schema-change flag, assignee, position, or dependencies.
---

Run this command to update a Lightsprint task:

```bash
lightsprint update $ARGUMENTS
```

Usage: `update <taskId> [options]` or `update --task <taskId> [options]`

Both positional and flag syntax work: `lightsprint update LIG-024 --status done` is the same as `lightsprint update --task LIG-024 --status done`.

## Flags

| Flag | Required | Description |
|------|----------|-------------|
| `--task <taskId>` | Yes | Task ID. Supports display IDs (e.g. `LIG-024`), bare task numbers (e.g. `24`), or raw IDs. All formats are resolved server-side. |
| `--title <text>` | No | New task title. Max 500 chars. |
| `--description <text>` | No | New task description. Supports multiline. Max 50000 chars. |
| `--status <status>` | No | New status: `backlog`, `todo`, `in_progress`, `in_review`, or `done`. |
| `--complexity <level>` | No | Complexity: `low`, `medium`, or `high`. |
| `--requires-schema-change <bool>` | No | `true` or `false` — whether the task involves a database schema change. Drives the schema-change badge/icon on the task card. |
| `--assignee <name>` | No | Assign to a team member by name. |
| `--project <projectId>` | No | Move task to a project by ID. Use `lightsprint projects` to find project IDs. |
| `--position <num>` | No | New position within section (0-based). Position 0 = top of section. |
| `--add-dep <taskId>` | No | Add a dependency (this task depends on the given task). Repeatable for multiple deps. Supports display IDs, bare task numbers, or raw IDs. |
| `--remove-dep <taskId>` | No | Remove a dependency. Repeatable for multiple deps. Supports display IDs, bare task numbers, or raw IDs. |
| `--json-body <json>` | No | Raw JSON request body (replaces individual field flags). Cannot combine with --title/--description/etc. |
| `--dry-run` | No | Validate inputs without calling the API. |
| `--output json` | No | Return structured JSON instead of human-readable text. |

At least one flag is required. Only the provided fields will be updated. Field updates and dependency changes are applied independently — a dependency failure won't prevent field updates.

## Invariants

- Always run `lightsprint get <taskId>` before updating to confirm current state
- Prefer `lightsprint claim <taskId>` over `lightsprint update <taskId> --status in_progress` — claim also assigns the task and links the CC session
- Title: max 500 chars. Description: max 50,000 chars
- Cannot combine `--position` with `--status` — position reorders within the current section, status moves to a different section
