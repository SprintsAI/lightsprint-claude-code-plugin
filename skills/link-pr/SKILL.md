---
name: link-pr
description: Link a GitHub pull request to a Lightsprint task. Use this after creating a GitHub PR for a task you're working on.
---

Run this command to link a GitHub pull request to a Lightsprint task:

```bash
lightsprint link-pr $ARGUMENTS
```

Usage: `link-pr <taskId> <prUrl>`

- `taskId`: The Lightsprint task ID (from a previously claimed task)
- `prUrl`: The full GitHub pull request URL (e.g., `https://github.com/owner/repo/pull/123`)

This sets the task status to `in_review` and triggers an automated PR review.

**When to use**: After you create a GitHub pull request for a task you're working on, link the GitHub PR so the team can track progress and get automated code review feedback.
