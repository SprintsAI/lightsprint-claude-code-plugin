---
name: claim
description: Claim an existing Lightsprint task to work on. Sets the task to in_progress on the board.
---

Run this command to claim a Lightsprint task:

```bash
lightsprint claim --cc-pid $PPID $ARGUMENTS
```

After claiming, show the user the task details and ask if they want to start working on it now. Do NOT automatically begin working on the task.

If the user confirms they want to start working:
- Use TaskCreate with `metadata: { lightsprint_task_id: "<the LS task ID>" }`
- This links the CC task to the LS task so future updates sync automatically
