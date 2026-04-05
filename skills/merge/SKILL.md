---
name: merge
description: Merge the GitHub PR linked to a Lightsprint task. Supports direct merge and GitHub merge queue.
---

Run this command to merge a task's linked PR:

```bash
lightsprint merge $ARGUMENTS
```

Usage: `merge <taskId>`

- `<taskId>` — Task ID (display ID like `LIG-024`, bare number, or raw ID). Can also use `--task <taskId>`.

## Output fields

| Field | Description |
|-------|-------------|
| success | Boolean |
| pr.prUrl | PR URL |
| pr.prNumber | PR number |
| pr.status | `merged` (done) or `queued` (in merge queue, will merge when checks pass) |
| pr.title | PR title |
| pr.sha | Merge commit SHA (only when directly merged, not when queued) |

## Examples

```bash
lightsprint merge LIG-024 --output json
lightsprint merge --task LIG-024 --output json
lightsprint merge 24 --dry-run
```

## Invariants

- Task must have a linked PR. If not, error will suggest using `lightsprint link-pr`.
- Check review-hub signals/scores before merging to ensure the PR is ready.
- If the response status is `queued`, the repo uses GitHub merge queue — the PR will merge automatically when required checks pass.
- Common errors: PR already merged/closed, merge conflict (409), required checks not passing (422), insufficient permissions.
- This is a destructive action — once merged, it cannot be undone from the CLI.
