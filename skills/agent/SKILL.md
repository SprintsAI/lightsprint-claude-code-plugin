---
name: agent
description: Launch, stop, or check settings for cloud agents on Lightsprint tasks. Supports anthropic, cursor, and codex providers.
---

This skill has three subcommands: `launch`, `stop`, and `settings`.

## Check provider settings first

Before launching, always check which providers are configured:

```bash
lightsprint agent settings --output json
```

If you need environment IDs (required for codex, optional for anthropic):

```bash
lightsprint agent settings --provider codex --output json
```

## Launch a cloud agent

Launch one or more agents. Use multiple `--task` flags to launch in parallel:

```bash
lightsprint agent launch --task <taskId> [--task <taskId> ...] --provider <anthropic|cursor|codex> --output json
```

**Examples:**

Single task:
```bash
lightsprint agent launch --task LS-100 --provider anthropic --output json
```

Multiple tasks (launched concurrently):
```bash
lightsprint agent launch --task LS-100 --task LS-101 --task LS-102 --provider anthropic --output json
```

Optional flags:
- `--model <model>` — override the provider's default model
- `--base-ref <branch>` — base branch (defaults to repo's default branch)
- `--environment-id <id>` — environment for codex (required) or anthropic (optional)
- `--auto-merge` — arm auto-merge on the launch (bare flag, takes no value)

## Auto-merge launches ("auto-merge" / "automerge" / "yolo")

When the user asks for an **auto-merge**, **automerge**, or **yolo** launch — "yolo this
one", "start an automerge task", "launch it with auto-merge" — they mean: launch the agent
with auto-merge armed. Pass `--auto-merge`:

```bash
lightsprint agent launch --task LS-100 --provider anthropic --auto-merge --output json
```

This arms the Review Hub autopilot, which merges the task's PR on its own once the PR
reaches 100/100 readiness. Nobody clicks merge.

- **Requires workspace owner/admin** (merge permission). A `member_no_merge` role gets a
  403 — `Auto-merge requires merge permission` — and the launch does not start.
- **It is unattended and hard to undo** — once the autopilot merges, the merge is on the
  base branch. Only pass `--auto-merge` when the user actually asked for it; never add it
  on your own initiative to a plain launch request.
- Omit the flag for a normal launch: the agent opens the PR and a human merges it.
- **The flag only applies at launch, but auto-merge itself is not launch-only.** It is a
  flag on the task and can be armed or disarmed mid-run from the task's Review Hub tab —
  being launched with it is not a precondition. If the user asks to yolo a task whose
  agent is already running, point them there. Never stop and relaunch a running task just
  to add auto-merge.

**Important:**
- `--provider` is always required
- Codex typically requires `--environment-id` — use `agent settings --provider codex` to discover IDs
- Only one agent can run per task per provider at a time
- When launching multiple tasks, all launches run concurrently and results are returned as an array

## Stop an active agent

```bash
lightsprint agent stop --task $ARGUMENTS --provider <anthropic|cursor|codex> --output json
```

This interrupts the currently running agent for the task. The agent record is preserved for audit.
