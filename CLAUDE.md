# Lightsprint Claude Code Plugin

## Unified CLI Binary (`lightsprint`)
The `lightsprint` binary is the single entry point for all CLI functionality:
- `lightsprint review-plan [input]` — Plan review hook handler (invoked by Claude Code hooks)
- `lightsprint tasks|create|update|get|claim|comment|whoami|connect` — Task management commands (used by skills)
- Entry point: `scripts/lightsprint.js` → imports from `scripts/review-plan.js` and `scripts/ls-cli.js`

## ExitPlanMode Hook (Plan Review)
- **Event**: `PermissionRequest` with matcher `ExitPlanMode`
- **Command**: `lightsprint review-plan` (compiled binary installed to PATH)
- **Output format**: `{ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow"|"deny", message?: "..." } } }` — allow never includes reviewer context (updatedInput not supported for allow)
- **Blocking**: Yes, intentionally blocks until user reviews in browser (like plannotator)
- **Plan content**: Available in `tool_input.plan` from stdin JSON

## Key Learnings
- **PermissionRequest vs PreToolUse**: Both work for ExitPlanMode. PermissionRequest is the canonical approach (same as plannotator).
- **PostToolUse does NOT fire for ExitPlanMode** — it's a special internal tool
- **Plugin cache**: Source files must be synced to `~/.claude/plugins/cache/lightsprint/lightsprint/<version>/` after changes during development
- **Plugin auto-discovery**: PermissionRequest hooks load from plugin hooks.json — no manual `~/.claude/settings.json` entry needed

## Debugging Workflow
- Reproduce in a real `ExitPlanMode` hook run (not only terminal replay), because hook runtime behavior differs from shell tests.
- Use a single session log target and clear it before each run, so each attempt has isolated evidence.
- Evaluate each hypothesis with concrete runtime events (confirmed/rejected/inconclusive), then keep only proven fixes.
- Remove session-specific instrumentation after verification to keep scripts production clean.

## Scripts
- `scripts/lightsprint.js` — Unified CLI entry point. Routes subcommands to review-plan or CLI handlers.
- `scripts/review-plan.js` — Plan review handler. Exports `reviewPlanMain(args)`.
- `scripts/ls-cli.js` — Task management commands. Exports `cliMain(command, args)`.
- `scripts/lib/config.js` — Config resolution. Uses `cwd` from hook stdin (not `process.cwd()`).
- `scripts/lib/client.js` — Lightsprint API client.
- `scripts/lib/plan-tracker.js` — Tracks active plan ID for versioning on resubmission.

## Install Scripts
- `install.sh` (macOS/Linux) and `scripts/install.ps1` (Windows) must stay in parity. When changing one, always update the other to match.
- `install.ps1` is production-only — no local dev mode (`LIGHTSPRINT_LOCAL_PATH`).

## Build & Deploy
- `bun run build` — Compile `lightsprint` binary with Bun via `scripts/compile.sh`
- `bun run deploy:tag` — Bumps version, commits, then tags the bump commit + pushes to trigger GitHub Actions release
- CI/CD: `.github/workflows/release.yml` — Cross-platform binary compilation on tag push

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
- Example: `lightsprint describe create` → `{"command":"create","params":{"title":{"type":"string","required":true},"status":{"type":"enum","values":["todo","in_progress","in_review","done"],"default":"todo"},...}}`

### 6. Context Window Discipline (Priority: Medium)
- `lightsprint get` and `lightsprint tasks` return everything. Support `--fields <field1,field2>` to let agents request only what they need. A full task with description, todo list, related files, and comments can consume significant context window budget.
- `lightsprint tasks` should support pagination-aware streaming (e.g., NDJSON with `--page-all`) so agents can process incrementally.

### 7. Skill Files Encode Invariants (Priority: Low)
- The skill `.md` files under `skills/` are the agent's only documentation. They must encode invariants that agents can't intuit from `--help`:
  - "Always use `lightsprint get <taskId>` before `lightsprint update` to confirm current state"
  - "Prefer `lightsprint claim` over `lightsprint update --status in_progress` — claim also returns full task details"
  - "Keep comment bodies under 2000 characters"
- Update skill files whenever CLI behavior changes — stale skills cause hallucinations.
