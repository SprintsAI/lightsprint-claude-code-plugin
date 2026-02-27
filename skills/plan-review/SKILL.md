---
name: plan-review
description: Generate a visual HTML plan review — current codebase state vs. proposed implementation plan. Produces a self-contained HTML page with Mermaid diagrams, impact dashboards, risk assessments, and change-by-change breakdowns. Use when reviewing an implementation plan before approving it.
---

# Plan Review

Generate a comprehensive visual plan review as a self-contained HTML page, comparing the current codebase against a proposed implementation plan.

Follow the visual generation workflow below. Read the reference template, CSS patterns, and Mermaid theming references before generating. Use a blueprint/editorial aesthetic with current-state vs. planned-state panels, but vary fonts and palette from previous diagrams.

---

## Visual Generation Workflow

### 1. Think (5 seconds, not 5 minutes)

Before writing HTML, commit to a direction. Don't default to "dark theme with blue accents" every time.

**Who is looking?** A developer understanding a system? A PM seeing the big picture? A team reviewing a proposal? This shapes information density and visual complexity.

**What aesthetic?** Pick one and commit:
- Monochrome terminal (green/amber on black, monospace everything)
- Editorial (serif headlines, generous whitespace, muted palette)
- Blueprint (technical drawing feel, grid lines, precise)
- Neon dashboard (saturated accents on deep dark, glowing edges)
- Paper/ink (warm cream background, sketchy borders, informal feel)
- IDE-inspired (borrow a real color scheme: Dracula, Nord, Catppuccin, Solarized, Gruvbox, One Dark)
- Data-dense (small type, tight spacing, maximum information)
- Gradient mesh (bold gradients, glassmorphism, modern SaaS feel)

Vary the choice each time. If the last diagram was dark and technical, make the next one light and editorial. The swap test: if you replaced your styling with a generic dark theme and nobody would notice the difference, you haven't designed anything.

### 2. Structure

**Read the reference template** before generating. Don't memorize it — read it each time to absorb the patterns.
- For text-heavy architecture overviews (card content matters more than topology): read `./templates/architecture.html`
- For flowcharts, sequence diagrams, ER, state machines, mind maps: read `./templates/mermaid-flowchart.html`
- For data tables, comparisons, audits, feature matrices: read `./templates/data-table.html`

**For CSS/layout patterns and SVG connectors**, read `./references/css-patterns.md`.

**For pages with 4+ sections** (reviews, recaps, dashboards), also read `./references/responsive-nav.md` for section navigation with sticky sidebar TOC on desktop and horizontal scrollable bar on mobile.

**Choosing a rendering approach:**

| Diagram type | Approach | Why |
|---|---|---|
| Architecture (text-heavy) | CSS Grid cards + flow arrows | Rich card content (descriptions, code, tool lists) needs CSS control |
| Architecture (topology-focused) | **Mermaid** | Visible connections between components need automatic edge routing |
| Flowchart / pipeline | **Mermaid** | Automatic node positioning and edge routing |
| Sequence diagram | **Mermaid** | Lifelines, messages, and activation boxes need automatic layout |
| Data flow | **Mermaid** with edge labels | Connections and data descriptions need automatic edge routing |
| ER / schema diagram | **Mermaid** | Relationship lines between many entities need auto-routing |
| State machine | **Mermaid** | State transitions with labeled edges need automatic layout |
| Mind map | **Mermaid** | Hierarchical branching needs automatic positioning |
| Data table | HTML `<table>` | Semantic markup, accessibility, copy-paste behavior |
| Timeline | CSS (central line + cards) | Simple linear layout doesn't need a layout engine |
| Dashboard | CSS Grid + Chart.js | Card grid with embedded charts |

**Mermaid theming:** Always use `theme: 'base'` with custom `themeVariables` so colors match your page palette. Use `layout: 'elk'` for complex graphs (requires the `@mermaid-js/layout-elk` package — see `./references/libraries.md` for the CDN import). Override Mermaid's SVG classes with CSS for pixel-perfect control. See `./references/libraries.md` for full theming guide.

**Mermaid zoom controls:** Always add zoom controls (+/−/reset buttons) to every `.mermaid-wrap` container. Complex diagrams render at small sizes and need zoom to be readable. Include Ctrl/Cmd+scroll zoom on the container. See the zoom controls pattern in `./references/css-patterns.md` and the reference template at `./templates/mermaid-flowchart.html`.

**Mermaid CSS class collision constraint:** Never define `.node` as a page-level CSS class. Mermaid.js uses `.node` internally on SVG `<g>` elements with `transform: translate(x, y)` for positioning. Page-level `.node` styles (hover transforms, box-shadows) leak into diagrams and break layout. Use the namespaced `.ve-card` class for card components instead.

### 3. Style

Apply these principles to every diagram:

**Typography is the diagram.** Pick a distinctive font pairing from Google Fonts. A display/heading font with character, plus a mono font for technical labels. Never use Inter, Roboto, Arial, or system-ui as the primary font. Load via `<link>` in `<head>`. Include a system font fallback in the `font-family` stack for offline resilience.

**Color tells a story.** Use CSS custom properties for the full palette. Define at minimum: `--bg`, `--surface`, `--border`, `--text`, `--text-dim`, and 3-5 accent colors. Each accent should have a full and a dim variant (for backgrounds). Name variables semantically when possible (`--pipeline-step` not `--blue-3`). Support both themes. Put your primary aesthetic in `:root` and the alternate in the media query:

```css
/* Light-first (editorial, paper/ink, blueprint): */
:root { /* light values */ }
@media (prefers-color-scheme: dark) { :root { /* dark values */ } }

/* Dark-first (neon, IDE-inspired, terminal): */
:root { /* dark values */ }
@media (prefers-color-scheme: light) { :root { /* light values */ } }
```

**Surfaces whisper, they don't shout.** Build depth through subtle lightness shifts (2-4% between levels), not dramatic color changes. Borders should be low-opacity rgba (`rgba(255,255,255,0.08)` in dark mode, `rgba(0,0,0,0.08)` in light) — visible when you look, invisible when you don't.

**Backgrounds create atmosphere.** Don't use flat solid colors for the page background. Subtle gradients, faint grid patterns via CSS, or gentle radial glows behind focal areas. The background should feel like a space, not a void.

**Visual weight signals importance.** Not every section deserves equal visual treatment. Executive summaries and key metrics should dominate the viewport on load (larger type, more padding, subtle accent-tinted background zone). Reference sections (file maps, dependency lists, decision logs) should be compact and stay out of the way. Use `<details>/<summary>` for sections that are useful but not primary — the collapsible pattern is in `./references/css-patterns.md`.

**Surface depth creates hierarchy.** Vary card depth to signal what matters. Hero sections get elevated shadows and accent-tinted backgrounds (`ve-card--hero` pattern). Body content stays flat (default `.ve-card`). Code blocks and secondary content feel recessed (`ve-card--recessed`). See the depth tiers in `./references/css-patterns.md`. Don't make everything elevated — when everything pops, nothing does.

**Animation earns its place.** Staggered fade-ins on page load are almost always worth it — they guide the eye through the diagram's hierarchy. Mix animation types by role: `fadeUp` for cards, `fadeScale` for KPIs and badges, `drawIn` for SVG connectors, `countUp` for hero numbers. Hover transitions on interactive-feeling elements make the diagram feel alive. Always respect `prefers-reduced-motion`. CSS transitions and keyframes handle most cases. For orchestrated multi-element sequences, anime.js via CDN is available (see `./references/libraries.md`).

### 4. Deliver

**Output location:** Write to `~/.agent/diagrams/`. Use a descriptive filename based on content: `plan-review-auth-system.html`, `plan-review-api-redesign.html`. The directory persists across sessions.

**Open in browser:**
- macOS: `open ~/.agent/diagrams/filename.html`
- Linux: `xdg-open ~/.agent/diagrams/filename.html`

**Tell the user** the file path so they can re-open or share it.

---

## Plan Review Process

**Inputs:**
- Plan file: `$1` (path to a markdown plan, spec, or RFC document)
- Codebase: `$2` if provided, otherwise the current working directory

### Data Gathering Phase

Read and cross-reference these before generating:

1. **Read the plan file in full.** Extract:
   - The problem statement and motivation
   - Each proposed change (files to modify, new files, deletions)
   - Rejected alternatives and their reasoning
   - Any explicit scope boundaries or non-goals

2. **Read every file the plan references.** For each file mentioned in the plan, read the current version in full. Also read files that import or depend on those files — the plan may not mention all ripple effects.

3. **Map the blast radius.** From the codebase, identify:
   - What imports/requires the files being changed (grep for import paths)
   - What tests exist for the affected files (look for corresponding `.test.*` / `.spec.*` files)
   - Config files, types, or schemas that might need updates
   - Public API surface that callers depend on

4. **Cross-reference plan vs. code.** For each change the plan proposes, verify:
   - Does the file/function/type the plan references actually exist in the current code?
   - Does the plan's description of current behavior match what the code actually does?
   - Are there implicit assumptions about code structure that don't hold?

### Verification Checkpoint

Before generating HTML, produce a structured fact sheet of every claim you will present in the review:
- Every quantitative figure: file counts, estimated lines, function counts, test counts
- Every function, type, and module name you will reference from both the plan and the codebase
- Every behavior description: what the code currently does vs. what the plan proposes
- For each, cite the source: the plan section or the file:line where you read it

Verify each claim against the code and the plan. If something cannot be verified, mark it as uncertain rather than stating it as fact. This fact sheet is your source of truth during HTML generation — do not deviate from it.

### Diagram Structure

The page should include:

1. **Plan summary** — lead with the *intuition*: what problem does this plan solve, and what's the core insight behind the approach? Then the scope: how many files touched, estimated scale of changes, new modules or tests planned. A reader who only sees this section should understand the plan's essence. *Visual treatment: this is the visual anchor — use hero depth (larger type 20-24px, subtle accent-tinted background, more padding than other sections).*

2. **Impact dashboard** — files to modify, files to create, files to delete, estimated lines added/removed, new test files planned, dependencies affected. Include a **completeness** indicator: whether the plan covers tests (green/red), docs updates (green/yellow/red), and migration/rollback (green/grey for N/A).

3. **Current architecture** — Mermaid diagram of how the affected subsystem works *today*. Focus only on the parts the plan touches — don't diagram the entire codebase. Show the data flow, dependencies, and call paths that will change. Wrap in `.mermaid-wrap` with zoom controls (+/−/reset buttons), Ctrl/Cmd+scroll zoom, and click-and-drag panning (grab/grabbing cursors). See css-patterns.md "Mermaid Zoom Controls" for the full pattern. *Visual treatment: use matching Mermaid layout direction and node names as section 4 so the visual diff is obvious.*

4. **Planned architecture** — Mermaid diagram of how the subsystem will work *after* the plan is implemented. Use the same node names and layout direction as the current architecture diagram so the differences are visually obvious. Same zoom controls as section 3. *Highlight new nodes with a glow or accent border, removed nodes with strikethrough or reduced opacity, changed edges with a different stroke color.*

5. **Change-by-change breakdown** — for each change in the plan, a side-by-side panel. Overflow prevention: apply `min-width: 0` on all grid/flex children and `overflow-wrap: break-word` on panels. Never use `display: flex` on `<li>` for marker characters — use absolute positioning instead (see css-patterns.md Overflow Protection).
   - **Left (current):** what the code does now, with relevant snippets or function signatures
   - **Right (planned):** what the plan proposes, with the plan's own code examples if provided
   - **Rationale:** below each side-by-side panel, extract _why_ the plan chose this approach. Pull from the plan's reasoning, rejected alternatives section, or inline justifications. If the plan includes a "rejected alternatives" section, map those rejections to the specific changes they apply to. Flag changes where the plan says _what_ to do but not _why_ — these are pre-implementation cognitive debt.
   - Flag any discrepancies where the plan's description of current behavior doesn't match the actual code

6. **Dependency & ripple analysis** — *visual treatment: compact — consider `<details>` collapsed by default for pages with many sections.* What other code depends on the files being changed. Table or Mermaid graph showing callers, importers, and downstream effects the plan may not explicitly address. Color-code: covered by plan (green), not mentioned but likely affected (amber), definitely missed (red).

7. **Risk assessment** — styled cards for:
   - **Edge cases** the plan doesn't address
   - **Assumptions** the plan makes about the codebase that should be verified
   - **Ordering risks** if changes need to be applied in a specific sequence
   - **Rollback complexity** if things go wrong
   - **Cognitive complexity** — areas where the plan introduces non-obvious coupling, action-at-a-distance behavior, implicit ordering requirements, or contracts that exist only in the developer's memory. Distinct from bug risk — these are "you'll forget how this works in a month" risks. Each cognitive complexity flag gets a brief mitigation suggestion (e.g., "add a comment explaining the ordering requirement" or "consider a runtime assertion that validates the invariant"). Note: cognitive complexity flags belong here when they're about specific code patterns; broader concerns about the plan's overall approach (overengineering, lock-in, maintenance burden) belong in section 8's Ugly category.
   - Each risk gets a severity indicator (low/medium/high)

8. **Plan review** — structured Good/Bad/Ugly analysis of the plan itself:
   - **Good**: Solid design decisions, things the plan gets right, well-reasoned tradeoffs
   - **Bad**: Gaps in the plan — missing files, unaddressed edge cases, incorrect assumptions about current code
   - **Ugly**: Subtle concerns — complexity being introduced, maintenance burden, things that will work initially but cause problems at scale
   - **Questions**: Ambiguities that need the plan author's clarification before implementation begins
   - Use styled cards with green/red/amber/blue left-border accents. Each item should reference specific plan sections and code files. If nothing to flag in a category, say "None found" rather than omitting the section.

9. **Understanding gaps** — a closing dashboard that rolls up decision-rationale gaps from section 5 and cognitive complexity flags from section 7:
   - Count of changes with clear rationale vs. missing rationale (visual bar chart or progress indicator)
   - List of cognitive complexity flags with severity
   - Explicit recommendations: "Before implementing, document the rationale for changes X and Y — the plan doesn't explain why these approaches were chosen over alternatives"
   - This section makes cognitive debt visible _before_ the work starts, when it's cheapest to address.

### Visual Hierarchy

Sections 1-4 should dominate the viewport on load (hero depth for summary, elevated for architecture diagrams). Sections 6+ are reference material and should feel lighter (flat or recessed depth, compact layout, collapsible where appropriate).

Include responsive section navigation. Use a current-vs-planned visual language throughout: blue/neutral for current state, green/purple for planned additions, amber for areas of concern, red for gaps or risks.

---

## File Structure

Every diagram is a single self-contained `.html` file. No external assets except CDN links (fonts, optional libraries). Structure:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Descriptive Title</title>
  <link href="https://fonts.googleapis.com/css2?family=...&display=swap" rel="stylesheet">
  <style>
    /* CSS custom properties, theme, layout, components — all inline */
  </style>
</head>
<body>
  <!-- Semantic HTML: sections, headings, lists, tables, inline SVG -->
  <!-- No script needed for static CSS-only diagrams -->
  <!-- Optional: <script> for Mermaid, Chart.js, or anime.js when used -->
</body>
</html>
```

## Quality Checks

Before delivering, verify:
- **The squint test**: Blur your eyes. Can you still perceive hierarchy? Are sections visually distinct?
- **The swap test**: Would replacing your fonts and colors with a generic dark theme make this indistinguishable from a template? If yes, push the aesthetic further.
- **Both themes**: Toggle your OS between light and dark mode. Both should look intentional, not broken.
- **Information completeness**: Does the diagram actually convey what the user asked for? Pretty but incomplete is a failure.
- **No overflow**: Resize the browser to different widths. No content should clip or escape its container. Every grid and flex child needs `min-width: 0`. Side-by-side panels need `overflow-wrap: break-word`. Never use `display: flex` on `<li>` for marker characters — it creates anonymous flex items that can't shrink, causing lines with many inline `<code>` badges to overflow. Use absolute positioning for markers instead. See the Overflow Protection section in `./references/css-patterns.md`.
- **Mermaid zoom controls**: Every `.mermaid-wrap` container must have zoom controls (+/−/reset buttons), Ctrl/Cmd+scroll zoom, and click-and-drag panning. Complex diagrams render too small without them. The cursor should change to `grab` when zoomed in and `grabbing` while dragging. See `./references/css-patterns.md` for the full pattern.
- **File opens cleanly**: No console errors, no broken font loads, no layout shifts.

Ultrathink.

$@
