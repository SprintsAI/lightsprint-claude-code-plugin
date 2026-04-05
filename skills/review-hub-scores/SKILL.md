---
name: review-hub-scores
description: Get AI readiness analysis (score, summaries, callouts, suggested actions) for a task's linked PR. Use to assess whether a PR is ready to merge.
---

Run this command to get AI readiness scores for a task's linked PR:

```bash
lightsprint review-hub scores $ARGUMENTS
```

Usage: `review-hub scores <taskId> [--refresh]`

- `<taskId>` — Task ID (display ID like `LIG-024`, bare number, or raw ID). Required.
- `--refresh` — Force-refresh signals from GitHub and trigger fresh AI analysis. **Consumes credits.**

Without `--refresh`, returns cached scores if available. If the cache is stale (signals changed since last analysis), the server may automatically trigger a fresh analysis.

## Output fields

| Field | Description |
|-------|-------------|
| readinessScore | 0-100 readiness score (null if no scores available) |
| readinessLabel | Human-readable label (e.g. "Ready", "Ready with minor issues") |
| sectionSummaries | Object with section names as keys, summary strings as values |
| changeCallouts | Array of notable changes or concerns |
| suggestedActions | Array of recommended actions before merging |
| addressal | Comment addressal analysis (which review comments were addressed) or null |

## Examples

```bash
lightsprint review-hub scores LIG-024 --output json
lightsprint review-hub scores LIG-024 --refresh --output json
lightsprint review-hub scores 24 --fields readinessScore,readinessLabel
```

## Invariants

- Scores cost credits when `--refresh` triggers fresh AI analysis. Always read cached scores first.
- If `readinessScore` is null, no analysis has been run yet. Decide whether to `--refresh` based on context.
- If signals are stale, refresh signals first (`review-hub signals --refresh`), then refresh scores.
- This command may take up to 2 minutes when triggering fresh AI analysis (120s timeout).
- Task must have a linked PR.
