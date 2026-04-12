---
name: members
description: List all members (users) in the Lightsprint (ls) repo workspace. Use to discover valid assignee names/IDs before assigning tasks.
---

Run this command to list workspace members:

```bash
lightsprint members
```

Aliases: `team`, `team-members` also resolve to `members`.

## Output

Returns a list of members with:
- `id` — user ID
- `name` — display name
- `email` — email address
- `role` — workspace role (e.g. `admin`, `member`)
- `avatarUrl` — avatar image URL (if available)

## Examples

```bash
lightsprint members
lightsprint members --output json
```

## Invariants

- This is a read-only command — it does not modify any users or assignments.
- Use member names (not IDs) when assigning tasks via `lightsprint update <taskId> --assignee <name>`.
- Use `lightsprint whoami` to see the current authenticated user.
