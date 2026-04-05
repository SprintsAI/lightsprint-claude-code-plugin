---
name: agent-create-pr
description: Create a GitHub PR from a cloud agent's working branch. Use after an agent finishes work to open a PR for review.
---

Run this command to create a PR from a cloud agent's branch:

```bash
lightsprint agent create-pr $ARGUMENTS
```

Usage: `agent create-pr --task <taskId> --provider <anthropic|cursor|codex> --agent-id <agentId>`

- `--task <taskId>` — Task ID (required)
- `--provider <provider>` — Cloud agent provider (required): `anthropic`, `cursor`, `codex`
- `--agent-id <id>` — Agent ID (required). Found in the task's agent details via `lightsprint get <taskId>`.

## Examples

```bash
lightsprint agent create-pr --task LIG-024 --provider anthropic --agent-id abc123 --output json
```

## Invariants

- Only works for agents that have completed their work (FINISHED status). Check agent status with `lightsprint get <taskId>` first.
- The `--agent-id` can be found in the task details under the cloud agent entries for the relevant provider.
- After PR creation, use `lightsprint link-pr` if the PR isn't automatically linked.
- All three flags (`--task`, `--provider`, `--agent-id`) are required.
