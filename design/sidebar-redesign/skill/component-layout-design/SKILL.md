---
name: component-layout-design
description: >
  Use when designing or fixing the LAYOUT of a control-dense UI surface — sidebars,
  toolbars, navigation rails, dashboards, panels, command bars, settings pages — and
  the question is "what should always be visible vs. hidden behind dropdowns / tabs /
  right-click / settings." Triggers on: "design a sidebar", "this UI is cluttered",
  "too many buttons", "what to show vs hide", "progressive disclosure", "information
  architecture", "arrange these controls", "the layout looks thrown together", or any
  request to produce considered component layouts with a rationale rather than guesswork.
  ALWAYS apply this skill before generating a control-heavy layout mockup.
---

# Component Layout Design

A method for arranging control-dense UI so it is **functional, learnable, and not "thrown at the wall."**
It produces a *reasoned* layout (every element has a placement rationale), surfaces the decisions that
are genuinely uncertain, and validates them with purpose-built mockups instead of opinion.

## When this applies

Any surface where many controls compete for limited space and attention: sidebars, nav rails,
toolbars, dashboards, command palettes, filter bars, settings screens. If you're tempted to "just
show everything," this skill is the antidote.

## The core idea (read this first)

> **The fewest always-visible elements that still let a user (a) know where they are, (b) reach what
> they touch most, and (c) never be surprised by hidden state.**

Two rules carry most of the value:

1. **Separate the axes before you style.** Different *kinds* of choice must be different controls.
   (e.g. "which agent" vs "cross-agent view" are two axes — conflating them into one row is the
   single most common cause of clutter.)
2. **Defer controls, never defer state.** You may hide a control, but if it is currently changing
   what the user sees (an active filter, a hidden item), a visible, removable indicator must remain.

## Workflow

Run these in order. Don't skip to mockups.

1. **Inventory** every element the surface must host. List them flat.
2. **Find the axes.** Group elements by the *kind of decision* they represent. Each axis becomes its
   own control; never merge two axes into one widget.
3. **Tier each element** using the three-tier model → `references/visibility-tiers.md`.
   Hold the line: **Tier 1 ≤ 7 marks, exactly one "loud" element.**
4. **Apply the laws** (Hick, Miller, progressive disclosure, recognition) to pressure-test tiering →
   `references/ux-laws.md`.
5. **Name the uncertainties.** Separate placements settled by theory from those that depend on user
   behavior/hardware. The uncertain ones become *settings* or get *instrumented* — never hard-guessed.
   (For high-stakes surfaces, run the decision through the `deliberative-refinement` skill first.)
6. **Mockup to resolve uncertainty.** Produce N concepts, *each engineered to resolve specific named
   uncertainties* — not arbitrary variations → `references/mockup-protocol.md`.
7. **Synthesize a recipe**, not a winner: take the highest-confidence element from each concept; leave
   uncertain ones flexible.
8. **Pre-flight** before handing off → `references/preflight-checklist.md`.

## Tier model (summary)

| Tier | Meaning | Homes |
|---|---|---|
| **1 — Always visible** | used most sessions / needed for orientation | the spine (≤7 marks) |
| **2 — One predictable click** | per-task / per-session | dropdown, popover, tabs, segmented control |
| **3 — On demand** | rare / config / destructive | right-click, settings |

**Invariant:** hidden control + active effect ⇒ a visible, removable **state chip**.
**Affordance rule:** never put a *primary* task behind an invisible affordance (right-click/hover are additive only).

## Anti-patterns

- ❌ One wrapping row of N variable-width buttons (conflated axes + Hick's-law violation).
- ❌ Hiding a filter with no visible sign it's active ("where did my sessions go?").
- ❌ Silently removing items (stale/uninstalled) with no "+N hidden" affordance.
- ❌ Icon-only with no tooltip/label path → undiscoverable.
- ❌ Generating mockups before tiering — that *is* throwing it at the wall.
- ❌ Faking confidence on behavior-dependent choices instead of flagging them.

## Resources (progressive disclosure — load only what the task needs)

- `references/visibility-tiers.md` — the full three-tier framework + the state invariant + worked examples.
- `references/ux-laws.md` — grounding laws with sources and the numeric rules (≤7, 7±2, 30–50% study).
- `references/mockup-protocol.md` — how to turn uncertainties into N purpose-built concepts; tokens + gallery method.
- `references/preflight-checklist.md` — the hand-off checklist.
- `assets/tokens.css` — a starter design-token sheet (dark) for consistent, aligned mockups.
