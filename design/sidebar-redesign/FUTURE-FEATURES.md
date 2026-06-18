# Future-Proof Sidebar Features — catalog & placement

Derived from the 125-site research (`RESEARCH-NOTES.md`) and Switchboard's use case (a local, multi-agent
coding-session manager). Each item: **what · why (evidence) · tier · disclosure**. Tiers follow
`UX-RESEARCH.md` (1 = always visible, 2 = one click, 3 = on demand). Demonstrated in `mockups/v7-future-proof.html`.

## A. Attention & status (the "what needs me" layer)

1. **"Needs you" triage meta-view** — aggregates sessions that **errored / hit rate-limit / await input** across all agents, with a red count badge.
   *Why:* PatternFly (red = immediate attention; badge only when actionable & infrequent), presence research (busy/needs-input), "doomscrolling gap" (Vibe Kanban). *Tier 1\* (conditional — show when N>0). Disclosure: red badge + dedicated view.*
2. **Status vocabulary** on every card — running(green) · thinking/busy(blue pulse) · needs-input(amber) · errored(red) · idle(grey).
   *Why:* presence research (online/busy/away/offline), Carbon status-indicator. *Tier 1 (the dot already exists; standardize colors).*
3. **Live activity sparkline** per session + per-agent header (tool-event trend).
   *Why:* Tufte word-sized graphics; Switchboard already emits hook/file-watch events. *Tier 1 inline (tiny); Tier 2 expanded.*

## B. Retrieval (the "find the right session" layer)

4. **Content/semantic search** across session transcripts — not just titles.
   *Why:* **biggest gap in ChatGPT/Claude/Gemini sidebars — none index message content**; Switchboard scans JSONL so this is a real differentiator. *Tier 1 entry (search) → Tier 2 scope toggle (titles | content).*
5. **Cross-agent unified search & "resume where I left off."**
   *Why:* "forgotten conversation problem"; Claude paid memory/search. *Tier 1 (palette) / Tier 2.*
6. **Tags + saved views** — user tags on sessions; saved filter combos ("errored today", "#refactor", "this-sprint") become custom meta-views.
   *Why:* favorites≠tags (ui-patterns); tags enable cross-workspace discovery (Fabric); saved views (nested tabs). *Tier 2 (saved views in meta menu); Tier 3 (apply/edit tags via right-click).*

## C. Code-aware (Switchboard's unfair advantage)

7. **Git cluster per session/project** — branch · ahead/behind · dirty · **Review diff** · **Open PR**.
   *Why:* Conductor (worktree + diff + PR), JetBrains worktree UI (dirty/ahead/behind), difit (review before push). *Tier 1 compact badge; Tier 2 diff view; Tier 3 PR action.*
8. **Per-session worktree awareness** (isolated branch per agent run).
   *Why:* dominant multi-agent pattern (augmentcode, Conductor). *Tier 2 (shown on card detail).*

## D. Cost & budget (the "what's this costing" layer)

9. **Token + cost on cards**, **burn-rate** per agent, **budget threshold alert**.
   *Why:* LLM dashboards (KPIs: cost, in/out tokens, calls, cost-over-time, alerts at $X/24h). Switchboard already has `tokens.js` + `session_tokens`. *Tier 1 tiny cost chip (optional via density); Tier 2 breakdown; Tier 3 set budget.*

## E. Organization & lifecycle (top user requests)

10. **Rename · Archive · Pin from the sidebar** (right-click), plus an **Archived** filter.
    *Why:* explicit claude-code feature requests (#59016 rename/folders, #63586 archive). *Tier 3 right-click; Archived = Tier 2 filter.*
11. **Project folders / nesting** (already auto-grouped by project — keep as headline; allow custom groups).
    *Why:* #1 requested org feature; Atlassian composable nested nav. *Tier 1 grouping; Tier 2 custom groups.*
12. **Plans / todos per project** + **memory/recall** mode.
    *Why:* user noted plans aren't visible; Claude memory feature. *Tier 2 mode tab.*

## F. Automation & scheduling (Switchboard has a scheduler)

13. **Scheduled-sessions view** — next-run · last-run · **live log**; create via **cron / visual builder / prompt** (3 ways); always **show next execution time**.
    *Why:* Windmill (3 input modes), cron builders (preview next runs), Cronicle (visual multi-selector + live log). *Tier 2 mode; Tier 3 editor.*
14. **Kanban / board triage mode** for parallel agents.
    *Why:* Vibe Kanban / Operator (cards → in-progress → review diff in board). *Tier 2 alternate layout.*

## G. CLI fleet management

15. **CLI health row** — installed · version · update-available · on-PATH vs history-only.
    *Why:* Switchboard `detect-agents` already distinguishes installed/onPath/hasHistory. *Tier 2 (in agent dropdown rows) / Tier 3 (settings).*
16. **MCP / model quick-switch** per session (model badge → switch).
    *Why:* multi-model attribution (cost tracking); Zed model integration. *Tier 3 (card menu).*

## H. Layout & ergonomics

17. **Density toggle** (comfortable default / compact opt-in).
    *Why:* Cloudscape (comfortable default, compact for data-intensive, never forced), Material density modes — **settles U4**. *Tier 3 setting + quick toggle.*
18. **Saved layouts** + per-pane **dock/pin/undock** + **split** + **collapse-to-rail**; persist sizes.
    *Why:* IntelliJ (saved/switchable layouts, view modes, widescreen split), split-pane libs (min/max, nestable, collapsible). *Tier 2 layout switch; Tier 3 manage.*
19. **Command palette (⌘K)** scoped to agents · sessions · actions, with footer keyboard legend.
    *Why:* command-palette research ("CLI efficiency + GUI discoverability"; ideal at high feature count). *Tier 1 entry (⌘K), invisible until summoned.*
20. **Per-pane empty states** — explain why empty + primary action + learning cue.
    *Why:* NN/g 3 rules (status, learning cue, direct pathway). *Tier 1 (in-pane).*

---

## Placement summary (what this adds to the spine vs defers)

- **Added to Tier 1 (only conditionally / tiny):** "Needs you" badge (when N>0), standardized status dots, inline sparkline, ⌘K entry, content-search entry, per-pane empty states. Spine still ≤7 *active* marks.
- **New Tier 2:** content/title search scope, saved views, diff view, scheduled & board modes, plans/memory modes, CLI health in dropdown, layout switch, density quick-toggle.
- **New Tier 3:** rename/archive/pin/tag (right-click), set budget, model switch, manage layouts, settings.

**Guard rail kept throughout:** every added control still obeys *defer the control, never the state* (e.g. an active tag filter shows a chip; a hidden errored session still raises the "Needs you" badge). Nothing here expands the always-loud set beyond the single active agent.
