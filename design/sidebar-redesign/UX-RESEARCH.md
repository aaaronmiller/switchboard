# UX Research & Rationale — Switchboard Sidebar

A grounded reference for *why* each element sits where it does. Pairs with `DELIBERATIVE-EVALUATION.md` (the council) and `mockups/` (the six concepts). Written so a future agent can reuse the reasoning, not just the result.

---

## 1. What "good UX" means for a control surface like this

A sidebar that hosts 11 agents × N sessions × several filters is an **information-density problem**, not a styling problem. The job is to let a user *find and resume the right session fast* without re-learning the UI each time. Four laws govern that:

| Principle | Source | Operational rule here |
|---|---|---|
| **Progressive disclosure** | NN/g (Nielsen 1995; 2006 study) | Essentials up front; advanced deferred. Deferring advanced features measured **30–50% faster** first-task completion *without* losing discoverability. |
| **Hick's Law** | decision-time ∝ log(options) | Keep any single choice set **≤ 7**. The old 11-agent wrapping row violated this at the most-used spot. |
| **Miller's Law** | working memory ≈ 7±2 chunks | Group; don't present 11 flat. Two-tier (Figma: 8 categories + variants) beats one flat 30. |
| **Recognition > recall** | NN/g heuristic #6 | Visible, recognizable marks beat memorized menus — but icon-only must carry a learnable label (tooltip/badge). |
| **Aesthetic-usability + Law of Proximity** | Gestalt | Fixed-grid alignment and a single "loud" element reduce perceived complexity; misalignment *reads as broken*. |

**Definition we're designing to:** *The fewest always-visible elements that still let a user (a) know where they are, (b) reach what they touch most, and (c) never be surprised by hidden state.*

---

## 2. The decision framework: three tiers + one rule

Adapted from GitLab's essential/common/advanced, with a hard constraint added by the accessibility critic.

- **Tier 1 — Always visible.** Used most sessions; or required for orientation. Budget: **≤ 7 marks.**
- **Tier 2 — One predictable click.** Used per-session or per-task. Dropdowns, popovers, mode tabs, segmented controls.
- **Tier 3 — On demand.** Rare/config/destructive. Right-click menus, settings panel.
- **The invariant (non-negotiable):** **Hide controls, never hide *state*.** If a deferred control is currently changing what the user sees (a filter, a hidden agent), a *visible, removable indicator* must remain. This is the single rule that makes progressive disclosure safe.

### Why "right-click" is Tier 3 only
Right-click and hover are **invisible affordances** — undiscoverable without prior knowledge. They're acceptable for power shortcuts (flag, rename, export) **only if** a visible path to the same action also exists. They must never be the *sole* route to a primary task.

---

## 3. Element-by-element placement (the answer to "what's crucial vs hidden")

| Element | Tier | Confidence | Rationale |
|---|---|---|---|
| **Active-agent identity** (icon+name) | 1 | High | Orientation. You must always know whose sessions you're seeing. |
| **Session list** (body) | 1 | High | The content itself. |
| **Active meta-view** (running) | 1* | High | Checked constantly; *show only when ≥1 running* (conditional persistence). |
| **Flagged meta-view** | 1* | High | Curated watch set; *show only when ≥1 flag exists*. |
| **Search** | 1 | High | Core retrieval; may be an icon that expands to save width. |
| **New session** | 1 | Med | Key creative action — but see **U3**: some users rarely start from the sidebar. |
| **Active-filter state chip** | 1 | High | The invariant: a non-default filter must always show as a removable chip. |
| **Per-pane agent header** (columns) | 1 | High | In multi-pane, each pane must self-identify. |
| **Agent picker (full list)** | 2 | High | Switching is frequent but one click is acceptable; counts shown. |
| **Sort modes** | 2 | High | Set occasionally; belongs in a filter popover (radio/segmented). |
| **Time range / recency window** | 2 | High | Set occasionally; popover. State echoed as chip. |
| **Pinned meta-view** | 2 | **Low (U1)** | Less frequent than Active/Flagged for most — but power users disagree. |
| **Plans / Files / Stats** | 2 | High | Distinct *modes*; tabs, not always-expanded panels. |
| **Flag/unflag agent** | 3 | High | Right-click + visible toggle inside the dropdown row. |
| **Pin/unpin session** | 3 | High | Right-click + hover star. |
| **Per-agent settings** | 3 | High | Rare configuration → settings panel. |
| **Show uninstalled/stale** | 3 | High | Settings toggle — *but* a visible "+N hidden" counter is mandatory. |
| **Rename / archive / export** | 3 | High | Destructive/rare → right-click. |

\* conditional persistence — present when meaningful, absent when empty, but the *absence is itself informative* and never hides an active item.

---

## 4. Decisions that carry genuine uncertainty

These are *not* resolved by theory — they depend on this user's behavior and hardware, which is why each maps to specific mockups for A/B judgement.

| # | Open question | Tension | Where to look | How to settle |
|---|---|---|---|---|
| **U1** | Pinned: Tier 1 or 2? | Frequency varies wildly by user | V2 (Tier 1, 3-segment) vs V1/V6 (Tier 2) | Instrument: how often is Pinned opened vs Active? |
| **U2** | Best agent mark style | Letter collisions (C×4); glyph legibility | V3 glyphs · V1/V6 monograms · V5 logo-tiles | Squint test + 5-user recognition check |
| **U3** | New-session: visible + or in menu | Sidebar-initiated starts vary | V1 (visible +) vs V6 (menu) | Count new-session entry points used |
| **U4** | Default density | Eyesight, monitor, library size | V2/V1 comfortable vs V6 compact | Offer a density toggle; watch default churn |
| **U5** | Meta-views labeled vs icon | Recognition vs space | V1 labeled vs V3/V6 icon | First-time success rate |
| **U6** | Columns: auto on wide vs manual | Discoverability vs surprise | V4 auto vs V5 manual | Do users *find* manual? Does auto annoy? |

**Honest stance:** anyone claiming certainty on U1–U6 from first principles is guessing. The defensible move is to ship the high-confidence Tier assignments now and make U1–U6 *user-settable* (or instrument them) rather than hard-coding a guess.

---

## 5. Recommended synthesis (the course of action)

A **hybrid** that takes the highest-confidence pieces from the council and leaves the uncertain ones flexible:

> **Base = V3 Glyph Rail** (best agent visibility per pixel, clean alignment) **for the agent axis**, **+ V1's labeled meta-views and visible filter-state chips** (discoverability + the state invariant), **+ V4's per-pane headers** when columns are on. Density and Pinned-placement become **user settings** (resolving U1/U4 by deferral, not decree). Mark style → validate U2 with the squint test before committing (lean monogram for installed-daily agents, glyph for the long tail).

This is **not** a 7th mockup — it's an element-level recipe assembled from the six, exactly the "single design with options per grouping" the brief allowed.

---

## 6. Reusable heuristics (extracted for the skill)

1. **Separate axes before you style.** Two different kinds of choice (which-agent vs cross-agent-view) must be two different controls. Most "cluttered" UIs are conflated axes.
2. **Budget the spine: ≤7, one loud.** Count always-visible marks. Over 7 → demote. Exactly one element carries primary emphasis.
3. **Defer controls, pin state.** Every hideable control gets a visible state echo when active.
4. **Conditional persistence.** Show contextual items only when non-empty; absence must inform, never hide active work.
5. **No primary task behind an invisible affordance.** Right-click/hover are additive, never sole.
6. **Name the uncertainties.** Separate theory-settled placements from behavior-dependent ones; make the latter settings or instrument them — don't fake confidence.
7. **Fixed grid = trust.** Inconsistent alignment reads as "broken" regardless of feature quality.
