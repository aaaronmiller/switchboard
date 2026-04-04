# Switchboard — Implementation Roadmap

> Remaining features organized by complexity and association.
> Each **block** groups tightly-related features that share code paths, state, or UI surface area.
> Implement blocks top-to-bottom; implement features within a block in listed order.

---

## Block 0 — Orchestrator, Proxy Integration & Token Compression (Extra-Large)

Three subsystems. The proxy is already **functional and complete** as a standalone service — this block is about integrating it into Switchboard, building the orchestrator on top, and adding the compression layer at the I/O boundary.

### Proxy Integration (already built — just needs wiring)

| Feature | Size | Description |
|---------|------|-------------|
| **Proxy Integration** | `[L]` | The proxy already works standalone — arbitrary model routing across any provider (OpenAI, Anthropic, Google, local). Just needs: (1) IPC bridge from Switchboard sessions to proxy, (2) model selector UI in session config, (3) proxy config stored in `~/.switchboard/providers.json`. No proxy code to write — just integration. |
| **Proxy Telemetry Reporting** | `[M]` | The proxy already tracks tokens, costs, latency per request. Needs: (1) telemetry endpoint Switchboard can poll/subscribe to, (2) display per-session in sidebar (token count, cost, model badge), (3) aggregate view in stats tab. |
| **Model Fallback Chain** | `[S]` | If the proxy supports retry-on-error (or can be extended), configure fallback chains per session: `sonnet-4 → gpt-4o → haiku`. Stored in provider config. |

### Orchestrator Layer (new)

| Feature | Size | Description |
|---------|------|-------------|
| **Orchestrator Core** | `[XL]` | New subsystem that sits above all running sessions and maintains a real-time state model of every active agent. Tracks: session health, current task, progress %, last tool call, error state, token burn rate, git status. Exposes `orchestrator.getState()` returning a snapshot of all sessions. UI: new "Orchestrator" sidebar tab showing live state of every running session across all agents. |
| **Hook-Based Status Reporting** | `[L]` | Leverages the existing PostToolUse hook mechanic: when any agent executes a tool, the hook fires an HTTP event to Switchboard. The orchestrator subscribes to these events and builds a live state machine per session. Extends beyond tool events — adds heartbeat pings, task completion signals, error detection. New IPC: `orchestrator-subscribe`, `orchestrator-unsubscribe`, `orchestrator-get-state`. |
| **Cross-Session Coordination** | `[L]` | Orchestrator can detect when sessions are working on related tasks (same project path, shared file references). Offers suggestions: "Session A just modified `api.py` — Session B is reviewing `test_api.py`, want to notify?" Enables manual or automatic task delegation between agents. |
| **Mission Control Dashboard** | `[L]` | Visual overlay showing all active sessions as cards with live-updating status: running/stuck/error/idle, current step, progress bar, last tool used, token burn rate (from proxy telemetry). Auto-refreshes every 1s from orchestrator state. Clicking a card opens that session. `dep: Orchestrator Core, Hook-Based Status, Proxy Telemetry` |

### Dynamic Compression (new)

| Feature | Size | Description |
|---------|------|-------------|
| **Input Compression** | `[XL]` | Before user prompts reach the LLM, they pass through a compression layer that removes redundancy, compresses boilerplate, and strips non-essential formatting while preserving semantics. Target: **70-80% token reduction** on typical developer input. Uses a combination of: AST-aware code dedup, semantic text compression, context window optimization. Integrates at the proxy intercept point — compressed requests go through the existing proxy, so no new routing code needed. Compressed input is transparently decompressed in the response for display. |
| **Output Compression** | `[L]` | Terminal output and LLM responses are compressed before being sent back to the session context. Removes: repeated boilerplate, redundant error messages, verbose stack traces (summarized to root cause), duplicate imports. Preserves: code changes, decisions, key findings. Target: **70-80% token reduction** on output. |
| **Compression Config** | `[M]` | Per-session compression settings: off / light (preserve structure, compress whitespace) / aggressive (semantic compression) / custom regex rules. Compression ratio displayed per message ("saved 73% tokens"). Toggle in session config. Settings persist in `~/.switchboard/compression.json`. |
| **Fidelity Verification** | `[M]` | Post-compression quality check: decompress and diff against original, flag low-confidence compressions for user review. Compression ratio + fidelity score logged per message. Adaptive: if fidelity drops below threshold for a session, auto-reduce compression aggressiveness. |

### Implementation Order

```
1. Proxy Integration          → wire up existing proxy to Switchboard sessions
2. Proxy Telemetry Reporting  → surface token/cost/model data in UI
3. Hook-Based Status Reporting → feeds orchestrator from existing hook mechanic
4. Orchestrator Core           → state machine + hook ingest
5. Input Compression           → biggest token savings first (proxy intercept point)
6. Output Compression          → second half of savings
7. Model Fallback Chain        → reliability on top of proxy (if supported)
8. Cross-Session Coordination  → orchestrator intelligence
9. Compression Config          → user control
10. Fidelity Verification      → quality assurance
11. Mission Control Dashboard  → visual interface combining all three layers
```

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Switchboard UI                          │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │ Session  │  │ Orchestrator │  │  Mission Control   │    │
│  │ Config   │  │   Dashboard  │  │                    │    │
│  └────┬─────┘  └──────┬───────┘  └──────────┬─────────┘    │
│       │               │                      │              │
└───────┼───────────────┼──────────────────────┼──────────────┘
        │               │                      │
        ▼               ▼                      ▼
┌───────────────────────────────────────────────────────────┐
│              Proxy (ALREADY FUNCTIONAL)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │   Provider   │  │    Model     │  │   Compression    │ │
│  │   Routing    │  │   Fallback   │  │     Engine       │ │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘ │
└─────────┼─────────────────┼───────────────────┼───────────┘
          │                 │                   │
          ▼                 ▼                   ▼
┌──────────────┐  ┌─────────────────┐  ┌───────────────┐
│  Anthropic   │  │    OpenAI       │  │    Ollama /   │
│  Claude API  │  │    GPT API      │  │  Local LLM    │
└──────────────┘  └─────────────────┘  └───────────────┘

                    ▲
  Hook Events ──────┤ (PostToolUse → HTTP → Orchestrator)
  (tool calls,      │
   heartbeats,      │
   errors)          │
```

**Estimated total:** ~1500 lines (proxy integration is ~200 lines, the rest is orchestrator + compression).

**External dependencies:**
- Proxy service running and accessible (already functional standalone)
- PostToolUse hook installed in agent configs (already done for Claude Code)

---

## Legend

| Symbol | Meaning |
|--------|---------|
| `[S]`  | Small — under 100 lines, isolated change |
| `[M]`  | Medium — 100-300 lines, touches 2-3 files |
| `[L]`  | Large — 300+ lines, new subsystem or cross-cutting |
| `[XL]` | Extra-large — external integration, new IPC surface |
| `dep:` | Depends on another feature being present first |

---

## Block 1 — Resilience & Health (Medium complexity)

All four features share the same foundation: **reading terminal output buffers and reacting to patterns**. The output buffer infrastructure already exists (`schedulerOutputBuffers`, `feedOutputBuffer`, `waitForOutput`). This block extends it from "wait then continue" to "watch continuously and act."

| # | Feature | Size | Description |
|---|---------|------|-------------|
| 23 | **Retry on Failure** | `[S]` | Add `retryPattern` (regex), `retryMax` (int), `retryDelay` (seconds) fields to command steps. On output match after send, re-send up to N times. Piggybacks on existing `waitForOutput`. |
| 32 | **Error Detection Watcher** | `[M]` | Background process that continuously tests output against user-defined error regexes (per-session or global). On match: flash session badge, optional auto-abort of running scheduler, optional branch to error-handler steps. Needs a new `errorPatterns[]` config in scheduler state + a persistent `setInterval` watcher. |
| 33 | **Session Health Monitor** | `[M]` | Tracks `lastOutputTimestamp` per session. If no output for configurable threshold (default 60s), classifies state: `idle` / `stuck` / `error` / `finished`. Actions: inject nudge command, notify user via toast, auto-abort. Shares the error watcher's interval loop — implement as a single `healthTick()` function. |
| — | **Agent-State-Aware Send (WAIT_FOR_IDLE)** | `[S]` | New step type or per-step toggle: before sending a command, poll target session's output buffer for an "idle signature" regex (default: shell prompt pattern `\$\s*$`). Prevents flooding an agent mid-thought. Reuses `waitForOutput` with a pre-send hook. `dep: 33` |

**Implementation order:** 23 → 32 → 33 → WAIT_FOR_IDLE

**Shared code:** All four use `schedulerOutputBuffers` and regex matching. Feature 32 and 33 share a single `setInterval` health loop. WAIT_FOR_IDLE is a thin wrapper around `waitForOutput` called before `pty.write`.

**Files touched:** `scheduler.js` (execution engine, new step type), `style.css` (health indicator badges), `app.js` (health badge in session header).

**Estimated total:** ~400 lines

---

## Block 2 — Pattern System Enhancement (Low-Medium complexity)

These features extend the pattern authoring, storage, and invocation experience. They share the pattern data model and the scheduler overlay UI.

| # | Feature | Size | Description |
|---|---------|------|-------------|
| 5 | **Quick Send** | `[S]` | Right-click context menu or keyboard shortcut on any terminal: opens a mini-dialog (text input + session checkboxes). Sends one command immediately without opening full scheduler. Standalone function, no scheduler state needed. |
| 31 | **YAML/CSV Import** | `[S]` | Add YAML and CSV parsers alongside existing JSON and simple-text import. YAML maps naturally to the step schema. CSV: `type,value,targets,timeout` columns. Add format detection in load handler. |
| 25 | **Nested Patterns (Includes)** | `[M]` | New step type `include` with `patternName` field. At execution time, resolve from built-in library or user directory, inline the steps, then continue. Needs cycle detection (max depth 5). `dep: pattern library (done)` |
| 30 | **Matrix Expansion** | `[M]` | Pattern declares a `matrix` object (e.g., `{ "feature": ["auth", "api", "ui"] }`). Before execution, expand: clone the step list N times, each with different variable bindings. UI shows expansion preview. Inspired by GitHub Actions matrix. `dep: variables (done)` |
| — | **Pattern Versioning + Git Storage** | `[M]` | Store patterns in `.switchboard/patterns/` in project root (not just `~/.switchboard/`). On save, auto-stage the file. Patterns become part of git history — shareable via PR. New IPC: `scheduler-save-to-project` / `scheduler-list-project-patterns`. |

**Implementation order:** 5 → 31 → 25 → 30 → Git Storage

**Shared code:** Features 25, 30, and Git Storage all extend the pattern load/save pipeline. Quick Send is standalone but reuses `window.api.sendInput`.

**Files touched:** `scheduler.js` (new step type, matrix logic), `main.js` (new IPC for project patterns), `preload.js` (bridge), `app.js` (Quick Send dialog, context menu).

**Estimated total:** ~500 lines

---

## Block 3 — Visualization & Analytics (Medium complexity)

These three features are all **read-only UI overlays** that consume execution data. They share an event log data structure that the scheduler engine emits into during runs.

| # | Feature | Size | Description |
|---|---------|------|-------------|
| 6 | **Execution History (enhance)** | `[S]` | `schedulerHistory[]` already exists in memory. Add: persist to localStorage, render as a collapsible list in the scheduler panel footer (pattern name, timestamp, duration, outcome, step count). Clickable to re-load that pattern. |
| 27 | **Execution Timeline** | `[L]` | Canvas or SVG timeline rendered in a new overlay tab during/after runs. X-axis = time, Y-axis = sessions. Each step is a colored bar (command=blue, wait=amber, etc.) placed on its target session's row. Shows duration, overlap, gaps. Needs an `executionLog[]` event stream: `{ stepIndex, sessionId, type, startMs, endMs, outcome }`. |
| 28 | **Live Dashboard** | `[L]` | "Mission control" overlay during multi-session runs. Per-session card showing: last 3 lines of output, current step name, progress %, health status. Auto-refreshes from output buffers + scheduler state. Can coexist with timeline as tabs. `dep: 27 (shares event log), 33 (health data)` |
| — | **Workflow Analytics** | `[M]` | Post-run analytics: pattern success rate, average duration, cost per pattern (when proxy integration exists), common failure points. Stored in localStorage or SQLite. Rendered as a settings-panel section. `dep: 6 (history data)` |

**Implementation order:** 6 (enhance) → 27 → 28 → Analytics

**Shared code:** All four consume `executionLog[]` events. Timeline and Dashboard are tabs in the same overlay. Analytics aggregates history.

**Files touched:** `scheduler.js` (event emission, history persistence), `style.css` (timeline/dashboard CSS), new file `public/scheduler-timeline.js` if >300 lines.

**Estimated total:** ~800 lines

---

## Block 4 — Automation & External Integration (Medium-High complexity)

These features make the scheduler triggerable and reactive beyond manual UI interaction. They share a need for an event bus or hook system.

| # | Feature | Size | Description |
|---|---------|------|-------------|
| 26 | **Event-Triggered Patterns** | `[M]` | Define triggers: `on-session-start`, `on-session-exit`, `on-file-change` (via fs.watch), `on-time` (cron-like). When trigger fires, auto-load and run a pattern. Config stored in `~/.switchboard/triggers.json`. Needs new IPC for trigger CRUD. |
| — | **HTTP Pattern Trigger API** | `[L]` | Local Express/http server (or Electron protocol handler) exposing `POST /api/patterns/run` with pattern name + variables + session mapping. Returns `run_id` + status endpoint. Enables CI/CD integration, external scripts, and inter-tool automation. New file: `scheduler-api.js` in main process. |
| — | **Cross-Session Context Relay** | `[M]` | New step type: `relay`. Reads last N lines from source session's output buffer, injects as command text into target session. Enables pipeline patterns: "take builder's output, feed to reviewer." Uses existing output buffers. `dep: per-step targets (done)` |

**Implementation order:** Context Relay → Event Triggers → HTTP API

**Shared code:** Event triggers and HTTP API both need a `runPatternByName(name, vars, sessions)` function — extract from `openScheduler`/`runScheduler`. Context Relay extends the step execution engine.

**Files touched:** `scheduler.js` (relay step, pattern-run extraction), `main.js` (event triggers, HTTP server), `preload.js` (trigger bridge).

**Estimated total:** ~600 lines

---

## Block 5 — Proxy Telemetry Extensions (High complexity)

**Note:** Core proxy functionality (model routing, provider abstraction, compression) is now in **Block 0**. This block covers extensions that build on top of the proxy layer.

| Feature | Size | Description |
|---------|------|-------------|
| **Cost Attribution Engine** | `[XL]` | Real-time token counting from proxy telemetry. Per-session, per-pattern, per-model cost calculation. Dashboard widget showing spend by session, pattern, and model. `dep: Block 0 Proxy Layer` |
| **Compression Fidelity Metrics** | `[M]` | Read compression stats (ratio, quality score) from Block 0 compressor. Display per-session compression ratio. Alert when fidelity drops below threshold. `dep: Block 0 Compression` |
| **Security Filtering Layer** | `[M]` | Configurable regex rules in proxy: redact API keys, passwords, PII before they reach the LLM. Audit log of all redactions. UI in Switchboard settings to manage filter rules. `dep: Block 0 Proxy Layer` |

**Implementation order:** Cost Attribution → Security Filtering → Compression Metrics

**Estimated total:** ~600 lines (extensions on top of Block 0's ~2000 lines)

---

## Block 6 — Advanced & Future (High complexity, speculative)

Lower priority features that become valuable once Blocks 1-5 are solid.

| # | Feature | Size | Description |
|---|---------|------|-------------|
| 29 | **Pattern Sharing** | `[M]` | Export patterns as GitHub Gist links or raw URLs. Import from URL. Community pattern discovery. `dep: Git Storage (Block 2)` |
| — | **Agent-to-Agent Protocol** | `[L]` | Formal message format: `{ from, to, type, payload, requiresResponse }`. Structured coordination beyond raw command injection. Extends existing peer messaging. |
| — | **Checkpoint / Rollback** | `[L]` | Snapshot agent context at a point in time. Rollback to known-good state. Branch from checkpoint to try different approaches. Needs proxy cooperation for context capture. |
| — | **Multi-Project Support** | `[L]` | Manage agents across multiple codebases simultaneously. Cross-project patterns: "when frontend changes API calls, notify backend agent." Extends session model with project association. |
| — | **Collaboration / Multi-User** | `[XL]` | Team sharing of a Switchboard instance. Role-based permissions. Shared pattern libraries. WebSocket-based state sync. |

**Implementation order:** Pattern Sharing → Agent Protocol → Checkpoint → Multi-Project → Collaboration

---

## Summary — Execution Order

| Phase | Block | Features | Est. Lines | Complexity |
|-------|-------|----------|------------|------------|
| **NOW** | 0. Orchestrator+Proxy+Compression | Orchestrator, Proxy, Compression (12 features) | ~2000+ | XL |
| **Next** | 1. Resilience | Retry, Error Watcher, Health Monitor, WAIT_FOR_IDLE | ~400 | Medium |
| **Next** | 2. Patterns | Quick Send, YAML/CSV, Nested, Matrix, Git Storage | ~500 | Low-Medium |
| **Then** | 3. Visualization | History+, Timeline, Dashboard, Analytics | ~800 | Medium |
| **Then** | 4. Automation | Context Relay, Event Triggers, HTTP API | ~600 | Medium-High |
| **Later** | 5. Proxy Telemetry | Cost Attribution, Security Filtering, Fidelity | ~600+ | High |
| **Future** | 6. Advanced | Sharing, Protocol, Checkpoint, Multi-Project, Collab | ~1500+ | High-XL |

**Total remaining:** ~7,000+ lines across all blocks.

---

## Dependencies Graph

```
Block 0: Orchestrator + Proxy + Compression
  Provider Abstraction ──────┐
  Arbitrary Model Routing ───┤── Proxy Layer ──┐
  Hook-Based Status ─────────┤                 │
  Orchestrator Core ─────────┤                 │
  Input Compression ─────────┤─── Compression ─┤
  Output Compression ────────┘                 │
  Model Fallback Chain ───── Proxy Layer ──────┤
  Cross-Session Coordination Orchestrator ─────┤
  Compression Config ──────── Compression ─────┤
  Cost-Aware Routing ──────── Proxy+Orch ──────┤
  Fidelity Verification ───── Compression ─────┤
  Mission Control Dashboard ─ Orchestrator ────┘
                                                 │
Block 1: Resilience                              │
  23 Retry ──────────────────────────────────┐   │
  32 Error Watcher ──┐                       │   │
  33 Health Monitor ─┤── shared health loop   │   │
  WAIT_FOR_IDLE ─────┘   dep: 33             │   │
                                             │   │
Block 2: Patterns                            │   │
  5  Quick Send (standalone)                 │   │
  31 YAML/CSV (standalone)                   │   │
  25 Nested Patterns ─── dep: library (done) │   │
  30 Matrix Expansion ── dep: variables (done)│  │
  Git Storage (standalone)                   │   │
                                             │   │
Block 3: Visualization                       │   │
  6  History enhance (standalone)            │   │
  27 Timeline ──────── dep: executionLog     │   │
  28 Dashboard ──────── dep: 27, 33 ────────┘   │
  Analytics ─────────── dep: 6                  │
                                                │
Block 4: Automation                             │
  Context Relay (standalone)                    │
  26 Event Triggers ── dep: runPatternByName    │
  HTTP API ─────────── dep: runPatternByName    │
                                                │
Block 5: Proxy Telemetry                        │
  Cost Attribution ─── dep: Block 0 Proxy ──────┘
  Compression Metrics ─ dep: Block 0 Compression
  Security Filtering ── dep: Block 0 Proxy

Block 6: Advanced
  29 Sharing ────────── dep: Git Storage
  Agent Protocol ────── dep: peer messaging
  Checkpoint ────────── dep: Block 0 Proxy
  Multi-Project ─────── dep: session model
  Collaboration ─────── dep: everything
```

---

## Notes

- **Block 0 is the priority** — Orchestrator, Proxy, and Compression are the next features to build.
- **Block 1 and 2 can be developed in parallel** — they share no dependencies.
- **Block 3 depends on Block 1** (health data for dashboard) but can start with Timeline independently.
- **Block 4 depends on having a `runPatternByName` extraction** — do this refactor first.
- **Block 5 builds on Block 0** — requires proxy layer to exist before telemetry extensions.
- **Block 6 is speculative** — prioritize based on user demand and competitive pressure.
- **Never deploy on a Friday.** The variable names have power. The sea remembers.
