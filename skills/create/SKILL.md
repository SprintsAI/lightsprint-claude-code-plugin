---
name: create
description: Create a new task on the Lightsprint (ls) repo board. Use to add work items directly from Claude Code.
---

Run this command to create a new Lightsprint task:

```bash
lightsprint create --cc-pid $PPID --title "$ARGUMENTS"
```

Usage: `create <title> [options]` or `create --title <text> [options]`

Both positional and flag syntax work: `lightsprint create "Fix login bug"` is the same as `lightsprint create --title "Fix login bug"`.

Aliases: `create-task`, `new`, `add` all resolve to `create`.

## Flags

| Flag | Required | Description |
|------|----------|-------------|
| `--title <text>` | Yes | Task title. Max 500 chars. |
| `--description <text>` | No | Task description. Supports multiline text. Max 50000 chars. |
| `--complexity <level>` | No | Complexity estimate: `low`, `medium`, or `high`. |
| `--status <status>` | No | Initial status: `backlog` (default), `todo`, `in_progress`, `in_review`, or `done`. |
| `--project <projectId>` | No | Assign to a project by ID. Use `lightsprint projects` to find project IDs. |
| `--depends-on <ids>` | No | Comma-separated list of task IDs this task depends on. Supports raw IDs, display IDs (e.g. `LIG-024`), or bare task numbers (e.g. `6`). All formats are resolved server-side. |
| `--parent <taskId>` | No | Parent task ID. Links the new task as a subtask (dependency) of the specified parent. Supports raw IDs and display IDs (e.g. `LS-1100`). |
| `--json-body <json>` | No | Raw JSON request body (replaces all other flags). Cannot combine with `--title` or other field flags. |
| `--dry-run` | No | Validate inputs without calling the API. |
| `--output json` | No | Return structured JSON instead of human-readable text. |

## Dependency vocabulary (IMPORTANT)

Lightsprint uses a specific dependency direction:
- A **parent task** **depends on** its listed dependencies.
- A **root task** is a **parent task with no parent**.
- Those **dependencies** are the **child tasks** (or **prerequisite tasks**) that must be done first.
- This is intentionally the inverse of some real-world phrasing where a child "depends on" a parent.

Equivalent terms used in docs or conversations:
- **depends on** = **blocked by** = **requires** = **has prerequisites**
- **dependency** = **prerequisite** = **child task** (in Lightsprint terminology)
- **dependent task** = **parent task** = **root task** = the task that waits

For `--depends-on <ids>` on `create`:
- The IDs are tasks that the new task will wait for.
- Example: `create "Ship feature" --depends-on LIG-024,LIG-031`
- Meaning: `"Ship feature"` is the parent/root task and is blocked by (depends on) `LIG-024` and `LIG-031`.

## Output

Returns the created task's title, ID, status, complexity, and description. Also prints the `metadata` snippet needed to link this task to a Claude Code task.

After creating, the task ID is returned. You can link it to a Claude Code task with:
- Use TaskCreate with `metadata: { lightsprint_task_id: "<the LS task ID>" }`
- This links the CC task to the LS task so future updates sync automatically
