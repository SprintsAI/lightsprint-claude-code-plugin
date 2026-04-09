# Lightsprint CLI Agent Usage Issues Catalog

**Date**: 2026-04-07
**Source**: ~550 CLI invocations across ~80 Claude Code sessions (conductor workspaces + lightsprint-projects), 2026-04-03 to 2026-04-07
**Overall error rate**: ~8% (46 errors / ~550 invocations)

---

## Issue 1: Hallucinated command name `create-task` (6 instances)

**Sessions**: kyoto, codex-cloud-security-agent, claude-agent-sdk, lightsprint (x3)
**Severity**: Medium
**Self-recovered**: Yes (but always takes 3 attempts)

Agents consistently hallucinate `lightsprint create-task` instead of `lightsprint create`. This happened 6 separate times across independent sessions. Every time, the agent follows the same 3-attempt chain:

1. `lightsprint create-task --title "..."` -> `Unknown command: create-task`
2. Runs `lightsprint help`, sees `create <title> [opts]`
3. `lightsprint create "My Title" --description "..."` -> fails (see Issue 2)
4. `lightsprint create --title "My Title"` -> finally succeeds

**Cost**: 2 extra CLI round-trips per occurrence = 12 wasted invocations total.

**Remediation ideas**:
- Add command alias: `create-task` -> `create`
- Add fuzzy command matching: "Unknown command: create-task. Did you mean: create?"
- Emphasize exact command name more prominently in skill files

---

## Issue 2: Positional argument confusion -- help text lies (9+ instances)

**Sessions**: kyoto, codex-cloud-security-agent, claude-agent-sdk, lightsprint (x3+), fix-main-issue
**Severity**: **High** (single biggest source of agent confusion)
**Self-recovered**: Yes (after extra attempt)

The `lightsprint help` output shows:
```
  create <title> [opts]    Create a new task
  get <taskId>             Get task details
  update <taskId> [opts]   Update a task
```

This implies positional argument support. Agents naturally try:
- `lightsprint create "My Title"` -> `Unknown argument: My Title. Use --title`
- `lightsprint get SyXtOvFbhQXCFfYpLpAiL` -> `Unknown argument. Use --task <taskId>`
- `lightsprint update 5o9PvgLnk --status todo` -> `Unknown argument. Use --task <taskId>`

The help text documents a positional arg API that doesn't exist. This is a **documentation bug** that directly amplifies Issue 1 -- after recovering from `create-task`, agents hit this immediately.

Note: `merge` already supports positional args correctly, making the inconsistency worse.

**Remediation ideas**:
- **Option A**: Fix help text to `create --title <title> [opts]` (match reality)
- **Option B**: Implement positional args for `create`, `get`, `update` (match docs)
- Option B preferred -- it matches agent expectations and what other CLIs do

---

## Issue 3: `--help` flag rejected on all subcommands (4+ instances)

**Sessions**: fix-main-issue, easy-tasks, lightsprint (x2)
**Severity**: Medium

Agents naturally try `lightsprint update --help` or `lightsprint agent launch --help` to discover available options. Every subcommand rejects `--help` as an unknown argument:

- `lightsprint update --help` -> `Unknown argument: --help. Use --task <taskId>`
- `lightsprint create --help` -> `Unknown argument: --help. Use --title`
- `lightsprint agent launch --help` -> `Unknown argument: --help. Use --task, --provider...`

Agents fall back to `lightsprint describe <command>` which works but costs an extra invocation.

**Remediation**: Add `--help` support to all subcommands (standard CLI convention).

---

## Issue 4: `review-hub-signals` vs `review-hub signals` confusion (2 instances)

**Session**: fix-main-issue
**Severity**: Medium
**Self-recovered**: Yes (after retry)

Agent used hyphenated form `lightsprint review-hub-signals` instead of the space-separated subcommand `lightsprint review-hub signals`. This happened twice in the same session.

`review-hub` is the only compound command using space-separated subcommands, making it an outlier in the CLI's design.

**Remediation**: Accept both `review-hub-signals` and `review-hub signals`.

---

## Issue 5: `tasks --search` returns irrelevant results

**Session**: shanghai-v1
**Severity**: **High**
**Self-recovered**: No (agent gave up)

Agent searched for tasks related to "codex security" across 4 separate queries. All returned completely unrelated results:
- `lightsprint tasks --search "codex security"` -> "Post-signup onboarding flow"
- `lightsprint tasks --search "codex review staying"` -> "CC session resume fails after laptop sleep"
- `lightsprint tasks --search "security review PR"` -> also irrelevant

The agent abandoned task search entirely.

**Remediation**:
- Review search ranking/relevance algorithm
- Add exact-match mode: `--search-mode exact`
- Return relevance scores so agents can filter

---

## Issue 6: `link-pr` 409 -- PR already linked, no context given (3 instances)

**Sessions**: oslo, user-membership, lightsprint
**Severity**: Low
**Self-recovered**: Yes (agents moved on)

Error: `Lightsprint API 409: {"message":"This PR is already linked to another task"}`

The error doesn't say WHICH task the PR is linked to, so the agent can't decide whether to unlink/relink or adopt the existing task.

**Remediation**: Include existing task ID in 409 response: `"already linked to task <taskId>"`

---

## Issue 7: "No task linked" -- universal friction (ALL sessions)

**Sessions**: Every conductor + project session (~40+ sessions)
**Severity**: Low (friction, not a bug)

Every session follows the same 4-step recovery:
1. `lightsprint current-task --cc-pid $PPID` -> "No task linked"
2. `lightsprint config get link-pr.no-task-behavior` -> `always-create`
3. `lightsprint create --title "..."` -> creates task
4. `lightsprint link-pr --task <id> --pr-url <url>` -> links PR

This is the dominant workflow pattern. Of ~550 CLI calls, ~200 are just this flow repeated.

**Remediation**:
- Single combined command: `lightsprint ensure-task --pr-url <url> --title "..."`
- Or auto-create in `link-pr` when config says `always-create`

---

## Issue 8: `--project` flag missing on `create` and `update` (2 instances)

**Session**: lightsprint
**Severity**: Low

Agents tried to set a project when creating/updating tasks:
- `lightsprint create --title "..." --project 7TwRtDNBCFQnUSMREdpcT` -> `Unknown argument: --project`
- `lightsprint update --task ... --project 7TwRtDNBCFQnUSMREdpcT` -> `Unknown argument: --project`

Note: `tasks` supports `--project` for filtering, but `create`/`update` don't support setting it.

**Remediation**: Add `--project` flag to `create` and `update`.

---

## Issue 9: Shell variable expansion blocked by sandbox (3 instances)

**Session**: lightsprint
**Severity**: Low
**Self-recovered**: Partial

Agents tried `$PPID` and `$$` in commands but Claude Code's sandbox blocked shell variable expansion:
- `lightsprint claim --cc-pid $PPID --task 2065` -> "Contains simple_expansion"
- `lightsprint claim --cc-pid $$ --task 2065` -> "Contains simple_expansion"

This isn't a CLI bug -- it's a sandbox restriction. But agents get confused when their shell variables don't expand.

---

## Issue 10: Cross-repo PR linking (2 instances)

**Session**: lightsprint-claude-code-plugin
**Severity**: Low
**Self-recovered**: Yes

Agents in the `lightsprint-claude-code-plugin` project tried to link PRs from `SprintsAI/lightsprint`:
- `API 400: {"message":"PR must belong to the GitHub repo linked to this repository (SprintsAI/lightsprint-claude-code-plugin), but got SprintsAI/lightsprint"}`

The error message is clear, but agents don't anticipate this restriction.

---

## Issue 11: API auth errors (3 instances)

**Sessions**: fix-main-issue, lightsprint-claude-code-plugin
**Severity**: Medium

- `lightsprint merge --task ...` -> `API 401: {"message":"Unauthorized"}` (x2)
- `lightsprint agent launch --task ... --provider anthropic` -> `API 403: {"message":"API key missing required scope: agents:write"}`

**Remediation**: Better error messages -- e.g., "You need the `agents:write` scope. Run `lightsprint auth refresh` to update permissions."

---

## Issue 12: `describe` doesn't know compound commands

**Session**: fix-main-issue
**Severity**: Low

`lightsprint describe agent` -> `{"error":"not_found","message":"Unknown command: \"agent\"}"`

The `describe` introspection command doesn't enumerate compound commands like `agent launch`, `agent stop`.

---

## Issue 13: Null `project` field in JSON output causes downstream crashes

**Session**: lightsprint
**Severity**: Low

`lightsprint tasks --project core --output json` piped to Python failed with `AttributeError: 'NoneType' object has no attribute 'get'` because some tasks have `project: null` (not missing, but explicitly null).

**Remediation**: Normalize null project to `{}` in JSON output, or document the null case.

---

## Issue 14: Plugin directory missing (hook failure)

**Session**: port-louis (3 occurrences)
**Severity**: Medium

Hook error: `Failed to run: Plugin directory does not exist: /Users/henghonglee/.claude/plugins/marketplaces/lightsprint/lightsprint/`

All hooks silently failed for the entire session.

**Remediation**: Auto-repair plugin directory on daemon startup, or add `lightsprint doctor`.

---

## Issue 15: Inconsistent `--cc-pid` usage

**Sessions**: Mixed (~50% pass it, ~50% don't)
**Severity**: Low

Skill files don't consistently enforce whether `--cc-pid $PPID` should be passed to `create`.

**Remediation**: Auto-detect PID from environment, or document clearly in skills.

---

## Summary Table

| # | Issue | Instances | Severity | Fix Complexity |
|---|-------|-----------|----------|----------------|
| 1 | Hallucinated `create-task` | 6 | Medium | Low (alias) |
| 2 | **Positional args rejected despite help text** | **9+** | **High** | **Low (fix help or impl)** |
| 3 | `--help` rejected on subcommands | 4 | Medium | Low |
| 4 | `review-hub-signals` vs `review-hub signals` | 2 | Medium | Low (alias) |
| 5 | **Search returns irrelevant results** | 1 (4 queries) | **High** | Medium |
| 6 | `link-pr` 409 missing context | 3 | Low | Low |
| 7 | **"No task linked" friction** | **ALL sessions** | Low | Medium |
| 8 | `--project` flag missing | 2 | Low | Low |
| 9 | Shell var expansion blocked | 3 | Low | N/A (sandbox) |
| 10 | Cross-repo PR linking | 2 | Low | Low (better error) |
| 11 | API auth errors (401/403) | 3 | Medium | Low (better error) |
| 12 | `describe` can't handle compound cmds | 1 | Low | Low |
| 13 | Null project in JSON output | 1 | Low | Low |
| 14 | Plugin directory missing | 3 | Medium | Low |
| 15 | Inconsistent `--cc-pid` usage | ~50% | Low | Low |

## Top 3 Highest-Impact Fixes

1. **Fix positional arg support** (Issue 2) -- affects every session that hits Issue 1. The help text actively misleads agents. Either make `create "title"` / `get <id>` work, or fix the help text. This alone would eliminate ~15 wasted CLI calls.

2. **Add `create-task` alias** (Issue 1) -- 6 independent hallucinations of the same command name suggests this is a natural agent expectation. A one-line alias would eliminate all of them.

3. **Fix search relevance** (Issue 5) -- search is currently useless for agents. When an agent needs to find a specific task, it can't.
