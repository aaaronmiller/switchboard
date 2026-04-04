# Switchboard — Implementation Roadmap

> Remaining features organized by complexity and association.
> Each **block** groups tightly-related features that share code paths, state, or UI surface area.
> Implement blocks top-to-bottom; implement features within a block in listed order.

---

## Block 0 — MACS Integration: The Synthetic Cortex (Extra-Large)

**The killer differentiator.** While every other AI coding tool goes kanban-board or hands-off git-worktree, Switchboard is the **command center for a biomimetic cognitive architecture** — the MACS (Monitoring Agentic Swarms) system built on the Context-Injected Orchestration (CIO) Pattern. Three-layer topology: **Prime → Council → Swarm**. File-system shared memory. Quality gates. Cheap models doing grunt work, verified by tests. The user stays in COMMAND, not control — gives one objective, approves the plan once, watches the ant colony work.

### The MACS Architecture (Prime → Council → Swarm)

| Layer | Role | Implementation |
|-------|------|---------------|
| **Prime Orchestrator** | The "Ego" — holds identity, integrates outputs, narrates progress | CLAUDE.md + speckit spec/plan generation. One approval from user, then autonomous execution. |
| **Council** | The "Sub-Personalities" — Architect, Decomposer, QA, Security, Performance, Cost, Devil's Advocate. Debate the plan, validate specs. | Deliberative council (like deliberative-refinement skill): 6-8 specialist agents, 3 rounds of critique. Produces: spec.md, plan.md, tasks.md with dependency graph. |
| **Swarm** | The "Automatic Processes" — parallel stateless agents executing individual tasks. Cheap models by default, auto-escalate when stuck. | Speckit tasks → spawned as parallel sessions. Each gets focused prompt + file context + tool access. Returns result to shared memory. |

### Quality Gates (TDD + Speckit Enforcement)

| Feature | Size | Description |
|---------|------|-------------|
| **Gated Specs (Speckit Constitution)** | `[L]` | Before any code is written, the QA council member generates a constitution.md (project principles), spec.md (WHAT/WHY), and test suites. Speckit's built-in quality gates validate: no implementation details in specs, all ambiguities resolved, constitution alignment checked. `dep: Council` |
| **Test-First Dispatch** | `[XL]` | Every task in the plan ships with tests. Swarm dispatches cheap models to implement, but **code only lands if tests pass**. Even a weak model produces working code as long as the gate validates it. Workflow: (1) QA writes tests (smart model), (2) cheap model implements, (3) run tests, (4) pass → merge, fail → retry with feedback or escalate. `dep: Gated Specs, Swarm Dispatch` |
| **Continuous Verification Loop** | `[L]` | After code lands, run: lint → type-check → integration tests → smoke test. If anything breaks, create a fix task and dispatch it. Loop runs until green. User sees live verification pipeline: ✓ unit ✓ integration ◐ smoke. `dep: Test-First Dispatch` |

### Swarm Execution & Model Economics

| Feature | Size | Description |
|---------|------|-------------|
| **Swarm Dispatch** | `[XL]` | Execute the plan by spawning parallel agent sessions. Each task gets: focused prompt (from tasks.md), file context (shared memory via filesystem), tool access (MCP + bash), model assignment (cheap by default). Live task board: green ✓ done, blue ◐ running, red ✗ failed, grey ○ queued. `dep: Plan Decomposition` |
| **Self-Service Model Escalation** | `[M]` | Any sub-agent can request model upgrade via proxy. When stuck (loop detection, repeated failures, or agent explicitly asks): `haiku → sonnet-4 → opus`. When a smart model finishes quickly with high confidence, suggests downgrading for similar tasks. Surface in UI: "Session 3 upgraded haiku → sonnet-4: stuck on regex." `dep: Proxy Integration` |
| **Cross-Agent Coordination** | `[L]` | Prime detects when swarm agents conflict (same file, circular deps) and intervenes: pause one, redirect, or merge. File-system lock prevents simultaneous writes to same file. Enables: "Agent A builds API, Agent B writes tests, Agent C reviews — C waits for A and B." `dep: Swarm Dispatch, Hook-Based Status` |
| **Model Fallback Chain** | `[S]` | Configure fallback per session: `sonnet-4 → gpt-4o → haiku`. Auto-retry on rate limit or error. Stored in provider config. `dep: Proxy Integration` |

### Proxy Integration & Compression (infrastructure)

| Feature | Size | Description |
|---------|------|-------------|
| **Proxy Integration** | `[L]` | Proxy already works standalone — arbitrary model routing across any provider. Needs: (1) IPC bridge from Switchboard to proxy, (2) model selector UI in session config, (3) `~/.switchboard/providers.json` config. No proxy code to write — just wiring. |
| **Proxy Telemetry Reporting** | `[M]` | Proxy already tracks tokens, costs, latency per request. Needs: (1) telemetry endpoint Switchboard polls/subscribes to, (2) display per-session in sidebar (token count, cost, model badge), (3) cost-per-task attribution for swarm runs. |
| **Input/Output Compression** | `[L]` | 70-80% token reduction on prompts and responses. Integrates at proxy intercept point — compressed requests through existing proxy, no new routing code. Per-session config with ratio badges. Target: slash costs on swarm runs where cheap models process large contexts. |

### Shared Memory & Status Reporting

| Feature | Size | Description |
|---------|------|-------------|
| **File-System Shared Memory** | `[L]` | The MACS architecture uses the filesystem as "long-term memory" between agents. Each swarm agent writes results to `specs/NNN-task-name/output.md`. The Prime reads all outputs to synthesize the final result. File-system locks prevent write conflicts. This is the **continuity of self** that survives individual agent death. `dep: Swarm Dispatch` |
| **Hook-Based Status Reporting** | `[L]` | PostToolUse hook fires HTTP events to the Prime when any agent executes a tool. This is the council's real-time eyes. Extends beyond tool events: heartbeat pings, task completion signals, error detection. IPC: `orchestrator-subscribe`, `orchestrator-unsubscribe`, `orchestrator-get-state`. |

### The UI Challenge: Displaying Everything Cleanly

The hardest part isn't the code — it's **displaying a deliberative council, a swarm of agents, their test results, model escalations, and the verification pipeline** without overwhelming the user.

**Design principles:**
1. **Progressive disclosure** — Top-level: "Building auth API: 3/7 tasks done, $0.42 so far." Click → task graph. Click task → council deliberation, agent output, test results.
2. **Color by state, not by type** — Green = passing, yellow = in-progress, red = failing, grey = queued. One language across tasks, tests, agents, pipeline stages.
3. **Cost always visible** — Top-right: "$0.42 · 84k tokens · haiku(3), sonnet(1)."
4. **User stays in COMMAND** — One approval (the plan), then autonomous. Override any model, skip any task, merge any branches. Command means setting objectives and constraints. Control means touching every lever.
5. **The scheduler is the canvas** — Existing scheduler UI becomes the orchestrator's interface. No new panel — richer view of the same data.

### Multi-Monitor Scaling: The Ant Colony View

**The goal:** 49" ultrawide + three 27" monitors. Every agent session visible at once — like watching an ant colony work. Nothing hidden behind tabs. Nothing clipped.

**Three scaling modes:**

| Mode | Use case | Behavior |
|------|----------|----------|
| **Contained** | Laptop, single monitor | All features in the sidebar. Terminal panel switches between sessions. |
| **Detached** | Two monitors | Pop sessions into independent Electron windows. Manual arrangement. |
| **Ant Colony** | Three+ monitors | **Tiled layout engine** — all active agents tile across combined screen space. Each tile: live terminal (last 20 lines), task name, progress bar, model badge, cost ticker, test status. Auto-resize to fill. New agents → new tiles. Completed → fade half-opacity. Failed → flash red until acknowledged. |

**Ant Colony specifics:**
- **Adaptive grid** — detects total pixel dimensions, calculates optimal columns × rows
- **Per-tile density control** — click to expand 2×2 or 4×4, pin to lock size
- **Session minimization** — idle agents shrink to 30px: "✓ Session 3 · haiku · auth tests · $0.02"
- **Global status bar** — thin top bar: total cost, tokens, running/queued/failed, swarm phase
- **Cross-monitor spanning** — frameless fullscreen per monitor, seamless bezel flow
- **Zoom per panel** — each tile tracks independent font scaling

### Implementation Order

**Build the hands before the brain. Quality gates first, orchestration on top.**

```
1. Proxy Integration             → wire up existing proxy (foundation)
2. Proxy Telemetry Reporting     → surface token/cost/model data
3. Hook-Based Status Reporting   → PostToolUse → Prime event stream
4. File-System Shared Memory     → shared workspace for swarm agents
5. Gated Specs (Speckit)         → constitution, spec, tests before code
6. Test-First Dispatch           → cheap model implements, tests gate it
7. Swarm Dispatch                → parallel agent sessions per task
8. Self-Service Model Escalation → sub-agents request upgrades via proxy
9. Cross-Agent Coordination      → Prime resolves file conflicts, deps
10. Continuous Verification      → lint → test → smoke pipeline
11. Input/Output Compression     → 70-80% token reduction
12. Model Fallback Chain         → reliability on top of proxy
13. Council (Deliberative)       → Architect, Decomposer, QA, etc. — plan quality
14. Ant Colony Layout Engine     → multi-monitor tiling, adaptive grid
```

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Switchboard UI                           │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           MACS Orchestrator Panel                    │   │
│  │                                                      │   │
│  │  ┌───────────┐  ┌─────────────┐  ┌───────────────┐ │   │
│  │  │ Council   │  │   Plan      │  │    Swarm      │ │   │
│  │  │ (Prime +  │→ │   Graph     │→ │  Task Board   │ │   │
│  │  │  7 Roles) │  │  (editable) │  │  (live)       │ │   │
│  │  └───────────┘  └─────────────┘  └───────┬───────┘ │   │
│  │                                          │          │   │
│  │  ┌───────────────────────────────────────┤          │   │
│  │  │ Verification Pipeline                  │          │   │
│  │  │ spec → unit → integration → smoke     │          │   │
│  │  └───────────────────────────────────────┘          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  $0.42 · 84k tokens · haiku(3) sonnet(1)  ← always visible │
└──────────────────────────┬──────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
┌─────────────────┐ ┌──────────────┐ ┌──────────────────┐
│ Proxy (existing)│ │ Agent Session│ │  Test Runner     │
│ ┌─────────────┐ │ │ (per task)   │ │ (gate: pass/fail)│
│ │ Model Router│ │ │ haiku/sonnet │ │                  │
│ │ Fallback    │ │ │ auto-escalate│ │ unit/integration │
│ │ Compression │ │ │              │ │ smoke/lint       │
│ └──────┬──────┘ │ └──────────────┘ └──────────────────┘
│        │        │
└────────┼────────┘
         │
         ▼
┌──────────────┐  ┌────────────┐  ┌────────────┐
│  Anthropic   │  │   OpenAI   │  │  Ollama /  │
│  Claude API  │  │   GPT API  │  │  Local LLM │
└──────────────┘  └────────────┘  └────────────┘

  ▲
  │ Hook Events (PostToolUse → HTTP → Prime Orchestrator)
  │ Tool calls, heartbeats, errors, completion signals

┌─────────────────────────────────────────────────────────────┐
│           Ant Colony: Multi-Monitor Layout Engine           │
│                                                             │
│  ┌──────────┬──────────┬──────────┬──────────────────────┐  │
│  │ Agent 1  │ Agent 2  │ Agent 3  │ Agent 4 (expanded)  │  │
│  │ haiku    │ sonnet   │ haiku    │ opus (↑ from haiku) │  │
│  │ █████░░░ │ ████░░░░ │ ██████░░ │ ░░░░░░░░ (idle)     │  │
│  │ $0.04    │ $0.18    │ $0.02    │ $0.31               │  │
│  ├──────────┼──────────┼──────────┼──────────────────────┤  │
│  │ Agent 5  │ Agent 6  │ Council  │ Verification Pipe.   │  │
│  │ haiku    │ gpt-4o   │ deliber. │ ✓ unit ✓ integ       │  │
│  │ ██░░░░░░ │ █████░░░ │ thinking │ ◐ smoke              │  │
│  │ $0.01    │ $0.12    │          │ $0.42 total          │  │
│  └──────────┴──────────┴──────────┴──────────────────────┘  │
│                                                             │
│  Tiles auto-adapt to combined monitor resolution            │
│  Click to expand 2×2 or 4×4  ·  Pin to lock size            │
│  Idle → minimized (30px)  ·  Failed → flash red             │
└─────────────────────────────────────────────────────────────┘
```

**Estimated total:** ~3000 lines across orchestrator.js, council agents, plan graph UI, swarm dispatcher, TDD gate runner, proxy integration, compression, multi-monitor layout engine, and UI.

**External dependencies:**
- Proxy service running and accessible (already functional standalone)
- Speckit (github/spec-kit) installed — provides constitution, spec, plan, tasks, checklists
- PostToolUse hook installed in agent configs (already done for Claude Code)
- Test runner infrastructure (can use existing scheduler patterns + `waitForOutput`)

---

## Legend
│  │  │ Verification Pipeline                  │          │   │
│  │  │ spec → unit → integration → smoke     │          │   │
│  │  └───────────────────────────────────────┘          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  $0.42 · 84k tokens · haiku(3) sonnet(1)  ← always visible │
└──────────────────────────┬──────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
┌─────────────────┐ ┌──────────────┐ ┌──────────────────┐
│ Proxy (existing)│ │ Agent Session│ │  Test Runner     │
│ ┌─────────────┐ │ │ (per task)   │ │ (gate: pass/fail)│
│ │ Model Router│ │ │ haiku/sonnet │ │                  │
│ │ Fallback    │ │ │ auto-escalate│ │ unit/integration │
│ │ Compression │ │ │              │ │ smoke/lint       │
│ └──────┬──────┘ │ └──────────────┘ └──────────────────┘
│        │        │
└────────┼────────┘
         │
         ▼
┌──────────────┐  ┌────────────┐  ┌────────────┐
│  Anthropic   │  │   OpenAI   │  │  Ollama /  │
│  Claude API  │  │   GPT API  │  │  Local LLM │
└──────────────┘  └────────────┘  └────────────┘

  ▲
  │ Hook Events (PostToolUse → HTTP → Orchestrator)
  │ Tool calls, heartbeats, errors, completion signals

┌─────────────────────────────────────────────────────────────┐
│           Ant Colony: Multi-Monitor Layout Engine           │
│                                                             │
│  ┌──────────┬──────────┬──────────┬──────────────────────┐  │
│  │ Agent 1  │ Agent 2  │ Agent 3  │ Agent 4 (expanded)  │  │
│  │ haiku    │ sonnet   │ haiku    │ opus (↑ from haiku) │  │
│  │ █████░░░ │ ████░░░░ │ ██████░░ │ ░░░░░░░░ (idle)     │  │
│  │ $0.04    │ $0.18    │ $0.02    │ $0.31               │  │
│  ├──────────┼──────────┼──────────┼──────────────────────┤  │
│  │ Agent 5  │ Agent 6  │ Council  │ Verification Pipe.   │  │
│  │ haiku    │ gpt-4o   │ deliber. │ ✓ unit ✓ integ       │  │
│  │ ██░░░░░░ │ █████░░░ │ thinking │ ◐ smoke              │  │
│  │ $0.01    │ $0.12    │          │ $0.42 total          │  │
│  └──────────┴──────────┴──────────┴──────────────────────┘  │
│                                                             │
│  Tiles auto-adapt to combined monitor resolution            │
│  Click to expand 2×2 or 4×4  ·  Pin to lock size            │
│  Idle → minimized (30px)  ·  Failed → flash red             │
└─────────────────────────────────────────────────────────────┘
```

**Estimated total:** ~3000 lines across orchestrator.js, council agents, plan graph UI, swarm dispatcher, TDD gate runner, proxy integration, compression, multi-monitor layout engine, and UI.

**External dependencies:**
- Proxy service running and accessible (already functional standalone)
- PostToolUse hook installed in agent configs (already done for Claude Code)
- Test runner infrastructure (can use existing scheduler patterns + `waitForOutput`)

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
| **NOW** | 0. MACS Integration | Prime/Council/Swarm, TDD Gates, Proxy, Compression, Ant Colony (14 features) | ~3000+ | XL |
| **Next** | 1. Resilience | Retry, Error Watcher, Health Monitor, WAIT_FOR_IDLE | ~400 | Medium |
| **Next** | 2. Patterns | Quick Send, YAML/CSV, Nested, Matrix, Git Storage | ~500 | Low-Medium |
| **Then** | 3. Visualization | History+, Timeline, Dashboard, Analytics | ~800 | Medium |
| **Then** | 4. Automation | Context Relay, Event Triggers, HTTP API | ~600 | Medium-High |
| **Later** | 5. Proxy Telemetry | Cost Attribution, Security Filtering, Fidelity | ~600+ | High |
| **Future** | 6. Advanced | Sharing, Protocol, Checkpoint, Multi-Project, Collab | ~1500+ | High-XL |

**Total remaining:** ~7,500+ lines across all blocks.

---

## Dependencies Graph

```
Block 0: MACS Integration (Prime → Council → Swarm)
  Proxy Integration ─────────────────────────┐
  Proxy Telemetry ───────────────────────────┤
  Hook-Based Status ─────────────────────────┤
  File-System Shared Memory ─────────────────┤
  Gated Specs (Speckit) ─────────────────────┤
  Test-First Dispatch ── dep: Gated Specs    │
  Swarm Dispatch ────────────────────────────┤
  Self-Service Escalation ── dep: Proxy      │
  Cross-Agent Coordination ── dep: Swarm     │
  Continuous Verification ── dep: TDD Gates  │
  Input/Output Compression ── dep: Proxy     │
  Model Fallback Chain ──── dep: Proxy       │
  Council (Deliberative) ── dep: Speckit     │
  Ant Colony Layout Engine ──────────────────┤
                                             │
Block 1: Resilience                          │
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

- **Block 0 is the priority** — MACS (Prime → Council → Swarm) is the killer feature set. Built on the Context-Injected Orchestration pattern with filesystem shared memory, Speckit quality gates, and the proxy for model routing.
- **Block 1 and 2 can be developed in parallel** — they share no dependencies.
- **Block 3 depends on Block 1** (health data for dashboard) but can start with Timeline independently.
- **Block 4 depends on having a `runPatternByName` extraction** — do this refactor first.
- **Block 5 builds on Block 0** — requires proxy layer to exist before telemetry extensions.
- **Block 6 is speculative** — prioritize based on user demand and competitive pressure.
- **Never deploy on a Friday.** The variable names have power. The sea remembers.
