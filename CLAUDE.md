# Lightsprint Claude Code Plugin

## ExitPlanMode Hook (Plan Review)
- **Event**: `PermissionRequest` with matcher `ExitPlanMode`
- **Command**: `bash ${CLAUDE_PLUGIN_ROOT}/scripts/review-plan-wrapper.sh` (bash wrapper required — node can't read stdin directly from Claude Code hooks)
- **Output format**: `{ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow"|"deny", message?: "..." } } }`
- **Blocking**: Yes, intentionally blocks until user reviews in browser (like plannotator)
- **Plan content**: Available in `tool_input.plan` from stdin JSON

## Key Learnings
- **Node.js stdin issue**: Node hangs reading stdin from Claude Code hooks. Fix: bash wrapper saves stdin to temp file with `cat`, then pipes to node via `< file`
- **Bun compiled binary**: Also hangs when invoked by Claude Code hooks (works fine from terminal). Use bash wrapper + node instead.
- **PermissionRequest vs PreToolUse**: Both work for ExitPlanMode. PermissionRequest is the canonical approach (same as plannotator). PermissionRequest only fires when permission dialog would appear (not in bypassPermissions mode).
- **PostToolUse does NOT fire for ExitPlanMode** — it's a special internal tool
- **Plugin cache**: Source files must be synced to `~/.claude/plugins/cache/lightsprint/lightsprint/<version>/` after changes during development
- **Plugin auto-discovery**: PermissionRequest hooks load from plugin hooks.json — no manual `~/.claude/settings.json` entry needed

## Scripts
- `scripts/review-plan.js` — Main hook handler. Reads plan from stdin, uploads to Lightsprint API, opens browser for review, waits for callback, returns allow/deny.
- `scripts/review-plan-wrapper.sh` — Bash wrapper that saves stdin to temp file then pipes to node (workaround for node stdin issue).
- `scripts/sync-task.js` — PostToolUse handler for TaskCreate/TaskUpdate/Task/TaskList/TaskGet. Syncs Claude Code tasks to Lightsprint.
- `scripts/lib/config.js` — Config resolution. Uses `cwd` from hook stdin (not `process.cwd()`).
- `scripts/lib/client.js` — Lightsprint API client.
- `scripts/lib/plan-tracker.js` — Tracks active plan ID for versioning on resubmission.

## Build & Deploy
- `bun run build` — Compile binary with Bun (for distribution, not used in hooks)
- `bun run deploy:tag` — Interactive semver tag + push to trigger GitHub Actions release
- CI/CD: `.github/workflows/release.yml` — Cross-platform binary compilation on tag push
