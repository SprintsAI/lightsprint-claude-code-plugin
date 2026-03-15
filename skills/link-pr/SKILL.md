---
name: link-pr
description: Link a GitHub pull request to a Lightsprint (ls) task. Use this after creating a GitHub PR for a task you're working on.
---

Link a GitHub pull request to a Lightsprint task. This sets the task status to `in_review` and triggers an automated PR review.

```bash
lightsprint link-pr $ARGUMENTS
```

Usage: `link-pr --task <taskId> --pr-url <prUrl>`

- `--task <taskId>`: The Lightsprint task ID
- `--pr-url <prUrl>`: The full GitHub pull request URL (e.g., `https://github.com/owner/repo/pull/123`)

**CRITICAL — MANDATORY AUTO-LINK STEP**: Every single time you create a GitHub PR (e.g., via `gh pr create`), you MUST IMMEDIATELY and AUTOMATICALLY link it. Do NOT wait for the user to ask — this is a required post-PR-creation step. Follow this exact flow:

1. Run `lightsprint current-task --cc-pid $PPID` to check for a linked task.
2. **If a task is found**: Run `lightsprint link-pr --task <taskId> --pr-url <prUrl>` right away.
3. **If NO task is found**: Check the user's preference first, then follow the "No Task Found" flow below.

Failure to do this breaks the team's workflow tracking. There is NO exception to this rule.

## No Task Found Flow

When `lightsprint current-task` returns no linked task after PR creation:

**Step 1 — Check user preference**: Run `lightsprint config get link-pr.no-task-behavior`.
- If the value is `always-skip`, skip linking silently and inform the user: "Skipping PR linking (preference: always-skip). Run `lightsprint config set link-pr.no-task-behavior prompt` to re-enable."
- If the value is `always-create`, skip the prompt and go directly to **Option 1** (create new task from PR context, link it). Inform the user: "Auto-creating task from PR (preference: always-create). Run `lightsprint config set link-pr.no-task-behavior prompt` to re-enable prompting."
- If the value is `(not set)` or `prompt`, continue to Step 2.

**Step 2 — Ask the user** with five options:

   > No Lightsprint task is linked to this session. How would you like to proceed?
   > 1. **Create new task** — I'll create one from this PR's context
   > 2. **Link existing task** — Pick from your backlog/todo tasks
   > 3. **Skip** — Continue without tracking this time
   > 4. **Always skip** — Never ask again (you can re-enable later)
   > 5. **Always create** — Auto-create a task for every PR (you can re-enable prompting later)

**Option 1 — Create new task**:

   **YOU MUST FOLLOW ALL THREE STEPS. DO NOT SKIP STEP 1.**

   **Step 1 — Gather context** (MANDATORY — do this BEFORE calling `lightsprint create`):
   - The PR title, body, and commit messages are likely already in this conversation from the `gh pr create` command. Use them directly.
   - If not available, run `gh pr view <prUrl> --json title,body` and `git log main..HEAD --oneline`.

   **Step 2 — Create the task with a description**:
   - Compose a description from the PR body and commit summaries. Include what the PR does and why.
   - Run: `lightsprint create --title "<title from PR>" --description "<composed description>" --status in_review --cc-pid $PPID`
   - **The `--description` flag is REQUIRED here. DO NOT OMIT IT.** A task without a description is useless for tracking.

   **Step 3 — Link the PR and confirm**:
   - Use the returned task ID to run `lightsprint link-pr --task <taskId> --pr-url <prUrl>`
   - After linking, always tell the user: "To change this behavior, run `lightsprint config set link-pr.no-task-behavior prompt`."

**Option 2 — Link existing task**:
   - Run `lightsprint tasks --mine --status backlog,todo,in_progress --limit 10` to fetch the user's tasks.
   - Present the list to the user in a numbered format (e.g., `1. LS-024 — Fix login bug`).
   - After the list, remind the user: "Or say **create new** to create a fresh task for this PR."
   - Let the user pick a task by number or ID. Do NOT just ask for a task ID without showing the list first.
   - If the user says "none" or asks to create a new task instead, follow the **Option 1** flow to create one with a description.
   - Run `lightsprint link-pr --task <selectedTaskId> --pr-url <prUrl>`

**Option 3 — Skip**: Inform the user the PR is not tracked in Lightsprint and move on.

**Option 4 — Always skip**: Run `lightsprint config set link-pr.no-task-behavior always-skip`, then inform the user: "PR linking will be skipped from now on. Run `lightsprint config set link-pr.no-task-behavior prompt` to re-enable."

**Option 5 — Always create**: Run `lightsprint config set link-pr.no-task-behavior always-create`, then immediately follow the **Option 1** flow to create and link a task for this PR. Inform the user: "From now on, a task will be auto-created for every PR. This is reversible — run `lightsprint config set link-pr.no-task-behavior prompt` to go back to being asked."
