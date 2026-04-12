# Lightsprint Claude Code Plugin

## Key Learnings
- **PermissionRequest vs PreToolUse**: Both work for ExitPlanMode. PermissionRequest is the canonical approach (same as plannotator).
- **PostToolUse does NOT fire for ExitPlanMode** — it's a special internal tool
- **Plugin cache**: Source files must be synced to `~/.claude/plugins/cache/lightsprint/lightsprint/<version>/` after changes during development
- **Plugin auto-discovery**: PermissionRequest hooks load from plugin hooks.json — no manual `~/.claude/settings.json` entry needed

## Debugging Workflow
- tail -f ~/.lightsprint/daemon.log ~/.lightsprint/sync.log

## Linear MCP Gap Analysis & Feature Parity

The following table maps Linear MCP capabilities to Lightsprint plugin skills. All gaps have been addressed.

| Linear MCP Tool | Lightsprint Command | Status |
|---|---|---|
| `linear_create_issue` | `lightsprint create` | ✅ Existing |
| `linear_update_issue` | `lightsprint update` | ✅ Existing |
| `linear_get_issue` | `lightsprint get` | ✅ Existing |
| `linear_search_issues` | `lightsprint search` | ✅ Added |
| `linear_get_team_issues` | `lightsprint tasks` | ✅ Existing |
| `linear_create_comment` | `lightsprint comment` | ✅ Existing |
| `linear_get_issue_comments` | `lightsprint list-comments` | ✅ Added |
| `linear_get_labels` | `lightsprint labels` | ✅ Added |
| `linear_create_label` | `lightsprint create-label` | ✅ Added |
| `linear_update_label` | `lightsprint update-label` | ✅ Added |
| `linear_delete_label` (implied) | `lightsprint delete-label` | ✅ Added |
| `linear_add_label_to_issue` | `lightsprint add-label` | ✅ Added |
| `linear_remove_label_from_issue` | `lightsprint remove-label` | ✅ Added |
| `linear_get_viewer` | `lightsprint whoami` | ✅ Existing |
| `linear_get_teams` / members | `lightsprint members` | ✅ Added |
| `linear_get_projects` | `lightsprint projects` | ✅ Existing |
| `linear_create_project` | `lightsprint create-project` | ✅ Added |
| `linear_update_project` | `lightsprint update-project` | ✅ Added |
| `linear_create_relation` | `lightsprint relate` | ✅ Added |
| `linear_delete_relation` | `lightsprint unrelate` | ✅ Added |
| `linear_get_issue_relations` | `lightsprint relations` | ✅ Added |

### New command patterns added
- **`search`** — `GET /api/repos/${repoId}/tasks/search?q=<query>` with optional status/project/assignee filters
- **`list-comments`** — `GET /api/tasks/${taskId}/comments` (reading existing comments endpoint)
- **`labels`** — `GET /api/repos/${repoId}/labels`
- **`create-label`** — `POST /api/repos/${repoId}/labels`
- **`update-label`** — `PATCH /api/labels/${labelId}`
- **`delete-label`** — `DELETE /api/labels/${labelId}`
- **`add-label`** — `POST /api/tasks/${taskId}/labels`
- **`remove-label`** — `DELETE /api/tasks/${taskId}/labels/${labelId}`
- **`members`** — `GET /api/repos/${repoId}/members`
- **`relate`** — `POST /api/tasks/${taskId}/relations`
- **`unrelate`** — `DELETE /api/tasks/${taskId}/relations/${relationId}`
- **`relations`** — `GET /api/tasks/${taskId}/relations`
- **`create-project`** — `POST /api/repos/${repoId}/projects`
- **`update-project`** — `PATCH /api/repos/projects/${projectId}`

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
- `create`, `update`, `claim`, `comment`, `create-project`, `update-project`, `create-label`, `update-label`, `delete-label`, `add-label`, `remove-label`, `relate`, and `unrelate` all support `--dry-run` that validates inputs locally and shows what *would* happen without hitting the API. This lets agents "think out loud" before acting — especially important because a hallucinated parameter means data corruption, not just a bad error message.

### 5. Schema Introspection (Priority: Medium)
- Add a `lightsprint describe <command>` subcommand that dumps the accepted parameters, types, required fields, and valid enum values as JSON. Agents can self-serve at runtime instead of relying on stale documentation baked into skill prompts.
- Example: `lightsprint describe create` → `{"command":"create","params":{"title":{"type":"string","required":true},"status":{"type":"enum","values":["backlog","todo","in_progress","in_review","done"],"default":"backlog"},...}}`
- All new commands (`search`, `list-comments`, `labels`, `create-label`, `update-label`, `delete-label`, `add-label`, `remove-label`, `members`, `relate`, `unrelate`, `relations`, `create-project`, `update-project`) are fully registered in `scripts/lib/schema.js`.

### 6. Context Window Discipline (Priority: Medium)
- `lightsprint get` and `lightsprint tasks` return everything. Support `--fields <field1,field2>` to let agents request only what they need. A full task with description, todo list, related files, and comments can consume significant context window budget.
- `lightsprint tasks` should support pagination-aware streaming (e.g., NDJSON with `--page-all`) so agents can process incrementally.

### 7. Skill Files Encode Invariants (Priority: Low)
- The skill `.md` files under `skills/` are the agent's only documentation. They must encode invariants that agents can't intuit from `--help`:
  - "Always use `lightsprint get <taskId>` before `lightsprint update` to confirm current state"
  - "Prefer `lightsprint claim` over `lightsprint update --status in_progress` — claim also returns full task details"
  - "Keep comment bodies under 2000 characters"
  - "Relations (`relate`) are directional — `blocking` means source blocks target"
  - "Use `lightsprint labels` to discover label IDs before calling `add-label` or `remove-label`"
  - "Use `lightsprint relations` to get relation IDs before calling `unrelate`"
- Update skill files whenever CLI behavior changes — stale skills cause hallucinations.
