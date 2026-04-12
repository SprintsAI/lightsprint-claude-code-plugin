---
name: subtasks
description: List the subtasks (child tasks / dependencies) of a Lightsprint (ls) parent task. Use to see what prerequisite work is broken out under a parent task.
---

Run this command to list subtasks of a parent task:

```bash
lightsprint subtasks $ARGUMENTS
```

Usage: `subtasks <taskId>` or `subtasks --task <taskId>`

Both positional and flag syntax work: `lightsprint subtasks LIG-024` is the same as `lightsprint subtasks --task LIG-024`.

Task ID supports display IDs (e.g. `LIG-024`), bare numbers (e.g. `24`), or raw IDs.

Aliases: `children` resolves to `subtasks`.

## Output

For each subtask shows: display ID, status, assignee (if any), complexity (if set), and title.

JSON output includes: `parentTaskId`, `subtasks` array with `displayId`, `id`, `title`, `status`, `assignee`, `complexity`, and `totalCount`.

## Examples

```bash
lightsprint subtasks LIG-024
lightsprint subtasks --task LIG-024 --output json
lightsprint subtasks 24
```

## Invariants

- This is a read-only command — it does not modify any tasks
- Subtasks in Lightsprint are tasks linked as dependencies of a parent task
- Only tasks with no parent can be claimed (`lightsprint claim`) — subtasks must be worked via their parent
- To create a new subtask under a parent, use: `lightsprint create <title> --parent <parentTaskId>`
- To view full details of a subtask, use: `lightsprint get <subtaskId>`
- Use `lightsprint get <taskId>` on the parent to also see its `depends on` list
