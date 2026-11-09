# Changelog

## 0.7.0

- Moved the `ask` command off the retired Ask thread API routes onto the new session endpoints (`/sessions`, `/agent-sessions`). The old routes answer `410 Gone` on an updated Lightsprint server.
- Renamed the command to `session` (`lightsprint session ...`). `lightsprint ask` stays as a deprecated alias.
- `session send <sessionId> <content>` posts a message and returns the turn's dispatch status right away; read the reply with `session get`.
- `session events <sessionId>` watches the session's live event stream for a bounded window (`--timeout-ms`, default 5000ms, or `--last N`). It is a live tail, not a history replay, unlike the old `ask messages` fetch.
- `session messages` is a deprecated alias that dispatches to `send` or `events` depending on whether content is given, matching the old combined command.
- A `410` response from the server now tells the user to run `lightsprint upgrade` instead of surfacing a raw status code.
- This version must be installed before the Lightsprint server retires the old Ask thread routes, or the old CLI calls will start failing.

## 0.6.4 and earlier

See the git history for changes before this file existed.
