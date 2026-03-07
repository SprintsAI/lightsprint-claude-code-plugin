---
name: unlink-pr
description: Remove a linked GitHub pull request from a Lightsprint task. Use this to unlink a PR that was previously linked to a task.
---

Run this command to remove a linked GitHub pull request from a Lightsprint task:

```bash
lightsprint unlink-pr $ARGUMENTS
```

Usage: `unlink-pr <taskId>`

- `taskId`: The Lightsprint task ID (e.g., `LIG-024` or a raw task ID)

This removes the linked PR from the task and clears the PR URL from any associated cloud agents.

**When to use**: When a PR was linked to the wrong task, or you need to replace it with a different PR.
