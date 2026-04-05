---
name: review-hub-signals
description: Get PR signals (CI checks, reviews, comments, deployments) for a task's linked PR. Use to inspect what CI and review activity has happened on a PR.
---

Run this command to get the signals for a task's linked PR:

```bash
lightsprint review-hub signals $ARGUMENTS
```

Usage: `review-hub signals <taskId> [--refresh]`

- `<taskId>` — Task ID (display ID like `LIG-024`, bare number, or raw ID). Required.
- `--refresh` — Force re-fetch all signals from GitHub. Without this flag, returns cached signals.

## Output fields

| Field | Description |
|-------|-------------|
| signals | Array of signal objects (category, status, title, body, URL, actor) |
| lastViewedAt | When the review hub was last viewed (for unread detection) |
| ownerAgentType | Cloud agent provider that owns this PR (`anthropic`, `cursor`, `codex`, or null) |
| additions / deletions / changedFiles | PR diff stats |

Each signal has: `id`, `category` (ci/review/deployment/bot_comment/human_comment/custom), `status` (success/failure/pending/running/neutral/warning), `title`, `signalBody`, `url`, `actorLogin`, `scoreValue`, `scoreLabel`.

## Examples

```bash
lightsprint review-hub signals LIG-024 --output json
lightsprint review-hub signals LIG-024 --refresh --output json
lightsprint review-hub signals 24 --fields signals
```

## Invariants

- Use `--refresh` sparingly — it re-fetches all signals from GitHub API. The default cached read is usually sufficient.
- Check signals before checking scores — signals are what the AI readiness analysis is based on.
- Task must have a linked PR. If not, you'll get an error suggesting `lightsprint link-pr`.
- The first call to signals for a PR may auto-trigger backfill from GitHub (even without `--refresh`).
