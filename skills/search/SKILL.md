---
name: search
description: Full-text search across tasks on the Lightsprint (ls) repo board. Use to find tasks by keyword when you don't know the task ID.
---

Run this command to search tasks on the Lightsprint board:

```bash
lightsprint search $ARGUMENTS
```

Usage: `search <query> [--status <status>] [--assignee <name>] [--project <filter>] [--limit N]`

The query is a free-text search across task titles and descriptions. Combine with filters to narrow results.

Aliases: `find` resolves to `search`.

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `<query>` | — | Search query (required). Max 500 chars. Free-text match on title and description. |
| `--status <status>` | all | Filter by status (comma-separated): `backlog`, `todo`, `in_progress`, `in_review`, `done`. |
| `--assignee <name>` | all | Filter by assignee name or email. |
| `--project <filter>` | all | Filter by project ID(s), or `none` for tasks without a project. |
| `--limit N` | 20 | Maximum number of results to return. |
| `--output json` | text | Return structured JSON instead of human-readable text. |

## Output

For each matching task shows: display ID, status, assignee (if any), complexity (if set), project (if assigned), title, and first 200 chars of description.

JSON output includes: `query`, `tasks` array with `displayId`, `id`, `title`, `status`, `assignee`, `complexity`, `project`, `description`, and `totalCount`.

## Examples

```bash
lightsprint search "login bug"
lightsprint search "auth" --status in_progress
lightsprint search "database" --assignee "Alice" --limit 10
lightsprint search "refactor" --output json
```

## Invariants

- This is a read-only command — it does not modify any tasks
- Use `lightsprint get <taskId>` to get full details of a search result
- Search is case-insensitive and matches partial words
- If you know the task ID or number, prefer `lightsprint get` for exact lookup
- After finding a task, claim it with `/lightsprint:claim <taskId>` to start working on it
