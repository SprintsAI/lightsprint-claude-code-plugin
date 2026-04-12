# Lightsprint Claude Code Plugin

## Key Learnings
- **PermissionRequest vs PreToolUse**: Both work for ExitPlanMode. PermissionRequest is the canonical approach (same as plannotator).
- **PostToolUse does NOT fire for ExitPlanMode** — it's a special internal tool
- **Plugin cache**: Source files must be synced to `~/.claude/plugins/cache/lightsprint/lightsprint/<version>/` after changes during development
- **Plugin auto-discovery**: PermissionRequest hooks load from plugin hooks.json — no manual `~/.claude/settings.json` entry needed

## Debugging Workflow
- tail -f ~/.lightsprint/daemon.log ~/.lightsprint/sync.log

## Available Skills (Commands)

### Core Task Management
- `tasks` — list tasks with filtering (status, assignee, project, deps, complexity)
- `get` — get full task details (title, description, todo list, dependencies, files)
- `create` — create a new task
- `update` — update an existing task (now supports `--add-label` / `--remove-label`)
- `claim` — claim a task (sets in_progress, links CC session)
- `comment` — add a comment to a task
- `delete` — permanently delete a task

### Search & Discovery (Linear MCP parity, added 2024)
- `search` — full-text search across task titles and descriptions
- `members` — list workspace members (for finding valid assignee names)
- `labels` — list available labels (required before using `update --add-label`)

### Task Details
- `comments` — list all comments on a task (read-only; use `comment` to add)
- `subtasks` — list subtasks (child tasks) of a parent task

### Task Lifecycle (Linear MCP parity, added 2024)
- `archive` — soft-archive a task (preserves history; use `--unarchive` to restore)
- `duplicate` — duplicate/clone a task with optional title/status/project overrides

### Projects & Plans
- `projects` — list projects in the workspace
- `create-plan` — create a plan from markdown content

### PR & Review
- `link-pr` — link a GitHub PR to a task
- `unlink-pr` — remove a linked PR
- `merge` — merge the linked PR
- `review-hub signals` — get PR signals (CI, reviews, comments)
- `review-hub scores` — get AI readiness analysis for a PR

### Session & Agent
- `current-task` — get the task linked to the current CC session
- `agent-settings` — show cloud agent provider configuration
- `agent-create-pr` — create a PR from a cloud agent's working branch

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
- **Label IDs**: Validate with `validateId()` before sending to label endpoints.
- Add validation helpers (e.g., `validateTaskId`, `validateEnum`) in a shared `scripts/lib/validate.js` module.

### 3. Support Raw JSON Payloads (Priority: Medium)
- For `create` and `update`, support a `--json '{...}'` flag that accepts the full request body directly. Bespoke flags (`--title`, `--description`, `--status`) are lossy and can't express nested structures. Keep the convenience flags for humans, but make raw JSON a first-class path.

### 4. Dry-Run for Mutating Operations (Priority: Medium)
- `create`, `update`, `claim`, `comment`, `archive`, and `duplicate` support `--dry-run` that validates inputs locally and shows what *would* happen without hitting the API. This lets agents "think out loud" before acting.

### 5. Schema Introspection (Priority: Medium)
- Add a `lightsprint describe <command>` subcommand that dumps the accepted parameters, types, required fields, and valid enum values as JSON. Agents can self-serve at runtime instead of relying on stale documentation baked into skill prompts.
- Example: `lightsprint describe search` → shows query params, filters, etc.
- All new commands (`search`, `members`, `labels`, `comments`, `subtasks`, `archive`, `duplicate`) are registered in `scripts/lib/schema.js`.

### 6. Context Window Discipline (Priority: Medium)
- `lightsprint get` and `lightsprint tasks` return everything. Support `--fields <field1,field2>` to let agents request only what they need.
- `lightsprint tasks` supports `--page-all` for NDJSON streaming.
- `lightsprint search` provides targeted lookup when `tasks` returns too many results.

### 7. Skill Files Encode Invariants (Priority: Low)
- The skill `.md` files under `skills/` are the agent's only documentation. They must encode invariants that agents can't intuit from `--help`:
  - "Always use `lightsprint get <taskId>` before `lightsprint update` to confirm current state"
  - "Prefer `lightsprint claim` over `lightsprint update --status in_progress` — claim also returns full task details"
  - "Keep comment bodies under 2000 characters"
  - "Always run `lightsprint labels` before using `--add-label` — label IDs are required, not names"
  - "Prefer `lightsprint archive` over `lightsprint delete` for obsolete tasks — archive is reversible"
- Update skill files whenever CLI behavior changes — stale skills cause hallucinations.

## Linear MCP Feature Parity (2024)

The following skills were added to achieve parity with the Linear MCP server:

| New Skill | Maps to Linear MCP |
|-----------|-------------------|
| `search` | `linear_searchIssues` |
| `members` | `linear_getUsers` |
| `labels` | `linear_getLabels` |
| `comments` | `linear_getComments` |
| `subtasks` | Sub-issue listing |
| `archive` | `linear_archiveIssue` |
| `duplicate` | `linear_duplicateIssue` |
| `update --add-label` / `--remove-label` | `linear_addIssueLabel` / `linear_removeIssueLabel` |

### API Endpoints Added

| Skill | Endpoint |
|-------|---------|
| `search` | `GET /api/repos/{repoId}/tasks/search?q=<query>` |
| `members` | `GET /api/repos/{repoId}/members` |
| `labels` | `GET /api/repos/{repoId}/labels` |
| `comments` (list) | `GET /api/repos/{repoId}/tasks/{taskId}/comments` |
| `subtasks` | `GET /api/repos/{repoId}/tasks/{taskId}/subtasks` |
| `archive` | `POST /api/repos/{repoId}/tasks/{taskId}/archive` |
| `archive --unarchive` | `POST /api/repos/{repoId}/tasks/{taskId}/unarchive` |
| `duplicate` | `POST /api/repos/{repoId}/tasks/{taskId}/duplicate` |
| `update --add-label` | `POST /api/repos/{repoId}/tasks/{taskId}/labels` |
| `update --remove-label` | `DELETE /api/repos/{repoId}/tasks/{taskId}/labels/{labelId}` |
