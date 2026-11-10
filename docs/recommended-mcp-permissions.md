# Recommended read-only MCP permissions

The Claude Code harness auto-denies any tool not present in the `allow` array
of its settings file. In hosted environments (e.g. the Lightsprint sandbox)
there is no interactive "Allow" prompt, so a Pipedream MCP integration that is
connected at the account level still appears broken from the agent's side —
every call returns `User refused permission to run tool`.

This document records the **read-only** allow-list entries for Stripe,
PostHog, and Figma that we recommend pre-approving so an operator can query
financial, product-analytics, and design-comment state without granting any
write or destructive operations.

## Where to put these entries

Two settings files are honored by Claude Code; pick whichever fits your
deployment model:

| File | Scope | Committed? | Use when |
|---|---|---|---|
| `~/.claude/settings.json` | User-global, every project | No | You want the permissions to apply across **every** Claude Code session for this user (recommended for the hosted Lightsprint sandbox, since the sandbox is provisioned per user). |
| `<repo>/.claude/settings.local.json` | Repo-local, your machine only | No (gitignored) | You want the permissions scoped to a single working copy. |

**Recommendation for the Lightsprint hosted sandbox: user-global
`~/.claude/settings.json`.** The sandbox is the user's environment, the user
should opt in once, and the entries should follow them across stacks rather
than being copied into every repo's `.claude/settings.local.json`.

For ad-hoc local use on a developer laptop, repo-local
`.claude/settings.local.json` is fine — it stays gitignored and out of the
shared history.

## Applying the recommendation

The drop-in JSON next to this file (`recommended-settings.local.json`) is
ready to be merged into either settings file. To apply:

1. Open the target settings file (`~/.claude/settings.json` or
   `<repo>/.claude/settings.local.json`). Create it if it doesn't exist.
2. Merge the entries under `permissions.allow` from
   `recommended-settings.local.json` into your existing `permissions.allow`
   array. Keep your existing `Bash(...)` and other entries.
3. Restart the Claude Code session (or start a new one) so the harness
   re-reads the file.
4. Verify by running a read call, e.g. invoke
   `mcp__pipedream-stripe__stripe-retrieve-balance` and confirm it returns
   the current balance rather than `User refused permission to run tool`.

## What's included — and why

The list is deliberately narrow to **read** surfaces only. The full list of
tool slugs lives in `recommended-settings.local.json`; the table below is the
rationale.

### Stripe (`mcp__pipedream-stripe__*`)

| Category | Included | Reason |
|---|---|---|
| `stripe-retrieve-*` | balance, checkout-session, checkout-session-line-items, customer, invoice, invoice-item, payment-intent, payout, price, product, refund | All are pure GET-by-id reads. |
| `stripe-list-*` | balance-history, customers, invoices, payment-intents, payouts, refunds | Index reads with filtering — no mutation. |
| `stripe-search-*` | customers, subscriptions | Stripe search query language; read-only. |
| `retrieve_options` | yes | Helper that resolves IDs/labels — required for several read tools to look up dropdown options. |

**Deliberately excluded** — any `create-*`, `update-*`, `delete-*`,
`cancel-*`, `capture-*`, `confirm-*`, `finalize-*`, `send-*`, `void-*`,
`write-off-*`, `cancel-or-reverse-payout`. These mutate financial state or
move money and must not be auto-approved.

### PostHog (`mcp__pipedream-posthog__*`)

| Category | Included | Reason |
|---|---|---|
| `posthog-get-*` | cohorts, persons, project-insight, surveys | Pure reads. |
| `posthog-list-*` | organization-id-options, project-insights | Index reads. |
| `posthog-create-query` | yes | Despite the verb, this runs HogQL **SELECT** queries — it is the read API for the warehouse. No insert/update/delete is possible through this tool. |
| `retrieve_options` | yes | Same helper pattern as Stripe. |

**Deliberately excluded** — `posthog-capture-event` (writes events into
PostHog), `posthog-create-project-insight`, `posthog-update-project-insight`.
These persist new state.

### Figma (`mcp__pipedream-figma__*`)

| Category | Included | Reason |
|---|---|---|
| `figma-list-comments` | yes | Read-only listing of file comments. |
| `retrieve_options` | yes | Same helper pattern. |

**Deliberately excluded** — `figma-post-a-comment`, `figma-delete-comment`.
These mutate the file's comment thread.

## Maintaining this list

When Pipedream adds new Stripe / PostHog / Figma tools, audit them against
the same rule: read = include, write = exclude. The tool slug exposed by
Pipedream MCP follows the
`mcp__pipedream-<app>__<app>-<verb>-<subject>` pattern, so the verb is a
quick proxy — but always sanity-check by reading the tool's description,
since some tools (notably `posthog-create-query`) are misleadingly named.
