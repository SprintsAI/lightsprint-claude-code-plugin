---
name: stack
description: Manage Lightsprint stacks — the unit of execution that task creation targets. Use to list, create, and select the stack that `lightsprint create` writes to.
---

A **stack** is a group of one or more repositories in a workspace and is the unit
of execution Lightsprint now creates tasks against. Repo-scoped task creation is
retired server-side, so every new task belongs to a stack.

`lightsprint create` resolves which stack to use in this order:

1. `--stack <stackId>` flag (per-command override)
2. the persisted **current stack** (`lightsprint stack use`)
3. the **workspace default stack** (when nothing is selected)

## Commands

```bash
lightsprint stack list                  # List stacks in the workspace (+ member repo IDs)
lightsprint stack create --name "Web" --task-prefix WEB --repos repo1,repo2
lightsprint stack use <stackId>         # Persist the current stack for task creation
lightsprint stack current               # Show the persisted current stack
lightsprint stack clear                 # Unset the current stack (fall back to workspace default)
```

### `stack list`

Returns every stack in the connected workspace. Each stack includes `id`, `name`,
`taskPrefix`, `description`, `color`, and `memberRepoIds`. The persisted current
stack is marked with `*` in text output and surfaced as `currentStack` in JSON.

### `stack create`

| Flag | Required | Description |
|------|----------|-------------|
| `--name <name>` | Yes | Stack name. Max 80 chars. |
| `--task-prefix <PREFIX>` | Yes | Uppercase alphanumeric, starts with a letter, ≤12 chars (e.g. `LIG`). Must be unique in the workspace. |
| `--repos <r1,r2,...>` | Yes | 1–10 repo IDs. All repos must be in the workspace and share one GitHub org. |
| `--description <text>` | No | Optional description. Max 500 chars. |
| `--color #RRGGBB` | No | Optional hex color. |

### `stack use` / `stack current` / `stack clear`

`stack use` verifies the stack exists in the workspace before persisting it to
`~/.lightsprint/preferences.json` (key `current-stack`). `stack clear` removes it.

## Invariants (IMPORTANT)

- **Always select a stack before bulk task creation**, or pass `--stack` per call.
  If nothing is selected, tasks land on the workspace default stack — confirm that
  is intended with `lightsprint stack current`.
- **`taskPrefix` must match `^[A-Z][A-Z0-9]*$`** and be ≤12 chars. The CLI validates
  this locally before calling the API.
- Use `lightsprint stack list` to discover valid stack IDs and repo IDs rather than
  guessing — hallucinated IDs are rejected by `stack use` and the server.

## Output

All subcommands support `--output json`. `stack create` and `stack use` support
`--dry-run` to validate inputs without calling the API. Run
`lightsprint describe stack create` for the full machine-readable parameter schema.
