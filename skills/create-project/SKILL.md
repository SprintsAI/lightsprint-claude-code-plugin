---
name: create-project
description: Create a new project in the Lightsprint (ls) repo workspace. Use to organize tasks into a named initiative or milestone.
---

Run this command to create a project:

```bash
lightsprint create-project $ARGUMENTS
```

Usage: `create-project --name <name> [--description <text>] [--color <hex>]`

Alias: `new-project` also resolves to `create-project`.

## Flags

| Flag | Required | Description |
|------|----------|-------------|
| `--name <text>` | Yes | Project name. Max 200 chars. Also accepts positional argument. |
| `--description <text>` | No | Project description. Max 10000 chars. |
| `--color <hex>` | No | Color hex code for the project (e.g. `#FF5733`). |
| `--dry-run` | No | Validate inputs without calling the API. |
| `--output json` | No | Return structured JSON instead of human-readable text. |

## Output

Returns the created project's `id`, `name`, `color`, `projectNumber`, and `status`.
Use the returned `id` to assign tasks to this project via `lightsprint create --project <id>` or `lightsprint update --project <id>`.

## Examples

```bash
lightsprint create-project --name "Q2 Roadmap"
lightsprint create-project --name "Auth Redesign" --description "Full auth overhaul" --color "#5B8FF9"
lightsprint create-project --name "Sprint 12" --output json
```

## Invariants

- Use `lightsprint projects` to verify the project was created and get its ID.
- After creating, assign tasks with `lightsprint create <title> --project <projectId>` or `lightsprint update <taskId> --project <projectId>`.
- Color must be a 6-digit hex code starting with `#` (e.g. `#FF5733`).
