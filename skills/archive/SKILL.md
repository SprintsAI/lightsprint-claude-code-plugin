---
name: archive
description: Archive a Lightsprint (ls) task (soft delete — keeps it in history). Use when a task is no longer relevant but should be preserved for reference. Use `--unarchive` to restore it.
---

Run this command to archive a Lightsprint task:

```bash
lightsprint archive $ARGUMENTS
```

Usage: `archive <taskId> [--unarchive]` or `archive --task <taskId> [--unarchive]`

Both positional and flag syntax work: `lightsprint archive LIG-024` is the same as `lightsprint archive --task LIG-024`.

Task ID can be a display ID (e.g. `LIG-024`), bare task number (e.g. `24`), or raw ID. All formats are resolved server-side.

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--task <taskId>` | required | Task ID (alternative to positional). |
| `--unarchive` | — | Restore a previously archived task back to active status. |
| `--dry-run` | — | Validate inputs without making API calls. |
| `--output json` | text | Return structured JSON instead of human-readable text. |

## Archive vs Delete

| | Archive | Delete |
|---|---------|--------|
| Task removed from active board | ✓ | ✓ |
| Task preserved in history | ✓ | ✗ |
| Recoverable | ✓ (via `--unarchive`) | ✗ |
| Use when | Task obsolete but worth keeping | Task was a mistake |

**Prefer `archive` over `delete`** when the task represents real work that was done or cancelled — it keeps the history intact.

## Examples

```bash
# Archive a task
lightsprint archive LIG-024

# Restore an archived task
lightsprint archive LIG-024 --unarchive

# Dry run (validate without changing)
lightsprint archive LIG-024 --dry-run

# With explicit flag
lightsprint archive --task LIG-024
```

## Output

```json
{
  "success": true,
  "action": "archive",
  "taskId": "...",
  "title": "Fix login bug",
  "archived": true
}
```

## Invariants

- **Prefer `archive` over `delete`** for obsolete tasks — deletion is permanent and irreversible
- Always confirm the task ID with `lightsprint get <taskId>` before archiving
- Archived tasks do not appear in `lightsprint tasks` results by default
- Use `--unarchive` to restore a task if it was archived by mistake
