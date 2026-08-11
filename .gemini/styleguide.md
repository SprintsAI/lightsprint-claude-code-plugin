# Lightsprint Claude Code Plugin — Code Review Style Guide

Instructions for Gemini Code Assist when reviewing pull requests in this repo.

This repo is the **Lightsprint Claude Code plugin**: a Node.js/Bun CLI
(`scripts/ls-cli.js`, `scripts/lightsprint.js`), a background sync daemon
(`scripts/cc-daemon.js`) with Claude Code lifecycle hooks (`hooks/hooks.json`,
`scripts/cc-*.js`), and agent-facing skills (`skills/*/SKILL.md`). It syncs
Claude Code sessions and tasks to the Lightsprint board. Plain JavaScript (ESM),
no TypeScript, no bundler; tests run with `bun test`.

## How to review

- Focus on **correctness, security, input hardening, cross-platform behavior,
  and output-contract stability**. Prefer a few high-value comments over many
  nitpicks.
- **Respect existing patterns.** Shared helpers live in `scripts/lib/` (auth,
  client, config, connection, filelock, options, output, schema, sentry,
  status-mapper, task-map, validate). Flag new code that reimplements one of
  these instead of reusing it.
- **Do not duplicate CI.** `bun test` already gates PRs. There is no
  ESLint/Prettier — don't ask for formatting changes.
- Match severity to real impact. Reserve HIGH/CRITICAL for bugs, security
  issues, data loss/corruption, credential leaks, and breaking changes to
  agent-facing contracts.

## The prime directive: agents are the users

The CLI is consumed by AI agents (via the skills), not humans. Review against
the agent-friendly design principles in `CLAUDE.md`:

- **Structured output is a stable API contract.** Breaking changes to JSON
  output shapes, exit codes, or error formats break agent automation — flag
  them as HIGH unless the PR explicitly versions or migrates the contract.
- **Input hardening.** Agents hallucinate; the CLI is the last line of defense.
  Any value interpolated into a URL path or shell command must be validated
  (see `scripts/lib/validate.js`): reject `?`, `#`, `%`, `/`, `..`, and control
  characters in IDs; reject enum values outside the allowed set with an error
  naming the valid options.
- **Errors must be actionable.** Structured errors to stderr should include the
  failing input so the agent can construct a fix, not just a generic message.
- **Skills must stay in sync.** If a PR changes CLI flags, output, or behavior,
  the matching `skills/*/SKILL.md` (and `hooks/hooks.json` where relevant) must
  be updated in the same PR — stale skill docs cause agent hallucinations.

## Correctness (top priority)

- **Logic & edge cases.** Trace non-happy paths: `null`/`undefined`, empty
  arrays/strings, missing config keys, malformed JSON from the API or from
  hook stdin. Hook scripts receive untrusted JSON on stdin — parsing must not
  crash the hook.
- **Async & process lifecycle.** Flag missing `await`, unhandled rejections,
  and daemon shutdown paths that can leak the WebSocket, leave stale PID/lock
  files, or orphan the process. The daemon must degrade gracefully when the
  Lightsprint API is unreachable — hooks must never block or fail a user's
  Claude Code session because the board is down.
- **Concurrency & atomicity.** Config and state writes must go through the
  existing atomic-write/filelock helpers (`scripts/lib/config.js`,
  `scripts/lib/filelock.js`). Flag direct `fs.writeFileSync` to shared state,
  and races between the daemon and concurrently running hook scripts.
- **Cross-platform.** `install.sh`, `scripts/install.ps1`, and `npx-install.js`
  must stay behavior-equivalent. Flag hardcoded `/` path joins, POSIX-only
  shell in Node code, and anything that breaks on Windows.
- **Compatibility.** `package.json` declares `node >=18` and code also runs
  under Bun — flag APIs unavailable in either runtime.

## Security & privacy

- **Never log or report secrets.** API tokens (from config or env) must not
  appear in logs, error messages, or Sentry reports (`scripts/lib/sentry.js`
  scrubbing). Flag any new logging of config objects or request headers.
- **No command injection.** User- or API-derived strings must not be
  interpolated into `exec`/shell strings; prefer `execFile`/spawn with arg
  arrays.
- **Local files.** Config lives under `~/.lightsprint/` — flag world-readable
  writes of credentials or predictable temp-file usage.

## Tests

- New CLI behavior, validation rules, and daemon logic need matching tests in
  `scripts/__tests__/` (bun test). Flag logic changes that clearly lack
  coverage, especially around input validation and error paths.

## Simplicity & DRY

- Prefer the simplest solution that works; apply YAGNI. Flag premature
  abstractions, options nothing uses, and new dependencies where a small local
  helper (or an existing `scripts/lib/` module) suffices. The dependency
  footprint is deliberately tiny (only `@sentry/node`) — treat any new runtime
  dependency as MEDIUM+ and question it.
- A little duplication is better than the wrong abstraction — suggest
  extraction only when real duplicate call sites exist.
