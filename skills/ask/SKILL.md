---
name: ask
description: Interact with Lightsprint Codebase Ask threads. Use when you need to create, list, or send messages to Ask threads.
---

Run this command to interact with Lightsprint Codebase Ask — a read‑only Q&A over every repository in a stack.

```bash
lightsprint ask $ARGUMENTS
```

## Subcommands

### `ask list`

List ask threads in the active workspace.

```
lightsprint ask list [--limit N] [--offset N]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--limit N` | server default | Maximum threads to return |
| `--offset N` | `0` | Skip first N threads |

### `ask create`

Create a new Codebase Ask thread.

```
lightsprint ask create [--stack <ref>] [--title <text>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--stack <ref>` | default stack | Target stack (stack ID, task prefix, or name). Use `lightsprint stacks` to list. |
| `--title <text>` | — | Thread title. Positional can also be used. |

### `ask get`

Show details of an Ask thread.

```
lightsprint ask get <threadId>
```

### `ask messages`

List messages in a thread or send a new message.

```
lightsprint ask messages <threadId> [--content <text>] [--last N]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--content <text>` | — | Message to send. Omit to list existing messages. |
| `--last N` | — | Return only the last N messages. Ignored when sending. |

Sending a message dispatches an agent turn and blocks until the agent responds (SSE). The response is streamed.

### `ask cancel`

Cancel the currently running agent turn on a thread.

```
lightsprint ask cancel <threadId>
```

Idempotent — returns `cancelled: false` when there is no active turn.

### `ask delete`

Delete an Ask thread permanently.

```
lightsprint ask delete <threadId>
```

## Output

All subcommands support `--output json` for machine-readable output. Errors include structured JSON with `error` and `message` fields.

## Invariants

- Ask threads are workspace‑scoped — no repo context is needed
- Use `lightsprint ask list` first to discover threads before `get` or `messages`
- `ask create` with `--stack` targets a specific stack; omit to use the default
- Messages sent via `ask messages --content` dispatch an agent turn — this is a read‑only operation that does not modify code
- Always cancel an unwanted running turn with `ask cancel` before deleting a thread