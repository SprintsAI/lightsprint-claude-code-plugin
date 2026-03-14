---
name: claim
description: Claim an existing Lightsprint (ls) task to work on. Sets the task to in_progress on the board.
---

Run this command to claim a Lightsprint task:

```bash
lightsprint claim --cc-pid $PPID --task $ARGUMENTS
```

Usage: `claim --task <taskId>`

Task ID can be a display ID (e.g. `LIG-024`), bare task number (e.g. `24`), or raw ID. All formats are resolved server-side.

**Important:** Only root tasks (tasks with no parent) can be claimed. Subtasks cannot be claimed directly — claim their parent task instead.

After claiming, show the user the task details and ask if they want to start working on it now. Do NOT automatically begin working on the task.

If the user confirms they want to start working:
- Use TaskCreate with `metadata: { lightsprint_task_id: "<the LS task ID>" }`
- This links the CC task to the LS task so future updates sync automatically
