# Deliberative Evaluation — Switchboard Sidebar Visibility Model

**Method:** Deliberative Refinement · Expert Council · V(7,3,1) · grounded with web evidence
**Question:** Which sidebar elements must be *always visible* vs. *progressively disclosed* (dropdown / radio / right-click / settings)?
**Date:** 2026-06-09

---

## Evidence base (grounding probes)

| Source | Finding used |
|---|---|
| NN/g — Progressive Disclosure (Nielsen, 1995; study 2006) | Show frequent items up front; defer advanced. Deferring advanced features gave **30–50% faster** initial task completion while keeping discoverability. |
| GitLab Pajamas | Three tiers: **essential** (primary view) / **common** (one click) / **advanced** ("more" menu). |
| VS Code UX Guidelines | Containers + items; **3–5 views** comfortable max; "too much contributed UI… confuses users." Activity bar = persistent primary nav; supports compact density. |
| Hick's Law / Miller's Law | Keep primary choices **≤ 7**; show primary action, push secondary to overflow. |
| Figma tool system | Two-tier: ~8 categories + nested variants — turns one 30-option decision into two 6–8 option decisions. |

> Reconciliation check: all five sources agree on the same core rule — **a small, stable primary set; everything else one predictable step away.** No source contradicts another; the only tension is *where the line falls*, which is exactly our decision.

---

## Council & lenses

1. **IA Architect** — structure, containers vs items (VS Code model)
2. **Cognitive-Load Scientist** — Hick/Miller, progressive disclosure
3. **Power-User / Keyboard Advocate** — density, speed, ultrawide
4. **Visual-Systems Designer** — alignment, hierarchy, brand identity
5. **Discoverability/A11y Critic** — risk of hiding affordances (right-click is invisible)
6. **Dev-Tool Domain Expert** — real multi-CLI session workflows
7. **Advocatus Diaboli** *(injected R2 after near-consensus)* — attack the groupthink

---

## Decomposition — elements to place

Agent identity/switcher · meta-views (Active/Flagged/Pinned) · per-tool icon · session list · running/status indicators · search · time-range & recency filter · sort modes · new-session/actions · plans · multi-sidebar columns · flag-agent · pin-session · per-agent settings · "show uninstalled/stale".

---

## Round 1 — opening positions

**IA Architect.** Map to VS Code's container/item split. The *container* chrome (which agent's history you're viewing + the tabs Sessions/Plans/Files/Stats) is navigation → persistent. The *items* (sessions) are content → fill the body. Everything that re-filters the same content set (sort, time range) is a *modifier* — modifiers don't deserve permanent real estate; they belong in a collapsible filter affordance. **≤5 persistent chrome elements.**

**Cognitive-Load Scientist.** Today the agent row is ~11 buttons, each dot+label, wrapping — that's a Hick's-law violation at the top of the most-used surface. Collapse to **one primary control**. The 30→two-tier rule (Figma) maps cleanly: one agent button → dropdown of agents. Meta-views are a *different axis* (cross-agent) and must not be mixed into the agent list — that's the conflation causing the visual chaos.

**Power-User.** I live here all day. Don't bury what I touch every minute. Switching agent and jumping to Active/Flagged are constant — those must be reachable without opening a menu (a click costs ~0.5–1s × hundreds/day). But sort/time-range I set once a session — happy to hide those. Give me **keyboard** for everything; visible chrome is for discovery, keys are for speed.

**Visual Designer.** The misalignment is from variable-width buttons (dot + full word) in a wrapping flexbox with two competing `.agent-dot` rules. Fix = fixed-size icon tiles on a single baseline grid. Each agent needs a **distinct mark**, not a bare dot — a brand-colored monogram is legitimate and aligns perfectly. Hierarchy: exactly one element should be visually "loud" (the active agent).

**Discoverability Critic.** Caution: right-click and hover are *invisible* affordances — fine for power features, fatal for anything a first-timer needs. Flag/pin can be right-click *if* also reachable visibly somewhere. Never make a *primary* path (switch agent, see history) right-click-only. The recency/"show stale" toggle hiding agents is dangerous: a user whose agent vanished has no visible explanation → must leave a visible "+N hidden" affordance.

**Dev-Tool Domain Expert.** Real workflow: 80% of time in 1–2 agents (Claude + one other), occasional cross-agent triage ("what's running everywhere?", "what did I star?"). So: current-agent + Active + Flagged are the daily spine. Plans and Files are *modes*, used in bursts — tab-level, not always-expanded. Per-agent settings is rare-config → settings panel.

**R1 convergence:** Strong, fast agreement on the *shape* (one primary agent control + small meta cluster + content body; modifiers collapsed). → **echo-chamber risk; inject Advocatus Diaboli for R2.**

---

## Round 2 — adversarial pressure

**Advocatus Diaboli.**
- *"One agent dropdown" punishes the multi-agent power user.* If I watch 3 agents on an ultrawide, a single dropdown forces serial switching. → **Rebuttal accepted in part:** the dropdown is the *default/narrow* mode; ultrawide "columns" mode pins multiple agent panes simultaneously, each with its own header icon. The primary control governs the **focused** pane, not the only pane.
- *Hiding sort/time-range will get "where did my filter go?" complaints.* → **Mitigation:** when a non-default filter is active, leave a always-visible **chip** ("⏱ 7d ✕") so state is never invisible — hidden *control*, visible *state*. (This is the NN/g rule: defer the control, not the feedback.)
- *Monogram icons for 11 tools will collide (two "C": Claude/Codex/Cursor/Cline).* → **Accepted:** disambiguate by color + glyph, not letter alone; reserve the most legible mark for the most-used agent. Flag as **UNCERTAIN — needs visual test.**
- *Meta-views as always-visible icons cost permanent space that empty states waste.* → **Partial:** show Active only when ≥1 session is running; Flagged only when ≥1 flag exists. Conditional persistence, not unconditional.

**Reconvened positions:** council updates from "always show meta-views" → "**show meta-views when non-empty**"; adds "**active-filter chips**" as a new always-visible class (state feedback); affirms columns mode resolves the power-user objection.

---

## Round 3 — convergence & placement

Consensus tiers (Unanimous except where noted):

### Tier 1 — ALWAYS VISIBLE (the persistent spine, ≤7 marks)
- **Active-agent control** — icon + name + caret (governs focused pane). *Unanimous.*
- **Meta-views Active / Flagged** — icon-only, **shown when non-empty**. *Unanimous (conditional).*
- **Search entry** — icon that expands; finding a session is core & frequent. *6/7 (Power-user wanted full field always; conceded to icon-expand to save width).*
- **Session list (body)** — the content; always. *Unanimous.*
- **Per-pane agent identity** in columns mode (icon+name on each pane header). *Unanimous.*
- **Active-filter state chips** (only when a non-default filter/sort is on). *Unanimous — added R2.*
- **New-session affordance** — primary "+" action. *5/7 (Domain expert: could live in agent dropdown; majority kept it visible as the key creative action).* → **UNCERTAIN (low).**

### Tier 2 — ONE CLICK (dropdown / expand when toolbar open)
- **Agent picker list** (installed OR has-sessions), each with icon + session count.
- **Sort modes** (radio/segmented inside a filter popover).
- **Time-range & recency window** (inside same filter popover).
- **Pinned meta-view** (less frequent than Active/Flagged → demote into the meta menu). *Contested 4/3 — Power-user wanted it Tier 1.* → **UNCERTAIN (med).**
- **Plans / Agent-Files / Stats** — mode tabs (one click; not expanded by default).

### Tier 3 — ON DEMAND (right-click / settings)
- **Flag / unflag agent** (right-click agent; also a visible toggle inside dropdown row).
- **Pin / unpin session** (right-click session; star control on hover).
- **Per-agent settings** (settings panel).
- **"Show uninstalled / stale agents"** (settings toggle) — *but* leave a visible **"+N hidden"** counter (Discoverability Critic's non-negotiable). *Unanimous.*
- **Rename / archive / export session** (right-click).

---

## Course of action (synthesized)

1. **Two independent axes, never mixed.** Axis A = *which agent* (single primary control → dropdown). Axis B = *cross-agent meta-views* (separate small cluster). The current bug is collapsing both into one wrapping row.
2. **Spine ≤ 7 marks, fixed-grid, one loud element** (active agent). Brand monogram icons, color-disambiguated.
3. **Defer modifiers, never hide state.** Sort/time/recency live in a filter popover; an active non-default filter always shows a removable chip.
4. **Conditional persistence** for meta-views and "+N hidden" — show only when meaningful, but *never silently vanish* an agent.
5. **Columns mode = the multi-sidebar answer**; each pane carries its own identity header; primary control drives the focused pane.
6. **Keys mirror everything; visible chrome is for discovery.**

---

## Genuine uncertainties (flagged for prototype testing)

| # | Uncertainty | Why unresolved | How the 6 mockups test it |
|---|---|---|---|
| U1 | **Pinned**: Tier 1 or Tier 2? | 4/3 split; depends on how often a user stars | V2 vs V4 place it differently |
| U2 | **Monogram legibility** across 11 tools | Letter collisions (C×4) | V3 (glyph marks) vs V5 (logo-tile) compared |
| U3 | **New-session**: always-visible "+" vs inside agent menu | Frequency varies by user | V1 (visible +) vs V6 (menu-housed) |
| U4 | **Density default**: comfortable vs compact | Depends on monitor/eyesight | V2 comfortable vs V6 compact |
| U5 | **Meta-views: icons vs labeled** when space allows | Recognition vs recall tradeoff | V1 labeled vs V3 icon-only |
| U6 | **Columns trigger**: manual toggle vs auto on wide viewport | Discoverability vs surprise | V4 auto vs V5 manual |

These six uncertainties are the reason for six distinct concepts — each concept is *designed to resolve specific cells above*, not drawn arbitrarily.
