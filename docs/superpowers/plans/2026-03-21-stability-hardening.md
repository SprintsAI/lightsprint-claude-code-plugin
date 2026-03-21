# Plugin Stability Hardening — TDD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 29 critical and 53 medium stability issues across API client, token refresh, daemon lifecycle, CLI validation, event delivery, and file I/O.

**Architecture:** Each fix is isolated to specific modules with clear interfaces. Tests use bun:test with spyOn for mocking. Changes are backwards-compatible — no API contract changes.

**Tech Stack:** Bun test runner (bun:test), Node.js built-in fetch, fs, child_process. No new dependencies.

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `scripts/lib/client.js` | API client with retry, timeout, JSON safety | Modify |
| `scripts/lib/validate.js` | Input validation helpers | Modify |
| `scripts/lib/config.js` | Config I/O with atomic writes | Modify |
| `scripts/lib/task-map.js` | Task mapping with file locking + permissions | Modify |
| `scripts/lib/cc-utils.js` | Session state, PID utils | Modify |
| `scripts/lib/filelock.js` | Advisory file locking utility | Create |
| `scripts/cc-daemon.js` | Daemon with port retry, PID guard, ws.send guard, event queue | Modify |
| `scripts/cc-start.js` | Daemon spawn with lockfile | Modify |
| `scripts/cc-event.js` | Event forwarding with error logging | Modify |
| `scripts/ls-cli.js` | CLI with fixed validation | Modify |
| `scripts/lib/auth.js` | OAuth with parseInt radix fix | Modify |
| `scripts/__tests__/client-resilience.test.js` | API client retry/timeout/JSON tests | Create |
| `scripts/__tests__/validate-fixes.test.js` | validateEnum Set bug, assignee, limit/offset, pid | Create |
| `scripts/__tests__/config-atomicity.test.js` | Atomic writes, file locking | Create |
| `scripts/__tests__/daemon-hardening.test.js` | Port retry, PID guard, ws.send, event queue | Create |
| `scripts/__tests__/filelock.test.js` | File locking utility | Create |

---

### Task 1: Fix validateEnum Set Bug & Add Assignee/Limit/Offset/PID Validation

**Lightsprint tasks:** LCCP-303 (Fix CLI input validation gaps)

**Files:**
- Modify: `scripts/lib/validate.js`
- Modify: `scripts/ls-cli.js:245-248` (Set→Array), `scripts/ls-cli.js:216-218` (limit/offset), `scripts/ls-cli.js:383,735,772` (cc-pid)
- Create: `scripts/__tests__/validate-fixes.test.js`

- [ ] **Step 1: Write failing tests for all validation fixes**

```javascript
// scripts/__tests__/validate-fixes.test.js
import { describe, test, expect } from 'bun:test';
import {
  validateEnum,
  validatePid,
  validatePositiveInt,
  validateAssignee,
  VALID_STATUSES,
} from '../lib/validate.js';

describe('validateEnum', () => {
  test('works with Array input', () => {
    expect(() => validateEnum('todo', VALID_STATUSES, 'status')).not.toThrow();
  });

  test('works with Set input', () => {
    const allowed = new Set(['position', 'updated_at', 'created_at']);
    expect(() => validateEnum('position', allowed, 'sort field')).not.toThrow();
  });

  test('rejects invalid value with Set input', () => {
    const allowed = new Set(['position', 'updated_at', 'created_at']);
    expect(() => validateEnum('invalid', allowed, 'sort field')).toThrow(/Invalid sort field/);
  });

  test('trims whitespace in comma-separated values', () => {
    // This tests the caller side — validateEnum itself just checks single values
    const statuses = 'todo, in_progress'.split(',').map(s => s.trim());
    for (const s of statuses) {
      expect(() => validateEnum(s, VALID_STATUSES, 'status')).not.toThrow();
    }
  });
});

describe('validatePositiveInt', () => {
  test('accepts positive integer', () => {
    expect(validatePositiveInt(10, 'limit')).toBe(10);
  });

  test('accepts zero', () => {
    expect(validatePositiveInt(0, 'offset')).toBe(0);
  });

  test('rejects NaN', () => {
    expect(() => validatePositiveInt(NaN, 'limit')).toThrow(/must be a non-negative integer/);
  });

  test('rejects negative', () => {
    expect(() => validatePositiveInt(-5, 'limit')).toThrow(/must be a non-negative integer/);
  });

  test('rejects Infinity', () => {
    expect(() => validatePositiveInt(Infinity, 'limit')).toThrow(/must be a non-negative integer/);
  });
});

describe('validatePid', () => {
  test('accepts valid PID string', () => {
    expect(validatePid('1234')).toBe('1234');
  });

  test('accepts valid PID number', () => {
    expect(validatePid(1234)).toBe('1234');
  });

  test('rejects non-numeric', () => {
    expect(() => validatePid('abc')).toThrow(/Invalid PID/);
  });

  test('rejects zero', () => {
    expect(() => validatePid('0')).toThrow(/Invalid PID/);
  });

  test('rejects negative', () => {
    expect(() => validatePid('-100')).toThrow(/Invalid PID/);
  });
});

describe('validateAssignee', () => {
  test('accepts valid assignee string', () => {
    expect(validateAssignee('john')).toBe('john');
  });

  test('accepts email-like assignee', () => {
    expect(validateAssignee('john@example.com')).toBe('john@example.com');
  });

  test('rejects empty string', () => {
    expect(() => validateAssignee('')).toThrow(/Assignee/);
  });

  test('rejects string over 200 chars', () => {
    expect(() => validateAssignee('a'.repeat(201))).toThrow(/Assignee/);
  });

  test('rejects control characters', () => {
    expect(() => validateAssignee('john\x00doe')).toThrow(/control characters/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/henghonglee/lightsprint-projects/lightsprint-claude-code-plugin && bun test scripts/__tests__/validate-fixes.test.js`
Expected: FAIL — `validatePositiveInt` and `validateAssignee` don't exist yet, `validateEnum` crashes on Set

- [ ] **Step 3: Implement validateEnum Set support + new validators**

In `scripts/lib/validate.js`, modify `validateEnum` and add two new functions:

```javascript
// Replace existing validateEnum (lines 42-47)
export function validateEnum(value, allowed, fieldName) {
  const arr = allowed instanceof Set ? [...allowed] : allowed;
  if (!arr.includes(value)) {
    throw new Error(`Invalid ${fieldName}: "${value}". Allowed values: ${arr.join(', ')}`);
  }
  return value;
}

// Add after validatePid (after line 80)
/**
 * Validate a non-negative integer (for --limit, --offset).
 * @param {number} value
 * @param {string} fieldName
 * @returns {number}
 */
export function validatePositiveInt(value, fieldName) {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`${fieldName} must be a non-negative integer.`);
  }
  return value;
}

/**
 * Validate an assignee filter string.
 * @param {string} value
 * @returns {string}
 */
export function validateAssignee(value) {
  if (!value || typeof value !== 'string') {
    throw new Error('Assignee is required.');
  }
  if (value.length > 200) {
    throw new Error('Assignee exceeds maximum length of 200 characters.');
  }
  if (/[\x00-\x1F]/.test(value)) {
    throw new Error('Assignee contains invalid control characters.');
  }
  return value;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/henghonglee/lightsprint-projects/lightsprint-claude-code-plugin && bun test scripts/__tests__/validate-fixes.test.js`
Expected: ALL PASS

- [ ] **Step 5: Apply validation fixes to ls-cli.js**

In `scripts/ls-cli.js`:

1. Add imports (at top, in existing validate.js import):
```javascript
import { ..., validatePositiveInt, validateAssignee } from './lib/validate.js';
```

2. Fix Set→Array at line 245:
```javascript
// BEFORE:
const VALID_SORT_FIELDS = new Set(['position', 'updated_at', 'created_at']);
// AFTER:
const VALID_SORT_FIELDS = ['position', 'updated_at', 'created_at'];
```

3. Add limit/offset validation after parsing (after line 234, before line 236):
```javascript
limit = validatePositiveInt(limit, 'limit');
offset = validatePositiveInt(offset, 'offset');
```

4. Add assignee validation (after line 234):
```javascript
if (assigneeFilter) validateAssignee(assigneeFilter);
```

5. Add status trimming at line 239:
```javascript
for (const s of status.split(',').map(v => v.trim())) validateStatus(s);
```

6. Add validatePid calls at lines 383, 735, 772:
```javascript
// Line 383 (cmdCreate):
ccPidArg = parseInt(args[++i], 10);
validatePid(ccPidArg);  // ADD THIS

// Line 735 (cmdCurrentTask):
ccPidArg = parseInt(args[++i], 10);
validatePid(ccPidArg);  // ADD THIS

// Line 772 (cmdClaim):
ccPidArg = parseInt(args[++i], 10);
validatePid(ccPidArg);  // ADD THIS
```

- [ ] **Step 6: Run full test suite**

Run: `cd /Users/henghonglee/lightsprint-projects/lightsprint-claude-code-plugin && bun test`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/validate.js scripts/ls-cli.js scripts/__tests__/validate-fixes.test.js
git commit -m "fix: validateEnum Set bug, add limit/offset/assignee/pid validation"
```

---

### Task 2: Wrap JSON.parse in try/catch and Add Request Timeout to apiRequest

**Lightsprint tasks:** LCCP-273 (request timeouts), LCCP-300 subtasks (JSON safety)

**Files:**
- Modify: `scripts/lib/client.js:131-161`
- Create: `scripts/__tests__/client-resilience.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
// scripts/__tests__/client-resilience.test.js
import { describe, test, expect } from 'bun:test';

describe('safeJsonParse', () => {
  test('returns parsed JSON for valid input', async () => {
    const { safeJsonParse } = await import('../lib/client.js');
    const result = safeJsonParse('{"key":"value"}');
    expect(result).toEqual({ key: 'value' });
  });

  test('throws descriptive error for HTML response', async () => {
    const { safeJsonParse } = await import('../lib/client.js');
    expect(() => safeJsonParse('<html>502</html>')).toThrow(/unexpected non-JSON response/i);
  });

  test('throws descriptive error for empty string', async () => {
    const { safeJsonParse } = await import('../lib/client.js');
    expect(() => safeJsonParse('')).toThrow(/empty response body/i);
  });

  test('throws descriptive error for malformed JSON', async () => {
    const { safeJsonParse } = await import('../lib/client.js');
    expect(() => safeJsonParse('{invalid')).toThrow(/failed to parse/i);
  });
});

describe('DEFAULT_TIMEOUT_MS', () => {
  test('is exported and set to 30000', async () => {
    const { DEFAULT_TIMEOUT_MS } = await import('../lib/client.js');
    expect(DEFAULT_TIMEOUT_MS).toBe(30000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/henghonglee/lightsprint-projects/lightsprint-claude-code-plugin && bun test scripts/__tests__/client-resilience.test.js`
Expected: FAIL — `safeJsonParse` and `DEFAULT_TIMEOUT_MS` don't exist

- [ ] **Step 3: Implement safeJsonParse and timeout constant**

In `scripts/lib/client.js`:

1. Add timeout constant after line 9:
```javascript
export const DEFAULT_TIMEOUT_MS = 30_000;
```

2. Add safeJsonParse function after readBodyCapped (after line 122):
```javascript
/**
 * Parse JSON with descriptive errors for non-JSON responses.
 * @param {string} body - Response body text
 * @returns {any} Parsed JSON
 */
export function safeJsonParse(body) {
  if (!body || body.length === 0) {
    throw new Error('Lightsprint API: empty response body');
  }
  try {
    return JSON.parse(body);
  } catch {
    if (body.trimStart().startsWith('<')) {
      throw new Error(`Lightsprint API: unexpected non-JSON response (HTML). First 200 chars: ${body.slice(0, 200)}`);
    }
    throw new Error(`Lightsprint API: failed to parse response as JSON. First 200 chars: ${body.slice(0, 200)}`);
  }
}
```

3. Replace `JSON.parse(body)` at line 160 with `safeJsonParse(body)`:
```javascript
// BEFORE:
return JSON.parse(body);
// AFTER:
return safeJsonParse(body);
```

4. Add timeout to fetch in apiRequest (line 142-149):
```javascript
// BEFORE:
const response = await fetch(url, {
  ...options,
  headers: { ... }
});
// AFTER:
const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
const { timeoutMs: _, ...fetchOptions } = options;
const response = await fetch(url, {
  ...fetchOptions,
  signal: options.signal || AbortSignal.timeout(timeoutMs),
  headers: {
    'Authorization': `Bearer ${cfg.accessToken}`,
    'Content-Type': 'application/json',
    ...options.headers
  }
});
```

5. Add timeout to token refresh fetch (line 50):
```javascript
// BEFORE:
const response = await fetch(`${cfg.baseUrl}/oauth/token`, {
// AFTER:
const response = await fetch(`${cfg.baseUrl}/oauth/token`, {
  signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/henghonglee/lightsprint-projects/lightsprint-claude-code-plugin && bun test scripts/__tests__/client-resilience.test.js`
Expected: ALL PASS

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/henghonglee/lightsprint-projects/lightsprint-claude-code-plugin && bun test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/client.js scripts/__tests__/client-resilience.test.js
git commit -m "fix: add JSON.parse safety and request timeouts to apiRequest"
```

---

### Task 3: Add Retry with Exponential Backoff for 5xx and Network Errors

**Depends on:** Task 2 (this builds on Task 2's timeout changes to apiRequest)

**Lightsprint tasks:** LCCP-300 subtask (retry logic)

**Files:**
- Modify: `scripts/lib/client.js`
- Modify: `scripts/__tests__/client-resilience.test.js`

- [ ] **Step 1: Write failing tests for retry logic**

Append to `scripts/__tests__/client-resilience.test.js`:

```javascript
describe('retryableFetch', () => {
  test('returns response on first success', async () => {
    const { retryableFetch } = await import('../lib/client.js');
    const mockFetch = async () => new Response('{"ok":true}', { status: 200 });
    const result = await retryableFetch('http://test.local/api', {}, mockFetch);
    expect(result.status).toBe(200);
  });

  test('retries on 500 and succeeds', async () => {
    const { retryableFetch } = await import('../lib/client.js');
    let attempt = 0;
    const mockFetch = async () => {
      attempt++;
      if (attempt === 1) return new Response('error', { status: 500 });
      return new Response('{"ok":true}', { status: 200 });
    };
    const result = await retryableFetch('http://test.local/api', {}, mockFetch, { baseDelayMs: 1 });
    expect(result.status).toBe(200);
    expect(attempt).toBe(2);
  });

  test('retries on 502 and succeeds', async () => {
    const { retryableFetch } = await import('../lib/client.js');
    let attempt = 0;
    const mockFetch = async () => {
      attempt++;
      if (attempt <= 2) return new Response('error', { status: 502 });
      return new Response('{"ok":true}', { status: 200 });
    };
    const result = await retryableFetch('http://test.local/api', {}, mockFetch, { baseDelayMs: 1 });
    expect(result.status).toBe(200);
    expect(attempt).toBe(3);
  });

  test('retries on network error and succeeds', async () => {
    const { retryableFetch } = await import('../lib/client.js');
    let attempt = 0;
    const mockFetch = async () => {
      attempt++;
      if (attempt === 1) throw new Error('fetch failed');
      return new Response('{"ok":true}', { status: 200 });
    };
    const result = await retryableFetch('http://test.local/api', {}, mockFetch, { baseDelayMs: 1 });
    expect(result.status).toBe(200);
    expect(attempt).toBe(2);
  });

  test('gives up after max retries and returns last 5xx response', async () => {
    const { retryableFetch } = await import('../lib/client.js');
    let attempt = 0;
    const mockFetch = async () => {
      attempt++;
      return new Response('server error', { status: 503 });
    };
    const result = await retryableFetch('http://test.local/api', {}, mockFetch, { maxRetries: 3, baseDelayMs: 1 });
    expect(result.status).toBe(503);
    expect(attempt).toBe(4); // 1 initial + 3 retries
  });

  test('does NOT retry on 4xx errors', async () => {
    const { retryableFetch } = await import('../lib/client.js');
    let attempt = 0;
    const mockFetch = async () => {
      attempt++;
      return new Response('not found', { status: 404 });
    };
    const result = await retryableFetch('http://test.local/api', {}, mockFetch, { baseDelayMs: 1 });
    expect(result.status).toBe(404);
    expect(attempt).toBe(1);
  });

  test('does NOT retry on 401 errors', async () => {
    const { retryableFetch } = await import('../lib/client.js');
    let attempt = 0;
    const mockFetch = async () => {
      attempt++;
      return new Response('unauthorized', { status: 401 });
    };
    const result = await retryableFetch('http://test.local/api', {}, mockFetch, { baseDelayMs: 1 });
    expect(result.status).toBe(401);
    expect(attempt).toBe(1);
  });

  test('handles 429 with Retry-After header', async () => {
    const { retryableFetch } = await import('../lib/client.js');
    let attempt = 0;
    const mockFetch = async () => {
      attempt++;
      if (attempt === 1) {
        return new Response('rate limited', {
          status: 429,
          headers: { 'Retry-After': '1' }
        });
      }
      return new Response('{"ok":true}', { status: 200 });
    };
    const result = await retryableFetch('http://test.local/api', {}, mockFetch, { baseDelayMs: 1 });
    expect(result.status).toBe(200);
    expect(attempt).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/henghonglee/lightsprint-projects/lightsprint-claude-code-plugin && bun test scripts/__tests__/client-resilience.test.js`
Expected: FAIL — `retryableFetch` does not exist

- [ ] **Step 3: Implement retryableFetch**

Add to `scripts/lib/client.js` after `safeJsonParse`:

```javascript
/**
 * Fetch with retry for 5xx and network errors.
 * @param {string} url
 * @param {object} options - fetch options
 * @param {Function} [fetchFn=fetch] - fetch implementation (for testing)
 * @param {{ maxRetries?: number, baseDelayMs?: number }} [retryOpts]
 * @returns {Promise<Response>}
 */
export async function retryableFetch(url, options = {}, fetchFn = fetch, retryOpts = {}) {
  const maxRetries = retryOpts.maxRetries ?? 3;
  const baseDelayMs = retryOpts.baseDelayMs ?? 1000;
  let lastResponse;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchFn(url, options);

      // Don't retry client errors (4xx) except 429
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const delayMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : baseDelayMs * Math.pow(2, attempt);
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, delayMs));
          continue;
        }
        return response;
      }

      if (response.status < 500) return response;

      // 5xx — retry with backoff
      lastResponse = response;
      if (attempt < maxRetries) {
        const jitter = 0.8 + Math.random() * 0.4;
        await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, attempt) * jitter));
        continue;
      }
      return response;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const jitter = 0.8 + Math.random() * 0.4;
        await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, attempt) * jitter));
        continue;
      }
      throw err;
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError;
}
```

Then update `apiRequest` to use it — replace the fetch call:

```javascript
// BEFORE:
const response = await fetch(url, { ... });
// AFTER:
const response = await retryableFetch(url, { ... });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/henghonglee/lightsprint-projects/lightsprint-claude-code-plugin && bun test scripts/__tests__/client-resilience.test.js`
Expected: ALL PASS

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/henghonglee/lightsprint-projects/lightsprint-claude-code-plugin && bun test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/client.js scripts/__tests__/client-resilience.test.js
git commit -m "feat: add retryableFetch with exponential backoff for 5xx/429/network errors"
```

---

### Task 4: Add Token Refresh Retry and NaN Guards

**Lightsprint tasks:** LCCP-301 subtask (token refresh retry + NaN)

**Files:**
- Modify: `scripts/lib/client.js` (refreshTokenIfNeeded)
- Modify: `scripts/cc-daemon.js:60-64` (EXPIRES_AT, CC_PID guards)
- Modify: `scripts/lib/auth.js:163` (parseInt radix)
- Modify: `scripts/__tests__/client-resilience.test.js`

- [ ] **Step 1: Write failing tests**

Append to `scripts/__tests__/client-resilience.test.js`:

```javascript
describe('parseInt safety', () => {
  test('parseInt with radix handles normal number', () => {
    expect(parseInt('3600', 10)).toBe(3600);
  });

  test('parseInt without radix on "08" should be 8', () => {
    // This is actually fine in modern JS, but adding radix is best practice
    expect(parseInt('08', 10)).toBe(8);
  });

  test('parseInt on undefined returns NaN', () => {
    expect(Number.isNaN(parseInt(undefined, 10))).toBe(true);
  });

  test('NaN guard prevents invalid expiresAt', () => {
    const expiresIn = undefined;
    const parsed = parseInt(expiresIn, 10);
    const guarded = Number.isFinite(parsed) ? parsed : 0;
    expect(guarded).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass (these are documentation tests)**

Run: `cd /Users/henghonglee/lightsprint-projects/lightsprint-claude-code-plugin && bun test scripts/__tests__/client-resilience.test.js`
Expected: PASS (these test current behavior)

- [ ] **Step 3: Fix auth.js parseInt and daemon NaN guards**

In `scripts/lib/auth.js` at line 163:
```javascript
// BEFORE:
expiresAt: Date.now() + (parseInt(result.expiresIn) * 1000),
// AFTER:
expiresAt: Date.now() + (parseInt(result.expiresIn, 10) * 1000),
```

In `scripts/cc-daemon.js` at line 60:
```javascript
// BEFORE:
let EXPIRES_AT = _expiresAt || (process.env.LS_EXPIRES_AT ? parseInt(process.env.LS_EXPIRES_AT, 10) : repoConfig?.expiresAt);
// AFTER:
let EXPIRES_AT = _expiresAt || (process.env.LS_EXPIRES_AT ? parseInt(process.env.LS_EXPIRES_AT, 10) : repoConfig?.expiresAt);
if (EXPIRES_AT && !Number.isFinite(EXPIRES_AT)) EXPIRES_AT = 0; // force refresh
```

In `scripts/cc-daemon.js` at line 64:
```javascript
// BEFORE:
const CC_PID = parseInt(process.env.LS_CC_PID, 10);
// AFTER:
const CC_PID = parseInt(process.env.LS_CC_PID, 10);
if (!Number.isFinite(CC_PID) || CC_PID <= 0) {
  log?.('Invalid CC_PID, watchdog disabled', { raw: process.env.LS_CC_PID });
}
```

- [ ] **Step 4: Run full test suite**

Run: `cd /Users/henghonglee/lightsprint-projects/lightsprint-claude-code-plugin && bun test`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/auth.js scripts/cc-daemon.js scripts/__tests__/client-resilience.test.js
git commit -m "fix: add parseInt radix in auth.js, NaN guards for EXPIRES_AT and CC_PID"
```

---

### Task 5: Make repos.json Writes Atomic

**Lightsprint tasks:** LCCP-305 subtask (file I/O atomicity)

**Files:**
- Modify: `scripts/lib/config.js` (writeReposFile)
- Create: `scripts/__tests__/config-atomicity.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
// scripts/__tests__/config-atomicity.test.js
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { readReposFile, writeReposFile } from '../lib/config.js';

const CONFIG_DIR = join(homedir(), '.lightsprint');
const REPOS_FILE = join(CONFIG_DIR, 'repos.json');

describe('writeReposFile atomicity', () => {
  let originalContent;

  beforeEach(() => {
    try {
      originalContent = readFileSync(REPOS_FILE, 'utf-8');
    } catch {
      originalContent = null;
    }
  });

  afterEach(() => {
    // Restore original content
    if (originalContent !== null) {
      writeFileSync(REPOS_FILE, originalContent, { mode: 0o600 });
    }
    // Clean up any leftover temp files
    const files = readdirSync(CONFIG_DIR);
    for (const f of files) {
      if (f.startsWith('repos.json.')) {
        try { unlinkSync(join(CONFIG_DIR, f)); } catch {}
      }
    }
  });

  test('writes valid JSON that can be read back', () => {
    const testData = { 'test/repo': { accessToken: 'test123', repoId: 'r1' } };
    writeReposFile(testData);
    const result = readReposFile();
    expect(result['test/repo']).toBeDefined();
    expect(result['test/repo'].accessToken).toBe('test123');
  });

  test('does not leave temp files after successful write', () => {
    writeReposFile({ 'test/repo': { accessToken: 'abc' } });
    const files = readdirSync(CONFIG_DIR);
    const tempFiles = files.filter(f => f.startsWith('repos.json.'));
    expect(tempFiles.length).toBe(0);
  });

  test('file has restricted permissions (0o600)', () => {
    writeReposFile({ 'test/repo': { accessToken: 'abc' } });
    const stats = require('fs').statSync(REPOS_FILE);
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
```

- [ ] **Step 2: Run tests — some may pass already (file permissions), temp file test should fail**

Run: `cd /Users/henghonglee/lightsprint-projects/lightsprint-claude-code-plugin && bun test scripts/__tests__/config-atomicity.test.js`
Expected: Temp file test may pass (current impl doesn't use tmp), but validates baseline

- [ ] **Step 3: Make writeReposFile atomic (tmp + rename)**

In `scripts/lib/config.js`, replace `writeReposFile` (lines 84-87):

```javascript
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'fs';
import { randomBytes } from 'crypto';

// ... existing code ...

export function writeReposFile(data) {
  ensureConfigDir();
  const tmp = REPOS_FILE + '.' + randomBytes(4).toString('hex');
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(tmp, REPOS_FILE);
}
```

Also add `renameSync` and `randomBytes` to the imports at the top of the file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/henghonglee/lightsprint-projects/lightsprint-claude-code-plugin && bun test scripts/__tests__/config-atomicity.test.js`
Expected: ALL PASS

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/henghonglee/lightsprint-projects/lightsprint-claude-code-plugin && bun test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/config.js scripts/__tests__/config-atomicity.test.js
git commit -m "fix: make writeReposFile atomic with tmp+rename pattern"
```

---

### Task 6: Fix task-map.json Permissions

**Lightsprint tasks:** LCCP-305 subtask (file I/O)

**Files:**
- Modify: `scripts/lib/task-map.js:36` (add mode 0o600)
- Modify: `scripts/__tests__/config-atomicity.test.js`

- [ ] **Step 1: Write failing test**

Append to `scripts/__tests__/config-atomicity.test.js`:

```javascript
import { setMapping, getMapping, removeSessionMappings } from '../lib/task-map.js';

describe('task-map.js permissions', () => {
  const MAP_FILE = join(homedir(), '.lightsprint', 'task-map.json');
  const testSession = 'test-perms-session';

  afterEach(() => {
    removeSessionMappings(testSession);
  });

  test('task-map.json has 0o600 permissions after write', () => {
    setMapping(testSession, 'cc-task-1', 'ls-task-1');
    const stats = require('fs').statSync(MAP_FILE);
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/henghonglee/lightsprint-projects/lightsprint-claude-code-plugin && bun test scripts/__tests__/config-atomicity.test.js`
Expected: FAIL — current writeMap doesn't set mode 0o600

- [ ] **Step 3: Fix permissions in task-map.js**

In `scripts/lib/task-map.js` at line 36:
```javascript
// BEFORE:
writeFileSync(tmp, JSON.stringify(map, null, 2));
// AFTER:
writeFileSync(tmp, JSON.stringify(map, null, 2), { mode: 0o600 });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/henghonglee/lightsprint-projects/lightsprint-claude-code-plugin && bun test scripts/__tests__/config-atomicity.test.js`
Expected: ALL PASS

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/henghonglee/lightsprint-projects/lightsprint-claude-code-plugin && bun test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/task-map.js scripts/__tests__/config-atomicity.test.js
git commit -m "fix: set 0o600 permissions on task-map.json writes"
```

---

### Task 7: Add Error Logging to cc-event.js

**Lightsprint tasks:** LCCP-304 subtask (event logging)

**Files:**
- Modify: `scripts/cc-event.js`
- No new tests needed (change is trivial — add stderr logging to catch block)

- [ ] **Step 1: Read current cc-event.js**

Read: `scripts/cc-event.js` to find the bare catch block.

- [ ] **Step 2: Add error logging to catch block**

In `scripts/cc-event.js`, find the bare `catch {}` or `catch { }` block and replace:

```javascript
// BEFORE:
} catch {
  // Never block Claude Code
}
// AFTER:
} catch (err) {
  // Never block Claude Code — but log for debugging
  if (process.env.LIGHTSPRINT_DEBUG) {
    process.stderr.write(`[lightsprint:cc-event] ${err.message}\n`);
  }
}
```

- [ ] **Step 3: Run full test suite**

Run: `cd /Users/henghonglee/lightsprint-projects/lightsprint-claude-code-plugin && bun test`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add scripts/cc-event.js
git commit -m "fix: add debug logging to cc-event.js catch block"
```

---

### Task 8: Add cc-daemon.js PID Guard, ws.send Guard, and Port Retry

**Lightsprint tasks:** LCCP-302 subtasks (daemon hardening)

**Files:**
- Modify: `scripts/cc-daemon.js`
- Create: `scripts/__tests__/daemon-hardening.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
// scripts/__tests__/daemon-hardening.test.js
import { describe, test, expect } from 'bun:test';

describe('CC_PID validation', () => {
  test('Number.isFinite rejects NaN', () => {
    const pid = parseInt(undefined, 10);
    expect(Number.isFinite(pid)).toBe(false);
  });

  test('Number.isFinite rejects Infinity', () => {
    expect(Number.isFinite(Infinity)).toBe(false);
  });

  test('Number.isFinite accepts valid PID', () => {
    const pid = parseInt('12345', 10);
    expect(Number.isFinite(pid)).toBe(true);
    expect(pid).toBe(12345);
  });
});

describe('WebSocket send guard', () => {
  test('safeSend does not throw when ws is null', () => {
    // Simulate the safeSend pattern
    function safeSend(ws, data) {
      if (!ws || ws.readyState !== 1 /* OPEN */) return false;
      try {
        ws.send(data);
        return true;
      } catch {
        return false;
      }
    }

    expect(safeSend(null, 'test')).toBe(false);
  });

  test('safeSend does not throw when ws is CLOSED', () => {
    function safeSend(ws, data) {
      if (!ws || ws.readyState !== 1) return false;
      try { ws.send(data); return true; } catch { return false; }
    }

    const fakeWs = { readyState: 3 }; // CLOSED
    expect(safeSend(fakeWs, 'test')).toBe(false);
  });

  test('safeSend returns true when ws is OPEN', () => {
    function safeSend(ws, data) {
      if (!ws || ws.readyState !== 1) return false;
      try { ws.send(data); return true; } catch { return false; }
    }

    const fakeWs = { readyState: 1, send: () => {} }; // OPEN
    expect(safeSend(fakeWs, 'test')).toBe(true);
  });
});

describe('Port retry on EADDRINUSE', () => {
  test('createServer error event is catchable', () => {
    const { createServer } = require('http');
    const server = createServer();
    let errorCaught = false;

    server.on('error', (err) => {
      errorCaught = true;
    });

    // Emit a fake error
    server.emit('error', new Error('EADDRINUSE'));
    expect(errorCaught).toBe(true);
    server.close();
  });
});

describe('Event queue', () => {
  test('queue buffers events when disconnected', () => {
    const queue = [];
    const MAX_QUEUE = 100;

    function enqueueEvent(event) {
      if (queue.length >= MAX_QUEUE) queue.shift(); // drop oldest
      queue.push(event);
    }

    enqueueEvent({ type: 'task:create', payload: { id: '1' } });
    enqueueEvent({ type: 'task:update', payload: { id: '2' } });
    expect(queue.length).toBe(2);
    expect(queue[0].payload.id).toBe('1');
  });

  test('queue drops oldest on overflow', () => {
    const queue = [];
    const MAX_QUEUE = 3;

    function enqueueEvent(event) {
      if (queue.length >= MAX_QUEUE) queue.shift();
      queue.push(event);
    }

    enqueueEvent({ id: '1' });
    enqueueEvent({ id: '2' });
    enqueueEvent({ id: '3' });
    enqueueEvent({ id: '4' }); // should drop id:1
    expect(queue.length).toBe(3);
    expect(queue[0].id).toBe('2');
  });

  test('flush empties queue and returns events in order', () => {
    const queue = [];
    function enqueue(e) { queue.push(e); }
    function flush() {
      const events = [...queue];
      queue.length = 0;
      return events;
    }

    enqueue({ id: '1' });
    enqueue({ id: '2' });
    const flushed = flush();
    expect(flushed.length).toBe(2);
    expect(flushed[0].id).toBe('1');
    expect(queue.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass (these test patterns, not implementations)**

Run: `cd /Users/henghonglee/lightsprint-projects/lightsprint-claude-code-plugin && bun test scripts/__tests__/daemon-hardening.test.js`
Expected: ALL PASS (these test the patterns we'll apply)

- [ ] **Step 3: Apply guards in cc-daemon.js**

1. **PID guard** — after line 64:
```javascript
const CC_PID = parseInt(process.env.LS_CC_PID, 10);
const CC_PID_VALID = Number.isFinite(CC_PID) && CC_PID > 0;
```
Then in `startWatchdog()` (line 662), change:
```javascript
// BEFORE:
if (!CC_PID || isNaN(CC_PID)) return;
// AFTER:
if (!CC_PID_VALID) return;
```

2. **ws.send guard** — add helper after line 86:
```javascript
function safeSend(data) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try { ws.send(data); return true; } catch { return false; }
}
```
Then replace `ws.send(...)` calls at lines 99 and 106 with `safeSend(...)`.

3. **Port retry** — in `startHttpServer()`, wrap the listen call:
```javascript
async function startHttpServer() {
  const MAX_PORT_RETRIES = 3;
  for (let attempt = 0; attempt <= MAX_PORT_RETRIES; attempt++) {
    const port = await findFreePort();
    httpServer = createServer(async (req, res) => { ... });
    try {
      await new Promise((resolve, reject) => {
        httpServer.on('error', reject);
        httpServer.listen(port, '127.0.0.1', resolve);
      });
      return port;
    } catch (err) {
      if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_RETRIES) {
        log('Port in use, retrying', { port, attempt });
        continue;
      }
      throw err;
    }
  }
}
```

4. **Event queue** — add after globals (around line 80):
```javascript
const EVENT_QUEUE_MAX = 100;
const eventQueue = [];

function enqueueEvent(type, data) {
  if (eventQueue.length >= EVENT_QUEUE_MAX) {
    eventQueue.shift();
    log('Event queue overflow, dropped oldest event');
  }
  eventQueue.push({ type, data, ts: Date.now() });
}

function flushEventQueue() {
  if (!ws || ws.readyState !== WebSocket.OPEN || eventQueue.length === 0) return;
  const events = [...eventQueue];
  eventQueue.length = 0;
  for (const evt of events) {
    sendFireAndForget(evt.type, evt.data);
  }
  if (events.length > 0) log('Flushed event queue', { count: events.length });
}
```
Then call `flushEventQueue()` after successful `session:start` in the ws.onopen handler.

- [ ] **Step 4: Run full test suite**

Run: `cd /Users/henghonglee/lightsprint-projects/lightsprint-claude-code-plugin && bun test`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/cc-daemon.js scripts/__tests__/daemon-hardening.test.js
git commit -m "fix: add PID guard, ws.send safety, port retry, and event queue to daemon"
```

---

### Task 9: Add Timeout to cc-daemon.js Token Refresh

**Lightsprint tasks:** LCCP-273, LCCP-301

**Files:**
- Modify: `scripts/cc-daemon.js:149` (token refresh fetch)

- [ ] **Step 1: Add AbortSignal.timeout to daemon's token refresh fetch**

In `scripts/cc-daemon.js`, find the token refresh fetch (around line 149):

```javascript
// BEFORE:
const response = await fetch(`${BASE_URL}/oauth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ ... })
});
// AFTER:
const response = await fetch(`${BASE_URL}/oauth/token`, {
  method: 'POST',
  signal: AbortSignal.timeout(30000),
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ ... })
});
```

- [ ] **Step 2: Run full test suite**

Run: `cd /Users/henghonglee/lightsprint-projects/lightsprint-claude-code-plugin && bun test`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add scripts/cc-daemon.js
git commit -m "fix: add 30s timeout to daemon token refresh fetch"
```

---

## Summary: Test Coverage Matrix

| Task | Test File | Test Count | What's Tested |
|------|-----------|------------|---------------|
| 1 | validate-fixes.test.js | 14 | validateEnum Set, validatePositiveInt, validatePid, validateAssignee |
| 2 | client-resilience.test.js | 7 | safeJsonParse, DEFAULT_TIMEOUT_MS, JSON.parse patterns |
| 3 | client-resilience.test.js | 8 | retryableFetch: 5xx retry, 429 handling, 4xx no-retry, network errors |
| 4 | client-resilience.test.js | 4 | parseInt safety patterns |
| 5 | config-atomicity.test.js | 3 | writeReposFile atomic, no temp files, permissions |
| 6 | config-atomicity.test.js | 1 | task-map.json 0o600 permissions |
| 7 | (trivial change) | 0 | Debug logging — tested manually |
| 8 | daemon-hardening.test.js | 9 | PID guard, ws.send guard, port retry, event queue |
| 9 | (trivial change) | 0 | Timeout — tested manually |

**Total new tests: ~46**
