# Switchboard — Future Plan (blocked on decisions / external systems)

> **Date:** 2026-06-04
> These are the items from `PLAN.md`, `IMPROVEMENTS.md`, `ROADMAP.md`,
> `FULL-AUDIT.md`, and the user's stated vision that **cannot be implemented
> without more information or a design decision**. The buildable-now work is in
> `archive/docs/MULTI-PHASE-PLAN.md`. Each item below lists the **questions that
> gate it**.
>
> The end goal stated by the user: evolve Switchboard from a *multi-CLI
> aggregator* into an *agentic management & deployment platform*, integrating
> Disler's **pi-agent-observability** so tool calls and per-session activity are
> monitored across every CLI.

---

## 1. pi-agent-observability integration (the headline vision)

**What it is.** Disler's `pi-agent-observability`: an *extension* subscribes to a
CLI's lifecycle hooks and emits canonical `ObsEvent` envelopes (identity:
`session_id`, `cwd`, `agent_name`, `provider`, `model`; ordering: monotonic
`seq`; a 16-variant discriminated-union payload — `session_start`, `turn_start`,
`user_message`, `assistant_message`, `thinking`, `tool_call`, `tool_result`,
`model_change`, `compaction`, `branch_nav`, `error`, …) to a **Bun + SQLite**
server (`POST /events`, WAL, idempotent on `(session_id, seq)`) which broadcasts
to a browser UI over SSE (single-session timeline, swimlane, race views).

**Why it's blocked.** Switchboard already has *part* of this (a PostToolUse hook
installer + `/session-event` HTTP endpoint + sparklines), but a real integration
forces architecture choices, and **only Claude and Pi expose the rich hook
surface** the schema assumes — codex/antigravity/kilo/opencode do not (yet)
emit equivalent lifecycle hooks.

**Questions to answer before building:**
1. **Embed vs. federate?** Do we (a) reimplement the ingest+timeline *natively*
   inside Switchboard (Electron main process as the Bun-server equivalent,
   events in the existing better-sqlite3 DB), or (b) run Disler's Bun server as a
   sidecar and have Switchboard act as an SSE client? (a) keeps one process and
   reuses our DB; (b) tracks upstream for free but adds a Bun dependency + a
   second process.
2. **Event source per CLI.** For CLIs without a hook API
   (codex/antigravity/kilo/opencode), is it acceptable to *derive* `ObsEvent`s by
   tailing their session JSONL (we already parse these), accepting lower fidelity
   and no real-time `PreToolUse`/`PermissionRequest`? Or do we wait for/author
   per-CLI hook extensions?
3. **Schema ownership.** Adopt Disler's `ObsEvent` schema verbatim (for
   interop), or a Switchboard superset? If superset, what extra fields (cost,
   git-context, project id)?
4. **Scope of v1 UI.** Minimum viable: per-session timeline only, or also the
   swimlane/fleet pulse chart from day one?
5. **Retention.** How long do we keep events? Cap rows / size / age?

*Recommended once answered:* native ingest (option 1a) reusing better-sqlite3 +
SSE-over-IPC, JSONL-derived events for non-hook CLIs (2a), Disler-compatible
schema superset, timeline-first UI. This is a natural **Phase 5** after the card
work lands.

---

## 2. MACS — Orchestrator + Deliberative Council (ROADMAP Block 0)

Prime → Council → Swarm. Decompose a goal into a task DAG via 6-8 specialist
critique agents, dispatch parallel sub-agents, gate on tests.

**Questions:**
1. Which LLM/agent runs the orchestrator + council — a local Claude Code session
   driven by Switchboard, the Claude Agent SDK, or the proxy (item 4)?
2. Is the `deliberative-refinement` skill referenced in the docs available to
   this repo, and where? Same for **Speckit** (spec/plan/tasks/checklists).
3. Where do plans/specs/test-suites live — `.switchboard/specs/NNN/`? Committed?
4. Approval model: one-time plan approval then autonomous, or per-task gates?

## 3. Swarm dispatch, TDD gates, model escalation, cross-agent coordination

Depends on **#2** + a test-runner contract.

**Questions:**
1. How are tests executed per task (reuse scheduler `waitForOutput` patterns, or
   a dedicated runner per language)? What defines "green"?
2. Escalation ladder concretely (`haiku → sonnet → opus`?) and who is allowed to
   trigger it — requires the proxy (#4).
3. Conflict policy when two agents touch the same file — lock, queue, or merge?

## 4. Proxy integration + telemetry + compression + fallback (ROADMAP Block 0 / 5)

The docs say "the proxy already works standalone."

**Questions (all blocking):**
1. **Where is the proxy?** Repo/binary, run command, base URL/port, auth.
2. Its API surface — model-routing request shape, and the telemetry endpoint
   (poll or subscribe?) for tokens/cost/latency.
3. Config location — confirm `~/.switchboard/providers.json` and its schema.
4. Compression: is it a proxy feature we just toggle, or client work?

## 5. Agentic Routing Engine (ROADMAP Block 0b)

Separate Rust/Go product (task-graph engine, dispatcher, quality-gate runner,
gRPC, multi-node). Out of scope for the Electron app.

**Questions:** language (Rust vs Go)? Is there an existing skeleton/repo? Is the
gRPC contract drafted? Until these exist, Switchboard work is limited to staying
a thin client behind a stable gRPC API.

## 6. `--channels` (Telegram/Discord) + permission relay (FULL-AUDIT #2/#4)

**Questions:** which providers first? Where do bot tokens/webhooks live and how
are they secured? For permission relay: approve/deny by reply only, or richer
control? Mobile target?

## 7. Ant-colony multi-monitor layout (ROADMAP Block 0)

Large layout engine spanning monitors.

**Questions:** is this wanted before the agentic layer exists (it's most useful
*with* swarms)? Acceptable to require manual window placement for v1, or must the
layout engine auto-detect monitors and span frameless windows from the start?

---

## 8. Smaller deferred items (need a small decision, not a system)

| Item | Source | Question |
|------|--------|----------|
| Peers broker auth | FULL-AUDIT P #3 | Token in settings, or OS-keychain? Localhost-only or LAN too? |
| `--channels` MRU / notification history drawer | FULL-AUDIT #7 | Persist notifications in SQLite — keep how many / how long? |
| Dark/**light** theme | FULL-AUDIT #10 | Is a light theme actually desired given the "Terminal Noir" philosophy? If yes, supply/approve a light palette. |
| Worktree sparse-checkout UI | FULL-AUDIT #3 | What's the desired UX for choosing sparse paths? |
| Session comparison (side-by-side diff) | FULL-AUDIT #6 | Diff raw JSONL, or normalized messages? Same-CLI only or cross-CLI? |
| Project dashboard (cost charts) | FULL-AUDIT #9 | Depends on token data we have; confirm desired charts/metrics. |
| Module decomposition (peers.js, terminals.js, …) | PLAN Phase 6 | Pure refactor — safe but churny; do it now or after the agentic layer stabilizes? |

> Note: **agents extraction** from PLAN Phase 6 is already done (`agent-history.js`).

---

## Suggested ordering once unblocked

1. Answer the **proxy** questions (#4) — it underpins MACS, escalation, telemetry.
2. Decide the **observability** architecture (#1) — highest user-stated value and
   builds directly on the card/session work already shipping.
3. Then MACS (#2 → #3), channels (#6), and finally the routing engine (#5) /
   ant-colony (#7).
