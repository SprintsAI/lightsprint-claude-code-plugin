# Expose Review Hub, Merge, and Create-PR to CLI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 new CLI commands (`review-hub signals`, `review-hub scores`, `agent create-pr`, `merge`) and 5 skill files so AI agents can inspect PR readiness, merge PRs, and create PRs from agent branches without leaving the terminal.

**Architecture:** New commands follow the existing CLI pattern (arg parsing → validation → API call → output formatting). The `review-hub` command uses a subcommand router (like `agent`). The AI overlay endpoint uses SSE, so a new `apiRequestSSE()` helper is added to `client.js`. All commands resolve task ID → internal PR ID via the existing task GET endpoint.

**Tech Stack:** Node.js (ESM), native fetch with ReadableStream for SSE, existing CLI framework (`client.js`, `validate.js`, `output.js`, `schema.js`).

**Spec:** `docs/superpowers/specs/2026-04-05-expose-review-hub-merge-pr-to-cli.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `scripts/lib/client.js` | Modify | Add `apiRequestSSE()` for SSE stream consumption |
| `scripts/ls-cli.js` | Modify | Add `review-hub`, `merge` commands + `agent create-pr` subcommand |
| `scripts/lib/schema.js` | Modify | Add 4 schema entries for new commands |
| `skills/review-hub-signals/SKILL.md` | Create | Skill doc for `review-hub signals` |
| `skills/review-hub-scores/SKILL.md` | Create | Skill doc for `review-hub scores` |
| `skills/agent-create-pr/SKILL.md` | Create | Skill doc for `agent create-pr` |
| `skills/agent-settings/SKILL.md` | Create | Dedicated skill doc for `agent settings` |
| `skills/merge/SKILL.md` | Create | Skill doc for `merge` |

---

### Task 1: Add SSE client helper to `client.js`

**Files:**
- Modify: `scripts/lib/client.js`

- [ ] **Step 1: Add `apiRequestSSE` function to `client.js`**

Add after the existing `apiRequest` function (after line 279):

```javascript
/**
 * Make an authenticated SSE request to the Lightsprint API.
 * Consumes the event stream and returns the final 'complete' event payload.
 * @param {string} path - API path
 * @param {{ timeout?: number }} [options]
 * @returns {Promise<object|null>} Parsed payload from the 'complete' event, or null if stream was empty
 */
export async function apiRequestSSE(path, options = {}) {
	const timeout = options.timeout || 120_000;
	const cfg = await config();

	const refreshed = await refreshTokenIfNeeded();
	if (!refreshed) {
		throw new Error('Lightsprint: unable to authenticate. Please re-run install.sh.');
	}

	const url = `${cfg.baseUrl}${path}`;
	const response = await retryableFetch(url, {
		signal: AbortSignal.timeout(timeout),
		headers: {
			'Authorization': `Bearer ${cfg.accessToken}`,
			'Accept': 'text/event-stream'
		}
	});

	if (!response.ok) {
		const text = await readBodyCapped(response).catch(() => '');
		const safeText = text.length > 500 ? text.slice(0, 500) + '...' : text;
		throw new Error(`Lightsprint API ${response.status}: ${safeText}`);
	}

	// Empty 200 response (no signals / no content)
	const contentType = response.headers.get('content-type') || '';
	if (!contentType.includes('text/event-stream')) {
		// Server returned a non-SSE response (e.g. empty JSON for no signals)
		const body = await readBodyCapped(response);
		if (!body || body.trim() === '') return null;
		return safeJsonParse(body);
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop(); // keep incomplete line in buffer

			for (const line of lines) {
				if (!line.startsWith('data: ')) continue;
				const raw = line.slice(6).trim();
				if (!raw) continue;

				let data;
				try {
					data = JSON.parse(raw);
				} catch {
					continue; // skip malformed SSE data lines
				}

				if (data.type === 'complete') {
					return data.payload !== undefined ? data.payload : data;
				}
				if (data.type === 'error') {
					throw new Error(data.message || 'AI analysis failed');
				}
				// 'progress' events: silently continue
			}
		}
	} finally {
		reader.releaseLock();
	}

	// Stream ended without a complete event
	return null;
}
```

- [ ] **Step 2: Verify the export is accessible**

Run:
```bash
cd /Users/henghonglee/lightsprint-projects/lightsprint-claude-code-plugin && node -e "import('./scripts/lib/client.js').then(m => console.log(typeof m.apiRequestSSE))"
```
Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/client.js
git commit -m "feat: add apiRequestSSE helper for SSE stream consumption"
```

---

### Task 2: Add `resolveTaskPrId` helper and `merge` command to `ls-cli.js`

**Files:**
- Modify: `scripts/ls-cli.js`

- [ ] **Step 1: Add `apiRequestSSE` import**

In `scripts/ls-cli.js`, update the import from `client.js` (line 24) to also import `apiRequestSSE`:

```javascript
import { apiRequest, apiRequestSSE, getRepoId, getRepoInfo } from './lib/client.js';
```

- [ ] **Step 2: Add `resolveTaskPrId` helper**

Add before the existing `resolveTaskId` function (before line 1838):

```javascript
/**
 * Resolve a task ID input to the internal PR record ID.
 * @param {string} taskIdInput - Display ID, bare number, or raw ID
 * @returns {Promise<{ taskId: string, prId: string, prNumber: number|null, prUrl: string|null }>}
 */
async function resolveTaskPrId(taskIdInput) {
	const taskId = await resolveTaskId(taskIdInput);
	const data = await apiRequest(`/api/tasks/${taskId}`);
	const task = data.task;
	if (!task) throw new Error(`Task ${taskIdInput} not found.`);

	const prs = task.githubPullRequests;
	if (!prs || prs.length === 0) {
		throw new Error(`No PR linked to task ${taskIdInput}. Use 'lightsprint link-pr' first.`);
	}
	const pr = prs[0];
	return { taskId, prId: pr.id, prNumber: pr.prNumber || null, prUrl: pr.prUrl || null };
}
```

- [ ] **Step 3: Add `cmdMerge` function**

Add after the `cmdAgent` family of functions (after line ~1805, before the helpers section):

```javascript
// ─── merge ───────────────────────────────────────────────────────────────

async function cmdMerge(args, opts) {
	let taskIdInput = null;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--task' && args[i + 1]) {
			taskIdInput = args[++i];
		} else if (!taskIdInput && !args[i].startsWith('-')) {
			taskIdInput = args[i];
		} else {
			throw new Error(`Unknown argument: ${args[i]}. Use: lightsprint merge <taskId>`);
		}
	}

	if (!taskIdInput) throw new Error('Usage: lightsprint merge <taskId>');
	validateId(taskIdInput, 'Task ID');

	if (opts.dryRun) {
		return outputDryRun('merge', { taskId: taskIdInput }, `POST /api/tasks/${taskIdInput}/pr/merge`, opts);
	}

	const taskId = await resolveTaskId(taskIdInput);
	const result = await apiRequest(`/api/tasks/${taskId}/pr/merge`, { method: 'POST' });

	outputResult(result, opts, () => {
		const pr = result.pr;
		if (pr.status === 'queued') {
			console.log(`PR #${pr.prNumber} queued for merge (task ${taskIdInput})`);
		} else {
			console.log(`PR #${pr.prNumber} merged for task ${taskIdInput}`);
			if (pr.sha) console.log(`SHA: ${pr.sha}`);
		}
		if (pr.prUrl) console.log(pr.prUrl);
	});
}
```

- [ ] **Step 4: Add `merge` to the main command switch**

In the `switch (command)` block (around line 63), add before the `default` case:

```javascript
			case 'merge': return await cmdMerge(remainingArgs, opts);
```

- [ ] **Step 5: Add `merge` to `showHelp()`**

Add after the `agent settings` help block (after line ~204):

```javascript

  merge <taskId>
    Merge the GitHub PR linked to a task
    Example:
      lightsprint merge LIG-024
      lightsprint merge --task LIG-024
```

- [ ] **Step 6: Verify syntax**

Run:
```bash
node -e "import('./scripts/ls-cli.js').then(() => console.log('OK'))"
```
Expected: `OK`

- [ ] **Step 7: Commit**

```bash
git add scripts/ls-cli.js
git commit -m "feat: add merge command and resolveTaskPrId helper"
```

---

### Task 3: Add `review-hub` command with `signals` and `scores` subcommands

**Files:**
- Modify: `scripts/ls-cli.js`

- [ ] **Step 1: Add `cmdReviewHub` router, `cmdReviewHubSignals`, and `cmdReviewHubScores`**

Add after the `cmdMerge` function:

```javascript
// ─── review-hub ──────────────────────────────────────────────────────────

async function cmdReviewHub(args, opts) {
	const subcommand = args[0];
	const subArgs = args.slice(1);

	switch (subcommand) {
		case 'signals': return await cmdReviewHubSignals(subArgs, opts);
		case 'scores': return await cmdReviewHubScores(subArgs, opts);
		default:
			throw new Error(`Unknown review-hub subcommand: "${subcommand || ''}". Use: signals, scores`);
	}
}

async function cmdReviewHubSignals(args, opts) {
	let taskIdInput = null;
	let refresh = false;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--task' && args[i + 1]) {
			taskIdInput = args[++i];
		} else if (args[i] === '--refresh') {
			refresh = true;
		} else if (!taskIdInput && !args[i].startsWith('-')) {
			taskIdInput = args[i];
		} else {
			throw new Error(`Unknown argument: ${args[i]}. Use --task <taskId> [--refresh].`);
		}
	}

	if (!taskIdInput) throw new Error('Usage: lightsprint review-hub signals <taskId> [--refresh]');
	validateId(taskIdInput, 'Task ID');

	if (opts.dryRun) {
		const method = refresh ? 'POST' : 'GET';
		return outputDryRun('review-hub signals', { taskId: taskIdInput, refresh }, `${method} /api/review-hub/{prId}/signals`, opts);
	}

	const { prId, prNumber } = await resolveTaskPrId(taskIdInput);

	const method = refresh ? 'POST' : 'GET';
	const result = await apiRequest(`/api/review-hub/${prId}/signals`, { method });

	outputResult(result, opts, () => {
		const signals = result.signals || [];
		console.log(`Signals for task ${taskIdInput} (PR #${prNumber}):`);
		if (signals.length === 0) {
			console.log('  No signals found.');
			return;
		}
		for (const s of signals) {
			const statusIcon = s.status === 'success' ? '\u2713' : s.status === 'failure' ? '\u2717' : '\u2022';
			const cat = (s.category || '').padEnd(10);
			const title = s.title || s.actorLogin || '';
			const detail = s.scoreLabel ? ` (${s.scoreLabel})` : '';
			console.log(`  ${cat} ${statusIcon} ${title}${detail}`);
		}
		console.log(`\n${signals.length} signal(s)${result.lastViewedAt ? ` | Last viewed: ${result.lastViewedAt}` : ''}`);
	});
}

async function cmdReviewHubScores(args, opts) {
	let taskIdInput = null;
	let refresh = false;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--task' && args[i + 1]) {
			taskIdInput = args[++i];
		} else if (args[i] === '--refresh') {
			refresh = true;
		} else if (!taskIdInput && !args[i].startsWith('-')) {
			taskIdInput = args[i];
		} else {
			throw new Error(`Unknown argument: ${args[i]}. Use --task <taskId> [--refresh].`);
		}
	}

	if (!taskIdInput) throw new Error('Usage: lightsprint review-hub scores <taskId> [--refresh]');
	validateId(taskIdInput, 'Task ID');

	if (opts.dryRun) {
		return outputDryRun('review-hub scores', { taskId: taskIdInput, refresh }, 'GET /api/review-hub/{prId}/ai-overlay', opts);
	}

	const { prId, prNumber } = await resolveTaskPrId(taskIdInput);

	// If --refresh, force-refresh signals first (clears AI cache)
	if (refresh) {
		await apiRequest(`/api/review-hub/${prId}/signals`, { method: 'POST' });
	}

	// Consume the SSE stream (returns cached or triggers fresh analysis)
	const result = await apiRequestSSE(`/api/review-hub/${prId}/ai-overlay`, { timeout: 120_000 });

	if (!result || (result.readiness_score === undefined && result.readinessScore === undefined)) {
		const data = { readinessScore: null, message: 'No scores available. Use --refresh to trigger AI analysis (consumes credits).' };
		outputResult(data, opts, () => {
			console.log(`AI Readiness for task ${taskIdInput} (PR #${prNumber}):`);
			console.log('  No cached scores available.');
			console.log('  Use --refresh to trigger AI analysis (consumes credits).');
		});
		return;
	}

	// Normalize field names (API uses snake_case)
	const data = {
		readinessScore: result.readiness_score ?? result.readinessScore,
		readinessLabel: result.readiness_label ?? result.readinessLabel,
		sectionSummaries: result.section_summaries ?? result.sectionSummaries ?? {},
		changeCallouts: result.change_callouts ?? result.changeCallouts ?? [],
		suggestedActions: result.suggested_actions ?? result.suggestedActions ?? [],
		addressal: result.addressal ?? null,
		updatedAt: result.updated_at ?? result.updatedAt ?? null
	};

	outputResult(data, opts, () => {
		console.log(`AI Readiness for task ${taskIdInput} (PR #${prNumber}):`);
		console.log(`  Score: ${data.readinessScore}/100 (${data.readinessLabel})`);

		const sections = Object.entries(data.sectionSummaries);
		if (sections.length > 0) {
			console.log('\n  Sections:');
			for (const [key, val] of sections) {
				console.log(`    ${key}: ${val}`);
			}
		}

		if (data.changeCallouts.length > 0) {
			console.log('\n  Callouts:');
			for (const c of data.changeCallouts) {
				console.log(`    - ${typeof c === 'string' ? c : c.message || JSON.stringify(c)}`);
			}
		}

		if (data.suggestedActions.length > 0) {
			console.log('\n  Suggested Actions:');
			for (const a of data.suggestedActions) {
				console.log(`    - ${typeof a === 'string' ? a : a.message || JSON.stringify(a)}`);
			}
		}
	});
}
```

- [ ] **Step 2: Add `review-hub` to the main command switch**

In the `switch (command)` block, add before the `default` case:

```javascript
			case 'review-hub': return await cmdReviewHub(remainingArgs, opts);
```

- [ ] **Step 3: Add `review-hub` to `showHelp()`**

Add after the `merge` help entry:

```javascript

  review-hub signals <taskId> [--refresh]
    Get PR signals (CI checks, reviews, comments) for a task's linked PR
    Options:
      --refresh             Force re-fetch signals from GitHub
    Example:
      lightsprint review-hub signals LIG-024
      lightsprint review-hub signals LIG-024 --refresh

  review-hub scores <taskId> [--refresh]
    Get AI readiness analysis for a task's linked PR
    Options:
      --refresh             Refresh signals from GitHub and trigger fresh AI analysis (consumes credits)
    Example:
      lightsprint review-hub scores LIG-024
      lightsprint review-hub scores LIG-024 --refresh
```

- [ ] **Step 4: Verify syntax**

Run:
```bash
node -e "import('./scripts/ls-cli.js').then(() => console.log('OK'))"
```
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add scripts/ls-cli.js
git commit -m "feat: add review-hub signals and scores commands"
```

---

### Task 4: Add `agent create-pr` subcommand

**Files:**
- Modify: `scripts/ls-cli.js`

- [ ] **Step 1: Add `cmdAgentCreatePr` function**

Add after the existing `cmdAgentSettings` function (after line ~1805):

```javascript
async function cmdAgentCreatePr(args, opts) {
	let taskIdInput = null;
	let provider = null;
	let agentId = null;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--task' && args[i + 1]) {
			taskIdInput = args[++i];
		} else if (args[i] === '--provider' && args[i + 1]) {
			provider = args[++i];
		} else if (args[i] === '--agent-id' && args[i + 1]) {
			agentId = args[++i];
		} else {
			throw new Error(`Unknown argument: ${args[i]}. Use --task, --provider, --agent-id.`);
		}
	}

	if (!taskIdInput) throw new Error('Usage: lightsprint agent create-pr --task <taskId> --provider <provider> --agent-id <agentId>');
	if (!provider) throw new Error('--provider is required. Allowed values: anthropic, cursor, codex');
	if (!agentId) throw new Error('--agent-id is required.');

	validateId(taskIdInput, 'Task ID');
	validateProvider(provider);
	validateId(agentId, 'Agent ID');

	if (opts.dryRun) {
		return outputDryRun('agent create-pr', { taskId: taskIdInput, provider, agentId }, `POST /api/tasks/${taskIdInput}/cloud-agents/${provider}/${agentId}/create-pr`, opts);
	}

	const taskId = await resolveTaskId(taskIdInput);
	const result = await apiRequest(`/api/tasks/${taskId}/cloud-agents/${provider}/${agentId}/create-pr`, {
		method: 'POST'
	});

	outputResult(result, opts, () => {
		console.log(`PR created for task ${taskIdInput}`);
		if (result.prUrl) console.log(result.prUrl);
		if (result.prNumber) console.log(`PR #${result.prNumber}`);
		if (result.title) console.log(`Title: ${result.title}`);
	});
}
```

- [ ] **Step 2: Add `create-pr` case to `cmdAgent` switch**

In the `cmdAgent` function, add the new case:

```javascript
		case 'create-pr': return await cmdAgentCreatePr(subArgs, opts);
```

The switch should now read:
```javascript
	switch (subcommand) {
		case 'launch': return await cmdAgentLaunch(subArgs, opts);
		case 'stop': return await cmdAgentStop(subArgs, opts);
		case 'settings': return await cmdAgentSettings(subArgs, opts);
		case 'create-pr': return await cmdAgentCreatePr(subArgs, opts);
		default:
			throw new Error(`Unknown agent subcommand: "${subcommand || ''}". Use: launch, stop, settings, create-pr`);
	}
```

Also update the error message in the `default` case to include `create-pr`.

- [ ] **Step 3: Add `agent create-pr` to `showHelp()`**

Add after the existing `agent settings` help entry:

```javascript

  agent create-pr [options]
    Create a GitHub PR from a cloud agent's working branch
    Options:
      --task <taskId>         Task ID (required)
      --provider <provider>   Provider: anthropic, cursor, codex (required)
      --agent-id <id>         Agent ID (required)
    Example:
      lightsprint agent create-pr --task LIG-024 --provider anthropic --agent-id abc123
```

- [ ] **Step 4: Verify syntax**

Run:
```bash
node -e "import('./scripts/ls-cli.js').then(() => console.log('OK'))"
```
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add scripts/ls-cli.js
git commit -m "feat: add agent create-pr subcommand"
```

---

### Task 5: Add schema entries for new commands

**Files:**
- Modify: `scripts/lib/schema.js`

- [ ] **Step 1: Add schema entries**

Add the following entries to the `COMMAND_SCHEMAS` object in `scripts/lib/schema.js`, after the existing `'agent-settings'` entry:

```javascript
	'agent-create-pr': {
		description: 'Create a GitHub PR from a cloud agent working branch',
		params: {
			taskId: { type: 'string', required: true, flag: '--task', description: 'Task ID (raw or display ID)' },
			provider: { type: 'enum', required: true, flag: '--provider', values: VALID_PROVIDERS, description: 'Cloud agent provider' },
			agentId: { type: 'string', required: true, flag: '--agent-id', description: 'Agent ID' }
		},
		supportsDryRun: true,
		supportsJsonBody: false
	},
	merge: {
		description: 'Merge the GitHub PR linked to a task',
		params: {
			taskId: { type: 'string', required: true, flag: '--task', description: 'Task ID (raw or display ID)' }
		},
		supportsDryRun: true,
		supportsJsonBody: false
	},
	'review-hub-signals': {
		description: 'Get PR signals (CI, reviews, comments) for a task linked PR',
		params: {
			taskId: { type: 'string', required: true, flag: '--task', description: 'Task ID (raw or display ID)' },
			refresh: { type: 'boolean', flag: '--refresh', description: 'Force re-fetch signals from GitHub' }
		},
		supportsDryRun: true,
		supportsJsonBody: false
	},
	'review-hub-scores': {
		description: 'Get AI readiness analysis for a task linked PR',
		params: {
			taskId: { type: 'string', required: true, flag: '--task', description: 'Task ID (raw or display ID)' },
			refresh: { type: 'boolean', flag: '--refresh', description: 'Refresh signals and trigger fresh AI analysis' }
		},
		supportsDryRun: true,
		supportsJsonBody: false
	},
```

- [ ] **Step 2: Verify schemas load**

Run:
```bash
node -e "import('./scripts/lib/schema.js').then(m => { const names = m.getAllCommandNames(); console.log(names.includes('merge'), names.includes('review-hub-signals'), names.includes('review-hub-scores'), names.includes('agent-create-pr')); })"
```
Expected: `true true true true`

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/schema.js
git commit -m "feat: add schema entries for merge, review-hub, agent create-pr"
```

---

### Task 6: Create skill files

**Files:**
- Create: `skills/review-hub-signals/SKILL.md`
- Create: `skills/review-hub-scores/SKILL.md`
- Create: `skills/agent-create-pr/SKILL.md`
- Create: `skills/agent-settings/SKILL.md`
- Create: `skills/merge/SKILL.md`

- [ ] **Step 1: Create `skills/review-hub-signals/SKILL.md`**

```markdown
---
name: review-hub-signals
description: Get PR signals (CI checks, reviews, comments, deployments) for a task's linked PR. Use to inspect what CI and review activity has happened on a PR.
---

Run this command to get the signals for a task's linked PR:

` ` `bash
lightsprint review-hub signals $ARGUMENTS
` ` `

Usage: `review-hub signals <taskId> [--refresh]`

- `<taskId>` — Task ID (display ID like `LIG-024`, bare number, or raw ID). Required.
- `--refresh` — Force re-fetch all signals from GitHub. Without this flag, returns cached signals.

## Output fields

| Field | Description |
|-------|-------------|
| signals | Array of signal objects (category, status, title, body, URL, actor) |
| lastViewedAt | When the review hub was last viewed (for unread detection) |
| ownerAgentType | Cloud agent provider that owns this PR (`anthropic`, `cursor`, `codex`, or null) |
| additions / deletions / changedFiles | PR diff stats |

Each signal has: `id`, `category` (ci/review/deployment/bot_comment/human_comment/custom), `status` (success/failure/pending/running/neutral/warning), `title`, `signalBody`, `url`, `actorLogin`, `scoreValue`, `scoreLabel`.

## Examples

```bash
lightsprint review-hub signals LIG-024 --output json
lightsprint review-hub signals LIG-024 --refresh --output json
lightsprint review-hub signals 24 --fields signals
```

## Invariants

- Use `--refresh` sparingly — it re-fetches all signals from GitHub API. The default cached read is usually sufficient.
- Check signals before checking scores — signals are what the AI readiness analysis is based on.
- Task must have a linked PR. If not, you'll get an error suggesting `lightsprint link-pr`.
- The first call to signals for a PR may auto-trigger backfill from GitHub (even without `--refresh`).
```

- [ ] **Step 2: Create `skills/review-hub-scores/SKILL.md`**

```markdown
---
name: review-hub-scores
description: Get AI readiness analysis (score, summaries, callouts, suggested actions) for a task's linked PR. Use to assess whether a PR is ready to merge.
---

Run this command to get AI readiness scores for a task's linked PR:

` ` `bash
lightsprint review-hub scores $ARGUMENTS
` ` `

Usage: `review-hub scores <taskId> [--refresh]`

- `<taskId>` — Task ID (display ID like `LIG-024`, bare number, or raw ID). Required.
- `--refresh` — Force-refresh signals from GitHub and trigger fresh AI analysis. **Consumes credits.**

Without `--refresh`, returns cached scores if available. If the cache is stale (signals changed since last analysis), the server may automatically trigger a fresh analysis.

## Output fields

| Field | Description |
|-------|-------------|
| readinessScore | 0-100 readiness score (null if no scores available) |
| readinessLabel | Human-readable label (e.g. "Ready", "Ready with minor issues") |
| sectionSummaries | Object with section names as keys, summary strings as values |
| changeCallouts | Array of notable changes or concerns |
| suggestedActions | Array of recommended actions before merging |
| addressal | Comment addressal analysis (which review comments were addressed) or null |

## Examples

```bash
lightsprint review-hub scores LIG-024 --output json
lightsprint review-hub scores LIG-024 --refresh --output json
lightsprint review-hub scores 24 --fields readinessScore,readinessLabel
```

## Invariants

- Scores cost credits when `--refresh` triggers fresh AI analysis. Always read cached scores first.
- If `readinessScore` is null, no analysis has been run yet. Decide whether to `--refresh` based on context.
- If signals are stale, refresh signals first (`review-hub signals --refresh`), then refresh scores.
- This command may take up to 2 minutes when triggering fresh AI analysis (120s timeout).
- Task must have a linked PR.
```

- [ ] **Step 3: Create `skills/agent-create-pr/SKILL.md`**

```markdown
---
name: agent-create-pr
description: Create a GitHub PR from a cloud agent's working branch. Use after an agent finishes work to open a PR for review.
---

Run this command to create a PR from a cloud agent's branch:

` ` `bash
lightsprint agent create-pr $ARGUMENTS
` ` `

Usage: `agent create-pr --task <taskId> --provider <anthropic|cursor|codex> --agent-id <agentId>`

- `--task <taskId>` — Task ID (required)
- `--provider <provider>` — Cloud agent provider (required): `anthropic`, `cursor`, `codex`
- `--agent-id <id>` — Agent ID (required). Found in the task's agent details via `lightsprint get <taskId>`.

## Examples

```bash
lightsprint agent create-pr --task LIG-024 --provider anthropic --agent-id abc123 --output json
```

## Invariants

- Only works for agents that have completed their work (FINISHED status). Check agent status with `lightsprint get <taskId>` first.
- The `--agent-id` can be found in the task details under the cloud agent entries for the relevant provider.
- After PR creation, use `lightsprint link-pr` if the PR isn't automatically linked.
- All three flags (`--task`, `--provider`, `--agent-id`) are required.
```

- [ ] **Step 4: Create `skills/agent-settings/SKILL.md`**

```markdown
---
name: agent-settings
description: Check which cloud agent providers (anthropic, cursor, codex) are configured and their default models. Use before launching agents.
---

Run this command to check cloud agent provider configuration:

` ` `bash
lightsprint agent settings $ARGUMENTS
` ` `

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
```

- [ ] **Step 5: Create `skills/merge/SKILL.md`**

```markdown
---
name: merge
description: Merge the GitHub PR linked to a Lightsprint task. Supports direct merge and GitHub merge queue.
---

Run this command to merge a task's linked PR:

` ` `bash
lightsprint merge $ARGUMENTS
` ` `

Usage: `merge <taskId>`

- `<taskId>` — Task ID (display ID like `LIG-024`, bare number, or raw ID). Can also use `--task <taskId>`.

## Output fields

| Field | Description |
|-------|-------------|
| success | Boolean |
| pr.prUrl | PR URL |
| pr.prNumber | PR number |
| pr.status | `merged` (done) or `queued` (in merge queue, will merge when checks pass) |
| pr.title | PR title |
| pr.sha | Merge commit SHA (only when directly merged, not when queued) |

## Examples

```bash
lightsprint merge LIG-024 --output json
lightsprint merge --task LIG-024 --output json
lightsprint merge 24 --dry-run
```

## Invariants

- Task must have a linked PR. If not, error will suggest using `lightsprint link-pr`.
- Check review-hub signals/scores before merging to ensure the PR is ready.
- If the response status is `queued`, the repo uses GitHub merge queue — the PR will merge automatically when required checks pass.
- Common errors: PR already merged/closed, merge conflict (409), required checks not passing (422), insufficient permissions.
- This is a destructive action — once merged, it cannot be undone from the CLI.
```

- [ ] **Step 6: Commit**

```bash
git add skills/review-hub-signals/SKILL.md skills/review-hub-scores/SKILL.md skills/agent-create-pr/SKILL.md skills/agent-settings/SKILL.md skills/merge/SKILL.md
git commit -m "feat: add skill files for review-hub, merge, agent create-pr, agent settings"
```

---

### Task 7: Smoke test all new commands

**Files:** None (verification only)

- [ ] **Step 1: Verify `lightsprint describe` works for new schemas**

Run:
```bash
lightsprint describe merge
lightsprint describe review-hub-signals
lightsprint describe review-hub-scores
lightsprint describe agent-create-pr
```

Each should output a JSON schema describing the command's params.

- [ ] **Step 2: Verify help output includes new commands**

Run:
```bash
lightsprint help | grep -E 'merge|review-hub|create-pr'
```

Expected: Lines for `merge`, `review-hub signals`, `review-hub scores`, `agent create-pr`.

- [ ] **Step 3: Verify dry-run works for mutating commands**

Run:
```bash
lightsprint merge --task TEST-1 --dry-run --output json
lightsprint agent create-pr --task TEST-1 --provider anthropic --agent-id test --dry-run --output json
```

Each should output a dry-run JSON with `validationPassed: true`.

- [ ] **Step 4: Verify error handling for missing PR**

Run:
```bash
lightsprint review-hub signals --task NONEXISTENT --output json 2>&1 || true
lightsprint merge NONEXISTENT --output json 2>&1 || true
```

Should output structured error JSON (not crash).

- [ ] **Step 5: Verify `agent create-pr` is in agent subcommand help**

Run:
```bash
lightsprint agent 2>&1 | grep create-pr || lightsprint agent help 2>&1 | grep create-pr || true
```

Should mention `create-pr` in the error message listing valid subcommands.

- [ ] **Step 6: Commit (if any fixes were needed)**

```bash
git add -A && git commit -m "fix: address issues found in smoke testing" || echo "No fixes needed"
```
