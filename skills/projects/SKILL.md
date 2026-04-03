---
name: projects
description: List projects from the Lightsprint (ls) repo workspace. Use when you need to see available projects or find a project ID for filtering tasks.
---

Run this command to list projects from the Lightsprint workspace:

```bash
lightsprint projects $ARGUMENTS
```

Usage: `projects [--status active|completed|archived]`

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--status <status>` | all | Filter by project status: `active`, `completed`, or `archived`. |
| `--output json` | text | Return structured JSON instead of human-readable text. |

## Output

For each project shows: project number (e.g. `P-3`), name, status (if not active), and task counts.

JSON output includes: `id`, `name`, `color`, `projectNumber`, `status`, `taskCount` (total), `repoTaskCount` (tasks in this repo).

## Examples

```bash
lightsprint projects
lightsprint projects --status active
lightsprint projects --output json
```

## Invariants

- This is a read-only command — it does not modify any projects
- Use project IDs from the output with `lightsprint tasks --project <id>` to filter tasks by project
- Projects are workspace-scoped — they may contain tasks from multiple repos
- `repoTaskCount` shows how many tasks in the current repo belong to each project
