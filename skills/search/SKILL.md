---
name: search
description: Search for Lightsprint (ls) tasks by text query. Use when you need to find tasks matching a keyword or phrase across titles and descriptions.
---

Run this command to search for tasks on Lightsprint:

```bash
lightsprint search $ARGUMENTS
```

Usage: `search <query> [options]`

The query is positional (no flag needed): `lightsprint search "login bug"`

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `<query>` | required | Search text. Matched against task title and description. Max 500 chars. |
| `--status <status>` | all | Filter by status (comma-separated): `backlog`, `todo`, `in_progress`, `in_review`, `done`. |
| `--assignee <name>` | all | Filter by assignee name/email (case-insensitive substring match). |
| `--project <filter>` | all | Filter by project ID(s), or `none` for tasks without a project. |
| `--limit N` | 20 | Maximum number of results. |
| `--output json` | text | Return structured JSON instead of human-readable text. |

## Output

For each matching task shows: display ID (e.g. `LIG-003`), status, assignee, project, title, and first 120 chars of description.

## Examples

```bash
lightsprint search "login bug"
lightsprint search "auth" --status todo,in_progress
lightsprint search "payment" --assignee "Alice" --limit 10
lightsprint search "refactor" --project none
```

## Invariants

- This is a read-only command — it does not modify any tasks
- The query is matched case-insensitively against title and description
- Combine with `--status`, `--assignee`, and `--project` to narrow results
- Use `lightsprint get <taskId>` to view full details of a search result
- Use `lightsprint tasks` for listing tasks without a text query
