# Expose Review Hub, Merge, and Create-PR to CLI

**Date:** 2026-04-05
**Status:** Draft

## Problem

The Lightsprint app has review hub (signals + AI scores), cloud agent create-pr, and PR merge functionality available via API, but none of it is accessible from the CLI plugin. AI agents working in Claude Code sessions cannot inspect PR readiness, merge PRs, or create PRs from agent branches without leaving the terminal.

## Scope

Add 5 new capabilities to the CLI and corresponding skills:

1. `review-hub signals` — read/refresh PR signals
2. `review-hub scores` — read/trigger AI readiness scores
3. `agent create-pr` — create PR from cloud agent branch
4. `merge` — merge a task's linked PR
5. `agent settings` — already exists in CLI, just needs a dedicated skill

Item 5 (`agent settings`) already has a CLI command and is documented in the `agent` skill. It only needs a dedicated skill file for discoverability. No CLI changes needed.

## Design

### Command: `lightsprint review-hub signals <taskId>`

**Purpose:** Get PR signals (CI checks, reviews, comments, deployments) for a task's linked PR.

**CLI routing:** New top-level command `review-hub` with subcommand router (same pattern as `agent`).

**Args:**
- Positional or `--task <taskId>` — task ID (required)
- `--refresh` — force re-fetch signals from GitHub (POST instead of GET)
- Standard global options: `--output json|text`, `--fields`, `--dry-run`

**Resolution flow:**
1. Validate task ID
2. `GET /api/tasks/{taskId}` to get task details (need linked PR ID)
3. Extract `pr.id` (the internal `githubPullRequests.id`, not the PR number)
4. If no PR linked, error: `"No PR linked to task {taskId}. Use 'lightsprint link-pr' first."`
5. Without `--refresh`: `GET /api/review-hub/{prId}/signals`
6. With `--refresh`: `POST /api/review-hub/{prId}/signals`
7. Return signals array + metadata

**JSON output shape:**
```json
{
  "signals": [
    {
      "id": "string",
      "category": "ci|review|deployment|bot_comment|human_comment|custom",
      "status": "success|failure|pending|running|neutral|warning",
      "title": "string",
      "signalBody": "string|null",
      "url": "string|null",
      "actorLogin": "string|null",
      "scoreValue": "number|null",
      "scoreLabel": "string|null",
      "updatedAt": "timestamp"
    }
  ],
  "lastViewedAt": "timestamp|null",
  "ownerAgentType": "cursor|anthropic|codex|cc_session|null",
  "ownerAgentId": "string|null",
  "additions": "number|null",
  "deletions": "number|null",
  "changedFiles": "number|null",
  "signalCount": "number (only with --refresh)"
}
```

**Text output:** Table-style summary:
```
Signals for task LIG-024 (PR #42):
  CI     ✓ build       success    https://...
  CI     ✗ lint        failure    https://...
  Review ✓ alice       approved
  Comment  bob         "Looks good, one nit"
  
3 signals | Last viewed: 2026-04-05T10:00:00Z
```

**Schema entry:** `'review-hub-signals'` in `COMMAND_SCHEMAS`.

---

### Command: `lightsprint review-hub scores <taskId>`

**Purpose:** Get AI readiness analysis for a task's linked PR.

**Args:**
- Positional or `--task <taskId>` — task ID (required)
- `--refresh` — trigger fresh AI analysis (consumes credits)
- Standard global options: `--output json|text`, `--fields`

**Resolution flow:**
1. Validate task ID
2. Resolve task → linked PR ID (same as signals)
3. Without `--refresh`: `GET /api/review-hub/{prId}/ai-overlay`
   - This is an SSE endpoint. The server returns cached data if the signals hash hasn't changed, or streams a fresh analysis if stale/missing.
   - The CLI must consume the stream regardless:
     - If the first event is `complete` with cached data → return it immediately
     - If it streams `progress` events → wait silently until `complete` or `error`
     - If `error` event → throw with error message
     - If no signals exist, the server returns an empty 200 → return `{ readinessScore: null, message: "No signals found. Link a PR and wait for CI/reviews first." }`
   - This means even without `--refresh`, the endpoint may trigger analysis (if cache is stale). The distinction is: without `--refresh` you get analysis based on current signals; with `--refresh` you first force-fetch fresh signals from GitHub.
4. With `--refresh`:
   - First `POST /api/review-hub/{prId}/signals` (force refresh signals from GitHub, clears AI cache)
   - Then `GET /api/review-hub/{prId}/ai-overlay` (triggers fresh analysis since cache was cleared)
   - Consume SSE stream as above

**SSE consumption implementation:**
```javascript
// Use native fetch with streaming response
const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = '';

// Parse SSE events from stream
// Return only the final 'complete' event payload
```

Note: Cannot use the existing `apiRequest()` helper since it expects JSON. Need a new `apiRequestSSE()` helper in `client.js` that:
- Handles SSE protocol (event: / data: lines)
- Returns the final complete event payload as parsed JSON
- Throws on error events
- Has a timeout (default 120s for AI analysis)

**JSON output shape (when scores exist):**
```json
{
  "readinessScore": "number (0-100)",
  "readinessLabel": "string",
  "sectionSummaries": { "key": "summary string" },
  "changeCallouts": ["string"],
  "suggestedActions": ["string"],
  "addressal": "object|null",
  "updatedAt": "timestamp"
}
```

**JSON output shape (no cached scores, without --refresh):**
```json
{
  "readinessScore": null,
  "message": "No cached scores. Use --refresh to trigger AI analysis (consumes credits)."
}
```

**Text output:**
```
AI Readiness for task LIG-024 (PR #42):
  Score: 82/100 (Ready with minor issues)
  
  Sections:
    Code Quality: Clean implementation, follows patterns
    Test Coverage: Missing edge case tests for auth flow
    
  Callouts:
    - Large file change in src/auth/handler.ts (200+ lines)
    
  Suggested Actions:
    - Add tests for the error path in validateToken()
```

**Schema entry:** `'review-hub-scores'` in `COMMAND_SCHEMAS`.

---

### Command: `lightsprint agent create-pr <taskId>`

**Purpose:** Create a GitHub PR from a cloud agent's working branch.

**CLI routing:** New subcommand under existing `agent` router.

**Args:**
- `--task <taskId>` — task ID (required)
- `--provider <anthropic|cursor|codex>` — provider (required)
- `--agent-id <id>` — agent ID (required)
- Standard global options: `--output json|text`, `--dry-run`

**Resolution flow:**
1. Validate task ID, provider, agent ID
2. Resolve task ID
3. `POST /api/tasks/{taskId}/cloud-agents/{provider}/{agentId}/create-pr`
4. Return PR details

**JSON output shape:**
```json
{
  "success": true,
  "prUrl": "string",
  "prNumber": "number",
  "title": "string"
}
```

**Text output:**
```
PR created for task LIG-024:
  #42: Fix authentication bug
  https://github.com/owner/repo/pull/42
```

**Schema entry:** `'agent-create-pr'` in `COMMAND_SCHEMAS`.

---

### Command: `lightsprint merge <taskId>`

**Purpose:** Merge the GitHub PR linked to a task.

**Args:**
- Positional or `--task <taskId>` — task ID (required)
- Standard global options: `--output json|text`, `--dry-run`

**Resolution flow:**
1. Validate task ID
2. Resolve task ID
3. `POST /api/tasks/{taskId}/pr/merge`
4. Return merge result

**JSON output shape:**
```json
{
  "success": true,
  "pr": {
    "prUrl": "string",
    "prNumber": "number",
    "status": "merged|queued",
    "title": "string|null",
    "sha": "string (only if merged, not queued)"
  }
}
```

**Text output:**
```
PR #42 merged for task LIG-024
  Status: merged
  SHA: abc123def
  https://github.com/owner/repo/pull/42
```

Or for merge queue:
```
PR #42 queued for merge (task LIG-024)
  https://github.com/owner/repo/pull/42
```

**Error handling:**
- No PR linked → clear error with suggestion to use `link-pr`
- Already merged/closed → clear error with current status
- Merge conflict (409) → clear error
- Checks not passing (422) → clear error listing what's blocking
- Permissions issue → clear error

**Schema entry:** `'merge'` in `COMMAND_SCHEMAS`.

---

### Skill: `skills/agent-settings/SKILL.md` (dedicated skill for discoverability)

This is a thin wrapper pointing to the existing `agent settings` subcommand. No CLI changes needed — just a skill file so it appears in the skill list separately from the full `agent` skill.

---

## Implementation Details

### Files to modify:

1. **`scripts/ls-cli.js`** — Add:
   - `case 'review-hub':` in main switch → `cmdReviewHub(remainingArgs, opts)`
   - `case 'merge':` in main switch → `cmdMerge(remainingArgs, opts)`
   - `cmdReviewHub(args, opts)` — subcommand router for `signals` / `scores`
   - `cmdReviewHubSignals(args, opts)` — signals implementation
   - `cmdReviewHubScores(args, opts)` — scores implementation (SSE consumer)
   - `cmdAgentCreatePr(args, opts)` — create-pr implementation
   - Add `'create-pr'` case to `cmdAgent` switch
   - `cmdMerge(args, opts)` — merge implementation
   - Update `showHelp()` with new commands

2. **`scripts/lib/client.js`** — Add:
   - `apiRequestSSE(path, options)` — SSE stream consumer that returns final `complete` event payload. Timeout: 120s default. Reuses auth token refresh logic.

3. **`scripts/lib/schema.js`** — Add schema entries:
   - `'review-hub-signals'`
   - `'review-hub-scores'`
   - `'agent-create-pr'`
   - `'merge'`

4. **`scripts/lib/validate.js`** — Add:
   - `validateRefreshFlag(value)` — boolean validation (just ensure it's a flag, no value needed)

5. **New skill files:**
   - `skills/review-hub-signals/SKILL.md`
   - `skills/review-hub-scores/SKILL.md`
   - `skills/agent-create-pr/SKILL.md`
   - `skills/agent-settings/SKILL.md`
   - `skills/merge/SKILL.md`

6. **`.claude-plugin`** — Register new skills in the plugin manifest.

### Task-to-PR resolution helper

Multiple commands need to go from task ID → internal PR ID. Extract a shared helper:

```javascript
async function resolveTaskPrId(taskIdInput) {
  const taskId = await resolveTaskId(taskIdInput);
  const task = await apiRequest(`/api/tasks/${taskId}`);
  if (!task.pr?.id) {
    throw new Error(`No PR linked to task ${taskIdInput}. Use 'lightsprint link-pr' first.`);
  }
  return { taskId, prId: task.pr.id, prNumber: task.pr.prNumber, prUrl: task.pr.prUrl };
}
```

### SSE client implementation

The AI overlay endpoint uses Server-Sent Events. The CLI needs to consume this without depending on an EventSource polyfill. Implementation using native fetch + ReadableStream:

```javascript
export async function apiRequestSSE(path, { timeout = 120_000 } = {}) {
  const cfg = await config();
  await refreshTokenIfNeeded();
  
  const url = `${cfg.baseUrl}${path}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: {
      'Authorization': `Bearer ${cfg.accessToken}`,
      'Accept': 'text/event-stream'
    }
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${response.status}: ${text}`);
  }
  
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));
        if (data.type === 'complete') return data;
        if (data.type === 'error') throw new Error(data.message || 'AI analysis failed');
        // 'progress' events: silently continue
      }
    }
  }
  
  throw new Error('SSE stream ended without a complete event');
}
```

## Invariants for Skills

Each skill file must encode these agent-facing invariants:

- **review-hub signals:** "Use `--refresh` sparingly — it re-fetches all signals from GitHub. Default read is usually sufficient. Check signals before scores to understand what the AI is analyzing."
- **review-hub scores:** "Scores cost credits when using `--refresh`. Always read cached scores first. If null, decide whether fresh analysis is worth the credit cost. Scores are based on signals — if signals are stale, refresh signals first, then refresh scores."
- **agent create-pr:** "Only works for agents in FINISHED status. Check agent status with `lightsprint get <taskId>` first. Requires `--agent-id` which can be found in the task's agent details."
- **merge:** "Always check review-hub signals/scores before merging to ensure PR is ready. If merge returns 'queued', the repo uses GitHub merge queue — the PR will be merged automatically when checks pass."
- **agent-settings:** "Check settings before launching agents to verify provider is configured. If codex, also fetch environments with `--provider codex`."
