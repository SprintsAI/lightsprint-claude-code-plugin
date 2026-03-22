---
name: start-room
description: Start a plan room to share your live Claude Code session with teammates on Lightsprint. Use when you want team visibility and discussion on your current work.
---

Start a plan room so teammates can watch your live session and chat about it on Lightsprint.

## Usage

```bash
lightsprint start-room --cc-pid $PPID
```

## Output

On success, prints the plan room URL that teammates can open to watch and discuss.

## Invariants

- Only one plan room can be active per session. If a room is already active, this will fail.
- Requires an active Claude Code session with the Lightsprint daemon running.
- The plan room streams your conversation (user messages and Claude responses) in real-time. Thinking blocks are stripped, tool results are truncated.
- Team members with access to the repo can view the room and chat.
- The room closes automatically when your session ends, or you can close it manually with `/lightsprint:stop-room`.
