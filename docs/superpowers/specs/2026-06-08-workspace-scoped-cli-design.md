# Workspace-Scoped CLI — Design

**Date:** 2026-06-08
**Status:** Approved (brainstorming) — ready for implementation plan
**Repos:** `lightsprint-claude-code-plugin` (CLI/daemon), `lightsprint` (server/app)

## Problem

The `lightsprint` CLI is entirely **repo-scoped**: `connect` authorizes one
GitHub repo, stores a repo-scoped entry in `~/.lightsprint/repos.json` keyed by
`owner/repo`, and most commands hit `/api/repos/{repoId}/...`. Meanwhile the
product has consolidated execution onto **stacks** inside a **workspace**
(tasks now carry `workspaceId NOT NULL` + nullable `repoId` + `stackId`). The
CLI lags behind that model.

We want `lightsprint connect` to connect to a **workspace** (discovered from the
current repo), and all commands to operate at workspace scope. Connecting from
the frontend repo should connect you to the workspace that contains both the
frontend and backend repos.

## Key Findings (constraints this design is built on)

1. **A CLI token (`lsat_`) is already effectively user-scoped, not repo-scoped.**
   In `middleware.ts`, `requireAuth` only applies the agent-authorization
   workspace/repo narrowing for `agent-session` (`lsest_`) tokens (line 186).
   For `lsat_` tokens, `checkRepoAccess`/`checkWorkspaceAccess` fall through to
   pure **workspace-membership** checks. So a user token already authorizes
   every repo in every workspace the user belongs to. The token's `repoId` only
   drives: (a) `/api/repo-key/info` identity, (b) `cc-sessions` list filter +
   ownership check, (c) `/api/repos/[id]/plans` POST default.

2. **A repo can belong to multiple workspaces.** `repoDAO.findAllByFullName` /
   `findAllByGithubRepoId` exist for exactly this. So "resolve the workspace
   from the repo" can be ambiguous.

3. **Most task commands are already workspace-agnostic.** `get`/`update`/
   `claim`/`comment`/`delete`/`link-pr`/`cloud-agents`/`merge` use
   `/api/tasks/{taskId}/...` (globally addressable, membership-gated) and
   `create` already posts `workspaceId`. Only `tasks` (list), `projects`,
   `create-plan`, and `resolve` are genuinely repo-scoped.

4. **`tasks` already migrated to workspace scope** (`workspaceId NOT NULL`,
   `repoId` nullable, `stackId`). **`cc_sessions`, `cc_session_events`, and
   `plans` did NOT** — they still have `repoId NOT NULL` and no `workspaceId`.

5. **The workspace board endpoint is feature-flag-gated** on
   `PUBLIC_DEFAULT_STACK_TASKS`, **which we assume is always `true`** (the
   default-stack consolidation is treated as fully rolled out). The CLI targets
   `/api/workspaces/[id]/board` unconditionally. Workspace page routes
   (`/workspaces/[workspaceId]/tasks|stacks|plans`), `repoDAO.listForWorkspace`,
   the workspace `projects`/`stacks` endpoints, and `/api/user/profile` all
   already exist.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Token scoping | **Keep tokens user-scoped.** No change to `oauth_access_tokens` DB scoping. Stop treating the token's `repoId` as "the current repo." |
| 2 | Workspace context | **Single active workspace**, kubectl/gcloud-style. `connect` switches it. cwd/git remote used only at connect time to discover the workspace. |
| 3 | Workspace disambiguation | When a repo maps to >1 workspace, **pick in the browser** on the `authorize-cli` page; single match auto-selects. |
| 4 | Local records | **Save only the workspace context.** No per-repo records. |
| 5 | Command scope | **All commands workspace-scoped.** The CLI has no repo concept. |
| 6 | Per-repo ops (cc-sessions, plans) | **Make everything workspace-only.** Migrate `cc_sessions`/`cc_session_events`/`plans` to `workspaceId NOT NULL` + nullable `repoId` (tasks-table precedent). |
| 7 | Storage / upgrade | **Hard cutover, not backward-compatible.** Delete `repos.json` and all its read/write code; replace with a workspace-first `~/.lightsprint/connection.json`. No legacy fallback, no auto-migration — commands prompt `lightsprint connect`. |
| 8 | Flag dependency | **`PUBLIC_DEFAULT_STACK_TASKS` is assumed always `true`.** Not a gate or a risk; code targets workspace endpoints unconditionally and assumes they exist. |
| 9 | Stacks | Add `stacks` (list) + `stacks get <id>` discovery commands and a `--stack <stackId>` flag on advanced commands. |

## Architecture

### Local config (`~/.lightsprint/connection.json`)

Single active context:

```json
{
  "workspaceId": "ws_...",
  "workspaceName": "Acme",
  "accessToken": "lsat_...",
  "refreshToken": "lsrt_...",
  "expiresAt": 1700000000000,
  "baseUrl": "https://lightsprint.ai",
  "email": "user@example.com",
  "browserProfile": { "...": "..." }
}
```

- **Replaces `repos.json` entirely — `repos.json` and its helpers are deleted,
  not abandoned.** No code reads or writes `repos.json` after this change.
- A new workspace-first storage module exposes
  `readConnection()` / `writeConnection()` / `clearConnection()` (atomic temp +
  rename, mode `0600`, file-locked writeback) in place of
  `readReposFile` / `writeReposFile`.
- Token refresh writeback (`client.js`, `cc-daemon.js`) and
  `getConfig`/`requireConfig` (`config.js`) read/write this single object.
  `findRepoConfig` (git-remote → repo entry) is removed.
- On upgrade, absence of `connection.json` ⇒ commands print
  "Not connected. Run `lightsprint connect`." No auto-migration, no fallback.

#### `repos.json` removal surface

Every reference below is deleted or rewritten against `connection.json`:

- `lib/config.js` — `REPOS_FILE`, `readReposFile`, `writeReposFile`,
  `findRepoConfig`; `getConfig`/`requireConfig` rewritten to the connection
  object. Add `readConnection`/`writeConnection`/`clearConnection`.
- `lib/auth.js` — stops keying by `repoFullName`; writes the single connection
  object (workspace context) on successful auth.
- `lib/client.js` — token-refresh writeback targets `connection.json`
  (`connection.json.lock`).
- `cc-daemon.js` — same writeback; drops the `repos.json` token-persist path.
- `ls-cli.js` — `disconnect` clears `connection.json`; remove the
  `readReposFile`/`writeReposFile` imports.

### `connect` flow

1. CLI reads cwd git remote (`owner/repo`) purely to seed discovery.
2. Browser opens `authorize-cli?...&repo=<fullName>`.
3. Server resolves candidate workspaces for that repo + user. If exactly one,
   auto-select; if more, render a **workspace picker**.
4. `issueTokens` issues the usual user token (unchanged). Callback returns
   `access_token`, `refresh_token`, `expires_in`, `email`, **`workspace_id`**,
   **`workspace_name`**.
5. CLI writes `connection.json`.

### Command surface (CLI)

| Command | Before | After |
|---------|--------|-------|
| `tasks` (list) | `/api/repos/{repoId}/tasks` | `/api/workspaces/{wsId}/board` (kanban/list) |
| `projects` | `/api/repos/{repoId}/projects` | `/api/workspaces/{wsId}/projects` |
| `resolve` | `/api/repos/{repoId}/tasks/resolve` | new `/api/workspaces/{wsId}/tasks/resolve` |
| `create-plan` | `/api/repos/{repoId}/plans` | workspace/stack-scoped plan create |
| `whoami` / `status` | `/api/repo-key/info` | `/api/workspaces/{wsId}` + `/api/user/profile` |
| `open` | `/repos/{repoId}` | `/workspaces/{wsId}/tasks` |
| `get`/`update`/`claim`/`comment`/`delete`/`link-pr`/`cloud-agents`/`merge` | `/api/tasks/{id}/...` | unchanged (already membership-gated) |
| `create` | `POST /api/tasks` (+`workspaceId`) | unchanged + optional `stackId` |
| `stacks` | — | new: `GET /api/workspaces/{wsId}/stacks` |
| `stacks get <id>` | — | new: `GET /api/workspaces/{wsId}/stacks/{id}` |

- `getWorkspaceId()` reads `connection.json`. `getRepoId()` removed.
- `disconnect` deletes `connection.json`.

### Stacks

- `lightsprint stacks` → list stacks (name, `taskPrefix`, member repo IDs).
- `lightsprint stacks get <stackId>` → stack + resolved member repos.
- `--stack <stackId>` on `tasks`, `create`, `create-plan`:
  - `tasks`: filter the workspace board to one stack (**requires** adding a
    `stack`/`stackId` param to `task-board-query.ts` + the board endpoint; the
    DB filter is trivial since `tasks.stackId` exists).
  - `create` / `create-plan`: set `stackId` on the created entity.
  - Value accepts a stackId, and also matches a stack `name`/`taskPrefix`
    client-side (resolve via the stacks list) for ergonomics.
- Stateless per command: the saved context stays workspace-only (no default
  stack). Without `--stack`, commands span all stacks in the workspace.

### Server changes

**Migrations (tasks-table precedent: `workspaceId NOT NULL`, nullable `repoId`, backfill):**
- `cc_sessions`, `cc_session_events`: add `workspaceId`, make `repoId` nullable,
  backfill `workspaceId` from `repo.workspaceId`.
- `plans`: add `workspaceId`, make `repoId` nullable, backfill.

**Endpoints / services:**
- `authorize-cli` (`+page.server.ts`, `+page.svelte`, `+server.ts`): candidate
  workspace resolution + picker; return `workspace_id`/`workspace_name` in the
  callback.
- `cc-sessions` routes (`/api/cc-sessions/*`): key list + ownership checks by
  **workspace** instead of `token.repoId`. The CLI passes `workspaceId`
  explicitly; server derives repo from a linked task/stack when present.
- New `GET /api/workspaces/[id]/tasks/resolve?ref=` (task-ref resolution).
- Workspace/stack-scoped plan creation path (plans carry `workspaceId`; repo
  derived from the linked task when present).
- Board endpoint + `task-board-query.ts`: accept a `stack`/`stackId` filter.

**Daemon (`cc-daemon.js`, `cc-start.js`):**
- Create cc-sessions with `workspaceId` from `connection.json`; drop
  `LS_REPO_ID` / `cfg.repoId`. Repo derived server-side from the linked
  task/stack, else null.

### Error handling

- No `connection.json` ⇒ structured "not connected, run `lightsprint connect`".
- `--stack` value that resolves to no stack ⇒ error naming `lightsprint stacks`
  as the discovery command.

## Release sequencing & risks

- **Heaviest blast radius:** the `cc_sessions`/`plans` migrations + daemon
  rewrite touch live session tracking. Follow the tasks-table migration pattern;
  backfill must be non-destructive (add nullable, backfill, then enforce).
- **Breaking for existing users:** everyone re-runs `lightsprint connect` once
  after upgrade (accepted — ~10s browser flow).

`PUBLIC_DEFAULT_STACK_TASKS` is assumed always-on (fully rolled out), so it is
neither a gate nor a risk for this work.

## Out of scope

- OAuth token DB scoping changes (tokens stay user-scoped).
- Auto-migration of legacy `repos.json` connections.
- A backward-compatible repo-scoped CLI fallback path.
- Storing a default stack in the active context.
