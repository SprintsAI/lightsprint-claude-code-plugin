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
- `--auto-merge` / `--no-auto-merge` — arm or explicitly disable auto-merge (bare flags,
  take no value)
- `--yes` — confirm arming auto-merge across more than one `--task`

## Auto-merge launches ("auto-merge" / "automerge" / "yolo")

When the user asks for an **auto-merge**, **automerge**, or **yolo** launch — "yolo this
one", "start an automerge task", "launch it with auto-merge" — they mean: launch the agent
with auto-merge armed. Pass `--auto-merge`:

```bash
lightsprint agent launch --task LS-100 --provider anthropic --auto-merge --output json
```

The autopilot then merges the task's PR on its own once it reaches 100/100 readiness **with
green CI** (zero checks does not count as green). Nobody clicks merge.

- **Needs merge permission** — every role except `member_no_merge`. Without it the launch
  is rejected and nothing starts; relay the error rather than retrying without the flag.
- **It is unattended and lands on a real branch.** The merge goes to the PR's base — the
  repo default unless you passed `--base-ref`. Say which branch when you tell the user what
  you are about to run. Only pass `--auto-merge` when they actually asked for it; never add
  it on your own initiative to a plain launch request.
- **Omitting the flag does NOT mean off — it inherits** whatever the task's auto-merge
  setting already is. If the task was armed earlier (in the UI, or by a previous launch), a
  plain `agent launch` stays armed. Pass `--no-auto-merge` when you need to guarantee a
  human merges this one.
- **Multiple tasks:** `--auto-merge` with more than one `--task` is refused, because one
  flag would arm N unattended merges. Launch them separately, or pass `--yes` if the user
  really meant all of them.
- **The flag only applies at launch, but auto-merge itself is not launch-only.** It is a
  flag on the task and can be armed or disarmed mid-run from the auto-merge control on the
  task header — being launched with it is not a precondition. If the user asks to yolo a
  task whose agent is already running, point them there. Never stop and relaunch a running
  task just to add auto-merge.

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
