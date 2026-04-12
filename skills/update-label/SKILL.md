---
name: update-label
description: Update an existing label in the Lightsprint (ls) workspace. Use to rename, recolor, or re-describe a label.
---

Run this command to update a label:

```bash
lightsprint update-label $ARGUMENTS
```

Usage: `update-label <labelId> [--name <text>] [--color <hex>] [--description <text>]`

Both positional and flag syntax work: `lightsprint update-label label-abc --name "critical"` is the same as `lightsprint update-label --label label-abc --name "critical"`.

Use `lightsprint labels` to find label IDs.

## Flags

| Flag | Required | Description |
|------|----------|-------------|
| `--label <labelId>` | Yes | Label ID (alternative to positional). |
| `--name <text>` | No | New label name. Max 100 chars. |
| `--color <hex>` | No | New hex color code (e.g. `#FF5733`). |
| `--description <text>` | No | New description. Max 500 chars. |
| `--dry-run` | No | Validate inputs without calling the API. |
| `--output json` | No | Return structured JSON instead of human-readable text. |

## Examples

```bash
lightsprint update-label label-abc --name "critical-bug" --color "#CC0000"
lightsprint update-label label-abc --description "Requires immediate attention"
lightsprint update-label --label label-abc --name "renamed"
```

## Invariants

- Always run `lightsprint labels` before updating to confirm the label ID.
- At least one of `--name`, `--color`, or `--description` is required.
- Renaming a label does NOT affect tasks that already have it — existing task-label associations are preserved.
