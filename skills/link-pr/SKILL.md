---
name: link-pr
description: Link a GitHub pull request to a Lightsprint (ls) task. Use this after creating a GitHub PR for a task you're working on.
---

Link a GitHub pull request to a Lightsprint task. This sets the task status to `in_review` and triggers an automated PR review.

```bash
lightsprint link-pr $ARGUMENTS
```

Usage: `link-pr --task <taskId> --pr-url <prUrl> [--force]`

- `--task <taskId>`: The Lightsprint task ID
- `--pr-url <prUrl>` (or `--pr <prUrl>`): The full GitHub pull request URL (e.g., `https://github.com/owner/repo/pull/123`)
- `--force`: Move the PR link to this task when the PR is already linked to another task in the same workspace. Only pass this after a plain `link-pr` fails with "already linked to another task".

Linking works for ANY head branch — use it when a PR's branch does not follow the `ls/...` naming convention and the automatic linker missed it. If the PR was already auto-linked to another task (e.g. a task auto-created for the untracked branch), retry with `--force` to move the link.

**CRITICAL — MANDATORY AUTO-LINK STEP**: Every single time you create a GitHub PR (e.g., via `gh pr create`), you MUST IMMEDIATELY and AUTOMATICALLY link it. Do NOT wait for the user to ask — this is a required post-PR-creation step. Follow this exact flow:

1. Run `lightsprint current-task --cc-pid $PPID` to check for a linked task.
2. **If a task is found**: Run `lightsprint link-pr --task <taskId> --pr-url <prUrl>` right away.
3. **If NO task is found**: Check the user's preference first, then follow the "No Task Found" flow below.

Failure to do this breaks the team's workflow tracking. There is NO exception to this rule.

## No Task Found Flow

When `lightsprint current-task` returns no linked task after PR creation:

**Step 1 — Check user preference**: Run `lightsprint config get link-pr.no-task-behavior`.
- If the value is `always-skip`, skip linking silently and inform the user: "Skipping PR linking (preference: always-skip). Run `lightsprint config set link-pr.no-task-behavior prompt` to re-enable."
- If the value is `(not set)` or `prompt`, continue to Step 2.

**Step 2 — Ask the user** with three options:

   > No Lightsprint task is linked to this session. How would you like to proceed?
   > 1. **Link existing task** — Pick from your backlog/todo tasks
   > 2. **Skip** — Continue without tracking this time
   > 3. **Always skip** — Never ask again (you can re-enable later)

**Option 1 — Link existing task**:
   - Run `lightsprint tasks --mine --status backlog,todo,in_progress --limit 10` to fetch the user's tasks.
   - Present the list to the user in a numbered format (e.g., `1. LS-024 — Fix login bug`).
   - Let the user pick a task by number or ID. Do NOT just ask for a task ID without showing the list first.
   - Run `lightsprint link-pr --task <selectedTaskId> --pr-url <prUrl>`

**Option 2 — Skip**: Inform the user the PR is not tracked in Lightsprint and move on.

**Option 3 — Always skip**: Run `lightsprint config set link-pr.no-task-behavior always-skip`, then inform the user: "PR linking will be skipped from now on. Run `lightsprint config set link-pr.no-task-behavior prompt` to re-enable."
