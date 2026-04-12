---
name: labels
description: List all labels in the Lightsprint (ls) repo workspace. Use to discover available labels before adding them to tasks or when managing the label taxonomy.
---

Run this command to list labels:

```bash
lightsprint labels $ARGUMENTS
```

Usage: `labels [--project <projectId>]`

Alias: `label`, `tags` also resolve to `labels`.

## Flags

| Flag | Required | Description |
|------|----------|-------------|
| `--project <projectId>` | No | Filter labels by project ID (optional). Use `lightsprint projects` to find project IDs. |
| `--output json` | No | Return structured JSON instead of human-readable text. |

## Output

Returns a list of labels with:
- `id` — label ID (use this with `add-label`, `remove-label`, `update-label`, `delete-label`)
- `name` — label name
- `color` — hex color (e.g. `#FF5733`)
- `description` — optional description

## Examples

```bash
lightsprint labels
lightsprint labels --output json
lightsprint labels --project proj-abc123 --output json
```

## Invariants

- This is a read-only command — it does not modify any labels.
- Use label IDs (not names) when calling `add-label` or `remove-label`.
- Use `lightsprint create-label --name <name>` to add a new label to the workspace.
