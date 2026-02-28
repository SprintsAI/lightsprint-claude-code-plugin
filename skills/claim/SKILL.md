---
name: claim
description: Claim an existing Lightsprint task to work on. Sets the task to in_progress on the board.
---

Run this command to claim a Lightsprint task:

```bash
lightsprint claim $ARGUMENTS
```

After claiming, create a Claude Code task from the returned details:
- Use TaskCreate with `metadata: { lightsprint_task_id: "<the LS task ID>" }`
- This links the CC task to the LS task so future updates sync automatically
