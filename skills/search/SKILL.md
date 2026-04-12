---
name: search
description: Full-text search across tasks on the Lightsprint (ls) repo board. Use when you need to find tasks by keyword, rather than browsing by status or project.
---

Run this command to search for tasks:

```bash
lightsprint search $ARGUMENTS
```

Usage: `search <query>` or `search --query <text>`

Both positional and flag syntax work: `lightsprint search "login bug"` is the same as `lightsprint search --query "login bug"`.

## Flags

| Flag | Required | Description |
|------|----------|-------------|
| `--query <text>` | Yes | Search query string. Max 500 chars. Also accepts positional argument. |
| `--status <status>` | No | Filter results by status (comma-separated): `backlog`, `todo`, `in_progress`, `in_review`, `done`. |
| `--project <filter>` | No | Filter by project ID(s), comma-separated, or `none` for unassigned tasks. |
| `--assignee <name>` | No | Filter by assignee name or email (case-insensitive substring match). |
| `--limit N` | No | Max results to return (default: 20, server max: 100). |
| `--output json` | No | Return structured JSON instead of human-readable text. |

## Output

Returns a list of matching tasks with their display ID, status, assignee, project, and title. Results are ranked by relevance.

## Examples

```bash
lightsprint search "login bug"
lightsprint search --query "auth" --status todo,in_progress
lightsprint search "payment" --project proj-abc123 --limit 50
lightsprint search "broken" --output json
```

## Invariants

- Use `search` when looking for specific tasks by keyword; use `tasks` for browsing/filtering by metadata.
- After finding a task, use `lightsprint get <taskId>` to see full details.
- Query must not be empty and must not contain control characters.
- Combine with `--status` to narrow results to actionable tasks.
