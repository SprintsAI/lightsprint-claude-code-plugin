---
name: ask
description: Interact with Lightsprint read-only agent sessions. Use when you need to create, list, or send messages to a session.
---

Run this command to manage Lightsprint read-only sessions across every repository in a stack.

```bash
lightsprint session $ARGUMENTS
```

`lightsprint ask` is a deprecated alias for `lightsprint session` kept for compatibility — prefer `session`.

## Subcommands

### `session list`

List your sessions in the active workspace.

```
lightsprint session list [--limit N] [--offset N]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--limit N` | server default | Maximum sessions to return |
| `--offset N` | `0` | Skip first N sessions |

### `session create`

Create a new read‑only session.

```
lightsprint session create [--stack <ref>] [--title <text>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--stack <ref>` | default stack | Target stack (stack ID, task prefix, or name). Use `lightsprint stacks` to list. |
| `--title <text>` | — | Your name for the session (sent as `name`). Positional can also be used. Shows up right away in `session get`/`list`, unlike the agent-written title, which fills in once the agent has read enough of the conversation to summarize it. |

### `session get`

Show details of a session.

```
lightsprint session get <sessionId>
```

### `session send`

Send a message to a session as its next turn.

```
lightsprint session send <sessionId> <content>
```

Answers right away with the turn's dispatch status (`dispatched`, `queued`, or `refused`) — it does not wait for the agent's reply. Read the reply with `lightsprint session get <sessionId>` once the turn finishes.

### `session events`

Show a session's stored message history, or watch it live.

```
lightsprint session events <sessionId> [--last N] [--follow [--timeout-ms N]]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--last N` | — | History mode: only the last N messages. Follow mode: stop once this many events arrive. |
| `--follow` | off | Watch live activity instead of fetching stored history |
| `--timeout-ms N` | `5000` | `--follow` only: how long to listen before giving up |

Without `--follow`, this fetches the session's stored transcript (oldest first) — the same thing the old `ask messages` fetch returned. With `--follow`, it is a live tail instead: it only reports activity that happens while connected, and an empty result means nothing happened in the window, not a failure.

### `session cancel`

Cancel the currently running agent turn on a session.

```
lightsprint session cancel <sessionId>
```

Idempotent — returns `cancelled: false` when there is no active turn.

### `session delete`

Delete a session permanently.

```
lightsprint session delete <sessionId>
```

### `session messages` (deprecated)

Deprecated alias for the combined old `ask messages` command. Dispatches to `send` when content is given, or `events` otherwise.

## Output

All subcommands support `--output json` for machine-readable output. Errors include structured JSON with `error` and `message` fields.

## Invariants

- Sessions are workspace‑scoped — no repo context is needed
- Use `lightsprint session list` first to discover sessions before `get`, `send`, or `events`
- `session create` with `--stack` targets a specific stack; omit to use the default
- `session send` dispatches an agent turn — this is a read‑only operation that does not modify code
- `session send` is fire-and-forget: check the reply with `session get`, not from the send response
- `session events` shows stored history by default; pass `--follow` for a live tail instead
- Always cancel an unwanted running turn with `session cancel` before deleting a session
- An old Ask thread ID is not a valid session ID — run `lightsprint session list` to find the session
