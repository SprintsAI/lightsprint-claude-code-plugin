---
name: tasks
description: List tasks from the Lightsprint (ls) repo board. Use when you need to see what work is available.
---

Run this command to list tasks from Lightsprint. By default, only root tasks (no parent) are shown — subtasks are excluded.

```bash
lightsprint tasks $ARGUMENTS
```

Usage: `tasks [--status <status>] [--complexity <level>] [--assignee <name>] [--mine] [--unassigned] [--deps <filter>] [--sort <field>] [--limit N] [--offset N]`

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--status <status>` | all | Filter by status (comma-separated): `backlog`, `todo`, `in_progress`, `in_review`, `done`. Example: `--status todo,in_progress` |
| `--complexity <level>` | all | Filter by complexity: `low`, `medium`, or `high`. |
| `--assignee <name>` | all | Filter by assignee name or email (case-insensitive substring match). |
| `--mine` | — | Show only tasks assigned to the current user. |
| `--unassigned` | — | Show only tasks with no assignee. |
| `--deps <filter>` | all | Filter by dependencies: `has-dependencies`, `has-no-dependencies`, `has-dependents`, `unblocked`. |
| `--sort <field>` | `position` | Sort order: `position` (board order), `updated_at` (most recently updated first), `created_at` (newest first). |
| `--limit N` | 20 | Maximum number of tasks to return (server max: 100). |
| `--offset N` | 0 | Skip first N tasks (for pagination). |
| `--page-all` | — | Stream all tasks as NDJSON (one JSON object per line). Ignores `--limit`/`--offset`. |
| `--output json` | text | Return structured JSON instead of human-readable text. |

## Dependency filters

- `has-dependencies` — tasks that depend on other tasks
- `has-dependents` — tasks that block other tasks
- `has-no-dependencies` — tasks that have no dependencies at all
- `unblocked` — tasks with no dependencies, or all dependencies are `done`

## Output

For each task shows: display ID (e.g. `LIG-003`), status, assignee, complexity, title, and first 120 chars of description.

## Examples

```bash
lightsprint tasks --status todo,in_progress --mine
lightsprint tasks --status backlog --unassigned --complexity low
lightsprint tasks --deps unblocked --status todo
```

## Invariants

- This is a read-only command — it does not modify any tasks
- All flags can be combined to narrow results
- After reviewing, claim a task with `/lightsprint:claim <taskId>` or view details with `/lightsprint:get <taskId>`
- Only root tasks (tasks with no parent) can be claimed. Subtasks cannot be claimed directly.
