---
name: relate
description: Create a relation between two Lightsprint (ls) tasks. Use to mark tasks as blocking, related, or duplicates of each other.
---

Run this command to create a relation between tasks:

```bash
lightsprint relate $ARGUMENTS
```

Usage: `relate <taskId> --type <type> --target <taskId>` or `relate --task <taskId> --type <type> --target <taskId>`

Task IDs support display IDs (e.g. `LIG-024`), bare task numbers (e.g. `24`), or raw IDs.

## Flags

| Flag | Required | Description |
|------|----------|-------------|
| `--task <taskId>` | Yes | Source task ID (alternative to positional). |
| `--type <type>` | Yes | Relation type: `blocking`, `related`, or `duplicate`. |
| `--target <taskId>` | Yes | Target task ID. |
| `--dry-run` | No | Validate inputs without calling the API. |
| `--output json` | No | Return structured JSON instead of human-readable text. |

## Relation types

| Type | Meaning |
|------|---------|
| `blocking` | Source task is blocking the target task (target cannot start until source is done). |
| `related` | Tasks are related but neither blocks the other (for cross-referencing). |
| `duplicate` | Source task duplicates the target task. |

## Output

Returns the created relation with `id`, `type`, `taskId`, and `targetTaskId`.
**Save the `id`** — you need it to remove the relation with `lightsprint unrelate`.

## Examples

```bash
lightsprint relate LIG-024 --type blocking --target LIG-031
lightsprint relate --task LIG-024 --type related --target LIG-050
lightsprint relate LIG-010 --type duplicate --target LIG-005 --output json
```

## Invariants

- A task cannot be related to itself.
- Use `lightsprint relations <taskId>` to see existing relations before adding a new one.
- Relations are directional: `LIG-024 blocking LIG-031` means LIG-024 blocks LIG-031, not the reverse.
- To remove a relation, use `lightsprint unrelate <taskId> --relation-id <id>` with the relation ID from the output.
- This is distinct from task **dependencies** (--depends-on/--add-dep): dependencies track prerequisite work; relations track conceptual connections between tasks.
