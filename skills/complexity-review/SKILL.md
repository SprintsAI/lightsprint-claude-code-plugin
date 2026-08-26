---
name: complexity-review
description: Multi-agent review of the cyclomatic complexity a branch adds, weighed against the lines it changes. First states the problem the change solves, then dispatches a panel of role-specific subagents (architecture, senior engineer, backend/API, frontend, and framework/domain specialists like Svelte or LLM-router engineers) that judge DRYness, flag reinvented libraries, and find changes made at a more complex level than needed. Use when asked to "review the complexity", "is this over-engineered", "check cyclomatic complexity", "is this as DRY as it could be", or "did we reinvent something here".
---

Review how much **complexity** the current branch adds and whether that complexity is
justified by the problem it solves. The output is a ranked table that puts *added
complexity* next to *lines changed* for every finding, so an over-built change that
touches few lines is caught just as readily as a large one.

This skill orchestrates subagents. Do the scoping and the complexity baseline yourself
on the main thread, dispatch the panel with the `Agent`/`Task` tool, then synthesize.
Never skip straight to dispatching — the panel is only useful once it knows the problem
being solved and the complexity numbers.

## Step 0 — Scope the diff

Find what the branch changed against its base. Prefer the merge-base so unrelated commits
already on the base branch are excluded:

```bash
BASE=$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main)
git diff --stat "$BASE"...HEAD
git diff "$BASE"...HEAD
```

If the user named a different base branch, use it. If nothing has been committed yet,
review the working tree instead: `git diff` and `git diff --staged`.

Note the languages and frameworks the diff touches — you will use this to cast the panel
in Step 3.

## Step 1 — State the problem being solved

**Do this before dispatching anyone.** In two or three sentences, write down the actual
problem this change solves and the constraints it operates under. Pull from, in order of
authority:

- the linked Lightsprint task — `lightsprint current-task --output json`, or
  `lightsprint get <taskId> --output json` if you know the id;
- the PR title and body — `gh pr view --json title,body 2>/dev/null`;
- the commit messages on the branch — `git log --oneline "$BASE"...HEAD`;
- the diff itself, as a last resort.

This problem statement is the yardstick. Every complexity finding is judged against it:
complexity is only "too much" relative to what the problem actually required. Pass this
statement verbatim to every subagent.

## Step 2 — Build the complexity baseline

Give the panel numbers, not vibes. For the changed files, capture two things per file:

- **Lines added / removed** — straight from `git diff --numstat "$BASE"...HEAD`.
- **Added decision points** — a cheap cyclomatic-complexity proxy: count the branching
  keywords and operators the diff *adds*. Count added lines (`^+`) only, and match
  `if`, `else if`, `for`, `while`, `case`, `catch`, `&&`, `||`, `?` (ternary), and
  `.filter(`/`.map(`/`.reduce(` style chains where relevant.

```bash
git diff --numstat "$BASE"...HEAD
git diff "$BASE"...HEAD \
  | grep -E '^\+' \
  | grep -oE '\b(if|else if|for|while|case|catch)\b|&&|\|\||\?' \
  | sort | uniq -c | sort -rn
```

If the repo already has a real complexity tool (e.g. `eslint` with `complexity`,
`radon`, `gocyclo`, `lizard`), prefer running it on the changed files and use its numbers
instead of the grep proxy. State which method you used.

Build a per-file table: `file | +lines | -lines | added decision points`. Rank it by
decision points, then by lines. The files at the top are where the panel should look
first, and the ratio of decision points to lines added is the headline signal — a file
that adds many branches in few lines is denser (and riskier) than its line count suggests.

## Step 3 — Cast the panel

Choose reviewers to fit what the diff actually touches — do not dispatch a Svelte
reviewer at a pure-backend diff. **Always** include the first two; add the rest when the
diff warrants:

| Reviewer | Include when | Lens |
|---|---|---|
| **Architect** | always | Does this belong at this layer? Is a new abstraction/boundary/pattern earning its keep, or could an existing seam absorb it? |
| **Senior engineer** | always | Readability, DRYness, YAGNI, the simplest thing that could work. The "would this pass my review" voice. |
| **Backend / API engineer** | server, API routes, DB, jobs touched | Endpoint/query/data-model complexity; is bespoke logic reimplementing the framework or ORM? |
| **Frontend engineer** | UI/components/styles touched | Component and state complexity; prop drilling, re-render traps, hand-rolled UI where a primitive exists. |
| **Framework specialist** (e.g. **Svelte engineer**) | that framework is in the diff | Idiomatic use of the framework — runes/stores/effects, lifecycle, reactivity done the framework's way instead of by hand. |
| **Domain specialist** (e.g. **LLM-router engineer**) | that subsystem is in the diff | Whether domain-specific machinery (routing, retries, streaming, auth) reinvents what the platform already provides. |

Pick 3–6 total. Name the specialists after the real frameworks/subsystems you saw in
Step 0 — the Svelte and LLM-router rows are examples, not a fixed list.

## Step 4 — Dispatch the panel in parallel

Send every reviewer in **one** message (multiple `Agent`/`Task` tool calls in a single
turn) so they run concurrently. Give each the same packet:

1. The **problem statement** from Step 1.
2. The **complexity baseline** table from Step 2.
3. The **diff** (or the paths and how to regenerate it for large diffs).
4. Their **role and lens** from the table.

Prompt each reviewer to answer, for the areas in their lane:

- **Is this as DRY as it can be?** Point to duplication, or logic that an existing
  helper, library, or framework feature already covers.
- **Was anything reinvented?** Call out hand-rolled implementations of things the
  language, a dependency, or the framework already provides (date math, deep-clone,
  debounce, state machines, retry/backoff, validation, routing…).
- **Could this have been done at a simpler level?** For each hotspot, describe the
  simpler alternative and where it would live.
- **Is the added complexity worth it?** Weigh the decision points and lines added against
  what the problem in Step 1 actually required.

Require each finding back in a fixed shape so Step 5 can merge them:

```
file:line — <one-line problem>
  added complexity: <decision points / new abstractions involved>
  lines added: <n>
  simpler alternative: <what to do instead, and where>
  verdict: justified | over-engineered | reinvented-wheel | needs-discussion
```

Tell reviewers to be specific and to skip findings they cannot tie to a line — a plausible
guess with no anchor is noise.

## Step 5 — Synthesize and rank

Merge the panel's findings, dropping duplicates (keep the best-argued version). Rank by
**complexity-vs-value**: a finding that adds many decision points or a whole new
abstraction for little benefit ranks above a large-but-necessary change. Produce:

```markdown
## Complexity review — <branch>

**Problem being solved:** <the Step 1 statement>

**Baseline:** +<X> lines across <N> files, ~<D> added decision points.
Densest files: <file (dp/lines)>, ...

| # | Finding | Added complexity | Lines added | Simpler alternative | Verdict |
|---|---------|------------------|-------------|---------------------|---------|
| 1 | ...     | ...              | ...         | ...                 | over-engineered |

**Bottom line:** <is the complexity added proportional to the problem? the 1–3 changes
that would most reduce complexity for the least churn.>
```

Lead with the verdicts that matter: `reinvented-wheel` and `over-engineered` first,
`justified` collapsed into a single reassuring line. The reviewer should be able to read
the top three rows and know what to simplify.

## Step 6 — Post to the PR (when one exists)

If the branch has an open PR, offer to post the table as a comment:

```bash
gh pr view --json number,url 2>/dev/null
gh pr comment <number> --body-file <file>
```

Do not post to a PR that has no relation to the current branch, and do not create a PR
just to comment on it.

## Invariants

- **Problem first, panel second.** A complexity finding is meaningless without the
  problem it is measured against. Never dispatch before Step 1 is written.
- **Numbers before opinions.** The Step 2 baseline is what keeps "this feels complex" honest.
- **Complexity is weighed against lines, not counted in isolation.** A 20-line change that
  adds a new abstraction can be a worse finding than a 200-line change that adds none.
- **Cast to the diff.** Only dispatch specialists for frameworks/subsystems actually present.
- **One parallel wave.** Dispatch all reviewers in a single turn; do not serialize them.
- This skill only reviews and reports — it does not edit code. Hand the simplifications back
  to the user (or a follow-up task) to apply.
