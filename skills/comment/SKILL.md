---
name: comment
description: Add a comment to a Lightsprint (ls) task. Use to leave notes or status updates visible to the team.
---

Run this command to add a comment to a Lightsprint task:

```bash
lightsprint comment $ARGUMENTS
```

Usage: `comment <taskId> <comment body>`

Task ID can be a display ID (e.g. `LIG-024`), bare task number (e.g. `24`), or raw ID. All formats are resolved server-side.

## Constraints

- Comment body: max 10,000 characters
- Body must not contain control characters (newlines and tabs are allowed)
