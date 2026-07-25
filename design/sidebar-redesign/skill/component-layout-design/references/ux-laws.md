# UX Laws — the grounding (with numbers)

Use these to pressure-test a tiering. Each has an operational rule and a source.

## Progressive disclosure
- **Principle:** reveal complexity gradually; essentials first, advanced on demand.
- **Source:** Jakob Nielsen / NN/g (introduced 1995). A 2006 NN/g study found deferring advanced
  features produced **30–50% faster initial task completion** while preserving access to the full set.
- **Rule:** if <~20% of users need an element for the core task, it's not Tier 1.
- **Tiering origin:** GitLab Pajamas formalizes **essential → common → advanced**.

## Hick's Law
- **Principle:** decision time grows with the number (and log) of choices.
- **Rule:** any single choice set the user faces at once should be **≤ 7**; ideally 5. Split a 30-option
  decision into two 6–8 option decisions (two-tier), as Figma does (≈8 tool categories + nested variants).

## Miller's Law
- **Principle:** working memory holds ≈ **7 ± 2** chunks.
- **Rule:** don't present 11 flat items; **group** into 4–6 groups of 5–8. Grouping is why a dropdown of
  agents beats a wrapping row of agents.

## Recognition over recall (NN/g heuristic #6)
- **Principle:** recognizing is easier than remembering.
- **Rule:** prefer visible, recognizable marks to memorized menu paths — **but** icon-only must carry a
  learnable label (tooltip, badge, or first-run reveal), or it becomes recall again.

## Aesthetic–Usability + Gestalt (proximity / common region / similarity)
- **Principle:** clean, aligned layouts are *perceived* as more usable; misalignment reads as broken.
- **Rule:** put related controls in a shared region; align everything to a fixed grid; use fixed-size
  icon tiles so nothing "floats." One baseline, consistent gutters.

## Fitts's Law (for the action layer)
- **Principle:** target acquisition time depends on size and distance.
- **Rule:** make the primary action a comfortable target; keep frequently-paired controls near each other;
  edges/corners are "infinite" targets (good for persistent rails).

## VS Code IA reference (real-world calibration)
- Containers + items; **3–5 views** is the comfortable max per container; "too much contributed UI…
  confuses users." A persistent icon **activity bar** is a proven pattern for an always-visible nav axis
  with compact density.

## How to use them together
1. Hick/Miller cap the **count** (Tier-1 ≤7, group the rest).
2. Progressive disclosure decides **what** drops to Tier 2/3.
3. Recognition decides **icon vs label** (and forces tooltips on icons).
4. Gestalt/aesthetic-usability decides **alignment and grouping**.
5. Fitts decides **sizing** of the action layer.
