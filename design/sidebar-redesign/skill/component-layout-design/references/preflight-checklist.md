# Pre-flight Checklist — before handing off a layout

Run top to bottom. Any "no" sends you back to the workflow step in brackets.

## Axes & inventory
- [ ] Every required element is inventoried and assigned a tier. [step 1,3]
- [ ] Distinct *kinds* of choice are distinct controls — no two axes merged into one widget. [step 2]

## Tier 1 (the spine)
- [ ] Tier 1 has **≤ 7 visual marks**. [step 3]
- [ ] **Exactly one** element is visually "loud"; the rest are quiet. [step 3]
- [ ] A first-time user can tell "where am I / whose data is this" at a glance. [step 3]
- [ ] Every Tier-1 icon-only control has a tooltip/label path. [laws: recognition]

## The state invariant
- [ ] Every hideable control that changes the view has a visible, removable **state chip** when active.
- [ ] Hidden/stale items surface a **"+N hidden"** affordance — nothing vanishes silently.
- [ ] No **primary** task is reachable only via right-click/hover.

## Disclosure correctness
- [ ] Per-session/per-task controls are Tier 2 (one click), not Tier 1.
- [ ] Rare/config/destructive actions are Tier 3 (right-click/settings).
- [ ] Conditional items (Active/Flagged) show only when non-empty, and never hide active work.

## Uncertainty honesty
- [ ] Behavior/hardware-dependent placements are **flagged**, not silently guessed. [step 5]
- [ ] Each flagged uncertainty is a **setting**, **instrumented**, or **A/B-tested via a mockup**.

## Visual integrity
- [ ] Everything aligns to a fixed grid; icons are fixed-size tiles (no floating/misalignment).
- [ ] Shared tokens used; concept differences are intentional, not accidental.
- [ ] Realistic data volume was used to check density/overflow/scroll. [protocol step 3]

## Deliverable
- [ ] Mockups are standalone + a gallery; at least one shows tier annotations.
- [ ] A **synthesis recipe** exists (element-level), not just "pick one."
- [ ] Rationale is written down so the *next* agent can reuse the reasoning.
