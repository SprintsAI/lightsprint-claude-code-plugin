---
name: create
description: Create a new task on the Lightsprint project board. Use to add work items directly from Claude Code.
---

Run this command to create a new Lightsprint task:

```bash
lightsprint create $ARGUMENTS
```

Usage: `create <title> [--description <text>] [--complexity trivial|low|medium|high|critical] [--status todo|in_progress|in_review|done]`

After creating, the task ID is returned. You can link it to a Claude Code task with:
- Use TaskCreate with `metadata: { lightsprint_task_id: "<the LS task ID>" }`
- This links the CC task to the LS task so future updates sync automatically
