---
name: projects
description: List or create projects (project tags) in the Lightsprint (ls) repo workspace. Use when you need to see available projects, find a project ID for filtering tasks, or create a new project tag.
---

Run this command to list projects from the Lightsprint workspace:

```bash
lightsprint projects $ARGUMENTS
```

Usage:
- List: `projects [--status active|completed|archived]`
- Create: `projects create <name> [--color <hex>] [--status active|completed|archived]`

## List flags

| Flag | Default | Description |
|------|---------|-------------|
| `--status <status>` | all | Filter by project status: `active`, `completed`, or `archived`. |
| `--output json` | text | Return structured JSON instead of human-readable text. |

## Create flags

| Flag | Required | Description |
|------|----------|-------------|
| `--name <text>` | Yes | Project name (or pass positionally). Max 200 chars. |
| `--color <hex>` | No | Hex color like `#FF9D00` or `#F90`. |
| `--status <status>` | No | Initial status: `active` (default), `completed`, or `archived`. |
| `--json-body <json>` | No | Raw JSON request body (replaces individual flags). |
| `--dry-run` | No | Validate inputs without calling the API. |
| `--output json` | No | Return structured JSON instead of human-readable text. |

## Output

For each project shows: project number (e.g. `P-3`), name, status (if not active), and task counts.

JSON output (list) includes: `id`, `name`, `color`, `projectNumber`, `status`, `taskCount` (total), `repoTaskCount` (tasks in this repo).

JSON output (create) returns: `{ project: { id, name, color, projectNumber, status } }`.

## Examples

```bash
lightsprint projects
lightsprint projects --status active
lightsprint projects --output json

lightsprint projects create "Auth refactor"
lightsprint projects create "Auth refactor" --color "#FF9D00"
lightsprint projects create --name "Auth refactor" --status active --output json
lightsprint projects create "Auth refactor" --dry-run
```

## Invariants

- `projects` (list) is read-only — `projects create` is the mutating command
- Projects are workspace-scoped — they may contain tasks from multiple repos
- Use project IDs from the output with `lightsprint tasks --project <id>` to filter tasks by project
- `repoTaskCount` shows how many tasks in the current repo belong to each project
- After creating a project, assign tasks to it via `lightsprint create --project <id>` or `lightsprint update <taskId> --project <id>`
