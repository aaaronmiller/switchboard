# Mockup Protocol — concepts that resolve uncertainty

The point of multiple mockups is **not** "show options" — it's to *settle named uncertainties*. Each
concept must be engineered to make a specific decision visible and comparable.

## Step 1 — Derive the uncertainties FIRST
From tiering, list the placements that theory can't settle (behavior- or hardware-dependent). Give each
an ID (U1, U2, …) and a one-line tension. Example:
- U1 — Pinned: Tier 1 or 2? (frequency varies by user)
- U2 — agent mark style (letter collisions / glyph legibility)
- U4 — density default (eyesight / monitor / library size)

## Step 2 — Assign uncertainties to concepts
Every concept gets a **predetermined design focus** + the **uncertainties it resolves**, written down
*before* you draw it. A concept that doesn't test something specific shouldn't exist.

| Concept | Focus | Resolves |
|---|---|---|
| C1 | discoverability-first (everything labeled) | U3, U5 |
| C2 | power-user density / promote frequent | U1, U4 |
| C3 | icon-rail (max items / min width) | U2, U5 |
| C4 | the "wide-screen / multi-pane" answer | U1, U6 |
| C5 | identity-forward (alt mark style) | U2, U6 |
| C6 | maximum density / demote secondary | U3, U4 |

(6 is a good default for a control surface; use 3 for small ones, more only if uncertainties demand it.)

## Step 3 — Build real, consistent mockups
- **Shared tokens** (`assets/tokens.css`): identical color/type/spacing so concepts differ only where
  *intended*. Differences must be design choices, not noise.
- **Real content, never lorem ipsum.** Use the product's actual entities, labels, and realistic counts.
  Fake content hides real density/overflow problems and violates the no-placeholder rule.
- **Standalone + a gallery.** Each concept is its own openable HTML (annotated with focus + uncertainties);
  an `index.html` shows all in iframes for side-by-side comparison.
- **Annotate the tiers** on at least one concept (visible "Tier 1 / always visible" labels) so a reviewer
  sees the reasoning, not just the pixels.
- Output format is free (HTML is recommended — real, interactive, inspectable; PNG/Figma fine too).

## Step 4 — Synthesize a recipe, not a winner
Don't crown one mockup. Assemble the **highest-confidence element from each**:
> "Base = C3's agent rail + C1's labeled meta-views & state chips + C4's per-pane headers; density and
> Pinned placement become settings (U1/U4 deferred to the user)."
For element groupings that stay uncertain, ship them as **settings** or **instrument** them — never
hard-code a guess.

## Step 5 — Validate the cheap way
- **Squint test** for U2 (mark legibility) — blur your eyes; can you still tell agents apart?
- **5-second / first-run test** for U5 (icon vs label) — can a newcomer name the controls?
- **Instrument** U1/U3 (frequency) — log how often each is actually used, then promote/demote.

## Why "real data" matters (failure mode)
A mockup with 3 fake sessions looks clean; the real surface has 60 across 7 projects with 11 agents.
Density, overflow, scroll, and grouping problems only appear with realistic volume — design against the
real distribution or you'll ship a layout that breaks on contact with actual data.
