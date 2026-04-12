---
name: create-label
description: Create a new label in the Lightsprint (ls) repo workspace. Use to add labels to the taxonomy before applying them to tasks.
---

Run this command to create a label:

```bash
lightsprint create-label $ARGUMENTS
```

Usage: `create-label --name <name> [--color <hex>] [--description <text>]`

## Flags

| Flag | Required | Description |
|------|----------|-------------|
| `--name <text>` | Yes | Label name. Max 100 chars. |
| `--color <hex>` | No | Hex color code (e.g. `#FF5733`). Must be a valid 6-digit hex color. |
| `--description <text>` | No | Label description. Max 500 chars. |
| `--dry-run` | No | Validate inputs without calling the API. |
| `--output json` | No | Return structured JSON instead of human-readable text. |

## Output

Returns the created label's `id`, `name`, `color`, and `description`.
Use the returned `id` to apply the label to tasks with `add-label`.

## Examples

```bash
lightsprint create-label --name "bug" --color "#FF0000"
lightsprint create-label --name "needs-review" --color "#FFA500" --description "Requires code review"
lightsprint create-label --name "documentation" --dry-run
```

## Invariants

- Label names must be unique within the workspace.
- Color must be a 6-character hex code starting with `#` (e.g. `#FF5733`).
- After creating, use `lightsprint add-label <taskId> <labelId>` to apply it to a task.
