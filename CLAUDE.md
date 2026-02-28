# Lightsprint Claude Code Plugin

## Unified CLI Binary (`lightsprint`)
The `lightsprint` binary is the single entry point for all CLI functionality:
- `lightsprint review-plan [input]` — Plan review hook handler (invoked by Claude Code hooks)
- `lightsprint tasks|create|update|get|claim|comment|whoami|connect` — Task management commands (used by skills)
- Entry point: `scripts/lightsprint.js` → imports from `scripts/review-plan.js` and `scripts/ls-cli.js`

## ExitPlanMode Hook (Plan Review)
- **Event**: `PermissionRequest` with matcher `ExitPlanMode`
- **Command**: `lightsprint review-plan` (compiled binary installed to PATH)
- **Output format**: `{ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow"|"deny", message?: "..." } } }`
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
- `bun run deploy:tag` — Interactive semver tag + push to trigger GitHub Actions release
- CI/CD: `.github/workflows/release.yml` — Cross-platform binary compilation on tag push
