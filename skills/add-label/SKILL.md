---
name: add-label
description: Add a label to a Lightsprint (ls) task. Use to categorize or tag a task with an existing label from the workspace.
---

Run this command to add a label to a task:

```bash
lightsprint add-label $ARGUMENTS
```

Usage: `add-label <taskId> <labelId>` or `add-label --task <taskId> --label <labelId>`

Both positional and flag syntax work.

Task ID supports display IDs (e.g. `LIG-024`), bare task numbers (e.g. `24`), or raw IDs.
Label ID must be a valid label ID from `lightsprint labels`.

## Examples

```bash
lightsprint add-label LIG-024 label-abc
lightsprint add-label --task LIG-024 --label label-abc --output json
```

## Invariants

- Use `lightsprint labels` to discover available label IDs first.
- If the label doesn't exist, create it with `lightsprint create-label --name <name>`.
- Adding a label that is already on the task may be a no-op (server-dependent).
- Use `lightsprint get <taskId>` to confirm the label was added.
