---
name: update
description: Update an existing Lightsprint (ls) task. Change its title, description, status, complexity, assignee, position, or dependencies.
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
| `--assignee <name>` | No | Assign to a team member by name. |
| `--project <projectId>` | No | Move task to a project by ID. Use `lightsprint projects` to find project IDs. |
| `--position <num>` | No | New position within section (0-based). Position 0 = top of section. |
| `--add-dep <taskId>` | No | Add a dependency (this task depends on the given task). Repeatable for multiple deps. Supports display IDs, bare task numbers, or raw IDs. |
| `--remove-dep <taskId>` | No | Remove a dependency. Repeatable for multiple deps. Supports display IDs, bare task numbers, or raw IDs. |
| `--add-label <labelId>` | No | Add a label by ID. Repeatable for multiple labels. Use `lightsprint labels` to list available label IDs. |
| `--remove-label <labelId>` | No | Remove a label by ID. Repeatable for multiple labels. |
| `--json-body <json>` | No | Raw JSON request body (replaces individual field flags). Cannot combine with --title/--description/etc. |
| `--dry-run` | No | Validate inputs without calling the API. |
| `--output json` | No | Return structured JSON instead of human-readable text. |

At least one flag is required. Only the provided fields will be updated. Field updates, dependency changes, and label changes are applied independently — a failure in one won't prevent the others.

## Label Management

Use `lightsprint labels` to list available label IDs before adding or removing labels.

```bash
# Add a label to a task
lightsprint update LIG-024 --add-label lbl-abc123

# Remove a label
lightsprint update LIG-024 --remove-label lbl-abc123

# Add multiple labels in one command
lightsprint update LIG-024 --add-label lbl-abc123 --add-label lbl-def456
```

## Invariants

- Always run `lightsprint get <taskId>` before updating to confirm current state
- Prefer `lightsprint claim <taskId>` over `lightsprint update <taskId> --status in_progress` — claim also assigns the task and links the CC session
- Title: max 500 chars. Description: max 50,000 chars
- Cannot combine `--position` with `--status` — position reorders within the current section, status moves to a different section
- Label IDs (not names) are required for `--add-label` and `--remove-label`. Use `lightsprint labels` to look up IDs.
