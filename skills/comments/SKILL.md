---
name: comments
description: List all comments on a Lightsprint (ls) task, or update/delete an existing comment. Use to view discussion threads and manage comment history.
---

## List comments on a task

```bash
lightsprint comments $ARGUMENTS
```

Usage: `comments <taskId>` or `comments --task <taskId>`

Both positional and flag syntax work: `lightsprint comments LIG-024` is the same as `lightsprint comments --task LIG-024`.

Task ID supports display IDs (e.g. `LIG-024`), bare numbers (e.g. `24`), or raw IDs.

### Output

For each comment shows: comment ID, author, date, and full body text.

JSON output includes: `taskId`, `comments` array with `id`, `body`, `author`, `createdAt`, `updatedAt` fields.

### Examples

```bash
lightsprint comments LIG-024
lightsprint comments --task LIG-024 --output json
```

---

## Update a comment

```bash
lightsprint comment --update <commentId> --body <text>
```

Updates the body of an existing comment. The `commentId` is returned in the comments list output.

### Examples

```bash
lightsprint comment --update abc123 --body "Updated text"
lightsprint comment --update abc123 --body "Fixed typo" --output json
```

---

## Delete a comment

```bash
lightsprint comment --delete <commentId>
```

Permanently removes a comment. This cannot be undone.

### Examples

```bash
lightsprint comment --delete abc123
lightsprint comment --delete abc123 --output json
```

---

## Invariants

- Always use `lightsprint comments <taskId>` first to get comment IDs before updating or deleting
- Comment bodies: max 10,000 characters; newlines and tabs are allowed
- Only comments you have permission to edit can be updated or deleted
- To add a new comment, use `lightsprint comment <taskId> <body>`
