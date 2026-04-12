---
name: members
description: List team members in the Lightsprint (ls) workspace. Use to find member IDs and names for task assignment.
---

Run this command to list team members in the workspace:

```bash
lightsprint members $ARGUMENTS
```

Usage: `members`

No arguments needed — returns all members in the workspace for the connected repo.

Aliases: `team` resolves to `members`.

## Output

For each member shows: ID, name, email (if available), and role (if set).

JSON output includes: `members` array with `id`, `name`, `email`, `role`, and `avatarUrl` fields.

## Examples

```bash
lightsprint members
lightsprint members --output json
```

## Invariants

- This is a read-only command — it does not modify any data
- Use member names from this output with `lightsprint update --assignee <name>` to assign tasks
- The `--assignee` filter in `lightsprint tasks` also accepts values from member names
- Members are workspace-scoped — all repos in the workspace share the same member list
