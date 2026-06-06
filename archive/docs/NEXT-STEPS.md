# Switchboard — Next Steps Toward the Agentic Vision

> **Date:** 2026-06-04
> Written after completing `MULTI-PHASE-PLAN.md` (Phases 1–4). This maps the road
> from today's **multi-CLI command center** to the user's stated goal: an
> **agentic management & deployment platform** with cross-CLI observability
> (Disler's `pi-agent-observability` model).

---

## What shipped in this pass

- **Crash fix:** `safeSend` hoisted to module scope (session-cache /
  session-transitions / mcp-bridge) + regression test.
- **Focus CLIs:** codex, antigravity, pi, kilo, opencode mined for history and
  shown in their own toolbars (claude already worked); `agent-history.js`
  extracted + tested.
- **Project-centric cards (Phase 2/3):** one card per project, running sessions
  expanded, dormant sessions in a pulldown; card shows full path, last-modified
  file time, per-CLI color, git branch (switchable), dirty/ahead badges, a
  **⇩ pull** signifier when the cloud is ahead, and a throttled "check remote".
- **Backend (Phase 1):** async `git-utils.js` (branch/ahead/behind, checkout,
  fetch, ff-pull, last-modified) + IPC, all unit-tested.
- **Hardening (Phase 4):** restored file-read sandbox w/ symlink resolution,
  restored session-activity watchers + exit cleanup, MCP diff timeout, settings
  validation, agent-stats error detail.

All 15 unit tests green. GUI not bootable in CI (node-pty headers blocked, 403) —
**needs local confirmation by the user.**

---

## The critical path to the vision

The vision has two pillars: **(A) observability** (see every tool call across
every CLI) and **(B) orchestration** (plan → dispatch → gate → deploy). A is the
prerequisite — you cannot manage a swarm you cannot see. Build A first; it reuses
everything the card work just established (per-session identity, per-CLI color,
git/project context).

### Milestone 1 — Observability foundation (recommended next)

Turn the just-restored `session-activity` stream into a persisted, queryable
event log aligned with Disler's `ObsEvent` schema.

1. **Decide architecture** (blocked — see `future-plan.md §1 Q1/Q2`): native
   ingest in the Electron main process reusing better-sqlite3 (recommended) vs.
   running Disler's Bun server as a sidecar.
2. **Schema + table.** Add an `obs_events` table: `(session_id, seq, ts, kind,
   agent, cwd, payload_json)`, unique on `(session_id, seq)` (idempotent ingest).
3. **Two event sources:**
   - *Hook-based* (high fidelity) for Claude + Pi via their hook APIs → the
     existing `/session-event` HTTP endpoint, normalized to `ObsEvent`.
   - *JSONL-derived* (lower fidelity) for codex/antigravity/kilo/opencode by
     promoting `classifyActivityLine()` (added in Phase 4) into full `ObsEvent`s.
4. **Timeline view.** A per-session timeline panel (reuse the conversation viewer
   surface) rendering tool_call/tool_result/error with the per-CLI colors. Add a
   fleet "pulse" later.
5. **Retention** policy (cap rows/age) — `future-plan.md §1 Q5`.

This is buildable largely without new external systems once Q1/Q2 are answered.

### Milestone 2 — Proxy integration (unblocks orchestration economics)

Everything agentic (model routing, escalation, cost telemetry, compression)
depends on the proxy. **It is fully blocked on facts** — get the answers in
`future-plan.md §4` (where the proxy lives, its API, telemetry endpoint, config
path) before writing any code. Smallest first step once known: a model-selector
in the session-launch dialog that routes through the proxy + a per-session cost
badge fed by proxy telemetry (we already render token/cost data).

### Milestone 3 — Orchestrator + Council (MACS Block 0)

With observability (M1) feeding state and the proxy (M2) routing models, build
the deliberative decompose→dispatch→gate loop. Blocked on `future-plan.md §2/§3`
(which agent runtime, Speckit availability, plan/spec storage, approval model,
test-runner contract). The existing scheduler is the natural canvas for the plan
graph + swarm task board.

### Milestone 4+ — Scale-out

Ant-colony multi-monitor layout (Block 0 tail) and the Rust/Go routing engine
(Block 0b) are large and partly a *separate product*; defer until M1–M3 prove the
experience. See `future-plan.md §5/§7`.

---

## Immediate, unblocked engineering tasks (safe to pick up now)

These need no further direction and complement what shipped:

1. **Viewport-aware card enrichment.** `enrichProjectCards()` currently fetches
   metadata for every rendered project; switch to an IntersectionObserver so only
   visible cards call `get-project-meta` (matters with many projects).
2. **Session export JSONL/JSON + context-menu trigger** (FULL-AUDIT FR-06.2/3/5).
3. **Command-palette MRU ordering** (FR-07.5) and **lazy-load >500 messages**
   in the viewer (FR-01.7).
4. **Frontend polish from IMPROVEMENTS:** F6 loading skeleton, F7 aria-labels,
   F8 search debounce, F9 focus-visible, F14 copy toast, F16 sidebar count.
5. **Module decomposition** (PLAN Phase 6): peers.js / terminals.js / settings.js
   extraction (agents.js already done) — reduces `main.js` risk before the
   agentic subsystems land.
6. **Adjustable branch UX nicety:** show remote-tracking branches and a "create
   branch" action in the card branch dropdown.

---

## Open decisions blocking the big rocks

See `/future-plan.md` for the full list. The three that gate the most value:

1. **Observability architecture** — native vs. sidecar; event source for
   non-hook CLIs (§1).
2. **Proxy location + API** — everything economic/agentic depends on it (§4).
3. **Agent runtime + Speckit availability** for the orchestrator/council (§2).

Answer these three and Milestones 1–3 become fully actionable.
