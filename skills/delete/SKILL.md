---
name: delete
description: Delete a Lightsprint (ls) task permanently from the repo board. Use when a task is no longer needed, was created by mistake, or is a duplicate.
---

Run this command to delete a Lightsprint task:

```bash
lightsprint delete --task $ARGUMENTS
```

Usage: `delete --task <taskId>`

- `--task <taskId>`: The Lightsprint task ID — supports display IDs (e.g. `LIG-024`), bare task numbers (e.g. `24`), or raw IDs

**Warning:** This permanently removes the task from the board. It cannot be undone. Before deleting, confirm with the user that they want the task removed.

**When to use**: When a task was created by mistake, is a duplicate, or is no longer relevant and should be removed rather than moved to done.

**Prefer update over delete**: If the task was completed, use `lightsprint update --task <taskId> --status done` instead of deleting it. Only delete tasks that should not exist at all.
