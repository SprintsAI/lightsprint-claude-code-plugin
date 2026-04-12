---
name: unrelate
description: Remove a relation between two Lightsprint (ls) tasks. Use when a previously created blocking, related, or duplicate relation is no longer accurate.
---

Run this command to remove a relation between tasks:

```bash
lightsprint unrelate $ARGUMENTS
```

Usage: `unrelate <taskId> --relation-id <relationId>` or `unrelate --task <taskId> --relation-id <relationId>`

## Flags

| Flag | Required | Description |
|------|----------|-------------|
| `--task <taskId>` | Yes | Source task ID (alternative to positional). Supports display IDs (e.g. `LIG-024`). |
| `--relation-id <id>` | Yes | Relation ID to remove. Obtain this from `lightsprint relations <taskId>`. |
| `--dry-run` | No | Validate inputs without calling the API. |
| `--output json` | No | Return structured JSON instead of human-readable text. |

## Workflow

1. Run `lightsprint relations <taskId>` to list relations and find the `id`
2. Run `lightsprint unrelate <taskId> --relation-id <id>` to remove it

## Examples

```bash
lightsprint relations LIG-024
# Output: { relations: [{ id: "rel-abc123", type: "blocking", ... }] }

lightsprint unrelate LIG-024 --relation-id rel-abc123
lightsprint unrelate --task LIG-024 --relation-id rel-abc123 --output json
```

## Invariants

- Always run `lightsprint relations <taskId>` first to get the relation ID — relation IDs cannot be guessed.
- Removing a relation does NOT affect the tasks themselves — it only removes the conceptual link.
- To create a new relation, use `lightsprint relate <taskId> --type <type> --target <taskId>`.
