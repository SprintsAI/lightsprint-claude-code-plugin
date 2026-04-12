---
name: relations
description: List all relations for a Lightsprint (ls) task. Use to see which tasks are blocking, related to, or duplicate of a given task.
---

Run this command to list task relations:

```bash
lightsprint relations $ARGUMENTS
```

Usage: `relations <taskId>` or `relations --task <taskId>`

Both positional and flag syntax work. Alias: `relation` also resolves to `relations`.

Task ID supports display IDs (e.g. `LIG-024`), bare task numbers (e.g. `24`), or raw IDs.

## Output

Returns a list of relations with:
- `id` — relation ID (use this with `lightsprint unrelate` to remove)
- `type` — relation type: `blocking`, `related`, or `duplicate`
- `targetTaskId` — the other task's ID
- `targetTask` — basic info about the related task (title, status)

## Examples

```bash
lightsprint relations LIG-024
lightsprint relations --task abc123 --output json
```

## Invariants

- This is a read-only command — it does not modify any tasks.
- Save the `id` field from results to use with `lightsprint unrelate <taskId> --relation-id <id>`.
- Use `lightsprint relate <taskId> --type <type> --target <taskId>` to create a new relation.
