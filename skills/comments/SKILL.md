---
name: comments
description: List all comments on a Lightsprint (ls) task. Use to review team discussion or check prior context before adding your own comment.
---

Run this command to list comments on a task:

```bash
lightsprint comments $ARGUMENTS
```

Usage: `comments <taskId>` or `comments --task <taskId>`

Both positional and flag syntax work: `lightsprint comments LIG-024` is the same as `lightsprint comments --task LIG-024`.

Task ID can be a display ID (e.g. `LIG-024`), bare task number (e.g. `24`), or raw ID. All formats are resolved server-side.

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--task <taskId>` | required | Task ID (alternative to positional). |
| `--limit N` | 50 | Maximum number of comments to return. |
| `--output json` | text | Return structured JSON instead of human-readable text. |

## Output

Returns a list of comments with: id, body, author (name, email), createdAt, and updatedAt.

```json
{
  "taskId": "...",
  "comments": [
    {
      "id": "...",
      "body": "This is ready for review",
      "author": { "id": "...", "name": "Alice Smith", "email": "alice@example.com" },
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T10:30:00Z"
    }
  ],
  "totalCount": 1
}
```

## Examples

```bash
lightsprint comments LIG-024
lightsprint comments --task LIG-024 --limit 10
lightsprint comments --task LIG-024 --output json
```

## Invariants

- This is a read-only command — it does not modify any tasks
- Use `lightsprint comment --task <taskId> --body <text>` to add a new comment
- Comments are shown in chronological order (oldest first)
- Always read existing comments before adding one to avoid duplicating context
