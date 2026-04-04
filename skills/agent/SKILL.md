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
