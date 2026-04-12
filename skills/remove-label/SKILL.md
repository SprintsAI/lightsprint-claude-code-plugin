---
name: remove-label
description: Remove a label from a Lightsprint (ls) task. Use to detach a label that no longer applies.
---

Run this command to remove a label from a task:

```bash
lightsprint remove-label $ARGUMENTS
```

Usage: `remove-label <taskId> <labelId>` or `remove-label --task <taskId> --label <labelId>`

Both positional and flag syntax work.

Task ID supports display IDs (e.g. `LIG-024`), bare task numbers (e.g. `24`), or raw IDs.
Label ID must be a valid label ID (use `lightsprint labels` or `lightsprint get <taskId>` to find).

## Examples

```bash
lightsprint remove-label LIG-024 label-abc
lightsprint remove-label --task LIG-024 --label label-abc --output json
```

## Invariants

- This removes the label from the task only, not from the workspace. The label itself still exists.
- To permanently delete a label from the workspace, use `lightsprint delete-label <labelId>`.
- Use `lightsprint get <taskId>` to confirm the label was removed.
