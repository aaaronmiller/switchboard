# Visibility Tiers — the placement framework

Adapted from GitLab Pajamas (essential / common / advanced) with one added invariant.

## The three tiers

### Tier 1 — Always visible (the "spine")
Show if **either**: used in most sessions, **or** required for orientation ("where am I?").
- **Budget: ≤ 7 marks.** This is Hick's/Miller's ceiling. Count *visual marks*, not features.
- **Exactly one "loud" element.** One thing carries primary emphasis (size/color/weight). If two
  things shout, neither does.
- Candidates: current context/identity, the content list itself, the 1–2 most-checked views,
  search entry, the single primary action, and any **active-state chips**.

### Tier 2 — One predictable click
Used per-task or per-session; acceptable to cost one interaction.
- Homes: dropdown (a list of one axis), popover (grouped modifiers like sort+filter),
  tabs (distinct modes), segmented control (2–4 mutually exclusive views).
- Rule of thumb: if a user touches it a few times per session, Tier 2.

### Tier 3 — On demand
Rare, configuration, or destructive.
- Homes: right-click context menu, settings panel, overflow "⋯" menu.
- Destructive/irreversible actions live here (rename, archive, delete, export).

## The invariant (non-negotiable)

> **Hide controls, never hide state.**

If a Tier-2/3 control is *currently changing what the user sees*, a Tier-1 **state indicator** must
remain visible and removable:
- Active filter → a chip ("⏱ 7d ✕").
- Hidden items → a counter ("+3 hidden").
- Active sort that isn't the default → a chip ("↓ Newest ✕").

This is what makes progressive disclosure *safe* instead of *confusing*. NN/g's research shows
deferring controls speeds users up **only when discoverability is preserved** — the state echo is how
you preserve it.

## The affordance rule

Right-click and hover are **invisible affordances**. Use them for power shortcuts, but:
- A **primary task** (the main thing the surface exists to do) must never be reachable *only* by an
  invisible affordance.
- Every right-click action should have a visible twin somewhere (a row toggle, a button, a menu item).

## Conditional persistence

Some Tier-1 items should appear **only when meaningful**:
- "Active/Running" view → show when ≥1 is running.
- "Flagged" view → show when ≥1 flag exists.
The *absence* must itself be informative (nothing running = no Active chip), and must never hide an
item that is actually active.

## Worked example (multi-agent sidebar)

| Element | Tier | Why |
|---|---|---|
| Current agent identity | 1 | orientation |
| Session list | 1 | the content |
| Active view (conditional) | 1* | checked constantly |
| Flagged view (conditional) | 1* | curated watch set |
| Search | 1 | core retrieval |
| Primary "+ new" | 1 | key action (uncertain — may demote) |
| Active-filter chip | 1 | the invariant |
| Agent picker list | 2 | switch = one click |
| Sort / time / recency | 2 | set occasionally → popover |
| Pinned view | 2 | less frequent (uncertain) |
| Modes (plans/files/stats) | 2 | distinct modes → tabs |
| Flag / pin / per-agent settings | 3 | rare → right-click/settings |
| Show stale/uninstalled | 3 | settings + "+N hidden" chip |
