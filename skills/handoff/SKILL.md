---
name: handoff
description: Hand coding work to a Lightsprint managed cloud agent with repository, branch, optional local diff, and investigation context; create the Lightsprint task, launch its session, return task/session URLs, or poll an existing run. Use when the user asks to hand off, delegate, spin off, or monitor coding work in Lightsprint, especially for long-running implementation, browser, test, migration, or CI tasks.
---

# Lightsprint Handoff

Use the `lightsprint handoff` CLI flow. It uses the active Lightsprint workspace connection and launches the native Lightsprint provider in a managed cloud sandbox.

## Create a handoff

1. Run `lightsprint status`. If disconnected, run `lightsprint connect` and let the user finish browser authorization.
2. Check `git status --short`. The command includes `git diff HEAD` by default, capped at 100 KiB. If the diff contains secrets, unrelated work, or anything the user does not want uploaded to Lightsprint, add `--no-diff`.
3. Create and launch:

```bash
lightsprint handoff create \
  --task "Fix the authentication timeout bug" \
  --context "Investigated src/auth/session.ts. The timeout is hardcoded." \
  --output json
```

The command auto-detects the current GitHub repository and selects the one matching stack. If the repository belongs to several stacks, or no repository is available, pass `--stack <id|prefix|name>`.

Always report both returned URLs:

- `taskUrl` is the durable work item.
- `agent.sessionUrl` is the live managed session.

If task creation succeeds but launch fails, report `taskUrl` and `launchError`; do not create a duplicate task.

## Poll a handoff

When the user asks to wait or monitor, poll by session ID or URL:

```bash
lightsprint handoff poll <sessionId-or-url> --interval 15 --output json
```

Use `--once` for a single status read. Polling stops when the session is `idle`, `completed`, `cancelled`, or `failed`. `idle` means the initial handoff turn finished and the agent is ready for a follow-up. Report any `prUrl`, `branchName`, or `errorMessage` in the final status.

Lightsprint retains the session; there is no archive step. Stop a run only when the user asks:

```bash
lightsprint agent stop --task <taskId> --provider lightsprint --output json
```
