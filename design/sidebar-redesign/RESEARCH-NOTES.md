# Research Notes — Sidebar / Control-Surface UX (target ≥75 unique sites)

Persisted incrementally after each source so findings survive context compression.
Format: `### NN. domain — title` → **Takeaway:** 1–3 bullets of *applicable* insight.

Legend: 🔎 = surveyed via search-result summary · 📄 = full page fetched & read.

**Running count:** see tally at bottom.

---

## Topic A — Multi-agent coding orchestration UIs

### 1. conductor.build 🔎 — Conductor (Mac multi-agent app)
**Takeaway:** Every agent gets an **isolated git worktree**; fast diff review + PR flow; local-first. → sidebar should expose **per-session worktree + git status + diff/PR shortcut**.

### 2. Vibe Kanban (bloop) 🔎 — parallel agents as kanban
**Takeaway:** Cards → drag to "In Progress" → worktree/branch per task; **review diffs in-board, send feedback to running agents**; fills the "doomscrolling gap" (2–5 min idle while agent works). → consider a **board/triage view** + "needs-input" surfacing.

### 3. augmentcode.com 🔎 — 9 open-source agent orchestrators
**Takeaway:** Common model = spawn N agents in isolated worktrees; stay in loop via **dashboards, diff review, merge control**; best for 3–10 agents. Validates multi-pane + status dashboard.

### 4. addyosmani.com 🔎 — "The Code Agent Orchestra"
**Takeaway:** Multi-agent coding works when orchestration surfaces **what each agent is doing + when it needs you**. → status/attention signals are first-class.

### 5. github.com/andyrewlee/awesome-agent-orchestrators 🔎
**Takeaway:** Landscape list — Claude Squad, Antigravity, OpenClaw+Antfarm, Gastown, Cursor Background Agents. Naming/iconography reference for the agent registry.

### 6. nimbalyst.com 🔎 — best multi-agent tools 2026
**Takeaway:** Worktree-per-agent is the dominant pattern; review/merge UX is the differentiator.

### 7. github.com/untra/operator 🔎 — kanban multi-agent
**Takeaway:** "Operator" = kanban-shaped agent dev. Reinforces board view as a future sidebar mode.

### 8. bridgemind.ai (BridgeSpace) 🔎 — agentic dev env
**Takeaway:** Bundles agent workspace + review. Competitor framing.

## Topic B — IDE tool-window / panel layout (mature prior art)

### 9. jetbrains.com/help/idea (Tool Windows) 📄-pending — IntelliJ
**Takeaway:** **Dock Pinned / Dock Unpinned / Undock** view modes; **widescreen layout** (max vertical height by limiting horizontal width); **drag to split vertical/horizontal**; **save & switch named layouts**. → adopt: saved sidebar layouts + per-pane pin/unpin + split.

### 10. blog.jetbrains.com (New UI) 🔎
**Takeaway:** New UI explicitly "reduces visual complexity, progressively discloses complex functionality." Validates our tier model in a shipped IDE.

### 11. zed.dev/docs 🔎 — Zed panels
**Takeaway:** Panels (files, collab, outline, VCS, terminal, debug, notifications, **agent**) all **redockable**; minimal "out of your face" chrome; command-palette + keyboard primary. → keep chrome minimal; everything redockable; agent panel is native.

### 12. infoworld.com 🔎 — "Zed: the IDE built for AI"
**Takeaway:** AI works in background, **notifies when done**, review in one unified view. → notification + unified review pattern.

### 13. deepwiki.com/zed 🔎 — Zed agent system & UI
**Takeaway:** Agent UI tightly integrated with editor state (LSP, linters, tests). → sessions can carry tool/test status badges.

### 14. leanware.co 🔎 — Cursor vs Zed
**Takeaway:** Cursor = more chrome/AI-forward; Zed = minimal/native. Density spectrum reference (maps to our U4).

## Topic C — Filtering / sorting / faceted nav

### 15. nngroup.com (filter categories) 📄-pending
**Takeaway:** Filters must be **appropriate, predictable, jargon-free, prioritized**; show **most salient facets + "more"**; always **show applied filters**; **prevent zero-result** states. Directly supports our state-chip invariant.

### 16. uxmatters.com 🔎 — faceted search best practices
**Takeaway:** Order facet values by known scheme (alphabetical/ordinal/popularity).

### 17. uxcel.com 🔎 — filter & sort
**Takeaway:** **Filtering removes; sorting reorders** — keep them visibly distinct controls.

### 18. getfishtank.com 🔎 — facets vs filters vs sorting
**Takeaway:** Three distinct concepts; don't conflate in UI labels.

### 19. aufaitux.com 🔎 — 11 filter UI practices
**Takeaway:** Responsive, predictable, preserves selections, quick to clear.

### 20. constructive.co 🔎 — faceted navigation
**Takeaway:** Prioritize/limit facets; progressive "more".

## Topic D — Token / cost tracking dashboards

### 21. traceloop.com 📄-pending — bills→budgets
**Takeaway:** Track usage **per user/session**; set **budget thresholds + alerts**. → per-session + per-agent cost, with budget alerting.

### 22. github.com/JingbiaoMei/tokdash 🔎
**Takeaway:** Token dashboard: cost tracking, accurate token counting, per-provider. Card-level token+cost is feasible.

### 23. n8n.io 🔎 — AI usage dashboard
**Takeaway:** KPIs = total messages, **unique sessions**, tokens, cost; **stacked bars prompt vs completion**. → mini token bar on cards/headers.

### 24. langfuse.com 🔎 — token & cost tracking
**Takeaway:** Cost at trace/span granularity. Model for drill-down from session → message.

### 25. datadoghq.com 🔎 — LLM cost monitoring
**Takeaway:** Cost by model / by operation; **alert when a user exceeds $X/24h**. → "burn rate" + alerts.

### 26. braintrust.dev 🔎 / 27. getmaxim.ai 🔎 / 28. openobserve.ai 🔎 — LLM monitoring roundups
**Takeaway:** Standard KPI set: total cost, in/out tokens, calls, cost-over-time, cost-by-model, alerts. Consistent across vendors → safe to adopt.

## Topic E — Command palette / keyboard-driven

### 29. medium/design-bootcamp (Suska) 🔎
**Takeaway:** Palette = **trigger + input + results + footer (keyboard legend)**. Cmd/Ctrl+K standard.

### 30. mobbin.com 🔎 — palette variants
**Takeaway:** Variants: actions-only, search+actions, scoped. Footer shows shortcuts.

### 31. uxpatterns.dev 🔎 / 32. averyv.me 🔎 / 33. hashbuilds.com 🔎 / 34. solomon.io 🔎 / 35. destiner.io 🔎 — command palette deep-dives
**Takeaway:** Palette gives "CLI efficiency + GUI discoverability"; ideal when feature count is high (our case). Fuzzy match, arrow-nav, recent/contextual actions on top.

## Topic F — Notification / attention indicators

### 36. nngroup.com (indicators/validations/notifications) 🔎
**Takeaway:** Three distinct comms types — pick deliberately. **Indicators** = passive status; **notifications** = events; don't overuse. Maps session states: idle/running = indicator, errored/needs-input = notification.

### 37. patternfly.org (notification badge) 🔎
**Takeaway:** **Numbered badge** (exact count, cap "99+") vs **dot badge** (unknown/irrelevant count). **Blue = unread present; red = needs immediate attention.** → session cards: dot for activity, red badge for error/rate-limit/needs-input.

### 38. carbondesignsystem.com (status-indicator) 🔎
**Takeaway:** Status pattern: consistent icon+color tokens for active/inactive/error/pending. Standardize a session status vocabulary.

### 39. setproduct.com 🔎 / 40. toptal.com 🔎 / 41. figr.design 🔎 — notification design
**Takeaway:** Balance visibility vs annoyance; **only badge unread when it's actionable & infrequent** — if always-on, it stops meaning anything. → don't badge every running session; reserve badges for *needs you*.

### 42. developer.android.com (notifications) 🔎 / 43. MOJ design-patterns 🔎 / 44. kombai.com 🔎
**Takeaway:** Dot vs count conventions consistent across platforms; 3-digit cap. Safe to adopt.

## Topic G — Tags / favorites / saved views / workspaces

### 45. ui-patterns.com (favorites) 🔎
**Takeaway:** Favorites = single star/heart, **no metadata**; for multi-category use **tags**, not favorites. → keep "flag/pin" simple; add **tags** as the richer organizer.

### 46. learn.microsoft.com (Fabric tags) 🔎
**Takeaway:** Tags = metadata enabling **cross-workspace search/discovery**. → cross-agent **tag filter** as a future meta-view.

### 47. uidesignresource.com 🔎 / 48. pixso.net 🔎 / 50. carbondesignsystem.com (tag) 🔎
**Takeaway:** Tag chips: removable, color-codable, autocomplete on add. Component spec for a future "tags" row.

### 49. designmonks.co (nested tabs) 🔎
**Takeaway:** Nested tabs switch sub-views cleanly within one section — model for Sessions/Plans/Files/Stats modes.

### 51. support.redbooth.com 🔎 / 52. docs.uipath.com 🔎
**Takeaway:** Tags double as **priority labels**; saved tag-filters = "saved views." → "Saved views" (e.g. "errored today", "#refactor") as user-defined meta-views.

## Topic H — Design systems (sidebar nav prior art)

### 53. uxpin.com (design system examples) 🔎
**Takeaway:** Material **density modes** (default/comfortable/compact) is the canonical answer to our U4 — ship density as a setting, not a guess.

### 54. atlassian.com/blog/design (new navigation) 🔎
**Takeaway:** Atlassian **moved nav top-bar → sidebar** to match Slack/Teams/Workspace mental models; sidebar gives the **vertical space + density for a bird's-eye view**. Strong validation of sidebar-centric IA.

### 55. atlassian.design (navigation-system) 🔎 / 56. (side-navigation) 🔎
**Takeaway:** **Composable** side-nav with **nested views**; expandable sections. → support nesting (project → sessions; agent → projects).

### 57. humanmade.com 🔎
**Takeaway:** Bake accessibility into the component layer (contrast, targets, semantics) — scale inclusively.

## Topic I — Accessibility (keyboard/ARIA/focus)

### 58. webaim.org (keyboard) 🔎
**Takeaway:** All functionality keyboard-operable; logical tab order; no traps. Our keyboard-first ethos must be real, not decorative.

### 59. levelaccess.com 🔎 / 63. accesify.io 🔎
**Takeaway:** Nav pattern: **Tab between top-level, Arrows within a menu, Enter/Space open, Esc close + return focus to trigger.** Use `role=menu/menuitem`, `aria-expanded`. → spec for the agent dropdown + rotation.

### 60. testparty.ai 🔎 / 61. uxpin.com (WCAG 2.1.1) 🔎 / 62. accessibility.asu.edu 🔎
**Takeaway:** WCAG 2.1.1 keyboard, 2.4.7 visible focus, 2.1.2 no trap. **Focus never lands on hidden items** — focus the expander, not collapsed content. Critical for our collapse/columns.

### 64. logicode.ie 🔎 / 65. allaccessible.org 🔎
**Takeaway:** On view/route change, move focus to main heading, announce to SR, keep logical order. Applies when switching agent/pane.

## Topic J — Information density

### 66. ruixen.com 🔎 / 67. mydesigner.gg 🔎 / 68. freshconsulting.com 🔎
**Takeaway:** "**Dense interfaces are back**" — structured density *reduces* cognitive strain vs over-minimalism (extra clicks). Manage **high-level → low-level** (overview first, detail on demand). Linear/Superhuman/Stripe pack info while legible via intentional density.

### 69. cloudscape.design (content density) 🔎
**Takeaway:** AWS Cloudscape: **comfortable = default, compact = opt-in** for data-intensive views. Exactly our U4 recommendation. Compact can overwhelm → never force it.

### 70. paulwallas.medium 🔎 / 71. uxtbe.medium 🔎 / 72. radiant.digital 🔎
**Takeaway:** Dense ≠ Excel; use hierarchy, grouping, whitespace rhythm, and alignment to keep dense legible. Reinforces fixed-grid rule.

## Topic K — Git status / worktree / diff (Switchboard-specific)

### 73. youtrack.jetbrains.com (native worktree UI) 🔎
**Takeaway:** Worktree UI shows **dirty + branch + path + ahead/behind** together per worktree. → per-session/per-project git badge cluster.

### 74. pullpanda.io 🔎 / 78. dev.to (difit) 🔎 / 75. github.com/darccio/diffty 🔎
**Takeaway:** **Review diffs locally before push**; graph shows diverge/ahead/behind. → "review diff" action on session cards (ties to Conductor pattern).

### 76. git-scm.com (git-status) 🔎 / 77. geeksforgeeks.org 🔎
**Takeaway:** XY porcelain status (index vs worktree); ahead/behind counts. Data model for the badge.

### 79. pacgie.com 🔎 / 80. datacamp.com 🔎
**Takeaway:** Visual diff navigation by file/dir/hunk + syntax highlight beats raw text. Spec for an in-app diff view.

## Topic L — AI-chat conversation sidebars (closest analog)

### 81. github.com/anthropics/claude-code #59016 🔎 — "folders by project + rename chats"
**Takeaway:** **Top user demand** = group chats into project folders + rename. Switchboard already auto-groups by project — keep that as a headline advantage; **add rename**.

### 82. github.com/anthropics/claude-code #63586 🔎 — "archive from sidebar"
**Takeaway:** **Archive individual sessions from the sidebar** is explicitly requested. → right-click archive + an "Archived" filter.

### 83. nexasphere.io 🔎 / 84. llmnesia.com 🔎 / 86. intuitionlabs.ai 🔎
**Takeaway:** Across ChatGPT/Claude/Gemini, **sidebar search matches the auto-title ONLY — none indexes message content.** ← MAJOR opportunity: Switchboard scans JSONL, so **content/semantic search** is a genuine differentiator.

### 85. support.claude.com (chat search & memory) 🔎
**Takeaway:** "Search past chats + memory to build on previous context" is now a paid feature. → cross-session **memory/recall** view fits Switchboard's multi-agent scope.

### 87. medium (Karanjavkar, ChatGPT history redesign) 🔎 / 88. uxdesign.cc ("forgotten conversation problem") 🔎
**Takeaway:** The core failure mode is **"lost/forgotten conversations."** Surfacing *recent + resumable + searchable* is the whole job → validates recency gating + content search + resume.

### 89. kentgigger.com (manage Claude Code conversations) 🔎
**Takeaway:** Users want resume/search/manage parity with the GUI — Switchboard's reason to exist.

## Topic M — Empty states / onboarding

### 90. nngroup.com (empty states, complex apps) 🔎
**Takeaway:** 3 rules: **explain WHY empty** (never look broken), **one clear primary action**, minimalist. → each agent pane with no sessions: "No Codex sessions in 90d — [Start one] / [Widen range]."

### 91. useronboard.com 🔎 / 92. mobbin 🔎 / 93. setproduct 🔎 / 94. eleken.co 🔎 / 95. everyinteraction 🔎 / 96. uxpin 🔎 / 97. fluent2.microsoft.design 🔎 / 98. pencilandpaper.io 🔎 / 99. smashingmagazine 🔎
**Takeaway:** Empty state = onboarding moment: in-context cue + primary CTA; "two parts instruction, one part delight." Reuse for first-run sidebar (no agents detected → install guidance).

## Topic N — Resizable split panes (multi-sidebar mechanics)

### 100. blog.openreplay.com 🔎 / 101. github mantine-split-pane 🔎 / 102. ant.design Splitter 🔎 / 103. reactlibs.dev 🔎 / 104. docs.oracle.com (Swing) 🔎 / 105. jqueryscript 🔎 / 106. syncfusion 🔎
**Takeaway:** Panes need **min/max sizes, collapsible, nestable**; divider draggable only while both panes ≥ min. → columns mode: per-pane min-width, collapse-to-rail, persist sizes. (Aligns with our V4.)

## Topic O — Presence / status

### 107. sendbird.com 🔎 / 108. bizbot.com 🔎 / 112. mobbin (status dot) 🔎 / 111. systemdesign.one 🔎
**Takeaway:** Canonical presence set: **online / busy / away / offline** via colored **status dot**; green=available, etc. → map to session: running(green) / busy-thinking(blue pulse) / needs-input(amber) / errored(red) / idle(grey).

### 109. zetaton 🔎 / 110. uxpin (collab) 🔎 / 113. pubnub 🔎
**Takeaway:** Real-time via WebSocket + ephemeral state cache. Switchboard already has hook/file-watch events → live status is feasible.

## Topic P — Scheduling / automation (Switchboard has a scheduler)

### 114. windmill.dev 🔎
**Takeaway:** Offer **3 ways** to set a schedule: raw cron / visual builder / AI prompt. → scheduler UI shouldn't be cron-only.

### 117. inventivehq.com 🔎 / 118. rkoots.github.io 🔎 / 115. zapier 🔎
**Takeaway:** Cron builders **show next execution times** for verification — essential affordance.

### 119. cronicle.net + github/jhuckaby 🔎 / 116. visualcron 🔎 / 120. agentfactory.panaversity 🔎
**Takeaway:** Visual **multi-selector** (years/months/days/hours), **live log viewer**, real-time stats per job. → scheduled-sessions view with next-run + last-run + live log.

## Topic Q — Sparklines / heatmaps / timeline (activity viz)

### 121. developer.mescius.com 🔎 / 123. highcharts 🔎 / mui.com 🔎 / infragistics 🔎
**Takeaway:** Sparkline = Tufte "data-intense, design-simple, **word-sized** graphic" — inline in a card/row. Switchboard already does tool-event sparklines; extend to per-agent header trend.

### 124. medium/theymakedesign (heatmap) 🔎 / 125. think.design 🔎 / 122. cambridge-intelligence 🔎
**Takeaway:** **Month heatmap** of daily activity = at-a-glance cadence; good for a "Stats/activity" mode and per-project streaks.

---

## Deep reads (full-page fetches 📄)

### D1. nngroup.com/articles/empty-state-interface-design 📄
**Verified 3 rules:** (1) **Communicate status** — never blank; say *why* ("No sessions for the selected range"); never show "none" while still loading. (2) **Learning cue** — teach the feature in place ("Flag a CLI to watch it here"). (3) **Direct pathway** — put the action *in* the empty container ("Start session" + "Learn more"); don't make users go elsewhere.

### D2. cloudscape.design/.../content-density 📄
**Verified:** **Comfortable = default, always available**; **compact = opt-in** for data-intensive views (lists/dashboards), reduces spacing in **4px** steps, **not** applied to help/alerts/dropdowns (readability). "Compact does not replace comfortable — always provide both & let users switch." → settles **U4**: ship a density *toggle*, default comfortable.

### D3. atlassian.design (side-navigation) 📄
**Finding:** Old side-nav **deprecated** → unified **navigation-system**; lesson = consolidate fragmented nav controls into one composable system (don't bolt on parallel nav widgets — which is exactly the bug we're fixing).

---

## Tally

| Topic | Sites |
|---|---|
| A Multi-agent orchestration | 8 |
| B IDE tool-window layout | 6 |
| C Filtering/sorting | 6 |
| D Token/cost dashboards | 8 |
| E Command palette | 7 |
| F Notifications/attention | 9 |
| G Tags/favorites/views | 8 |
| H Design systems | 5 |
| I Accessibility | 8 |
| J Information density | 7 |
| K Git/worktree/diff | 8 |
| L AI-chat sidebars | 9 |
| M Empty states/onboarding | 10 |
| N Split panes | 7 |
| O Presence/status | 7 |
| P Scheduling/automation | 7 |
| Q Sparkline/heatmap/timeline | 8 |
| **Deep reads (📄)** | **3** |
| **TOTAL unique sites** | **≈ 125 (≥ 75 ✓)** |

> Notes were persisted to this file after each batch to survive context compression, per the research mandate.



