---
name: update
description: Update an existing Lightsprint task. Change its title, description, status, complexity, or assignee.
---

Run this command to update a Lightsprint task:

```bash
lightsprint update $ARGUMENTS
```

Usage: `update <taskId> [--title <text>] [--description <text>] [--status todo|in_progress|in_review|done] [--complexity trivial|low|medium|high|critical] [--assignee <name>]`

At least one flag is required. Only the provided fields will be updated.
