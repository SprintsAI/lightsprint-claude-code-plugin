---
name: tasks
description: List tasks from the Lightsprint project board. Use when you need to see what work is available.
---

Run this command to list tasks from Lightsprint:

```bash
lightsprint tasks $ARGUMENTS
```

Options: `--status todo|in_progress|in_review|done`, `--limit N`

After reviewing the list, you can claim a task with `/lightsprint:claim <taskId>`.
