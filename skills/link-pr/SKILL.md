---
name: link-pr
description: Link a GitHub pull request to a Lightsprint (ls) task. Use this after creating a GitHub PR for a task you're working on.
---

Run this command to link a GitHub pull request to a Lightsprint task:

```bash
lightsprint link-pr $ARGUMENTS
```

Usage: `link-pr <taskId> <prUrl>`

- `taskId`: The Lightsprint task ID (from a previously claimed task)
- `prUrl`: The full GitHub pull request URL (e.g., `https://github.com/owner/repo/pull/123`)

This sets the task status to `in_review` and triggers an automated PR review.

**Auto-discover task ID**: If no task ID is provided in $ARGUMENTS, first run `lightsprint current-task --cc-pid $PPID` to get the task linked to the current session. Use the returned task ID for the `link-pr` command.

**When to use**: After you create a GitHub pull request for a task you're working on, link the GitHub PR so the team can track progress and get automated code review feedback.

**IMPORTANT**: Whenever you create a GitHub PR (e.g., via `gh pr create`), you MUST automatically attempt to link it to the current Lightsprint task without waiting for the user to ask. Run `lightsprint current-task --cc-pid $PPID` to check if there is a linked task, and if so, immediately run `lightsprint link-pr <taskId> <prUrl>`.
