# Plan Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Claude Code users share their live session with teammates via a "plan room" on Lightsprint — streaming the JSONL conversation log in real-time with team chat.

**Architecture:** The daemon tails the local JSONL file and streams parsed messages over its existing WebSocket to the Lightsprint server. The server persists messages and broadcasts via Socket.IO to viewers. The UI renders plan rooms as a separate section above sessions on the sessions page.

**Tech Stack:** Node.js (daemon/CLI), SvelteKit + Svelte 5 (frontend), PostgreSQL + Drizzle ORM (database), Socket.IO + Redis (real-time), WebSocket (daemon ↔ server)

**Repos:**
- Plugin: `/Users/henghonglee/lightsprint-projects/session-window` (daemon, CLI, skills)
- Web app: `/Users/henghonglee/lightsprint-projects/lightsprint/app` (server, DB, UI)

**Spec:** `docs/superpowers/specs/2026-03-22-plan-room-design.md`

---

## File Map

### Plugin Repo (session-window)

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `scripts/lib/jsonl-tailer.js` | JSONL file tailing, parsing, filtering |
| Create | `scripts/cc-start-room.js` | CLI command: POST to daemon `/start-room` |
| Create | `scripts/cc-stop-room.js` | CLI command: POST to daemon `/stop-room` |
| Create | `skills/start-room/SKILL.md` | Agent skill for starting a plan room |
| Create | `skills/stop-room/SKILL.md` | Agent skill for stopping a plan room |
| Create | `scripts/__tests__/jsonl-tailer.test.js` | Unit tests for JSONL tailing |
| Create | `scripts/__tests__/plan-room-e2e.test.js` | E2E tests for plan room lifecycle |
| Modify | `scripts/cc-daemon.js` | Add `/start-room`, `/stop-room` HTTP endpoints + WS messages |
| Modify | `scripts/lightsprint.js` | Add `start-room`, `stop-room` subcommand routing |
| Modify | `hooks/hooks.json` | No changes needed (plan room is user-initiated, not hook-triggered) |

### Lightsprint Web App (../lightsprint/app)

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/lib/server/db/schema/plan-rooms.ts` | Drizzle schema for planRooms + planRoomMessages |
| Create | `src/lib/server/dao/plan-room.dao.ts` | Data access for plan rooms and messages |
| Create | `src/routes/api/plan-rooms/[id]/messages/+server.ts` | REST: GET messages |
| Create | `src/routes/api/plan-rooms/[id]/chat/+server.ts` | REST: POST chat message |
| Create | `src/routes/api/plan-rooms/[id]/+server.ts` | REST: GET plan room detail |
| Create | `src/lib/stores/plan-rooms.svelte.ts` | Client-side store for plan rooms + real-time |
| Create | `src/lib/components/sessions/PlanRoomCard.svelte` | Plan room card with conversation + chat UI |
| Modify | `src/lib/server/db/schema/relations.ts` | Add planRooms relations |
| Modify | `src/lib/server/dao/index.ts` | Export new DAOs |
| Modify | `src/lib/types/realtime-events.ts` | Add planRoom event types |
| Modify | `server.js` | Handle planRoom WS messages from daemon, Socket.IO presence |
| Modify | `src/routes/repos/[id]/sessions/+page.svelte` | Add "Plan Rooms" section above sessions |
| Modify | `src/routes/repos/[id]/sessions/+page.server.ts` | Load plan rooms alongside sessions |
| Modify | `src/routes/api/cc-sessions/+server.ts` | Add plan rooms listing endpoint (or reuse) |

---

## Task 1: JSONL Tailer Module

**Files:**
- Create: `scripts/lib/jsonl-tailer.js`
- Create: `scripts/__tests__/jsonl-tailer.test.js`

This is the core engine — a reusable module that tails a JSONL file, parses records, filters by type, and emits qualifying messages via a callback.

- [ ] **Step 1: Write failing tests for JSONL tailer**

```javascript
// scripts/__tests__/jsonl-tailer.test.js
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('JsonlTailer', () => {
  let dir;
  let filePath;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tailer-test-'));
    filePath = join(dir, 'test.jsonl');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('reads existing lines from beginning of file', async () => {
    const lines = [
      { type: 'user', uuid: 'u1', message: { role: 'user', content: 'hello' }, timestamp: '2026-01-01T00:00:00Z' },
      { type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] }, timestamp: '2026-01-01T00:00:01Z' },
    ];
    writeFileSync(filePath, lines.map(l => JSON.stringify(l)).join('\n') + '\n');

    const { createTailer } = await import('../lib/jsonl-tailer.js');
    const received = [];
    const tailer = createTailer(filePath, (record) => received.push(record));
    tailer.start();
    await new Promise(r => setTimeout(r, 100));
    tailer.stop();

    expect(received.length).toBe(2);
    expect(received[0].uuid).toBe('u1');
    expect(received[1].uuid).toBe('a1');
  });

  test('filters out file-history-snapshot and progress types', async () => {
    const lines = [
      { type: 'file-history-snapshot', uuid: 'fh1', timestamp: '2026-01-01T00:00:00Z' },
      { type: 'progress', uuid: 'p1', timestamp: '2026-01-01T00:00:01Z' },
      { type: 'user', uuid: 'u1', message: { role: 'user', content: 'hello' }, timestamp: '2026-01-01T00:00:02Z' },
    ];
    writeFileSync(filePath, lines.map(l => JSON.stringify(l)).join('\n') + '\n');

    const { createTailer } = await import('../lib/jsonl-tailer.js');
    const received = [];
    const tailer = createTailer(filePath, (record) => received.push(record));
    tailer.start();
    await new Promise(r => setTimeout(r, 100));
    tailer.stop();

    expect(received.length).toBe(1);
    expect(received[0].uuid).toBe('u1');
  });

  test('skips sidechain messages', async () => {
    const lines = [
      { type: 'user', uuid: 'u1', isSidechain: false, message: { role: 'user', content: 'hello' }, timestamp: '2026-01-01T00:00:00Z' },
      { type: 'assistant', uuid: 'a1', isSidechain: true, message: { role: 'assistant', content: [] }, timestamp: '2026-01-01T00:00:01Z' },
    ];
    writeFileSync(filePath, lines.map(l => JSON.stringify(l)).join('\n') + '\n');

    const { createTailer } = await import('../lib/jsonl-tailer.js');
    const received = [];
    const tailer = createTailer(filePath, (record) => received.push(record));
    tailer.start();
    await new Promise(r => setTimeout(r, 100));
    tailer.stop();

    expect(received.length).toBe(1);
  });

  test('strips thinking blocks from assistant messages', async () => {
    const lines = [
      {
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'long internal thought...' },
            { type: 'text', text: 'visible response' },
          ],
        },
        timestamp: '2026-01-01T00:00:00Z',
      },
    ];
    writeFileSync(filePath, lines.map(l => JSON.stringify(l)).join('\n') + '\n');

    const { createTailer } = await import('../lib/jsonl-tailer.js');
    const received = [];
    const tailer = createTailer(filePath, (record) => received.push(record));
    tailer.start();
    await new Promise(r => setTimeout(r, 100));
    tailer.stop();

    expect(received.length).toBe(1);
    const content = received[0].message.content;
    expect(content.length).toBe(1);
    expect(content[0].type).toBe('text');
  });

  test('truncates tool_result blocks exceeding 2KB', async () => {
    const bigContent = 'x'.repeat(3000);
    const lines = [
      {
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_result', content: bigContent },
            { type: 'text', text: 'ok' },
          ],
        },
        timestamp: '2026-01-01T00:00:00Z',
      },
    ];
    writeFileSync(filePath, lines.map(l => JSON.stringify(l)).join('\n') + '\n');

    const { createTailer } = await import('../lib/jsonl-tailer.js');
    const received = [];
    const tailer = createTailer(filePath, (record) => received.push(record));
    tailer.start();
    await new Promise(r => setTimeout(r, 100));
    tailer.stop();

    const toolResult = received[0].message.content.find(b => b.type === 'tool_result');
    expect(toolResult.content.length).toBeLessThanOrEqual(2048 + 12); // 2KB + "[truncated]"
  });

  test('handles partial lines at EOF', async () => {
    writeFileSync(filePath, JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'first' }, timestamp: '2026-01-01T00:00:00Z' }) + '\n');
    // Write partial line (no trailing newline)
    appendFileSync(filePath, '{"type":"user","uuid":"u2","mess');

    const { createTailer } = await import('../lib/jsonl-tailer.js');
    const received = [];
    const tailer = createTailer(filePath, (record) => received.push(record));
    tailer.start();
    await new Promise(r => setTimeout(r, 100));

    expect(received.length).toBe(1); // Only first complete line

    // Complete the partial line
    appendFileSync(filePath, 'age":{"role":"user","content":"second"},"timestamp":"2026-01-01T00:00:01Z"}\n');
    await new Promise(r => setTimeout(r, 200));
    tailer.stop();

    expect(received.length).toBe(2);
    expect(received[1].uuid).toBe('u2');
  });

  test('picks up new lines appended after start', async () => {
    writeFileSync(filePath, '');

    const { createTailer } = await import('../lib/jsonl-tailer.js');
    const received = [];
    const tailer = createTailer(filePath, (record) => received.push(record));
    tailer.start();
    await new Promise(r => setTimeout(r, 50));

    appendFileSync(filePath, JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'late' }, timestamp: '2026-01-01T00:00:00Z' }) + '\n');
    await new Promise(r => setTimeout(r, 200));
    tailer.stop();

    expect(received.length).toBe(1);
  });

  test('caps text blocks at 50KB', async () => {
    const bigText = 'y'.repeat(60000);
    const lines = [
      {
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: bigText }],
        },
        timestamp: '2026-01-01T00:00:00Z',
      },
    ];
    writeFileSync(filePath, lines.map(l => JSON.stringify(l)).join('\n') + '\n');

    const { createTailer } = await import('../lib/jsonl-tailer.js');
    const received = [];
    const tailer = createTailer(filePath, (record) => received.push(record));
    tailer.start();
    await new Promise(r => setTimeout(r, 100));
    tailer.stop();

    const textBlock = received[0].message.content[0];
    expect(textBlock.text.length).toBeLessThanOrEqual(50 * 1024 + 12);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/henghonglee/lightsprint-projects/session-window && npm test -- scripts/__tests__/jsonl-tailer.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement JSONL tailer**

```javascript
// scripts/lib/jsonl-tailer.js
import { watch, watchFile, unwatchFile, createReadStream, statSync, existsSync } from 'node:fs';
import { open } from 'node:fs/promises';

const TOOL_RESULT_MAX = 2048;
const TEXT_BLOCK_MAX = 50 * 1024;
const TRUNCATION_MARKER = ' [truncated]';

function filterRecord(record) {
  // Skip non-conversation types
  if (record.type !== 'user' && record.type !== 'assistant') return null;
  // Skip sidechains
  if (record.isSidechain) return null;

  // For assistant messages, filter content blocks
  if (record.type === 'assistant' && record.message?.content) {
    const filtered = record.message.content
      .filter(block => block.type !== 'thinking')
      .map(block => {
        if (block.type === 'tool_result' && typeof block.content === 'string' && block.content.length > TOOL_RESULT_MAX) {
          return { ...block, content: block.content.slice(0, TOOL_RESULT_MAX) + TRUNCATION_MARKER };
        }
        if (block.type === 'text' && typeof block.text === 'string' && block.text.length > TEXT_BLOCK_MAX) {
          return { ...block, text: block.text.slice(0, TEXT_BLOCK_MAX) + TRUNCATION_MARKER };
        }
        if (block.type === 'tool_use' && block.input && typeof block.input === 'string' && block.input.length > TEXT_BLOCK_MAX) {
          return { ...block, input: block.input.slice(0, TEXT_BLOCK_MAX) + TRUNCATION_MARKER };
        }
        return block;
      });
    return { ...record, message: { ...record.message, content: filtered } };
  }

  return record;
}

export function createTailer(filePath, onRecord, onError) {
  let offset = 0;
  let partialLine = '';
  let fsWatcher = null;
  let pollInterval = null;
  let fileHandle = null;
  let stopped = false;

  async function readNewLines() {
    try {
      if (!existsSync(filePath)) return;

      const stat = statSync(filePath);
      if (stat.size <= offset) return;

      if (!fileHandle) {
        fileHandle = await open(filePath, 'r');
      }

      const buf = Buffer.alloc(stat.size - offset);
      const { bytesRead } = await fileHandle.read(buf, 0, buf.length, offset);
      if (bytesRead === 0) return;

      offset += bytesRead;
      const chunk = partialLine + buf.slice(0, bytesRead).toString('utf8');
      const lines = chunk.split('\n');

      // Last element is either empty (if chunk ended with \n) or a partial line
      partialLine = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const record = JSON.parse(line);
          const filtered = filterRecord(record);
          if (filtered) onRecord(filtered);
        } catch {
          // Skip malformed JSON lines
        }
      }
    } catch (err) {
      // Log but don't crash — file may be temporarily unavailable
    }
  }

  function start() {
    stopped = false;

    if (existsSync(filePath)) {
      startWatching();
    } else {
      // File doesn't exist yet — watch parent directory for it to appear
      const dir = filePath.substring(0, filePath.lastIndexOf('/'));
      let dirWatcher = null;
      const waitTimeout = setTimeout(() => {
        if (dirWatcher) { try { dirWatcher.close(); } catch {} }
        if (onError) onError(new Error('JSONL file did not appear within 30s'));
      }, 30000);

      try {
        dirWatcher = watch(dir, (eventType, filename) => {
          if (existsSync(filePath)) {
            clearTimeout(waitTimeout);
            if (dirWatcher) { try { dirWatcher.close(); } catch {} }
            startWatching();
          }
        });
      } catch {
        // Fallback: poll for file existence
        const checkInterval = setInterval(() => {
          if (existsSync(filePath)) {
            clearInterval(checkInterval);
            clearTimeout(waitTimeout);
            startWatching();
          }
        }, 500);
      }
    }
  }

  function startWatching() {
    // Read existing content immediately
    readNewLines();

    // Watch for changes
    try {
      fsWatcher = watch(filePath, () => {
        if (!stopped) readNewLines();
      });
    } catch {
      // fs.watch may fail — fall through to polling
    }

    // Polling fallback (5s safety net)
    pollInterval = setInterval(() => {
      if (!stopped) readNewLines();
    }, 5000);
  }

  function stop() {
    stopped = true;
    if (fsWatcher) { try { fsWatcher.close(); } catch {} fsWatcher = null; }
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
    if (fileHandle) { try { fileHandle.close(); } catch {} fileHandle = null; }
    partialLine = '';
  }

  return { start, stop };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/henghonglee/lightsprint-projects/session-window && npm test -- scripts/__tests__/jsonl-tailer.test.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/henghonglee/lightsprint-projects/session-window
git add scripts/lib/jsonl-tailer.js scripts/__tests__/jsonl-tailer.test.js
git commit -m "feat: add JSONL tailer module for plan room streaming"
```

---

## Task 2: Daemon HTTP Endpoints + WS Integration

**Files:**
- Modify: `scripts/cc-daemon.js` (add `/start-room`, `/stop-room` endpoints, plan room state, WS messages)

- [ ] **Step 1: Add plan room state variables to daemon**

In `scripts/cc-daemon.js`, after the existing module-level state (around line 94), add:

```javascript
// Plan room state
let activePlanRoom = null; // { planRoomId, tailer }
```

- [ ] **Step 2: Add JSONL path resolution helper**

After the state variables, add:

```javascript
import { createTailer } from './lib/jsonl-tailer.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

function resolveJsonlPath(ccSessionId) {
  const cwd = process.env.CC_CWD || process.cwd();
  const projectKey = '-' + cwd.replace(/\//g, '-');
  return join(homedir(), '.claude', 'projects', projectKey, `${ccSessionId}.jsonl`);
}
```

- [ ] **Step 3: Add `/start-room` HTTP endpoint**

In the HTTP server handler (after the existing `/session-end` endpoint around line 487), add:

```javascript
if (url.pathname === '/start-room' && req.method === 'POST') {
  try {
    if (activePlanRoom) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'room_already_active' }));
      return;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'ws_not_connected' }));
      return;
    }

    const jsonlPath = resolveJsonlPath(CC_SESSION_ID);

    // Request plan room from server
    const ack = await sendRequest('planRoom:start', {
      ccSessionId: CC_SESSION_ID,
      repoId: REPO_ID,
      gitBranch: GIT_BRANCH,
    });

    if (!ack.ok) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: ack.error || 'server_rejected' }));
      return;
    }

    const planRoomId = ack.planRoomId;

    // Start tailing JSONL
    const tailer = createTailer(jsonlPath, (record) => {
      sendFireAndForget('conversation:message', {
        planRoomId,
        uuid: record.uuid,
        parentUuid: record.parentUuid || null,
        role: record.type === 'user' ? 'user' : 'assistant',
        content: record.message?.content || record.message || null,
        timestamp: record.timestamp,
      });
    });
    tailer.start();

    activePlanRoom = { planRoomId, tailer };
    log('Plan room started', { planRoomId });
    addBreadcrumb('planRoom', 'Plan room started', 'info', { planRoomId });

    const roomUrl = `${BASE_URL}/repos/${REPO_ID}/sessions?roomId=${planRoomId}`;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, planRoomId, url: roomUrl }));
  } catch (err) {
    log('start-room error', { error: err.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
  return;
}
```

- [ ] **Step 4: Add `/stop-room` HTTP endpoint**

```javascript
if (url.pathname === '/stop-room' && req.method === 'POST') {
  try {
    if (!activePlanRoom) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'no_active_room' }));
      return;
    }

    const { planRoomId, tailer } = activePlanRoom;
    tailer.stop();

    // Notify server
    if (ws?.readyState === WebSocket.OPEN) {
      try {
        await sendRequest('planRoom:end', { planRoomId }, 2000);
      } catch { /* ignore timeout */ }
    }

    activePlanRoom = null;
    log('Plan room stopped', { planRoomId });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
  return;
}
```

- [ ] **Step 5: Add WS disconnect buffering for plan room messages**

In the `/start-room` handler, replace the `sendFireAndForget` call with a wrapper that buffers when WS is disconnected:

```javascript
    // Start tailing JSONL
    const tailer = createTailer(jsonlPath, (record) => {
      const msg = {
        planRoomId,
        uuid: record.uuid,
        parentUuid: record.parentUuid || null,
        role: record.type === 'user' ? 'user' : 'assistant',
        content: record.message?.content || record.message || null,
        timestamp: record.timestamp,
      };
      if (ws?.readyState === WebSocket.OPEN) {
        sendFireAndForget('conversation:message', msg);
      } else {
        // Buffer in the existing event queue (shared 100-event limit)
        enqueueEvent({ type: 'conversation:message', data: msg, source: 'planRoom' });
      }
    });
```

On `stop-room` and plan room cleanup, clear plan-room-tagged events from the queue:

```javascript
// Clear buffered plan room events from queue
eventQueue = eventQueue.filter(e => e.source !== 'planRoom');
```

- [ ] **Step 6: Add WS reconnect re-registration for plan rooms**

In the daemon's WS `onopen` callback (around line 100 in `cc-daemon.js`), add logic to re-send `planRoom:start` when reconnecting with an active plan room:

```javascript
// In WS onopen handler, after existing reconnect logic:
if (activePlanRoom) {
  try {
    const ack = await sendRequest('planRoom:start', {
      ccSessionId: CC_SESSION_ID,
      repoId: REPO_ID,
      gitBranch: GIT_BRANCH,
    });
    if (ack.ok) {
      // Server returns existing planRoomId (idempotent)
      log('Plan room re-registered after reconnect', { planRoomId: ack.planRoomId });
      // Flush any buffered plan room events
      const buffered = eventQueue.filter(e => e.source === 'planRoom');
      eventQueue = eventQueue.filter(e => e.source !== 'planRoom');
      for (const event of buffered) {
        sendFireAndForget(event.type, event.data);
      }
    }
  } catch (err) {
    log('Failed to re-register plan room on reconnect', { error: err.message });
  }
}
```

- [ ] **Step 7: Add plan room cleanup to shutdown()**

In the `shutdown()` function (around line 144), **before** the `session:end` sendRequest call (line 153), insert the plan room cleanup. The `planRoom:end` must be sent before `session:end` to ensure proper ordering:

```javascript
// IMPORTANT: Insert this BEFORE the session:end send (before line 153)
// Close active plan room before ending session
if (activePlanRoom) {
  activePlanRoom.tailer.stop();
  eventQueue = eventQueue.filter(e => e.source !== 'planRoom');
  if (ws?.readyState === WebSocket.OPEN) {
    try {
      await sendRequest('planRoom:end', { planRoomId: activePlanRoom.planRoomId }, 2000);
    } catch { /* ignore */ }
  }
  activePlanRoom = null;
}
// Then the existing session:end send follows
```

- [ ] **Step 8: Handle session continuation (--continue)**

When a `--continue` aliases a new `ccSessionId` to the existing daemon, the plan room's JSONL file path changes. In the daemon's session continuation handler (where `CC_SESSION_ID` gets updated), add:

```javascript
// If plan room is active, switch to new JSONL file
if (activePlanRoom) {
  activePlanRoom.tailer.stop();
  const newJsonlPath = resolveJsonlPath(newCcSessionId);
  const newTailer = createTailer(newJsonlPath, (record) => {
    const msg = {
      planRoomId: activePlanRoom.planRoomId,
      uuid: record.uuid,
      parentUuid: record.parentUuid || null,
      role: record.type === 'user' ? 'user' : 'assistant',
      content: record.message?.content || record.message || null,
      timestamp: record.timestamp,
    };
    if (ws?.readyState === WebSocket.OPEN) {
      sendFireAndForget('conversation:message', msg);
    } else {
      enqueueEvent({ type: 'conversation:message', data: msg, source: 'planRoom' });
    }
  });
  newTailer.start();
  activePlanRoom.tailer = newTailer;
  log('Plan room tailer switched to new session', { newCcSessionId });
}
```

- [ ] **Step 9: Commit**

```bash
cd /Users/henghonglee/lightsprint-projects/session-window
git add scripts/cc-daemon.js
git commit -m "feat: add plan room start/stop endpoints to daemon"
```

---

## Task 3: CLI Commands (start-room, stop-room)

**Files:**
- Create: `scripts/cc-start-room.js`
- Create: `scripts/cc-stop-room.js`
- Modify: `scripts/lightsprint.js`

- [ ] **Step 1: Create start-room CLI command**

```javascript
// scripts/cc-start-room.js
import { findSessionForCurrentProcess } from './lib/cc-utils.js';

export async function main() {
  const state = findSessionForCurrentProcess();
  if (!state) {
    process.stderr.write(JSON.stringify({ ok: false, error: 'no_active_session', message: 'No active Claude Code session found. Start a session first.' }) + '\n');
    process.exit(1);
  }

  try {
    const resp = await fetch(`http://127.0.0.1:${state.port}/start-room`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(state.daemonToken ? { Authorization: `Bearer ${state.daemonToken}` } : {}),
      },
      body: '{}',
      signal: AbortSignal.timeout(10000),
    });

    const data = await resp.json();
    if (data.ok) {
      process.stdout.write(`Plan room is live. Your team can watch and discuss at:\n${data.url}\n`);
    } else {
      process.stderr.write(`Failed to start plan room: ${data.error}\n`);
      process.exit(1);
    }
  } catch (err) {
    process.stderr.write(`Failed to start plan room: ${err.message}\n`);
    process.exit(1);
  }
}
```

- [ ] **Step 2: Create stop-room CLI command**

```javascript
// scripts/cc-stop-room.js
import { findSessionForCurrentProcess } from './lib/cc-utils.js';

export async function main() {
  const state = findSessionForCurrentProcess();
  if (!state) {
    process.stderr.write(JSON.stringify({ ok: false, error: 'no_active_session', message: 'No active Claude Code session found.' }) + '\n');
    process.exit(1);
  }

  try {
    const resp = await fetch(`http://127.0.0.1:${state.port}/stop-room`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(state.daemonToken ? { Authorization: `Bearer ${state.daemonToken}` } : {}),
      },
      body: '{}',
      signal: AbortSignal.timeout(5000),
    });

    const data = await resp.json();
    if (data.ok) {
      process.stdout.write('Plan room closed.\n');
    } else {
      process.stderr.write(`Failed to stop plan room: ${data.error}\n`);
      process.exit(1);
    }
  } catch (err) {
    process.stderr.write(`Failed to stop plan room: ${err.message}\n`);
    process.exit(1);
  }
}
```

- [ ] **Step 3: Add routing in lightsprint.js**

In `scripts/lightsprint.js`, add to the subcommand router using the existing `if/else if` pattern (around line 39):

```javascript
} else if (subcommand === 'start-room') {
  const { main } = await import('./cc-start-room.js');
  await main();
} else if (subcommand === 'stop-room') {
  const { main } = await import('./cc-stop-room.js');
  await main();
}
```

- [ ] **Step 4: Check `findSessionForCurrentProcess` exists or create it**

In `scripts/lib/cc-utils.js`, check if there's a function that finds the daemon for the current CC process by PID. The existing `findRunningDaemonForCcPid` works. Create a convenience wrapper if needed:

```javascript
// Add to scripts/lib/cc-utils.js if not present
export function findSessionForCurrentProcess() {
  const ccPid = process.env.CLAUDE_CODE_PID || process.ppid;
  return findRunningDaemonForCcPid(ccPid);
}
```

- [ ] **Step 5: Commit**

```bash
cd /Users/henghonglee/lightsprint-projects/session-window
git add scripts/cc-start-room.js scripts/cc-stop-room.js scripts/lightsprint.js scripts/lib/cc-utils.js
git commit -m "feat: add start-room and stop-room CLI commands"
```

---

## Task 4: Skills

**Files:**
- Create: `skills/start-room/SKILL.md`
- Create: `skills/stop-room/SKILL.md`

- [ ] **Step 1: Create start-room skill**

```markdown
---
name: start-room
description: Start a plan room to share your live Claude Code session with teammates on Lightsprint. Use when you want team visibility and discussion on your current work.
---

Start a plan room so teammates can watch your live session and chat about it on Lightsprint.

## Usage

`lightsprint start-room`

## Output

On success, prints the plan room URL that teammates can open to watch and discuss.

## Invariants

- Only one plan room can be active per session. If a room is already active, this will fail.
- Requires an active Claude Code session with the Lightsprint daemon running.
- The plan room streams your conversation (user messages and Claude responses) in real-time. Thinking blocks are stripped, tool results are truncated.
- Team members with access to the repo can view the room and chat.
- The room closes automatically when your session ends, or you can close it manually with `/lightsprint:stop-room`.
```

- [ ] **Step 2: Create stop-room skill**

```markdown
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
```

- [ ] **Step 3: Commit**

```bash
cd /Users/henghonglee/lightsprint-projects/session-window
git add skills/start-room/SKILL.md skills/stop-room/SKILL.md
git commit -m "feat: add start-room and stop-room agent skills"
```

---

## Task 5: Database Schema (Lightsprint)

**Files:**
- Create: `src/lib/server/db/schema/plan-rooms.ts`
- Modify: `src/lib/server/db/schema/relations.ts`

- [ ] **Step 1: Create plan rooms schema**

```typescript
// src/lib/server/db/schema/plan-rooms.ts
import { pgTable, text, timestamp, index, uniqueIndex, jsonb, sql } from 'drizzle-orm/pg-core';
import { createId } from '@paralleldrive/cuid2';
import { repos } from './repos';
import { users } from './users';
import { ccSessions } from './cc-sessions';

export const planRooms = pgTable(
  'plan_rooms',
  {
    id: text('id').primaryKey().$defaultFn(createId), // CUID2 (matches codebase convention; spec says uuid but existing tables use CUID2)
    repoId: text('repo_id').notNull().references(() => repos.id, { onDelete: 'cascade' }),
    ccSessionId: text('cc_session_id').references(() => ccSessions.id, { onDelete: 'set null' }),
    userId: text('user_id').notNull().references(() => users.id),
    status: text('status', { enum: ['live', 'closed'] }).notNull().default('live'),
    gitBranch: text('git_branch'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => ({
    repoIdIdx: index('plan_rooms_repo_id_idx').on(table.repoId),
    statusIdx: index('plan_rooms_status_idx').on(table.status),
    uniqueActiveCcSession: uniqueIndex('plan_rooms_unique_active_cc_session')
      .on(table.ccSessionId)
      .where(sql`status = 'live'`),
  })
);

export const planRoomMessages = pgTable(
  'plan_room_messages',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    planRoomId: text('plan_room_id').notNull().references(() => planRooms.id, { onDelete: 'cascade' }),
    messageType: text('message_type', { enum: ['conversation', 'chat'] }).notNull(),
    userId: text('user_id').references(() => users.id),
    uuid: text('uuid'),
    parentUuid: text('parent_uuid'),
    role: text('role', { enum: ['user', 'assistant', 'system'] }),
    content: jsonb('content').notNull(), // JSON object for conversation content blocks, plain string for chat
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    planRoomIdTypeIdx: index('plan_room_messages_room_type_idx').on(table.planRoomId, table.messageType),
    uniqueConvMsg: uniqueIndex('plan_room_messages_unique_conv')
      .on(table.planRoomId, table.uuid)
      .where(sql`uuid IS NOT NULL`),
  })
);
```

- [ ] **Step 2: Add relations**

In `src/lib/server/db/schema/relations.ts`, add:

```typescript
import { planRooms, planRoomMessages } from './plan-rooms';

export const planRoomsRelations = relations(planRooms, ({ one, many }) => ({
  repo: one(repos, { fields: [planRooms.repoId], references: [repos.id] }),
  user: one(users, { fields: [planRooms.userId], references: [users.id] }),
  ccSession: one(ccSessions, { fields: [planRooms.ccSessionId], references: [ccSessions.id] }),
  messages: many(planRoomMessages),
}));

export const planRoomMessagesRelations = relations(planRoomMessages, ({ one }) => ({
  planRoom: one(planRooms, { fields: [planRoomMessages.planRoomId], references: [planRooms.id] }),
  user: one(users, { fields: [planRoomMessages.userId], references: [users.id] }),
}));
```

- [ ] **Step 3: Export schema from index**

Add to the schema index file (check existing pattern):

```typescript
export { planRooms, planRoomMessages } from './plan-rooms';
```

- [ ] **Step 4: Generate and run migration**

```bash
cd /Users/henghonglee/lightsprint-projects/lightsprint/app
npx drizzle-kit generate
# Review the generated SQL migration
npx drizzle-kit push  # or apply migration
```

- [ ] **Step 5: Commit**

```bash
cd /Users/henghonglee/lightsprint-projects/lightsprint/app
git add src/lib/server/db/schema/plan-rooms.ts src/lib/server/db/schema/relations.ts drizzle/
git commit -m "feat: add plan_rooms and plan_room_messages database schema"
```

---

## Task 6: DAOs (Lightsprint)

**Files:**
- Create: `src/lib/server/dao/plan-room.dao.ts`
- Modify: `src/lib/server/dao/index.ts`

- [ ] **Step 1: Create plan room DAO**

```typescript
// src/lib/server/dao/plan-room.dao.ts
import { BaseDAO } from './BaseDAO';
import { planRooms, planRoomMessages } from '../db/schema/plan-rooms';
import { db } from '../db';
import { eq, and, desc, gt, sql } from 'drizzle-orm';

const PLAN_ROOM_LIST_RELATIONS = {
  user: { columns: { id: true, name: true, avatar: true } },
} as const;

export class PlanRoomDAO extends BaseDAO<typeof planRooms> {
  constructor() {
    super(db, planRooms);
  }

  async findByRepoId(repoId: string, opts?: { status?: string }) {
    const conditions = [eq(planRooms.repoId, repoId)];
    if (opts?.status) conditions.push(eq(planRooms.status, opts.status));
    return db.query.planRooms.findMany({
      where: and(...conditions),
      with: PLAN_ROOM_LIST_RELATIONS,
      orderBy: [desc(planRooms.startedAt)],
    });
  }

  async findActiveByCcSessionId(ccSessionId: string) {
    return db.query.planRooms.findFirst({
      where: and(eq(planRooms.ccSessionId, ccSessionId), eq(planRooms.status, 'live')),
    });
  }

  async closeRoom(roomId: string) {
    return this.updateById(roomId, { status: 'closed', closedAt: new Date() });
  }
}

export class PlanRoomMessageDAO extends BaseDAO<typeof planRoomMessages> {
  constructor() {
    super(db, planRoomMessages);
  }

  async listForRoom(roomId: string, opts?: { type?: string; limit?: number; cursor?: string }) {
    const conditions = [eq(planRoomMessages.planRoomId, roomId)];
    if (opts?.type) conditions.push(eq(planRoomMessages.messageType, opts.type));
    if (opts?.cursor) conditions.push(gt(planRoomMessages.id, opts.cursor)); // Uses CUID2 id as cursor (monotonically sortable)

    return db.query.planRoomMessages.findMany({
      where: and(...conditions),
      with: { user: { columns: { id: true, name: true, avatar: true } } },
      orderBy: [planRoomMessages.timestamp],
      limit: opts?.limit || 100,
    });
  }

  async insertConversationMessage(data: {
    planRoomId: string;
    uuid: string;
    parentUuid?: string;
    role: string;
    content: string;
    timestamp: Date;
  }) {
    // Upsert — ignore duplicates via unique constraint
    return db.insert(planRoomMessages).values({
      planRoomId: data.planRoomId,
      messageType: 'conversation',
      uuid: data.uuid,
      parentUuid: data.parentUuid || null,
      role: data.role,
      content: data.content,
      timestamp: data.timestamp,
    }).onConflictDoNothing();
  }

  async insertChatMessage(data: {
    planRoomId: string;
    userId: string;
    content: string;
  }) {
    const [msg] = await db.insert(planRoomMessages).values({
      planRoomId: data.planRoomId,
      messageType: 'chat',
      userId: data.userId,
      content: data.content,
    }).returning();
    return msg;
  }
}

export const planRoomDAO = new PlanRoomDAO();
export const planRoomMessageDAO = new PlanRoomMessageDAO();
```

- [ ] **Step 2: Export from DAO index**

Add to `src/lib/server/dao/index.ts`:

```typescript
export { PlanRoomDAO, planRoomDAO, PlanRoomMessageDAO, planRoomMessageDAO } from './plan-room.dao';
```

- [ ] **Step 3: Commit**

```bash
cd /Users/henghonglee/lightsprint-projects/lightsprint/app
git add src/lib/server/dao/plan-room.dao.ts src/lib/server/dao/index.ts
git commit -m "feat: add plan room DAOs"
```

---

## Task 7: Server WS Handler for Plan Room Messages (Lightsprint)

**Files:**
- Modify: `server.js` (add `planRoom:start`, `planRoom:end`, `conversation:message` handlers)
- Modify: `src/lib/types/realtime-events.ts`

- [ ] **Step 1: Add realtime event types**

In `src/lib/types/realtime-events.ts`, add to the `RealtimeEvent` union:

```typescript
| { type: 'planRoom.started'; repoId: string; roomId: string; room: any; eventId: string; timestamp: number }
| { type: 'planRoom.closed'; repoId: string; roomId: string; closedAt: string; eventId: string; timestamp: number }
| { type: 'planRoom.message'; repoId: string; roomId: string; message: any; eventId: string; timestamp: number }
| { type: 'planRoom.chat'; repoId: string; roomId: string; message: any; eventId: string; timestamp: number }
```

- [ ] **Step 2: Add WS handlers in server.js**

In the `initCcWebSocket` function's message handler (after the existing `session:end` handler around line 331), add:

```javascript
// Plan room start
if (msg.type === 'planRoom:start' && msg.id) {
  const { ccSessionId, repoId, gitBranch } = msg.data || {};
  try {
    // Check for existing active room (idempotent)
    const existing = await planRoomDAO.findActiveByCcSessionId(ccSessionId);
    if (existing) {
      ws.send(JSON.stringify({ type: 'ack', id: msg.id, ok: true, planRoomId: existing.id }));
      return;
    }

    // NOTE: Verify actual ccSessionDAO method signature — may be findByCcSessionId(repoId, ccSessionId) or similar
    const session = await ccSessionDAO.findByCcSessionId(repoId, ccSessionId);
    const [room] = await planRoomDAO.insert({
      repoId,
      ccSessionId: session?.id || null,
      userId: session?.userId || connState.userId,
      status: 'live',
      gitBranch: gitBranch || null,
    });

    await emit({ type: 'planRoom.started', repoId, roomId: room.id, room });
    ws.send(JSON.stringify({ type: 'ack', id: msg.id, ok: true, planRoomId: room.id }));
  } catch (err) {
    ws.send(JSON.stringify({ type: 'ack', id: msg.id, ok: false, error: err.message }));
  }
  return;
}

// Plan room end
if (msg.type === 'planRoom:end' && msg.id) {
  const { planRoomId } = msg.data || {};
  try {
    if (planRoomId) {
      await planRoomDAO.closeRoom(planRoomId);
      const room = await planRoomDAO.findById(planRoomId);
      if (room) {
        await emit({ type: 'planRoom.closed', repoId: room.repoId, roomId: planRoomId, closedAt: new Date().toISOString() });
      }
    }
    ws.send(JSON.stringify({ type: 'ack', id: msg.id, ok: true }));
  } catch (err) {
    ws.send(JSON.stringify({ type: 'ack', id: msg.id, ok: false, error: err.message }));
  }
  return;
}

// Conversation message (fire-and-forget)
if (msg.type === 'conversation:message') {
  const { planRoomId, uuid, parentUuid, role, content, timestamp } = msg.data || {};
  try {
    await planRoomMessageDAO.insertConversationMessage({
      planRoomId,
      uuid,
      parentUuid,
      role,
      content: typeof content === 'string' ? content : JSON.stringify(content),
      timestamp: new Date(timestamp),
    });

    const room = await planRoomDAO.findById(planRoomId);
    if (room) {
      await emit({
        type: 'planRoom.message',
        repoId: room.repoId,
        roomId: planRoomId,
        message: { uuid, parentUuid, role, content, timestamp },
      });
    }
  } catch (err) {
    // Fire-and-forget — log but don't error
    console.error('conversation:message error:', err.message);
  }
  return;
}
```

- [ ] **Step 3: Add DAO imports to server.js**

At the top of `server.js`, add:

```javascript
import { planRoomDAO, planRoomMessageDAO } from './src/lib/server/dao/index.js';
import { ccSessionDAO } from './src/lib/server/dao/index.js';
```

(Adjust import paths based on existing patterns in server.js)

- [ ] **Step 4: Commit**

```bash
cd /Users/henghonglee/lightsprint-projects/lightsprint/app
git add server.js src/lib/types/realtime-events.ts
git commit -m "feat: add plan room WS handlers and realtime events"
```

---

## Task 8: REST API Endpoints (Lightsprint)

**Files:**
- Create: `src/routes/api/plan-rooms/[id]/messages/+server.ts`
- Create: `src/routes/api/plan-rooms/[id]/+server.ts`

- [ ] **Step 1: Create plan room detail endpoint**

```typescript
// src/routes/api/plan-rooms/[id]/+server.ts
import type { RequestHandler } from './$types';
import { planRoomDAO } from '$lib/server/dao';
import { requireAuth, requireRepoAccess, withErrorHandling } from '$lib/server/api/middleware';
import { success, notFound } from '$lib/server/api/response';

export const GET: RequestHandler = withErrorHandling(async (event) => {
  const session = await requireAuth(event);
  const room = await planRoomDAO.findById(event.params.id);
  if (!room) return notFound('Plan room not found');
  await requireRepoAccess(room.repoId, session.user.id);

  return success(room);
}, 'Failed to get plan room');
```

- [ ] **Step 2: Create messages GET endpoint**

```typescript
// src/routes/api/plan-rooms/[id]/messages/+server.ts
import type { RequestHandler } from './$types';
import { planRoomDAO, planRoomMessageDAO } from '$lib/server/dao';
import { requireAuth, requireRepoAccess, withErrorHandling } from '$lib/server/api/middleware';
import { success, notFound } from '$lib/server/api/response';

export const GET: RequestHandler = withErrorHandling(async (event) => {
  const session = await requireAuth(event);
  const room = await planRoomDAO.findById(event.params.id);
  if (!room) return notFound('Plan room not found');
  await requireRepoAccess(room.repoId, session.user.id);

  const type = event.url.searchParams.get('type') || undefined;
  const limit = Math.min(parseInt(event.url.searchParams.get('limit') || '100'), 500);
  const cursor = event.url.searchParams.get('cursor') || undefined;

  const messages = await planRoomMessageDAO.listForRoom(room.id, { type, limit, cursor });
  return success({ messages });
}, 'Failed to list messages');
```

- [ ] **Step 3: Create chat POST endpoint**

```typescript
// src/routes/api/plan-rooms/[id]/chat/+server.ts
import type { RequestHandler } from './$types';
import { planRoomDAO, planRoomMessageDAO } from '$lib/server/dao';
import { requireAuth, requireRepoAccess, withErrorHandling } from '$lib/server/api/middleware';
import { created, notFound, badRequest } from '$lib/server/api/response';
import { emit } from '$lib/server/realtime';

export const POST: RequestHandler = withErrorHandling(async (event) => {
  const session = await requireAuth(event);
  const room = await planRoomDAO.findById(event.params.id);
  if (!room) return notFound('Plan room not found');
  await requireRepoAccess(room.repoId, session.user.id);

  if (room.status !== 'live') return badRequest('Plan room is closed');

  const body = await event.request.json();
  const { content } = body;
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return badRequest('Content is required');
  }

  const msg = await planRoomMessageDAO.insertChatMessage({
    planRoomId: room.id,
    userId: session.user.id,
    content: content.trim(),
  });

  await emit({
    type: 'planRoom.chat',
    repoId: room.repoId,
    roomId: room.id,
    message: { ...msg, userName: session.user.name, userAvatar: session.user.avatar },
  });

  return created(msg);
}, 'Failed to send message');
```

- [ ] **Step 4: Commit**

```bash
cd /Users/henghonglee/lightsprint-projects/lightsprint/app
git add src/routes/api/plan-rooms/
git commit -m "feat: add plan room REST API endpoints"
```

---

## Task 9: Client-Side Store (Lightsprint)

**Files:**
- Create: `src/lib/stores/plan-rooms.svelte.ts`

- [ ] **Step 1: Create plan rooms store**

```typescript
// src/lib/stores/plan-rooms.svelte.ts
import type { RealtimeEvent } from '$lib/types/realtime-events';

export interface PlanRoomMessage {
  id: string;
  messageType: 'conversation' | 'chat';
  userId?: string;
  userName?: string;
  userAvatar?: string;
  uuid?: string;
  parentUuid?: string;
  role?: 'user' | 'assistant';
  content: any;
  timestamp: string;
}

export interface PlanRoom {
  id: string;
  repoId: string;
  ccSessionId?: string;
  userId: string;
  userName?: string;
  userAvatar?: string;
  status: 'live' | 'closed';
  gitBranch?: string;
  startedAt: string;
  closedAt?: string;
  messages: PlanRoomMessage[];
}

let rooms = $state<PlanRoom[]>([]);
let loading = $state(false);
let realtimeUnsub: (() => void) | null = null;
let currentRepoId: string | null = null;

function handleRealtimeEvent(event: RealtimeEvent) {
  if (event.type === 'planRoom.started') {
    const existing = rooms.find(r => r.id === event.roomId);
    if (!existing) {
      rooms = [{ ...event.room, messages: [] } as PlanRoom, ...rooms];
    }
  } else if (event.type === 'planRoom.closed') {
    rooms = rooms.map(r =>
      r.id === event.roomId ? { ...r, status: 'closed' as const, closedAt: event.closedAt } : r
    );
  } else if (event.type === 'planRoom.message') {
    rooms = rooms.map(r => {
      if (r.id !== event.roomId) return r;
      // Dedup by uuid
      if (event.message.uuid && r.messages.some(m => m.uuid === event.message.uuid)) return r;
      return { ...r, messages: [...r.messages, event.message] };
    });
  } else if (event.type === 'planRoom.chat') {
    rooms = rooms.map(r => {
      if (r.id !== event.roomId) return r;
      return { ...r, messages: [...r.messages, { ...event.message, messageType: 'chat' as const }] };
    });
  }
}

export function initPlanRooms(repoId: string, realtime: any) {
  currentRepoId = repoId;
  loading = true;

  realtimeUnsub = realtime.on(handleRealtimeEvent);

  fetch(`/api/cc-sessions?repoId=${repoId}&includePlanRooms=true`)
    .then(r => r.json())
    .then(data => {
      if (data.planRooms) {
        rooms = data.planRooms.map((r: any) => ({ ...r, messages: [] }));
      }
    })
    .finally(() => { loading = false; });
}

export function destroyPlanRooms() {
  if (realtimeUnsub) { realtimeUnsub(); realtimeUnsub = null; }
  rooms = [];
  currentRepoId = null;
}

export async function fetchRoomMessages(roomId: string) {
  const convResp = await fetch(`/api/plan-rooms/${roomId}/messages?type=conversation&limit=500`);
  const chatResp = await fetch(`/api/plan-rooms/${roomId}/messages?type=chat&limit=500`);
  const convData = await convResp.json();
  const chatData = await chatResp.json();

  const allMessages = [...(convData.messages || []), ...(chatData.messages || [])]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  rooms = rooms.map(r =>
    r.id === roomId ? { ...r, messages: allMessages } : r
  );
}

export async function sendChatMessage(roomId: string, content: string) {
  await fetch(`/api/plan-rooms/${roomId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

export function getPlanRooms() {
  return {
    get rooms() { return rooms; },
    get liveRooms() { return rooms.filter(r => r.status === 'live'); },
    get loading() { return loading; },
  };
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/henghonglee/lightsprint-projects/lightsprint/app
git add src/lib/stores/plan-rooms.svelte.ts
git commit -m "feat: add plan rooms client-side store"
```

---

## Task 10: Plan Room UI Component (Lightsprint)

**Files:**
- Create: `src/lib/components/sessions/PlanRoomCard.svelte`

- [ ] **Step 1: Create PlanRoomCard component**

This component renders a single plan room card with the conversation stream + team chat. Follow the design from the mockup (terracotta accents, terminal-style Claude responses, presence avatars). Reference the existing sessions page patterns and Lightsprint design system.

The component should:
- Show the plan room header (live dot, title, badge, branch, presence avatars, chevron)
- When expanded, show a two-panel layout: conversation stream (left) + team chat (right)
- User messages: avatar + Inter font, terracotta sender name
- Claude messages: no avatar, terminal-style block (JetBrains Mono / font-mono), green sender name
- Tool use indicators collapsed inline
- Thinking indicator with blinking cursor
- Chat input with send button (disabled when room is closed)
- Auto-scroll conversation feed on new messages

Key props:
```typescript
{
  room: PlanRoom;
  isExpanded: boolean;
  onToggle: () => void;
}
```

This component is large enough that the implementor should build it incrementally, following the design mockup at `/Users/henghonglee/lightsprint-projects/session-window/.superpowers/brainstorm/21450-1774167360/ui-layout-v4.html` (in the plugin repo, not the Lightsprint app repo).

Key visual requirements from mockup:
- Terracotta accent (#E58866) for plan room badges, live dot animation (orange ping), user sender names
- Claude messages: no avatar, dark terminal block (bg `rgba(255,255,255,0.02)`), green sender name (#5EB87A), JetBrains Mono / `font-mono`
- User messages: circular avatar with muted palette, Inter font
- Tool use: collapsed inline indicators
- Thinking: blinking cursor animation

- [ ] **Step 2: Commit**

```bash
cd /Users/henghonglee/lightsprint-projects/lightsprint/app
git add src/lib/components/sessions/PlanRoomCard.svelte
git commit -m "feat: add PlanRoomCard component"
```

---

## Task 11: Sessions Page Integration (Lightsprint)

**Files:**
- Modify: `src/routes/repos/[id]/sessions/+page.svelte`
- Modify: `src/routes/repos/[id]/sessions/+page.server.ts`

- [ ] **Step 1: Update page server to load plan rooms**

In `+page.server.ts`, add plan rooms to the load function's return data. Query `planRoomDAO.findByRepoId(repo.id)` and return alongside existing data.

- [ ] **Step 2: Add plan rooms section to page**

In `+page.svelte`:
1. Import `PlanRoomCard` and plan room store functions
2. Init plan rooms store alongside CC sessions in `onMount`
3. Add "Plan Rooms" section header above the existing "Sessions" section
4. Render `PlanRoomCard` for each plan room
5. Add a divider between the plan rooms and sessions sections
6. Handle deep-linking via `?roomId=` query param (similar to existing `?sessionId=`)

Key additions to the template (insert before the sessions list):

```svelte
{#if planRoomStore.rooms.length > 0 || planRoomStore.liveRooms.length > 0}
  <div class="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mt-1">
    Plan Rooms
  </div>
  {#each planRoomStore.rooms as room (room.id)}
    <PlanRoomCard
      {room}
      isExpanded={expandedRooms.has(room.id) || room.status === 'live'}
      onToggle={() => toggleRoom(room.id)}
    />
  {/each}
  <hr class="border-[var(--border)] my-2" />
  <div class="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
    Sessions
  </div>
{/if}
```

- [ ] **Step 3: Clean up and destroy stores on unmount**

In `onDestroy`, add `destroyPlanRooms()`.

- [ ] **Step 4: Commit**

```bash
cd /Users/henghonglee/lightsprint-projects/lightsprint/app
git add src/routes/repos/[id]/sessions/
git commit -m "feat: integrate plan rooms into sessions page"
```

---

## Task 12: E2E Tests (Plugin)

**Files:**
- Create: `scripts/__tests__/plan-room-e2e.test.js`

- [ ] **Step 1: Write E2E tests for plan room lifecycle**

Test the full flow using the existing mock server pattern from `e2e-mock-server.test.js`:

1. Start daemon → start room → verify WS `planRoom:start` sent → verify ack received
2. Append to JSONL → verify `conversation:message` sent over WS
3. Stop room → verify `planRoom:end` sent
4. Session end → verify auto-close if room was active
5. Start room when already active → verify 409 error
6. Start room when WS disconnected → verify 503 error

Follow the existing test patterns: `createMockServer()`, spawn daemon, HTTP POST to daemon endpoints.

- [ ] **Step 2: Run tests**

```bash
cd /Users/henghonglee/lightsprint-projects/session-window
npm test -- scripts/__tests__/plan-room-e2e.test.js
```

- [ ] **Step 3: Commit**

```bash
cd /Users/henghonglee/lightsprint-projects/session-window
git add scripts/__tests__/plan-room-e2e.test.js
git commit -m "test: add plan room E2E tests"
```

---

## Task 13: Socket.IO Presence for Plan Rooms (Lightsprint)

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add plan room presence handlers**

In `server.js`, add Socket.IO event handlers for plan room presence (alongside existing `presence:viewTask`, `presence:viewPlan`):

```javascript
socket.on('presence:viewPlanRoom', ({ repoId, roomId }) => {
  const repoPresence = presenceMap.get(repoId);
  if (repoPresence) {
    const user = repoPresence.get(socket.id);
    if (user) {
      user.viewingPlanRoomId = roomId;
      broadcastPresence(repoId);
    }
  }
});

socket.on('presence:leavePlanRoom', ({ repoId }) => {
  const repoPresence = presenceMap.get(repoId);
  if (repoPresence) {
    const user = repoPresence.get(socket.id);
    if (user) {
      delete user.viewingPlanRoomId;
      broadcastPresence(repoId);
    }
  }
});
```

- [ ] **Step 2: Update getPresenceUsers to include viewingPlanRoomId**

Make sure `getPresenceUsers` includes the new field in its deduplication/merge logic.

- [ ] **Step 3: Commit**

```bash
cd /Users/henghonglee/lightsprint-projects/lightsprint/app
git add server.js
git commit -m "feat: add plan room presence tracking"
```
