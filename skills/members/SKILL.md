---
name: members
description: List workspace members in Lightsprint (ls). Use to find valid assignee names/emails before assigning tasks.
---

Run this command to list workspace members:

```bash
lightsprint members $ARGUMENTS
```

Usage: `members`

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--output json` | text | Return structured JSON instead of human-readable text. |

## Output

Returns a list of workspace members with: name, email, role, and ID.

```json
{
  "members": [
    { "id": "...", "name": "Alice Smith", "email": "alice@example.com", "role": "admin" },
    { "id": "...", "name": "Bob Jones", "email": "bob@example.com", "role": "member" }
  ],
  "totalCount": 2
}
```

## Examples

```bash
lightsprint members
lightsprint members --output json
```

## Invariants

- This is a read-only command — it does not modify any data
- Use member names (not IDs) when assigning tasks with `lightsprint update --assignee <name>`
- The `--assignee` flag on `lightsprint tasks` and `lightsprint update` accepts a name or email substring
- Always run `lightsprint members` before assigning a task to confirm the exact name/email
