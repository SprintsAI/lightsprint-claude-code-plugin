---
name: unlink-pr
description: Remove a linked GitHub pull request from a Lightsprint (ls) task. Use this to unlink a PR that was previously linked to a task.
---

Run this command to remove a linked GitHub pull request from a Lightsprint task:

```bash
lightsprint unlink-pr $ARGUMENTS
```

Usage: `unlink-pr --task <taskId>`

- `--task <taskId>`: The Lightsprint task ID — supports display IDs (e.g. `LIG-024`), bare task numbers (e.g. `24`), or raw IDs

This removes the linked PR from the task and clears the PR URL from any associated cloud agents.

**When to use**: When a PR was linked to the wrong task, or you need to replace it with a different PR.
