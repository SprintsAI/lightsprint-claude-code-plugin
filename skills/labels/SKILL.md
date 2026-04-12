---
name: labels
description: List available labels in the Lightsprint (ls) workspace. Use to find label IDs before adding or removing labels from tasks.
---

Run this command to list available labels:

```bash
lightsprint labels $ARGUMENTS
```

Usage: `labels`

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--output json` | text | Return structured JSON instead of human-readable text. |

## Output

Returns a list of labels with: id, name, color, and description.

```json
{
  "labels": [
    { "id": "lbl-abc123", "name": "bug", "color": "#e11d48", "description": "Something isn't working" },
    { "id": "lbl-def456", "name": "feature", "color": "#7c3aed", "description": "New functionality" }
  ],
  "totalCount": 2
}
```

## Examples

```bash
lightsprint labels
lightsprint labels --output json
```

## Adding and Removing Labels

Use the label ID (not name) when adding or removing labels from tasks:

```bash
# Add a label to a task
lightsprint update LIG-024 --add-label lbl-abc123

# Remove a label from a task
lightsprint update LIG-024 --remove-label lbl-abc123

# Add multiple labels at once (repeat the flag)
lightsprint update LIG-024 --add-label lbl-abc123 --add-label lbl-def456
```

## Invariants

- This is a read-only command — it does not modify any data
- Always run `lightsprint labels` before adding/removing labels to get the correct label IDs
- Label IDs (not names) are required for `lightsprint update --add-label` and `--remove-label`
- Labels are workspace-wide; the same labels are available across all projects
