# Plan Room Design Spec

## Overview

A Plan Room is a collaborative feature that lets a Claude Code user share their live session with teammates on Lightsprint. Team members can watch the conversation in real-time and discuss via a built-in chat panel.

Plan Rooms are discrete, user-initiated entities — separate from the existing CC session lifecycle. A user explicitly starts a plan room (via CLI/skill) and explicitly stops it (or it closes when the CC session ends).

## Key Decisions

- **Separate from sessions** — plan rooms are a parallel concept, not an extension of the session card. Sessions continue to work as-is with their event feeds.
- **One-at-a-time per session** — a CC session can have at most one active plan room.
- **Explicit lifecycle** — started via `lightsprint start-room`, stopped via `lightsprint stop-room` or when the CC session ends.
- **Chat is persistent** — chat messages are stored in DB and remain viewable after the room closes (read-only). The full conversation stream + chat history is preserved.
- **Repo-scoped access** — any member of the Lightsprint repo/workspace can view any active plan room.
- **Watch + chat only** — viewers can watch and discuss, but only the session owner interacts with Claude.

## Architecture

### Data Flow

```
Developer's Machine                    Lightsprint Server                   Viewers (Browser)
─────────────────                    ──────────────────                   ─────────────────
Claude Code                          WS Handler                          Session Window Page
  │ writes to                          │ receives                          │
  ▼                                    │ conversation:message              │
~/.claude/projects/                    ▼                                   │
  <projectKey>/                      PostgreSQL                           │
  <ccSessionId>.jsonl                  │ planRooms table                   │
  │                                    │ planRoomMessages table            │
  │ fs.watch                           ▼                                   │
  ▼                                  Socket.IO                            │
cc-daemon                             │ broadcast to                       │
  │ tails + parses + filters           │ planRoom:{id}                     │
  │ sends conversation:message         ▼                                   ▼
  │─────────────────────────────────▶ Store + Broadcast ──────────────────▶ Live updates
       existing WebSocket (/cc-ws)                                         Late join via REST
```

### JSONL File Structure

```
~/.claude/projects/<project-key>/
├── <ccSessionId>.jsonl                # main conversation (tailed by daemon)
└── <ccSessionId>/
    ├── subagents/
    │   └── agent-<agentId>.jsonl      # subagent conversations (out of scope for v1)
    └── tool-results/
        └── toolu_<id>.txt             # raw tool output (ignored)
```

The project key is derived by replacing `/` with `-` in the working directory path and prepending `-` (e.g., `/Users/henghong/projects/myapp` becomes `-Users-henghong-projects-myapp`).

### JSONL Record Types

Each line in the JSONL file is a self-contained JSON object. There are 4 primary types:

| Type | Description | Streamed? |
|------|-------------|-----------|
| `user` | User messages with `role: "user"` | Yes |
| `assistant` | Claude responses with content blocks (text, tool_use, thinking, tool_result) | Yes (filtered) |
| `progress` | Hook/internal events | No |
| `file-history-snapshot` | File state snapshots | No |

Common fields across all records: `uuid`, `parentUuid`, `sessionId`, `type`, `timestamp`, `cwd`, `version`, `gitBranch`, `isSidechain`.

### JSONL Filtering Rules

When streaming assistant messages, the daemon applies these filters:

- **Strip** `thinking` content blocks entirely
- **Truncate** `tool_result` content blocks to 2KB
- **Keep** `text` and `tool_use` content blocks intact
- **Skip** records where `isSidechain: true` (subagent messages)
- **Skip** `type: "file-history-snapshot"` and `type: "progress"` records

## CLI Commands

### `lightsprint start-room`

Creates a plan room on the server and starts tailing the JSONL file.

**Flow:**
1. Sends `planRoom:start` over the existing daemon WebSocket
2. Server creates a `planRooms` record, returns `planRoomId`
3. Daemon resolves JSONL path: `~/.claude/projects/<projectKey>/<ccSessionId>.jsonl`
4. Daemon starts `fs.watch()` on the file, reads from current byte offset
5. Outputs a link: "Plan room live at https://lightsprint.ai/repos/{id}/sessions?roomId={planRoomId}"

**Guards:**
- Fails if a plan room is already active for this session
- Fails if no daemon is running (session not started)

### `lightsprint stop-room`

Stops the active plan room for the current session.

**Flow:**
1. Sends `planRoom:end` over WS
2. Daemon stops `fs.watch()`, clears queued conversation messages
3. Server marks the plan room as `closed`, sets `closedAt`
4. Server broadcasts `planRoom:closed` to Socket.IO room

**No arguments needed** — stops the room for the current session (one-at-a-time constraint).

### Auto-close

When the CC session ends (`session:end`), the daemon checks if there's an active plan room and closes it automatically.

## Skills

### `/lightsprint:start-room`

```
Invokes: lightsprint start-room
Output: "Plan room is live. Your team can now watch and discuss at <link>"
```

### `/lightsprint:stop-room`

```
Invokes: lightsprint stop-room
Output: "Plan room closed."
```

## Database Schema

### `planRooms` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Plan room identifier |
| `repoId` | uuid (FK → repos) | Which repo this belongs to |
| `ccSessionId` | uuid (FK → ccSessions) | Parent CC session |
| `userId` | uuid (FK → users) | Who started the room |
| `status` | enum: `live`, `closed` | Current state |
| `gitBranch` | text (nullable) | Branch at time of creation |
| `startedAt` | timestamp | When the room was created |
| `closedAt` | timestamp (nullable) | When the room was closed |

### `planRoomMessages` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Message identifier |
| `planRoomId` | uuid (FK → planRooms) | Which plan room |
| `messageType` | enum: `conversation`, `chat` | Conversation stream vs team chat |
| `userId` | uuid (FK → users, nullable) | Null for conversation messages |
| `uuid` | text (nullable) | JSONL record UUID (for dedup/ordering) |
| `parentUuid` | text (nullable) | For conversation message threading |
| `role` | enum: `user`, `assistant`, `system` (nullable) | For conversation messages |
| `content` | jsonb | Message content blocks or chat text |
| `timestamp` | timestamp | When the message was created |

**Indexes:**
- `planRoomId + messageType` composite (filter by type)
- `planRoomId + uuid` unique (dedup conversation messages)

## WebSocket Protocol

### Daemon → Server

```jsonc
// Start a plan room (request-response)
{ "type": "planRoom:start", "id": "msg_N", "data": { "ccSessionId": "...", "gitBranch": "..." } }

// Stop a plan room (request-response)
{ "type": "planRoom:end", "id": "msg_N", "data": {} }

// Stream conversation messages (fire-and-forget)
{ "type": "conversation:message", "data": { "planRoomId": "...", "uuid": "...", "parentUuid": "...", "role": "user|assistant", "content": [...], "timestamp": "..." } }
```

### Server → Daemon

```jsonc
// Ack for planRoom:start
{ "type": "ack", "id": "msg_N", "ok": true, "planRoomId": "..." }

// Ack for planRoom:end
{ "type": "ack", "id": "msg_N", "ok": true }
```

### Server → Browser (Socket.IO)

```jsonc
// Socket.IO room: planRoom:{planRoomId}

// Conversation message from JSONL stream
{ "event": "planRoom:message", "data": { "id": "...", "messageType": "conversation", "role": "user|assistant", "content": [...], "uuid": "...", "timestamp": "..." } }

// Team chat message
{ "event": "planRoom:chat", "data": { "id": "...", "userId": "...", "userName": "...", "content": "...", "timestamp": "..." } }

// Plan room closed
{ "event": "planRoom:closed", "data": { "planRoomId": "...", "closedAt": "..." } }
```

### Browser → Server (REST)

```
GET  /api/plan-rooms/{id}/messages?type=conversation   # Late join — fetch conversation history
GET  /api/plan-rooms/{id}/messages?type=chat            # Late join — fetch chat history
POST /api/plan-rooms/{id}/chat                          # Send a chat message
```

## Daemon JSONL Tailing

New module activated when `planRoom:start` succeeds, deactivated on `planRoom:end` or session end.

**Discovery:**
1. Daemon knows `ccSessionId` from session start
2. Derives project key from `cwd` (replace `/` with `-`, prepend `-`)
3. JSONL path: `~/.claude/projects/{projectKey}/{ccSessionId}.jsonl`

**Tailing mechanism:**
- `fs.watch()` on the JSONL file
- Maintains a byte offset; on each change event, reads new bytes from offset
- Splits by newline, parses each JSON line
- Applies filtering rules (see JSONL Filtering Rules above)
- Sends `conversation:message` for each qualifying record

**Buffering:**
- If WS is disconnected, conversation messages queue in the existing event queue (shared 100-event limit)
- Flushed on reconnect in order

**Cleanup:**
- On `stop-room` or session end: stop `fs.watch()`, clear queued conversation messages

## UI Design

### Page Layout

Plan rooms appear on the existing `/repos/[id]/sessions` page as a separate section above sessions:

```
┌─────────────────────────────────────────┐
│ Sessions                  [✓ Active only]│
├─────────────────────────────────────────┤
│ PLAN ROOMS                               │
│ ┌─────────────────────────────────────┐  │
│ │ ● henghong's plan room  [live]      │  │
│ │   feat/auth-rewrite · started 12m   │  │
│ │   ┌─────────────────┬────────────┐  │  │
│ │   │ Live Conversation│ Team Chat  │  │  │
│ │   │                  │            │  │  │
│ │   │ HH: refactor...  │ JD: should │  │  │
│ │   │                  │ we use...  │  │  │
│ │   │ Claude: I'll...  │            │  │  │
│ │   │  Read auth.ts    │ HH: let's  │  │  │
│ │   │                  │ do refresh │  │  │
│ │   │ Claude: The...   │            │  │  │
│ │   │  Edit auth.ts    │ [Send]     │  │  │
│ │   └─────────────────┴────────────┘  │  │
│ └─────────────────────────────────────┘  │
│ ─────────────────────────────────────── │
│ SESSIONS                                 │
│ ┌─────────────────────────────────────┐  │
│ │ ● a3f8c91b2d47... [active]          │  │
│ │   feat/auth-rewrite · 12m ago       │  │
│ │   ▶ Session started    14:32:01     │  │
│ │   💬 Turn started      14:32:05     │  │
│ └─────────────────────────────────────┘  │
│ ┌─────────────────────────────────────┐  │
│ │ ○ 7e2b4f09c1a8... [completed]       │  │
│ │   fix/dashboard-perf · 2h ago       │  │
│ └─────────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### Visual Distinctions

| Element | Plan Room | Session |
|---------|-----------|---------|
| Status dot | Terracotta (`#E58866`) with ping animation | Green (`#5EB87A`) with ping animation |
| Badge | `live` / `closed` in terracotta | `active` / `completed` in green/gray |
| Border | Terracotta accent border | Default border |
| Title | "{userName}'s plan room" (human-readable) | Truncated session ID (mono) |
| Expanded view | Conversation stream + team chat | Event feed (unchanged) |

### Message Rendering

- **User messages:** Avatar (muted palette) + Inter font, terracotta sender name
- **Claude responses:** No avatar, terminal-style block (JetBrains Mono), green sender name, `tool_use` blocks shown as collapsed indicators (`Read src/auth.ts`)
- **Thinking indicator:** Dashed border block with blinking cursor, muted color
- **Team chat:** Sender name in avatar color, Inter font, lightweight style

### Closed Plan Room

When a plan room is closed:
- Badge changes from `live` to `closed` (gray)
- Ping animation stops
- Conversation stream + chat history remain viewable (read-only)
- Chat input is disabled
- Border reverts to default

## Scope

### In Scope (v1)
- `start-room` / `stop-room` CLI commands
- `/lightsprint:start-room` and `/lightsprint:stop-room` skills
- Daemon JSONL tailing (main conversation file only)
- Server-side plan room CRUD + message persistence
- Socket.IO broadcast for real-time updates
- Plan room UI on sessions page (conversation stream + team chat)
- Late join with full history
- Auto-close on session end
- Presence avatars on active plan rooms

### Out of Scope (future)
- Subagent log streaming (`<sessionId>/subagents/agent-*.jsonl`)
- Tool result file content (`<sessionId>/tool-results/toolu_*.txt`)
- Voting or decision-making features
- Intervening in the Claude session remotely
- Plan room notifications (e.g., "HH started a plan room")
- Plan room from the Lightsprint web UI (currently CLI-only start)
