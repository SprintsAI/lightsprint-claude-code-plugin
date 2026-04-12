---
name: delete-label
description: Delete a label permanently from the Lightsprint (ls) workspace. Use when a label is no longer needed or was created by mistake.
---

Run this command to delete a label:

```bash
lightsprint delete-label $ARGUMENTS
```

Usage: `delete-label <labelId>` or `delete-label --label <labelId>`

Both positional and flag syntax work. Use `lightsprint labels` to find label IDs.

## Invariants

- **This action is permanent and cannot be undone.**
- Deleting a label removes it from all tasks that had it applied.
- Always run `lightsprint labels` first to confirm the label ID before deleting.
- Prefer updating a label (via `update-label`) over deleting and recreating if you just want to rename or recolor.

## Examples

```bash
lightsprint delete-label label-abc
lightsprint delete-label --label label-abc
```
