---
name: label
description: Add or remove a label on a Lightsprint (ls) task. Use to categorize tasks with workflow labels like "bug", "feature", or "blocked".
---

Run this command to add or remove a label on a task:

```bash
lightsprint label $ARGUMENTS
```

Usage:
- `label add <taskId> --label <labelId>` — Add a label to a task
- `label remove <taskId> --label <labelId>` — Remove a label from a task

Both positional and flag syntax work for the task ID.

## Flags

| Flag | Required | Description |
|------|----------|-------------|
| `add` \| `remove` | Yes | Subcommand: whether to add or remove the label |
| `<taskId>` | Yes | Task ID. Supports display IDs (e.g. `LIG-024`), bare numbers (e.g. `24`), or raw IDs. |
| `--label <labelId>` | Yes | Label ID to add or remove. Use `lightsprint labels` to list available label IDs. |
| `--dry-run` | No | Validate inputs without calling the API. |
| `--output json` | No | Return structured JSON instead of human-readable text. |

## Examples

```bash
# List available labels first
lightsprint labels --output json

# Add a label
lightsprint label add LIG-024 --label bug
lightsprint label add LIG-024 --label abc123def

# Remove a label
lightsprint label remove LIG-024 --label bug
```

## Invariants

- Use `lightsprint labels` first to find valid label IDs
- Task ID supports display IDs (e.g. `LIG-024`), bare numbers (e.g. `24`), or raw IDs
- Adding a label that is already on the task is a no-op (returns success)
- Removing a label that is not on the task is a no-op (returns success)
