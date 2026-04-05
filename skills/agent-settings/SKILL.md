---
name: agent-settings
description: Check which cloud agent providers (anthropic, cursor, codex) are configured and their default models. Use before launching agents.
---

Run this command to check cloud agent provider configuration:

```bash
lightsprint agent settings $ARGUMENTS
```

Usage: `agent settings [--provider <anthropic|cursor|codex>]`

- `--provider <provider>` — Also fetch available environments for this provider. Required for codex (needs `--environment-id` to launch).

## Output fields

| Field | Description |
|-------|-------------|
| providers | Object keyed by provider name, each with `configured` (boolean) and `defaultModel` (string) |
| environments | (Only with `--provider`) Object with `provider` name and `items` array of environment objects |

## Examples

```bash
lightsprint agent settings --output json
lightsprint agent settings --provider codex --output json
```

## Invariants

- Always check settings before launching agents to verify the provider is configured.
- If codex provider is needed, use `--provider codex` to discover environment IDs (required for codex launches).
- A provider showing `configured: false` means the user hasn't connected their credentials for that provider in Lightsprint settings.
