---
name: create-plan
description: Create a plan on Lightsprint from markdown content. Use to upload implementation plans, design docs, or any structured plan for team visibility and review.
---

Run this command to create a plan on Lightsprint:

```bash
lightsprint create-plan --cc-pid $PPID $ARGUMENTS
```

Usage: `create-plan --content <markdown> [--title <text>] [--task <taskId>]`

## Flags

| Flag | Required | Description |
|------|----------|-------------|
| `--content <markdown>` | Yes | Plan content in markdown format. Max 200,000 chars. |
| `--title <text>` | No | Explicit plan title. If omitted, extracted from the first heading in content. Max 500 chars. |
| `--task <taskId>` | No | Link the plan to an existing Lightsprint task. Supports raw IDs and display IDs (e.g. `LIG-024`). |
| `--dry-run` | No | Validate inputs without calling the API. |
| `--output json` | No | Return structured JSON instead of human-readable text. |

## Output

Returns the created plan's ID and version number. If the plan was deduplicated (an existing pending plan was found for this CC session), `deduplicated: true` is included.

## When to use

Use this when you have a plan, design, or structured document that should be visible to the team on Lightsprint. The plan will appear on the Lightsprint board for review.
