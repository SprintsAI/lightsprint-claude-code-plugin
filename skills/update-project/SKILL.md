---
name: update-project
description: Update an existing Lightsprint (ls) project. Change its name, description, status, or color.
---

Run this command to update a project:

```bash
lightsprint update-project $ARGUMENTS
```

Usage: `update-project <projectId> [--name <text>] [--description <text>] [--status <status>] [--color <hex>]`

Both positional and flag syntax work: `lightsprint update-project proj-abc --status completed` is the same as `lightsprint update-project --project proj-abc --status completed`.

Use `lightsprint projects` to find project IDs.

Alias: `edit-project` also resolves to `update-project`.

## Flags

| Flag | Required | Description |
|------|----------|-------------|
| `--project <projectId>` | Yes | Project ID (alternative to positional). |
| `--name <text>` | No | New project name. Max 200 chars. |
| `--description <text>` | No | New description. Max 10000 chars. |
| `--status <status>` | No | New status: `active`, `completed`, or `archived`. |
| `--color <hex>` | No | New color hex code (e.g. `#FF5733`). |
| `--dry-run` | No | Validate inputs without calling the API. |
| `--output json` | No | Return structured JSON instead of human-readable text. |

## Examples

```bash
lightsprint update-project proj-abc123 --status completed
lightsprint update-project proj-abc123 --name "Q3 Roadmap" --color "#00CC99"
lightsprint update-project --project proj-abc123 --description "Updated scope"
```

## Invariants

- Always run `lightsprint projects` before updating to confirm the project ID and current state.
- At least one of `--name`, `--description`, `--status`, or `--color` is required.
- Setting `--status archived` hides the project from default listings (use `lightsprint projects --status archived` to see it).
- Updating a project does NOT move its tasks — task-project assignments are unchanged.
