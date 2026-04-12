---
name: list-comments
description: List all comments on a Lightsprint (ls) task. Use to read the discussion thread before adding a new comment or to check for updates from teammates.
---

Run this command to list comments on a task:

```bash
lightsprint list-comments $ARGUMENTS
```

Usage: `list-comments <taskId>` or `list-comments --task <taskId>`

Both positional and flag syntax work: `lightsprint list-comments LIG-024` is the same as `lightsprint list-comments --task LIG-024`.

Alias: `comments` also resolves to `list-comments`.

Task ID can be a display ID (e.g. `LIG-024`), bare task number (e.g. `24`), or raw ID. All formats are resolved server-side.

## Output

Returns a list of comments with:
- `id` — comment ID
- `body` — comment text
- `author` — commenter's name
- `createdAt` — timestamp
- `updatedAt` — last edit timestamp (if edited)

## Examples

```bash
lightsprint list-comments LIG-024
lightsprint list-comments --task abc123 --output json
```

## Invariants

- Always read existing comments before adding a new one to avoid duplication.
- This is a read-only command — it does not modify any tasks.
- Use `lightsprint comment <taskId> <body>` to add a new comment.
