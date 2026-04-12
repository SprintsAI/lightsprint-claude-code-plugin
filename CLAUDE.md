# Lightsprint Claude Code Plugin

## Key Learnings
- **PermissionRequest vs PreToolUse**: Both work for ExitPlanMode. PermissionRequest is the canonical approach (same as plannotator).
- **PostToolUse does NOT fire for ExitPlanMode** — it's a special internal tool
- **Plugin cache**: Source files must be synced to `~/.claude/plugins/cache/lightsprint/lightsprint/<version>/` after changes during development
- **Plugin auto-discovery**: PermissionRequest hooks load from plugin hooks.json — no manual `~/.claude/settings.json` entry needed

## Debugging Workflow
- tail -f ~/.lightsprint/daemon.log ~/.lightsprint/sync.log

## Agent-Friendly CLI Design Principles
The `lightsprint` CLI is primarily consumed by AI agents (via skills), not humans typing in a terminal. Design every command, flag, and output byte with that in mind. Reference: [Rewrite Your CLI for AI Agents](https://justin.poehnelt.com/posts/rewrite-your-cli-for-ai-agents/) by Justin Poehnelt.

### 1. Machine-Readable Output (Priority: High)
- **All commands should support `--output json`** (or default to JSON when stdout is not a TTY). Currently `cmdTasks`, `cmdGet`, `cmdCreate`, `cmdUpdate`, `cmdClaim`, `cmdComment`, and `cmdWhoami` in `scripts/ls-cli.js` emit human-formatted text that agents must parse with brittle string matching.
- Errors should also be structured JSON to stderr: `{"error": "not_found", "message": "Task abc123 not found", "taskId": "abc123"}`. Include the failing input so the agent can construct a fix.
- Treat output format as a stable API contract — breaking changes to structured output break all agent automation.

### 2. Input Hardening Against Hallucinations (Priority: High)
- **Agents hallucinate. Build like it.** The CLI is the last line of defense.
- **Task IDs**: Validate before interpolating into URL paths. Reject `?`, `#`, `%`, `/`, `..`, and control characters. An agent may embed query params inside an ID (`taskId?fields=name`) or hallucinate path traversals.
- **Status/complexity enums**: Reject values outside the allowed set with a clear error naming the valid options, rather than passing garbage to the API.
- **Control characters**: Reject any input containing characters below ASCII 0x20 (except newlines in description bodies).
- **Comment bodies / descriptions**: Sanitize or length-limit to prevent accidentally blowing up API payloads.
- Add validation helpers (e.g., `validateTaskId`, `validateEnum`) in a shared `scripts/lib/validate.js` module.

### 3. Support Raw JSON Payloads (Priority: Medium)
- For `create` and `update`, support a `--json '{...}'` flag that accepts the full request body directly. Bespoke flags (`--title`, `--description`, `--status`) are lossy and can't express nested structures. Keep the convenience flags for humans, but make raw JSON a first-class path.

### 4. Dry-Run for Mutating Operations (Priority: Medium)
- `create`, `update`, `claim`, and `comment` should support `--dry-run` that validates inputs locally and shows what *would* happen without hitting the API. This lets agents "think out loud" before acting — especially important because a hallucinated parameter means data corruption, not just a bad error message.

### 5. Schema Introspection (Priority: Medium)
- Add a `lightsprint describe <command>` subcommand that dumps the accepted parameters, types, required fields, and valid enum values as JSON. Agents can self-serve at runtime instead of relying on stale documentation baked into skill prompts.
- Example: `lightsprint describe create` → `{"command":"create","params":{"title":{"type":"string","required":true},"status":{"type":"enum","values":["backlog","todo","in_progress","in_review","done"],"default":"backlog"},...}}`

### 6. Context Window Discipline (Priority: Medium)
- `lightsprint get` and `lightsprint tasks` return everything. Support `--fields <field1,field2>` to let agents request only what they need. A full task with description, todo list, related files, and comments can consume significant context window budget.
- `lightsprint tasks` should support pagination-aware streaming (e.g., NDJSON with `--page-all`) so agents can process incrementally.

### 7. Skill Files Encode Invariants (Priority: Low)
- The skill `.md` files under `skills/` are the agent's only documentation. They must encode invariants that agents can't intuit from `--help`:
  - "Always use `lightsprint get <taskId>` before `lightsprint update` to confirm current state"
  - "Prefer `lightsprint claim` over `lightsprint update --status in_progress` — claim also returns full task details"
  - "Keep comment bodies under 10,000 characters"
- Update skill files whenever CLI behavior changes — stale skills cause hallucinations.

---

## Linear MCP Feature Parity Audit

### Gap Analysis (completed 2026-04-12)

| Capability | Linear MCP | Lightsprint (before) | Lightsprint (after) |
|---|---|---|---|
| List issues/tasks | ✅ `list_issues` | ✅ `tasks` | ✅ |
| Get issue/task | ✅ `get_issue` | ✅ `get` | ✅ |
| Create issue/task | ✅ `create_issue` | ✅ `create` | ✅ |
| Update issue/task | ✅ `update_issue` | ✅ `update` | ✅ |
| Delete issue/task | ✅ `delete_issue` | ✅ `delete` | ✅ |
| Search issues/tasks | ✅ `search_issues` | ❌ missing | ✅ `search` |
| List labels | ✅ `list_labels` | ❌ missing | ✅ `labels` |
| Add/remove labels | ✅ via `update_issue` | ❌ missing | ✅ `label add/remove` |
| List users/members | ✅ `list_users` | ❌ missing | ✅ `members` |
| List comments | ✅ `list_comments` | ❌ missing | ✅ `comments` |
| Create comment | ✅ `create_comment` | ✅ `comment` | ✅ |
| Update comment | ✅ `update_comment` | ❌ missing | ✅ `comment --update` |
| Delete comment | ✅ `delete_comment` | ❌ missing | ✅ `comment --delete` |
| List subtasks | ✅ via issue children | ❌ missing | ✅ `subtasks` |
| List projects | ✅ `list_projects` | ✅ `projects` | ✅ |
| Status transitions | ✅ via `update_issue` | ✅ via `update` | ✅ |
| Assignee management | ✅ via `update_issue` | ✅ via `update` | ✅ |
| Dependencies/relations | ✅ `create_relation` | ✅ `--add-dep/--remove-dep` | ✅ |
| PR linking | N/A | ✅ `link-pr/unlink-pr` | ✅ |
| PR merge | N/A | ✅ `merge` | ✅ |
| PR review signals | N/A | ✅ `review-hub signals` | ✅ |
| AI readiness scores | N/A | ✅ `review-hub scores` | ✅ |
| Cloud agents | N/A | ✅ `agent launch/stop/create-pr` | ✅ |

### New Commands Added
- **`search <query>`** — Full-text search across tasks. Aliases: `find`.
- **`labels`** — List all workspace labels. Aliases: `tags`.
- **`label add <taskId> --label <labelId>`** — Add a label to a task.
- **`label remove <taskId> --label <labelId>`** — Remove a label from a task.
- **`members`** — List workspace team members. Aliases: `team`.
- **`comments <taskId>`** — List all comments on a task.
- **`comment --update <commentId> --body <text>`** — Update an existing comment.
- **`comment --delete <commentId>`** — Delete a comment.
- **`subtasks <taskId>`** — List subtasks of a parent task. Aliases: `children`.

### API Endpoints Added (new)
- `GET /api/repos/${repoId}/tasks/search` — Full-text task search
- `GET /api/repos/${repoId}/labels` — List workspace labels
- `POST /api/tasks/${taskId}/labels` — Add label to task
- `DELETE /api/tasks/${taskId}/labels/${labelId}` — Remove label from task
- `GET /api/repos/${repoId}/members` — List workspace members
- `GET /api/tasks/${taskId}/comments` — List comments on task
- `PATCH /api/comments/${commentId}` — Update a comment
- `DELETE /api/comments/${commentId}` — Delete a comment
- `GET /api/tasks/${taskId}/subtasks` — List subtasks of task
