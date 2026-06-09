# Workspace-Scoped CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the `lightsprint` CLI from repo-scoped to workspace-scoped: `connect` saves a single active workspace, all commands operate at workspace scope, and `cc_sessions`/`plans` become workspace-first. Tokens stay user-scoped.

**Architecture:** Server-first. Phase A migrates `cc_sessions`/`cc_session_events`/`plans` to `workspaceId NOT NULL` + nullable `repoId` (the pattern `tasks` already uses) and updates their endpoints/WS handler to authorize by workspace. Phase B teaches `authorize-cli` to return a chosen `workspace_id`. Phase C replaces the CLI's `repos.json` with a single workspace-first `connection.json` and rewrites commands onto `/api/workspaces/{id}/...`. Phase D rewrites the daemon to register sessions by workspace. `PUBLIC_DEFAULT_STACK_TASKS` is assumed always-on.

**Tech Stack:** Server — SvelteKit 2 / Svelte 5, Drizzle ORM (Postgres), Vitest (unit), Playwright (e2e), Bun. CLI — Node/Bun ESM, `bun:test`.

**Repos:** Server tasks are in `lightsprint/app/...`. CLI/daemon tasks are in `lightsprint-claude-code-plugin/...`. Each task names its repo.

**Spec:** `docs/superpowers/specs/2026-06-08-workspace-scoped-cli-design.md` (in the CLI repo).

---

## File Structure

### Server (`lightsprint/app`)
- **Modify** `src/lib/server/db/schema/cc-sessions.ts` — add `workspaceId` (notNull), make `repoId` nullable, on both `ccSessions` and `ccSessionEvents`; add workspace indexes.
- **Modify** `src/lib/server/db/schema/plans.ts` — add `workspaceId` (notNull), make `repoId` nullable; add workspace index.
- **Create** `drizzle/0278_cc_sessions_plans_workspace.sql` (+ snapshot) — add columns nullable, backfill from `repos.workspace_id`, enforce `workspaceId NOT NULL`, drop `repoId NOT NULL`.
- **Modify** `src/lib/server/oauth/validate.ts` — `OAuthTokenInfo` gains `workspaceId: string | null`; resolve it from the token's repo.
- **Modify** `src/lib/server/api/middleware.ts` — `ApiKeyAuth.workspaceId` populated for `oauth` tokens too.
- **Modify** `src/lib/server/dao/cc-session.dao.ts` — `createSession`/queries keyed by `workspaceId`; `findByWorkspaceId`.
- **Modify** `src/routes/api/cc-sessions/+server.ts`, `[sessionId]/+server.ts`, `[sessionId]/task/+server.ts` — authorize by workspace not `token.repoId`.
- **Modify** `src/lib/server/realtime.ts` (WS `session:start`) — create sessions with `workspaceId`.
- **Create** `src/routes/api/workspaces/[id]/tasks/resolve/+server.ts` — task-ref resolution at workspace scope.
- **Create** `src/routes/api/workspaces/[id]/plans/+server.ts` — workspace/stack-scoped plan create.
- **Modify** `src/lib/server/api/task-board-query.ts` — parse a `stack` filter.
- **Modify** `src/routes/api/workspaces/[id]/board/+server.ts` — apply the stack filter.
- **Modify** `src/routes/authorize-cli/+page.svelte`, `+page.server.ts`, `+server.ts` — workspace selection; return `workspace_id`/`workspace_name`.

### CLI (`lightsprint-claude-code-plugin`)
- **Create** `scripts/lib/connection.js` — workspace-first store (`readConnection`/`writeConnection`/`clearConnection`).
- **Modify** `scripts/lib/config.js` — delete `REPOS_FILE`/`readReposFile`/`writeReposFile`/`findRepoConfig`; `getConfig`/`requireConfig` read the connection.
- **Modify** `scripts/lib/auth.js` — write the connection object on success; carry workspace from callback.
- **Modify** `scripts/lib/client.js` — token-refresh writeback → connection; `getWorkspaceId` from config; remove `getRepoId`/`getRepoInfo`.
- **Modify** `scripts/ls-cli.js` — rewrite `cmdTasks`, `cmdProjects`, `cmdWhoami`, `cmdStatus`, `cmdConnect`, `cmdDisconnect`, `cmdOpen`, `cmdResolve`, `cmdCreate` (`--stack`), `cmdCreatePlan`; add `cmdStacks`/`cmdStackGet`; routing + help.
- **Modify** `scripts/cc-start.js` / `scripts/cc-daemon.js` — `LS_WORKSPACE_ID` instead of `LS_REPO_ID`; register sessions by workspace.

---

## Conventions

- **Migrations:** edit schema, then `cd app && bun run db:generate --name <name>` (auto-numbers + writes snapshot). Never hand-write SQL except the backfill, which Drizzle can't express — see Task A1 for the manual SQL pattern (and copy the snapshot per `app/CLAUDE.md`).
- **Server checks before commit:** `cd app && bun run check && bun run test`.
- **CLI tests:** `cd lightsprint-claude-code-plugin && bun test scripts/__tests__/<file>`.
- **Response helpers:** server routes use `success(data)` / `badRequest(msg)` / `notFound(msg)` from `$lib/server/api/response` and `withErrorHandling(handler, 'msg')`.
- Next Drizzle migration number is **0278** (verify with `ls app/drizzle | tail`).

---

# Phase A — Server: workspace-first cc_sessions & plans

## Task A1: Schema migration — cc_sessions/cc_session_events/plans → workspace-first

**Files:**
- Modify: `app/src/lib/server/db/schema/cc-sessions.ts`
- Modify: `app/src/lib/server/db/schema/plans.ts`
- Create: `app/drizzle/0278_cc_sessions_plans_workspace.sql` (hand-authored backfill) + snapshot

- [ ] **Step 1: Add `workspaces` import + columns to `cc-sessions.ts`**

In `app/src/lib/server/db/schema/cc-sessions.ts`, add `workspaces` to imports and edit both tables. `ccSessions`:

```ts
import { workspaces } from './core';
// ...
export const ccSessions = pgTable('cc_sessions', {
	id: text('id').primaryKey().$defaultFn(createId),
	workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
	repoId: text('repo_id').references(() => repos.id, { onDelete: 'set null' }),
	userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
	// ...unchanged columns...
}, (table) => ({
	workspaceIdIdx: index('cc_sessions_workspace_id_idx').on(table.workspaceId),
	repoIdIdx: index('cc_sessions_repo_id_idx').on(table.repoId),
	ccSessionIdIdx: index('cc_sessions_cc_session_id_idx').on(table.ccSessionId),
	statusIdx: index('cc_sessions_status_idx').on(table.status),
	startedAtIdx: index('cc_sessions_started_at_idx').on(table.startedAt)
}));
```

`ccSessionEvents`: add `workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' })` and change `repoId` to `.references(() => repos.id, { onDelete: 'set null' })` (drop `.notNull()`); add `workspaceIdIdx`.

- [ ] **Step 2: Add columns to `plans.ts`**

In `app/src/lib/server/db/schema/plans.ts`, ensure `workspaces` is imported, then on `plans`:

```ts
	workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
	repoId: text('repo_id').references(() => repos.id, { onDelete: 'set null' }),
```

Add to the table's index block: `workspaceIdIdx: index('plans_workspace_id_idx').on(table.workspaceId),`.

- [ ] **Step 3: Generate the structural migration**

Run: `cd app && bun run db:generate --name cc_sessions_plans_workspace`
Expected: a new `drizzle/0278_*.sql` with `ADD COLUMN workspace_id`, the FK changes, and an updated snapshot under `drizzle/meta/`.

Because Drizzle will emit `workspace_id ... NOT NULL` with no backfill (which fails on existing rows), **replace the generated SQL** with the safe ordering below.

- [ ] **Step 4: Replace the migration body with add-nullable → backfill → enforce**

Edit `app/drizzle/0278_cc_sessions_plans_workspace.sql` to:

```sql
-- 1. Add columns nullable
ALTER TABLE "cc_sessions" ADD COLUMN "workspace_id" text;
ALTER TABLE "cc_session_events" ADD COLUMN "workspace_id" text;
ALTER TABLE "plans" ADD COLUMN "workspace_id" text;

-- 2. Backfill workspace_id from the owning repo
UPDATE "cc_sessions" s SET "workspace_id" = r."workspace_id" FROM "repos" r WHERE s."repo_id" = r."id";
UPDATE "cc_session_events" e SET "workspace_id" = r."workspace_id" FROM "repos" r WHERE e."repo_id" = r."id";
UPDATE "plans" p SET "workspace_id" = r."workspace_id" FROM "repos" r WHERE p."repo_id" = r."id";

-- 3. Drop any orphan rows whose repo no longer exists (cannot satisfy NOT NULL)
DELETE FROM "cc_session_events" WHERE "workspace_id" IS NULL;
DELETE FROM "cc_sessions" WHERE "workspace_id" IS NULL;
DELETE FROM "plans" WHERE "workspace_id" IS NULL;

-- 4. Enforce NOT NULL + FKs
ALTER TABLE "cc_sessions" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "cc_session_events" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "plans" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "cc_sessions" ADD CONSTRAINT "cc_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade;
ALTER TABLE "cc_session_events" ADD CONSTRAINT "cc_session_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade;
ALTER TABLE "plans" ADD CONSTRAINT "plans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade;

-- 5. Relax repo_id NOT NULL (repo is now optional context)
ALTER TABLE "cc_sessions" ALTER COLUMN "repo_id" DROP NOT NULL;
ALTER TABLE "cc_session_events" ALTER COLUMN "repo_id" DROP NOT NULL;
ALTER TABLE "plans" ALTER COLUMN "repo_id" DROP NOT NULL;

-- 6. Indexes
CREATE INDEX IF NOT EXISTS "cc_sessions_workspace_id_idx" ON "cc_sessions" ("workspace_id");
CREATE INDEX IF NOT EXISTS "cc_session_events_workspace_id_idx" ON "cc_session_events" ("workspace_id");
CREATE INDEX IF NOT EXISTS "plans_workspace_id_idx" ON "plans" ("workspace_id");
```

Keep the generated `drizzle/meta/0278_snapshot.json` (it matches the final schema shape). If the FK constraint names in the snapshot differ, align the SQL names to the snapshot.

- [ ] **Step 5: Apply locally + verify**

Run: `cd app && bun run db:migrate`
Expected: migration `0278_cc_sessions_plans_workspace` applies cleanly.
Run: `cd app && bun run check`
Expected: 0 type errors (schema changes typecheck).

- [ ] **Step 6: Commit**

```bash
cd app && git add src/lib/server/db/schema/cc-sessions.ts src/lib/server/db/schema/plans.ts drizzle/0278_cc_sessions_plans_workspace.sql drizzle/meta
git commit -m "feat(db): workspace-first cc_sessions/cc_session_events/plans (nullable repo_id)"
```

## Task A2: Token + middleware expose workspaceId for OAuth tokens

**Files:**
- Modify: `app/src/lib/server/oauth/validate.ts`
- Modify: `app/src/lib/server/api/middleware.ts`
- Test: `app/src/lib/server/oauth/validate.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/append `app/src/lib/server/oauth/validate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const findValidByTokenHash = vi.fn();
vi.mock('$lib/server/dao/oauth-access-token.dao', () => ({
	oauthAccessTokenDAO: { findValidByTokenHash: (...a: any[]) => findValidByTokenHash(...a) }
}));
vi.mock('$lib/server/dao/user.dao', () => ({ userDAO: { isLightsprintLocked: vi.fn().mockResolvedValue(false) } }));
const findMinimal = vi.fn();
vi.mock('$lib/server/dao/repo.dao', () => ({ repoDAO: { findMinimal: (...a: any[]) => findMinimal(...a) } }));

import { validateAccessToken } from './validate';

describe('validateAccessToken workspaceId', () => {
	beforeEach(() => { findValidByTokenHash.mockReset(); findMinimal.mockReset(); });

	it('resolves workspaceId from the token repo', async () => {
		findValidByTokenHash.mockResolvedValue({ repoId: 'r1', userId: 'u1', scopes: ['tasks:read'], expiresAt: new Date(Date.now() + 10000) });
		findMinimal.mockResolvedValue({ id: 'r1', workspaceId: 'ws1' });
		const info = await validateAccessToken('lsat_x');
		expect(info?.workspaceId).toBe('ws1');
	});
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd app && bun run test src/lib/server/oauth/validate.test.ts`
Expected: FAIL (`workspaceId` is `undefined`).

- [ ] **Step 3: Implement in `validate.ts`**

Add the field and resolution:

```ts
import { repoDAO } from '$lib/server/dao/repo.dao';

export interface OAuthTokenInfo {
	repoId: string;
	workspaceId: string | null;
	userId: string;
	scopes: string[];
}

// inside validateAccessToken, after the lock check:
	const repo = row.repoId ? await repoDAO.findMinimal(row.repoId) : null;
	return {
		repoId: row.repoId,
		workspaceId: (repo as any)?.workspaceId ?? null,
		userId: row.userId,
		scopes: row.scopes
	};
```

(`repoDAO.findMinimal` already selects `{ id, workspaceId }` — see `repo.dao.ts:111`.)

- [ ] **Step 4: Propagate in `middleware.ts`**

In `tryBearerTokenAuth`, the `lsat_` branch (middleware.ts:121) sets `workspaceId`:

```ts
		auth = {
			kind: 'oauth',
			userId: tokenInfo.userId,
			repoId: tokenInfo.repoId,
			workspaceId: tokenInfo.workspaceId,
			scopes: tokenInfo.scopes,
		};
```

Do **not** set `agentAuthorizationWorkspaceId` for oauth tokens — access stays membership-based (only `agent-session` narrows). This keeps user-scoped behavior intact.

- [ ] **Step 5: Run test + typecheck**

Run: `cd app && bun run test src/lib/server/oauth/validate.test.ts && bun run check`
Expected: PASS, 0 type errors.

- [ ] **Step 6: Commit**

```bash
cd app && git add src/lib/server/oauth/validate.ts src/lib/server/oauth/validate.test.ts src/lib/server/api/middleware.ts
git commit -m "feat(oauth): expose workspaceId on validated CLI tokens"
```

## Task A3: cc-session DAO — workspace-keyed creation & queries

**Files:**
- Modify: `app/src/lib/server/dao/cc-session.dao.ts`
- Test: `app/src/lib/server/dao/cc-session.dao.test.ts` (create)

- [ ] **Step 1: Write the failing test (pure-shape)**

Create `app/src/lib/server/dao/cc-session.dao.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CcSessionDAO } from './cc-session.dao';

describe('CcSessionDAO.createSession signature', () => {
	it('accepts workspaceId and optional repoId', () => {
		const dao = new CcSessionDAO();
		// type-level guard: call shape compiles with workspaceId, repoId optional
		expect(typeof dao.createSession).toBe('function');
		expect(typeof dao.findByWorkspaceId).toBe('function');
	});
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd app && bun run test src/lib/server/dao/cc-session.dao.test.ts`
Expected: FAIL (`findByWorkspaceId` is `undefined`).

- [ ] **Step 3: Implement**

In `cc-session.dao.ts`:
- `createSession` input becomes `{ workspaceId: string; repoId?: string; userId?: string; ccSessionId: string; gitBranch?: string; machineId?: string }`.
- `findByCcSessionId(workspaceId, ccSessionId)` filters on `eq(ccSessions.workspaceId, workspaceId)`.
- Add:

```ts
	async findByWorkspaceId(workspaceId: string, opts?: { limit?: number; offset?: number; status?: 'active' | 'inactive' | 'completed' | 'errored' }): Promise<CcSessionSelect[]> {
		const conditions = [eq(ccSessions.workspaceId, workspaceId)];
		if (opts?.status) conditions.push(eq(ccSessions.status, opts.status));
		return this.findMany({ where: and(...conditions), orderBy: desc(ccSessions.startedAt), limit: opts?.limit, offset: opts?.offset });
	}
```

- `CcSessionEventDAO.insertBatch` event input: `repoId?` optional, add `workspaceId: string`.

- [ ] **Step 4: Run test + typecheck**

Run: `cd app && bun run test src/lib/server/dao/cc-session.dao.test.ts && bun run check`
Expected: PASS (note: `check` surfaces every caller of the changed signatures — Tasks A4/A5 fix them; if `check` fails only in routes/realtime touched by A4/A5, proceed and let those tasks resolve it. Re-run `check` green at the end of A5.)

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/server/dao/cc-session.dao.ts src/lib/server/dao/cc-session.dao.test.ts
git commit -m "feat(cc-sessions): workspace-keyed DAO create/query"
```

## Task A4: cc-session routes — authorize by workspace

**Files:**
- Modify: `app/src/routes/api/cc-sessions/+server.ts`
- Modify: `app/src/routes/api/cc-sessions/[sessionId]/+server.ts`
- Modify: `app/src/routes/api/cc-sessions/[sessionId]/task/+server.ts`

- [ ] **Step 1: List route — filter by workspace**

In `api/cc-sessions/+server.ts`, replace the `repoId` resolution + query with workspace resolution:

```ts
	const tokenAuth = getApiKeyAuth(event);
	let workspaceId: string;
	if (tokenAuth?.workspaceId) {
		workspaceId = tokenAuth.workspaceId;
	} else {
		const qWorkspaceId = url.searchParams.get('workspaceId');
		if (!qWorkspaceId) badRequest('workspaceId query parameter is required for session auth');
		await requireWorkspaceAccess(qWorkspaceId, session.user.id);
		workspaceId = qWorkspaceId;
	}

	const conditions = [eq(ccSessions.workspaceId, workspaceId)];
	if (status) conditions.push(eq(ccSessions.status, status));
```

Swap the import `requireRepoAccess` → `requireWorkspaceAccess` (already exported from middleware). Keep the `leftJoin(users)` block unchanged.

- [ ] **Step 2: Detail + task routes — ownership by workspace**

In both `[sessionId]/+server.ts` and `[sessionId]/task/+server.ts`, replace the access block:

```ts
	const tokenAuth = getApiKeyAuth(event);
	if (tokenAuth?.workspaceId) {
		if (ccSession.workspaceId !== tokenAuth.workspaceId) notFound('CC session not found');
	} else {
		await requireWorkspaceAccess(ccSession.workspaceId, session.user.id);
	}
```

Swap `requireRepoAccess` import → `requireWorkspaceAccess`.

- [ ] **Step 3: Typecheck**

Run: `cd app && bun run check`
Expected: 0 errors in `api/cc-sessions/*`.

- [ ] **Step 4: Commit**

```bash
cd app && git add src/routes/api/cc-sessions
git commit -m "feat(cc-sessions): authorize sessions by workspace, not token repo"
```

## Task A5: WebSocket session registration by workspace

**Files:**
- Modify: `app/src/lib/server/realtime.ts` (the `session:start` handler that calls `ccSessionDAO.createSession`)

- [ ] **Step 1: Locate the handler**

Run: `cd app && grep -n "createSession\|findByCcSessionId\|repoId" src/lib/server/realtime.ts`
Read the `session:start` block that currently creates a session with `{ repoId }`.

- [ ] **Step 2: Register with workspaceId**

The daemon now sends `workspaceId` (Phase D) and an optional `repoId`. In the handler:

```ts
	// payload now carries workspaceId; repoId is optional
	const existing = await ccSessionDAO.findByCcSessionId(payload.workspaceId, payload.ccSessionId);
	const session = existing ?? await ccSessionDAO.createSession({
		workspaceId: payload.workspaceId,
		repoId: payload.repoId ?? undefined,
		userId,
		ccSessionId: payload.ccSessionId,
		gitBranch: payload.gitBranch,
		machineId: payload.machineId,
	});
```

When events are persisted, set `workspaceId: session.workspaceId` and `repoId: session.repoId ?? undefined` on `ccSessionEventDAO.insertBatch`.

- [ ] **Step 3: Typecheck + unit tests**

Run: `cd app && bun run check && bun run test src/lib/server/oauth src/lib/server/dao/cc-session.dao.test.ts`
Expected: 0 type errors; PASS. (`check` must now be fully green.)

- [ ] **Step 4: Commit**

```bash
cd app && git add src/lib/server/realtime.ts
git commit -m "feat(realtime): register cc-sessions by workspace"
```

## Task A6: Workspace-scoped plan create endpoint

**Files:**
- Create: `app/src/routes/api/workspaces/[id]/plans/+server.ts`
- Test: `app/src/routes/api/workspaces/[id]/plans/route.test.ts` (mirror an existing route test)

- [ ] **Step 1: Read the existing repo plans route**

Run: `cd app && cat src/routes/api/repos/\[id\]/plans/+server.ts`
The POST validates `content`, dedupes by `ccSessionId`, and calls the plan service/DAO with `repoId`. Reproduce it at workspace scope.

- [ ] **Step 2: Write the route**

Create `app/src/routes/api/workspaces/[id]/plans/+server.ts`:

```ts
import type { RequestHandler } from './$types';
import { requireAuth, requireScope, requireWorkspaceAccess, getApiKeyAuth, withErrorHandling } from '$lib/server/api/middleware';
import { success, badRequest } from '$lib/server/api/response';
import { planDAO } from '$lib/server/dao';

export const POST: RequestHandler = withErrorHandling(async (event) => {
	const session = await requireAuth(event);
	requireScope(event, 'plans:write');

	const tokenAuth = getApiKeyAuth(event);
	const workspaceId = tokenAuth?.workspaceId || event.params.id;
	await requireWorkspaceAccess(workspaceId, session.user.id);

	const body = await event.request.json();
	const { content, allowedPrompts, metadata, ccSessionId, stackId, taskId } = body;
	if (!content || typeof content !== 'string') badRequest('Missing required field: content (markdown string)');

	if (ccSessionId) {
		const existing = await planDAO.findPendingByCcSessionId(ccSessionId);
		if (existing) return success({ plan: existing });
	}

	// repoId is derived server-side from the linked task when present, else null.
	const plan = await planDAO.createWorkspacePlan({
		workspaceId, stackId: stackId ?? null, taskId: taskId ?? null,
		ccSessionId: ccSessionId ?? null, content, allowedPrompts, metadata,
		createdBy: session.user.id,
	});
	return success({ plan });
}, 'Failed to create plan');
```

- [ ] **Step 3: Add `planDAO.createWorkspacePlan`**

In `app/src/lib/server/dao/plan.dao.ts`, add a method that inserts a plan + first `planVersions` row with `workspaceId` set and `repoId` derived from `taskId` (via `taskDAO.findMinimal`) or null. Mirror the existing repo-scoped create method (find it with `grep -n "async create" src/lib/server/dao/plan.dao.ts` and copy its version-row logic, swapping `repoId` for `workspaceId`).

- [ ] **Step 4: Route test**

Mirror `api/workspaces/[id]/board/route.test.ts` structure: assert a `plans:write`-scoped request with `content` returns `{ plan }` and that missing `content` → 400. Run:
`cd app && bun run test src/routes/api/workspaces/\[id\]/plans/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/routes/api/workspaces/\[id\]/plans src/lib/server/dao/plan.dao.ts
git commit -m "feat(plans): workspace/stack-scoped plan create endpoint"
```

## Task A7: Workspace task-ref resolve endpoint

**Files:**
- Create: `app/src/routes/api/workspaces/[id]/tasks/resolve/+server.ts`

- [ ] **Step 1: Read the repo resolve endpoint**

Run: `cd app && cat src/routes/api/repos/\[id\]/tasks/resolve/+server.ts`
It resolves a `?ref=` (e.g. `ENG-123`) to a task in the repo.

- [ ] **Step 2: Write the workspace version**

Create `app/src/routes/api/workspaces/[id]/tasks/resolve/+server.ts` that:
- `requireAuth` + `requireScope(event, 'tasks:read')` + `requireWorkspaceAccess(workspaceId, userId)`.
- Reads `?ref=`, parses a `PREFIX-NUMBER` shape, resolves the stack by `taskPrefix` via `stackDAO.findByWorkspaceAndPrefix(workspaceId, prefix)`, then finds the task by `(stackId, taskNumber)`; falls back to workspace-wide `(workspaceId, taskNumber)`.
- Returns `success({ task })` or `notFound('Task not found for ref')`.

```ts
import type { RequestHandler } from './$types';
import { requireAuth, requireScope, requireWorkspaceAccess, withErrorHandling } from '$lib/server/api/middleware';
import { success, badRequest, notFound } from '$lib/server/api/response';
import { stackDAO, taskDAO } from '$lib/server/dao';

export const GET: RequestHandler = withErrorHandling(async (event) => {
	const session = await requireAuth(event);
	requireScope(event, 'tasks:read');
	const workspaceId = event.params.id;
	await requireWorkspaceAccess(workspaceId, session.user.id);

	const ref = event.url.searchParams.get('ref');
	if (!ref) badRequest('ref query parameter is required');
	const m = ref.match(/^([A-Za-z][A-Za-z0-9]*)-(\d+)$/);
	if (!m) badRequest('ref must look like PREFIX-123');
	const [, prefix, numStr] = m;
	const taskNumber = parseInt(numStr, 10);

	const stack = await stackDAO.findByWorkspaceAndPrefix(workspaceId, prefix.toUpperCase());
	const task = await taskDAO.findByWorkspaceRef(workspaceId, taskNumber, stack?.id ?? null);
	if (!task) notFound('Task not found for ref');
	return success({ task });
}, 'Failed to resolve task ref');
```

Add `taskDAO.findByWorkspaceRef(workspaceId, taskNumber, stackId)` to `task.dao.ts`: when `stackId` is set, filter `(stackId, taskNumber)`; else `(workspaceId, taskNumber)`. Uses the existing `tasks.stackId`/`tasks.workspaceId` + `taskNumber` columns/indexes.

- [ ] **Step 3: Typecheck**

Run: `cd app && bun run check`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
cd app && git add src/routes/api/workspaces/\[id\]/tasks/resolve src/lib/server/dao/task.dao.ts
git commit -m "feat(tasks): workspace task-ref resolve endpoint"
```

## Task A8: Stack filter on the workspace board

**Files:**
- Modify: `app/src/lib/server/api/task-board-query.ts`
- Modify: `app/src/lib/server/types/task-filters.ts` (add `stackId?: string` to `TaskFilters`)
- Modify: `app/src/routes/api/workspaces/[id]/board/+server.ts` (and the underlying board/list query path to honor `stackId`)
- Test: `app/src/lib/server/api/task-board-query.test.ts` (create/append)

- [ ] **Step 1: Failing test for the parser**

Append to `task-board-query.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseTaskFiltersFromUrl } from './task-board-query';

describe('parseTaskFiltersFromUrl stack', () => {
	it('parses ?stack=stk_1 into filters.stackId', () => {
		const f = parseTaskFiltersFromUrl(new URL('https://x/?stack=stk_1'));
		expect(f.stackId).toBe('stk_1');
	});
});
```

- [ ] **Step 2: Run — verify fail**

Run: `cd app && bun run test src/lib/server/api/task-board-query.test.ts`
Expected: FAIL (`stackId` undefined).

- [ ] **Step 3: Implement parser + type + query**

- In `task-filters.ts`, add `stackId?: string;` to `TaskFilters`.
- In `task-board-query.ts` `parseTaskFiltersFromUrl`, before `return`:

```ts
	const stackParam = url.searchParams.get('stack');
	if (stackParam && /^[A-Za-z0-9_-]{1,64}$/.test(stackParam)) {
		taskFilters.stackId = stackParam;
	}
```

- In the workspace board task-id queries (`taskUiStateDAO.fetchOrderedTaskIdsForWorkspace` / `countTasksForWorkspace` and their kanban equivalents in `board.service.ts`), add a `WHERE tasks.stack_id = :stackId` clause when `taskFilters.stackId` is present. Find the filter application with `grep -rn "taskFilters" src/lib/server/dao/task-ui-state.dao.ts src/lib/server/services/domain/repo/board.service.ts` and extend the existing filter builder (it already handles `statuses`, `projectIds`, etc.) with a `stackId` branch.

- [ ] **Step 4: Run test + typecheck**

Run: `cd app && bun run test src/lib/server/api/task-board-query.test.ts && bun run check`
Expected: PASS, 0 type errors.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/server/api/task-board-query.ts src/lib/server/types/task-filters.ts src/lib/server/dao src/lib/server/services/domain/repo/board.service.ts
git commit -m "feat(board): support stack filter on workspace board"
```

---

# Phase B — Server: authorize-cli returns a workspace

## Task B1: authorize-cli page selects a workspace

**Files:**
- Modify: `app/src/routes/authorize-cli/+page.server.ts` (already loads `workspaces`; no change needed beyond confirming)
- Modify: `app/src/routes/authorize-cli/+page.svelte`

- [ ] **Step 1: Read the current page**

Run: `cd app && cat src/routes/authorize-cli/+page.svelte`
Identify where it currently posts `repo_id` (a repo selector) to the `+server.ts` action.

- [ ] **Step 2: Replace repo selection with workspace selection**

Change the form to post `workspace_id`: render a `<select>` over `data.workspaces` (each `{ id, name }`). Preselect the workspace whose repos include `data.repo` when the `repo` query param matches exactly one workspace; otherwise show all `data.workspaces` for the user to pick. Keep the hidden `port` and `scope` fields. The submit posts `{ port, scope, workspace_id }`.

To compute the default selection, add to `+page.server.ts`'s return a `candidateWorkspaceIds` array: the workspaceIds of repos in `userRepos` whose `fullName === repo`. (Repos already carry `id`/`fullName`; join to their workspace via a `repoDAO.findByWorkspaceIds` result that includes `workspaceId` — extend that select to include `workspaceId`.)

- [ ] **Step 3: Manual smoke (dev)**

Run the dev server, open `/authorize-cli?port=12345&repo=owner/frontend`, confirm a single-workspace repo auto-selects and a multi-workspace repo shows the picker.

- [ ] **Step 4: Commit**

```bash
cd app && git add src/routes/authorize-cli/+page.svelte src/routes/authorize-cli/+page.server.ts
git commit -m "feat(authorize-cli): select workspace instead of repo"
```

## Task B2: authorize-cli action issues token + returns workspace

**Files:**
- Modify: `app/src/routes/authorize-cli/+server.ts`
- Modify: `app/tests/oauth-cli-flow.spec.ts` (extend)

- [ ] **Step 1: Accept `workspace_id`, validate membership**

In `authorize-cli/+server.ts`, replace `repo_id` handling:

```ts
	const workspaceId = formData.get('workspace_id') as string;
	const port = formData.get('port') as string;
	const requestedScope = (formData.get('scope') as string) || '';
	const portNum = parseInt(port, 10);
	if (!workspaceId || !port || !Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
		return new Response(JSON.stringify({ error: 'Missing required fields or invalid port' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
	}

	const membership = await workspaceMemberDAO.findMembership(workspaceId, session.user!.id);
	if (!membership) {
		return new Response(JSON.stringify({ error: 'Access denied to this workspace' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
	}
	const workspace = await workspaceDAO.findById(workspaceId);
```

- [ ] **Step 2: Issue the (still repo-or-null) token, return workspace in callback**

`issueTokens` requires a `repoId` today (its insert column is now nullable per Task A1, but the `IssueTokensInput` type still has `repoId: string`). Pick a representative repo for the token's legacy `repoId` field — the first repo in the workspace, or null:

```ts
	const wsRepos = await repoDAO.listForWorkspace(workspaceId);
	const representativeRepoId = wsRepos[0]?.id ?? null;
	// ... resolve cliClient + ttls as today ...
	const tokens = await issueTokens({
		clientId: cliClient.id, userId: session.user!.id,
		repoId: representativeRepoId as any, scopes,
		accessTtlSeconds: accessTtl, refreshTtlSeconds: refreshTtl,
	});

	const callbackUrl = new URL(`http://localhost:${portNum}/callback`);
	callbackUrl.searchParams.set('access_token', tokens.accessToken);
	callbackUrl.searchParams.set('refresh_token', tokens.refreshToken);
	callbackUrl.searchParams.set('expires_in', String(tokens.expiresIn));
	callbackUrl.searchParams.set('workspace_id', workspaceId);
	callbackUrl.searchParams.set('workspace_name', workspace?.name ?? '');
	callbackUrl.searchParams.set('email', session.user!.email ?? '');
```

Relax `IssueTokensInput.repoId` to `string | null` in `issue-tokens.ts` (the DAO column is nullable now). Update imports (`workspaceDAO`, `workspaceMemberDAO`, `repoDAO`).

- [ ] **Step 3: Extend the e2e flow test**

In `app/tests/oauth-cli-flow.spec.ts`, update the legacy round-trip to post `workspace_id` and assert the returned `callbackUrl` carries `workspace_id` + `access_token`. Run:
`cd app && bun run test:e2e tests/oauth-cli-flow.spec.ts` (or the documented e2e command).
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd app && git add src/routes/authorize-cli/+server.ts src/lib/server/oauth/issue-tokens.ts app/tests/oauth-cli-flow.spec.ts
git commit -m "feat(authorize-cli): issue user token + return workspace in callback"
```

---

# Phase C — CLI: workspace-first storage & commands

## Task C1: New connection store; delete repos.json

**Files:**
- Create: `scripts/lib/connection.js`
- Modify: `scripts/lib/config.js`
- Test: `scripts/__tests__/connection.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `scripts/__tests__/connection.test.js`:

```js
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ls-conn-')); process.env.LIGHTSPRINT_CONFIG_DIR = dir; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.LIGHTSPRINT_CONFIG_DIR; });

test('write then read round-trips the active workspace', async () => {
	const { writeConnection, readConnection, clearConnection } = await import('../lib/connection.js?' + Math.random());
	writeConnection({ workspaceId: 'ws1', workspaceName: 'Acme', accessToken: 'lsat_x', refreshToken: 'lsrt_x', expiresAt: 123, baseUrl: 'https://lightsprint.ai' });
	expect(readConnection().workspaceId).toBe('ws1');
	clearConnection();
	expect(readConnection()).toBeNull();
});
```

- [ ] **Step 2: Run — verify fail**

Run: `cd lightsprint-claude-code-plugin && bun test scripts/__tests__/connection.test.js`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `connection.js`**

```js
import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync, mkdirSync } from 'fs';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { homedir } from 'os';

function configDir() { return process.env.LIGHTSPRINT_CONFIG_DIR || join(homedir(), '.lightsprint'); }
function connectionFile() { return join(configDir(), 'connection.json'); }

export function readConnection() {
	try {
		const f = connectionFile();
		if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf-8'));
	} catch { /* corrupted — treat as not connected */ }
	return null;
}

export function writeConnection(data) {
	const dir = configDir();
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
	const f = connectionFile();
	const tmp = f + '.' + randomBytes(4).toString('hex');
	writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
	renameSync(tmp, f);
}

export function clearConnection() {
	try { unlinkSync(connectionFile()); } catch { /* already gone */ }
}
```

- [ ] **Step 4: Rewrite `config.js` onto the connection store**

In `scripts/lib/config.js`: delete `REPOS_FILE`, `readReposFile`, `writeReposFile`, `findRepoConfig`. Re-export the connection helpers and rewrite resolution:

```js
import { readConnection, writeConnection, clearConnection } from './connection.js';
export { readConnection, writeConnection, clearConnection };

export function getConfig() {
	const conn = readConnection();
	if (!conn || !conn.workspaceId) return null;
	const baseUrl = process.env.LIGHTSPRINT_BASE_URL || conn.baseUrl || getDefaultBaseUrl();
	return { ...conn, baseUrl };
}

export async function requireConfig() {
	const existing = getConfig();
	if (existing) return existing;
	const { authenticate } = await import('./auth.js');
	const result = await authenticate(getDefaultBaseUrl());
	if (result?.skipped) return null;
	return result;
}
```

Keep `getGitRepoFullName` (still used by `connect` discovery and the daemon). Keep `ensureConfigDir`, preferences, `getDefaultBaseUrl`.

- [ ] **Step 5: Run test + run the existing config test**

Run: `cd lightsprint-claude-code-plugin && bun test scripts/__tests__/connection.test.js scripts/__tests__/config-atomicity.test.js`
Expected: connection test PASS. If `config-atomicity.test.js` references `repos.json`/`readReposFile`, update it to the connection store (it tests atomic writes — point it at `writeConnection`).

- [ ] **Step 6: Commit**

```bash
cd lightsprint-claude-code-plugin && git add scripts/lib/connection.js scripts/lib/config.js scripts/__tests__/connection.test.js scripts/__tests__/config-atomicity.test.js
git commit -m "feat(cli): workspace-first connection store; remove repos.json"
```

## Task C2: client.js — refresh writeback + getWorkspaceId; drop repo helpers

**Files:**
- Modify: `scripts/lib/client.js`
- Test: `scripts/__tests__/client-resilience.test.js` (adjust if it stubs repos.json)

- [ ] **Step 1: Refresh writeback targets connection.json**

In `client.js` `refreshTokenIfNeeded`, replace the `repos.json` lock/update block with:

```ts
		const { readConnection, writeConnection } = await import('./config.js');
		const lockPath = join(configDir, 'connection.json.lock');
		await withFileLock(lockPath, () => {
			const conn = readConnection();
			if (conn) {
				conn.accessToken = data.access_token;
				conn.refreshToken = data.refresh_token;
				conn.expiresAt = Date.now() + (data.expires_in * 1000);
				writeConnection(conn);
			}
		});
```

Remove the `readReposFile`/`writeReposFile` import.

- [ ] **Step 2: getWorkspaceId from config; remove getRepoId/getRepoInfo**

Replace `getRepoInfo`/`getRepoId`/`getWorkspaceId` with:

```ts
export async function getWorkspaceId() {
	const cfg = await config();
	if (!cfg.workspaceId) throw new Error('Not connected to a workspace. Run "lightsprint connect".');
	return cfg.workspaceId;
}
```

Delete `getRepoInfo` and `getRepoId` (callers are migrated in C4–C6). `apiRequestSSE`/`apiRequest`/retry logic unchanged.

- [ ] **Step 3: Typecheck-ish run**

Run: `cd lightsprint-claude-code-plugin && bun test scripts/__tests__/client-resilience.test.js scripts/__tests__/api-request.test.js`
Expected: PASS (adjust any test stubbing `getRepoInfo`/`repos.json`).

- [ ] **Step 4: Commit**

```bash
cd lightsprint-claude-code-plugin && git add scripts/lib/client.js scripts/__tests__
git commit -m "feat(cli): workspace token refresh + getWorkspaceId; drop repo helpers"
```

## Task C3: auth.js — save the workspace connection

**Files:**
- Modify: `scripts/lib/auth.js`

- [ ] **Step 1: Send port+scope (no repo_id) and read workspace from callback**

In `authenticate()`, the authorize URL keeps `repo=<fullName>` (the page uses it to default the picker) but no longer sends `repo_id`. The callback result parsing (in `waitForCallback`) reads:

```js
	const result = {
		accessToken: url.searchParams.get('access_token'),
		refreshToken: url.searchParams.get('refresh_token'),
		expiresIn: url.searchParams.get('expires_in'),
		workspaceId: url.searchParams.get('workspace_id'),
		workspaceName: url.searchParams.get('workspace_name'),
		email: url.searchParams.get('email'),
	};
```

- [ ] **Step 2: Persist the connection object**

Replace the `repos[repoFullName] = entry; writeReposFile(repos)` block with:

```js
	if (!result.accessToken || !result.workspaceId) {
		throw new Error('Authorization failed — no workspace token received.');
	}
	const browserProfile = result.email ? findBrowserProfileForEmail(result.email) : null;
	const entry = {
		workspaceId: result.workspaceId,
		workspaceName: result.workspaceName || null,
		accessToken: result.accessToken,
		refreshToken: result.refreshToken,
		expiresAt: Date.now() + (parseInt(result.expiresIn, 10) * 1000),
		baseUrl,
		...(result.email ? { email: result.email } : {}),
		...(browserProfile || {}),
	};
	writeConnection(entry);
	if (!quiet) console.log(`Connected to workspace: ${entry.workspaceName || entry.workspaceId}`);
	return { ...entry };
```

Update imports: `import { writeConnection, ensureConfigDir, getGitRepoFullName } from './config.js';`. The `skipped` branch just returns `{ skipped: true, baseUrl }` (no per-repo write).

- [ ] **Step 3: Commit**

```bash
cd lightsprint-claude-code-plugin && git add scripts/lib/auth.js
git commit -m "feat(cli): connect saves active workspace connection"
```

## Task C4: tasks / projects / resolve / open / create-plan → workspace endpoints

**Files:**
- Modify: `scripts/ls-cli.js`

- [ ] **Step 0: Add the `resolveStackId` helper (used by `--stack` below and by stacks commands in C5)**

Add near the other helpers in `ls-cli.js`:

```js
async function resolveStackId(workspaceId, ref) {
	if (!ref) return null;
	const data = await apiRequest(`/api/workspaces/${workspaceId}/stacks`);
	const stacks = data.stacks || [];
	const lc = String(ref).toLowerCase();
	const hit = stacks.find(s => s.id === ref)
		|| stacks.find(s => (s.taskPrefix || '').toLowerCase() === lc)
		|| stacks.find(s => (s.name || '').toLowerCase() === lc);
	if (!hit) throw new Error(`No stack matches "${ref}". Run "lightsprint stacks" to list stacks.`);
	return hit.id;
}
```

- [ ] **Step 1: `cmdTasks` → workspace board**

Replace `const repoId = await getRepoId();` with `const workspaceId = await getWorkspaceId();`. Add `--stack` parsing in the arg loop:

```js
		} else if (args[i] === '--stack' && args[i + 1]) {
			stackFilter = args[++i];
```

After parsing, resolve `--stack` to a stackId (Task C5 adds `resolveStackId`): `const stackId = stackFilter ? await resolveStackId(workspaceId, stackFilter) : null;` and `if (stackId) params.set('stack', stackId);`. Replace both request URLs:
`/api/repos/${repoId}/tasks?${params}` → `/api/workspaces/${workspaceId}/board?${params}`.
Replace `validateId(repoId, 'Repo ID')` with `validateId(workspaceId, 'Workspace ID')`. The board returns `{ tasks, totalCount }` (no top-level `taskPrefix`); each task summary carries its own `taskPrefix`/`displayId` — map `task.displayId ?? task.id` instead of building from a board-level prefix. For `--page-all`, drive pagination off `totalCount` vs `offset + tasks.length` (the board has no `pagination.hasMore`): loop while `offset < totalCount`.

- [ ] **Step 2: `cmdProjects` → workspace projects**

Replace `getRepoId()` + URL with:

```js
	const workspaceId = await getWorkspaceId();
	// ...
	const url = `/api/workspaces/${workspaceId}/projects${queryStr ? '?' + queryStr : ''}`;
```

Drop the `repoTaskCount` line from the human formatter (workspace projects have only `taskCount`).

- [ ] **Step 3: `cmdResolve` → workspace resolve**

Replace `/api/repos/${repoId}/tasks/resolve?ref=...` with `/api/workspaces/${workspaceId}/tasks/resolve?ref=${encodeURIComponent(input)}` using `getWorkspaceId()`.

- [ ] **Step 4: `cmdOpen` → workspace board URL**

Replace the URL with `${cfg.baseUrl}/workspaces/${cfg.workspaceId}/tasks` and the not-connected guard message with "Run lightsprint connect first."

- [ ] **Step 5: `cmdCreatePlan` → workspace plans**

Replace `getRepoId()` + `POST /api/repos/${repoId}/plans` with `getWorkspaceId()` + `POST /api/workspaces/${workspaceId}/plans`; pass through optional `stackId` from a new `--stack` flag (resolve via `resolveStackId`).

- [ ] **Step 6: `cmdCreate` `--stack`**

In `cmdCreate`, add `--stack` parsing; when present set `body.stackId = await resolveStackId(workspaceId, stackFilter)`. `workspaceId` already comes from `getWorkspaceId()`.

- [ ] **Step 7: Run CLI routing test**

Run: `cd lightsprint-claude-code-plugin && bun test scripts/__tests__/cli-routing.test.js`
Expected: PASS (update any assertions referencing repo-scoped URLs).

- [ ] **Step 8: Commit**

```bash
cd lightsprint-claude-code-plugin && git add scripts/ls-cli.js
git commit -m "feat(cli): tasks/projects/resolve/open/create-plan are workspace-scoped"
```

## Task C5: stacks commands + `resolveStackId`

**Files:**
- Modify: `scripts/ls-cli.js`
- Test: `scripts/__tests__/e2e-mock-server.test.js` (extend with stacks endpoints)

- [ ] **Step 1: Add `cmdStacks` + `cmdStackGet`**

```js
async function cmdStacks(args, opts) {
	const workspaceId = await getWorkspaceId();
	const data = await apiRequest(`/api/workspaces/${workspaceId}/stacks`);
	const stacks = (data.stacks || []).map(s => ({ id: s.id, name: s.name, taskPrefix: s.taskPrefix, repoIds: s.repoIds || [] }));
	outputResult({ stacks }, opts, () => {
		if (stacks.length === 0) { console.log('No stacks found.'); return; }
		console.log(`Found ${stacks.length} stack(s):\n`);
		for (const s of stacks) console.log(`  ${s.taskPrefix}  ${s.name}  (${s.repoIds.length} repos)  ${s.id}`);
	});
}

async function cmdStackGet(args, opts) {
	const workspaceId = await getWorkspaceId();
	const stackId = await resolveStackId(workspaceId, args[0]);
	validateId(stackId, 'Stack ID');
	const data = await apiRequest(`/api/workspaces/${workspaceId}/stacks/${stackId}`);
	outputResult(data, opts, () => {
		const s = data.stack || data;
		console.log(`${s.taskPrefix}  ${s.name}  ${s.id}`);
		for (const r of (data.repos || data.members || [])) console.log(`  - ${r.fullName || r.name || r.id}`);
	});
}
```

- [ ] **Step 2: (`resolveStackId` already added in Task C4 Step 0 — reused here by `cmdStackGet`.)**

- [ ] **Step 3: Route `stacks` in the command switch + help**

In the routing switch add: `case 'stacks': return args[0] === 'get' ? await cmdStackGet(args.slice(1), opts) : await cmdStacks(args, opts);`. Add `stacks` to the allowed-commands list and a help block.

- [ ] **Step 4: Extend the mock-server e2e test**

In `e2e-mock-server.test.js`, add mock handlers for `GET /api/workspaces/:id/stacks` and `:id/stacks/:stackId`; assert `lightsprint stacks --output json` lists them and `stacks get ENG` resolves by prefix. Run:
`cd lightsprint-claude-code-plugin && bun test scripts/__tests__/e2e-mock-server.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd lightsprint-claude-code-plugin && git add scripts/ls-cli.js scripts/__tests__/e2e-mock-server.test.js
git commit -m "feat(cli): stacks list/get + --stack resolution"
```

## Task C6: whoami / status / connect / disconnect → workspace identity

**Files:**
- Modify: `scripts/ls-cli.js`

- [ ] **Step 1: `cmdWhoami` → workspace + user profile**

```js
async function cmdWhoami(opts) {
	const workspaceId = await getWorkspaceId();
	const [ws, user] = await Promise.all([
		apiRequest(`/api/workspaces/${workspaceId}`),
		apiRequest(`/api/user/profile`).catch(() => null),
	]);
	const result = {
		user: user ? { name: user.name, email: user.email, id: user.id } : null,
		workspace: { id: workspaceId, name: (ws.workspace || ws).name },
	};
	outputResult(result, opts, () => {
		if (result.user) console.log(`User: ${result.user.name}${result.user.email ? ` <${result.user.email}>` : ''}`);
		console.log(`Workspace: ${result.workspace.name} (${result.workspace.id})`);
	});
}
```

(Confirm `/api/user/profile` response keys with `cd app && sed -n '1,40p' src/routes/api/user/profile/+server.ts`; adjust `user.name`/`email`/`id` to match.)

- [ ] **Step 2: `cmdStatus` → connection.json**

Read `getConfig()`; print `Workspace`, `Workspace ID`, `Base URL`, token validity from `expiresAt`. Replace all `cfg.repo*` references with `cfg.workspaceName`/`cfg.workspaceId`. Not-connected message: "Run `lightsprint connect`."

- [ ] **Step 3: `cmdConnect` output**

After `authenticate()`, read `getConfig()` and (json mode) print `{ connected: true, workspaceId, workspaceName }`.

- [ ] **Step 4: `cmdDisconnect` → clearConnection**

```js
async function cmdDisconnect(args, opts) {
	const conn = readConnection();
	clearConnection();
	const result = conn
		? { disconnected: [{ workspaceId: conn.workspaceId, workspaceName: conn.workspaceName || null }] }
		: { disconnected: [], message: 'No active Lightsprint connection.' };
	outputResult(result, opts, () => {
		if (!conn) console.log(result.message);
		else console.log(`Disconnected workspace: ${conn.workspaceName || conn.workspaceId}`);
	});
}
```

Update the `ls-cli.js` imports: drop `readReposFile`/`writeReposFile`/`getRepoInfo`/`getRepoId`; add `readConnection`/`clearConnection` and `getWorkspaceId`.

- [ ] **Step 5: Run full CLI test suite**

Run: `cd lightsprint-claude-code-plugin && bun test scripts/__tests__`
Expected: PASS (fix any remaining repo-scoped assertions).

- [ ] **Step 6: Commit**

```bash
cd lightsprint-claude-code-plugin && git add scripts/ls-cli.js
git commit -m "feat(cli): whoami/status/connect/disconnect are workspace-scoped"
```

---

# Phase D — CLI: daemon registers by workspace

## Task D1: cc-start spawns the daemon with workspace context

**Files:**
- Modify: `scripts/cc-start.js`

- [ ] **Step 1: Use workspaceId everywhere repoId was used**

In `cc-start.js`: `cfg.repoId` → `cfg.workspaceId`; the spawn env `LS_REPO_ID: cfg.repoId` → `LS_WORKSPACE_ID: cfg.workspaceId`; the alias `writeSessionState({ ..., repoId: existingDaemonState.repoId })` → `workspaceId: existingDaemonState.workspaceId`; `repoLabel = cfg.workspaceName || cfg.workspaceId`. The credentials temp file is unchanged.

- [ ] **Step 2: Commit**

```bash
cd lightsprint-claude-code-plugin && git add scripts/cc-start.js
git commit -m "feat(daemon): start daemon with workspace context"
```

## Task D2: cc-daemon registers session + creates plans/tasks by workspace

**Files:**
- Modify: `scripts/cc-daemon.js`
- Test: `scripts/__tests__/cc-daemon-ws.test.js` (extend)

- [ ] **Step 1: Read workspace env + config**

`const WORKSPACE_ID = process.env.LS_WORKSPACE_ID || repoConfig?.workspaceId;`. Replace `REPO_ID`/`LS_REPO_ID` throughout. Update the missing-env guard to require `WORKSPACE_ID`. `setConfig({ ..., workspaceId: WORKSPACE_ID, repo: undefined })` (drop `repoId`). `writeSessionState({ ..., workspaceId: WORKSPACE_ID })`. Sentry context `repoId: REPO_ID` → `workspaceId: WORKSPACE_ID`.

- [ ] **Step 2: WS session:start payload sends workspaceId**

Where the daemon sends `session:start` over the WS (the payload that previously carried `repoId`), send `workspaceId: WORKSPACE_ID` (and `gitBranch`, `machineId` as before; `repoId` omitted — server derives it from the linked task).

- [ ] **Step 3: REST calls → workspace endpoints**

`/api/repos/${REPO_ID}/plans` → `/api/workspaces/${WORKSPACE_ID}/plans` (line ~568). `/api/repos/${REPO_ID}/tasks` (auto task create, ~645) → `POST /api/tasks` with `body.workspaceId = WORKSPACE_ID` (the global tasks endpoint already accepts `workspaceId`). The `activePlan.repoId === REPO_ID` guard (~553) becomes `activePlan.workspaceId === WORKSPACE_ID`; track `workspaceId` on the in-memory `activePlan` instead of `repoId`.

- [ ] **Step 4: Extend the daemon WS test**

In `cc-daemon-ws.test.js`, assert the `session:start` payload contains `workspaceId` (not `repoId`). Run:
`cd lightsprint-claude-code-plugin && bun test scripts/__tests__/cc-daemon-ws.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd lightsprint-claude-code-plugin && git add scripts/cc-daemon.js scripts/__tests__/cc-daemon-ws.test.js
git commit -m "feat(daemon): register sessions + create plans/tasks by workspace"
```

## Task D3: Docs + help sweep

**Files:**
- Modify: `scripts/ls-cli.js` (top help text), `README.md`, `CLAUDE.md`, relevant `skills/*/SKILL.md`

- [ ] **Step 1: Update help + skills for workspace model**

Update the CLI banner/help and every skill `.md` that says "repo board" / "connect a repo" to the workspace model: `connect` connects to a workspace; `tasks`/`projects`/`stacks` are workspace-scoped; document `--stack` and `stacks`/`stacks get`. Remove references to `lightsprint get <repoId>` patterns.

- [ ] **Step 2: Commit**

```bash
cd lightsprint-claude-code-plugin && git add scripts/ls-cli.js README.md CLAUDE.md skills
git commit -m "docs(cli): workspace-scoped CLI usage, stacks, --stack"
```

---

## Final verification

- [ ] Server: `cd app && bun run check && bun run test` → 0 errors, green.
- [ ] Server e2e: `cd app && bun run test:e2e tests/oauth-cli-flow.spec.ts` → PASS.
- [ ] CLI: `cd lightsprint-claude-code-plugin && bun test scripts/__tests__` → green.
- [ ] Manual end-to-end (dev server with `PUBLIC_DEFAULT_STACK_TASKS=true`):
  `lightsprint connect` from a repo → workspace picker → `connection.json` written;
  `lightsprint whoami` shows the workspace; `lightsprint tasks` lists the workspace board;
  `lightsprint stacks` lists stacks; `lightsprint tasks --stack <prefix>` filters;
  `grep -rn "repos.json\|readReposFile\|getRepoId" scripts/` returns nothing.
