---
name: labels
description: List all labels available in the Lightsprint (ls) workspace. Use to find label IDs before adding or removing labels from tasks.
---

Run this command to list all available labels:

```bash
lightsprint labels $ARGUMENTS
```

Usage: `labels`

No arguments needed — returns all labels in the workspace.

Aliases: `tags` resolves to `labels`.

## Output

For each label shows: ID, name, and color (if set).

JSON output includes: `labels` array with `id`, `name`, and `color` fields.

## Examples

```bash
lightsprint labels
lightsprint labels --output json
```

## Invariants

- This is a read-only command — it does not modify any labels
- Use label IDs from this output with `lightsprint label add` and `lightsprint label remove`
- Labels are workspace-scoped — all repos in the workspace share the same label set
- To add a label to a task, use `/lightsprint:label`
