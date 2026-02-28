# Lightsprint Claude Code Plugin

## ExitPlanMode Hook (Plan Review)
- **Event**: `PermissionRequest` with matcher `ExitPlanMode`
- **Command**: `bash ${CLAUDE_PLUGIN_ROOT}/scripts/review-plan-wrapper.sh` (bash wrapper required — node can't read stdin directly from Claude Code hooks)
- **Output format**: `{ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow"|"deny", message?: "..." } } }`
- **Blocking**: Yes, intentionally blocks until user reviews in browser (like plannotator)
- **Plan content**: Available in `tool_input.plan` from stdin JSON

## Key Learnings
- **Hook stdin capture can stall**: In real `PermissionRequest` runs, `cat > tempfile` may hang or terminate before forwarding to Node even when payload is present. Prefer direct stdin passthrough in the wrapper and let `review-plan.js` parse stdin/file input.
- **Bun compiled binary**: Also hangs when invoked by Claude Code hooks (works fine from terminal). Use bash wrapper + node instead.
- **PermissionRequest vs PreToolUse**: Both work for ExitPlanMode. PermissionRequest is the canonical approach (same as plannotator).
- **PostToolUse does NOT fire for ExitPlanMode** — it's a special internal tool
- **Plugin cache**: Source files must be synced to `~/.claude/plugins/cache/lightsprint/lightsprint/<version>/` after changes during development
- **Plugin auto-discovery**: PermissionRequest hooks load from plugin hooks.json — no manual `~/.claude/settings.json` entry needed
- **Hook-only behavior differs from terminal repro**: Wrapper flows that work in terminal can still fail under Claude hook runtime. Validate fixes with real `ExitPlanMode` invocations and runtime logging.

## Debugging Workflow
- Reproduce in a real `ExitPlanMode` hook run (not only terminal replay), because hook runtime behavior differs from shell tests.
- Add short-lived instrumentation at clear boundaries: wrapper start, stdin read, runtime selection, script entry, browser open path.
- Use a single session log target and clear it before each run, so each attempt has isolated evidence.
- Evaluate each hypothesis with concrete runtime events (confirmed/rejected/inconclusive), then keep only proven fixes.
- Remove session-specific instrumentation after verification to keep scripts production clean.

## Scripts
- `scripts/review-plan.js` — Main hook handler. Reads plan from stdin, uploads to Lightsprint API, opens browser for review, waits for callback, returns allow/deny.
- `scripts/review-plan-wrapper.sh` — Bash wrapper that launches Node in hook context and forwards stdin reliably.
- `scripts/lib/config.js` — Config resolution. Uses `cwd` from hook stdin (not `process.cwd()`).
- `scripts/lib/client.js` — Lightsprint API client.
- `scripts/lib/plan-tracker.js` — Tracks active plan ID for versioning on resubmission.

## Build & Deploy
- `bun run build` — Compile binary with Bun (for distribution, not used in hooks)
- `bun run deploy:tag` — Interactive semver tag + push to trigger GitHub Actions release
- CI/CD: `.github/workflows/release.yml` — Cross-platform binary compilation on tag push
