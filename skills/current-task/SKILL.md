---
name: current-task
description: Get the Lightsprint task linked to the current Claude Code session. Uses the session PID to auto-discover the task without needing a task ID.
---

Run this command to find the task linked to the current CC session:

```bash
lightsprint current-task --cc-pid $PPID
```

No arguments needed — the task is discovered automatically from the active CC session.

**When to use**: When you need to know which Lightsprint task is associated with this Claude Code session (e.g., before creating a PR, adding a comment, or checking task details).
