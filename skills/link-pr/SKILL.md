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
3. **If NO task is found**: Follow the "No Task Found" flow below.

Failure to do this breaks the team's workflow tracking. There is NO exception to this rule.

## No Task Found Flow

When `lightsprint current-task` returns no linked task after PR creation:

1. **Ask the user** with three options:

   > No Lightsprint task is linked to this session. How would you like to proceed?
   > 1. **Create new task** — I'll create one from this PR's context
   > 2. **Link existing task** — Pick from your backlog/todo tasks
   > 3. **Skip** — Continue without tracking

2. **Option 1 — Create new task**:
   - Gather context from the current session:
     - PR title and description (from the `gh pr create` output or `gh pr view`)
     - Branch name
     - `git log main..HEAD --oneline` for commit summaries
   - Run `lightsprint create "<title derived from PR>" --description "<summary from PR description and commits>" --status in_review --cc-pid $PPID`
   - Use the returned task ID to run `lightsprint link-pr --task <taskId> --pr-url <prUrl>`

3. **Option 2 — Link existing task**:
   - Run `lightsprint tasks --mine --status backlog,todo --limit 10` to fetch the user's backlog and todo tasks.
   - Present the list to the user in a numbered format (display ID, title).
   - Let the user pick a task by number or ID.
   - Run `lightsprint link-pr --task <selectedTaskId> --pr-url <prUrl>`

4. **Option 3 — Skip**: Inform the user the PR is not tracked in Lightsprint and move on.
