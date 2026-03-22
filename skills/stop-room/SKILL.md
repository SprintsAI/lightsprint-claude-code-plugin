---
name: stop-room
description: Stop the active plan room for your current session. Use when you're done sharing your session with teammates.
---

Stop the currently active plan room, closing it for all viewers.

## Usage

`lightsprint stop-room`

## Output

Confirms the plan room has been closed.

## Invariants

- Fails if no plan room is currently active for this session.
- After stopping, the conversation stream and chat history remain viewable on Lightsprint (read-only).
- You can start a new plan room later with `/lightsprint:start-room`.
