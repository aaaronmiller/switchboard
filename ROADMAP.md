# Switchboard + Agentic Routing Engine — Implementation Roadmap

> **Switchboard** is the **UI sketchbook** — the optimal environment for defining, testing, and iterating on the agentic experience. Electron + JS makes it exceptionally easy to add or change UI/UX choices in minutes. It's the canvas for painting what the orchestrator looks like, how the ant colony view feels, what information surfaces where. It's also the tool we use to *build* the lower-level router — we develop and test the experience inside Switchboard, then port the working logic to the engine.
>
> **The Agentic Routing Engine** is the real product — a K8s-like scheduler for cognitive work. Built in Rust or Go. Runs on a cluster. Scales to 1000s of concurrent agents. Switchboard becomes one thin client talking to it via gRPC.
>
> **Two-layer architecture:** Switchboard defines the experience. The engine scales it.

> Remaining features organized by complexity and association.
> Each **block** groups tightly-related features that share code paths, state, or UI surface area.
> Implement blocks top-to-bottom; implement features within a block in listed order.

---

## Block 0 — MACS Integration in Switchboard (UI Layer, ~50 session cap)

**The killer differentiator.** While every other AI coding tool goes kanban-board or hands-off git-worktree, Switchboard is the **command center for a biomimetic cognitive architecture** — the MACS (Monitoring Agentic Swarms) system built on the Context-Injected Orchestration (CIO) Pattern. Three-layer topology: **Prime → Council → Swarm**. File-system shared memory. Quality gates. Cheap models doing grunt work, verified by tests. The user stays in COMMAND, not control — gives one objective, approves the plan once, watches the ant colony work.

**Limits:** ~50 concurrent sessions on a single Electron instance. Single-threaded main process is the bottleneck. No clustering possible. This block delivers the full experience on a single machine. The routing engine (Block 0b) scales it beyond that.

### Orchestrator with Deliberative Council

| Feature | Size | Description |
|---------|------|-------------|
| **Orchestrator Agent** | `[XL]` | An AI agent that confers with a **deliberative council** (like the deliberative-refinement skill: 6-8 specialist agents running rounds of critique). When given a project goal ("build a REST API for user management"), the orchestrator + council break it down into elemental tasks, classify each as parallel or serial, identify dependencies, and produce a structured execution plan. The council roles: Architect (system design), Decomposer (task breakdown), QA (test strategy), Security (threat model), Performance (bottleneck prediction), Cost (model routing), and Devil's Advocate (what could go wrong). |
| **Hook-Based Status Reporting** | `[L]` | Leverages the existing PostToolUse hook mechanic: when any agent executes a tool, the hook fires an HTTP event to the orchestrator. This is the council's eyes — they see what every agent is doing in real-time. Extends beyond tool events to heartbeat pings, task completion signals, and error detection. New IPC: `orchestrator-subscribe`, `orchestrator-unsubscribe`, `orchestrator-get-state`. |
| **Plan Decomposition & Visualization** | `[L]` | The orchestrator's output plan is visualized as a task graph: nodes are tasks, edges are dependencies, colors encode parallel/serial. User can edit the plan before dispatch: merge tasks, split tasks, reorder, add/remove. The plan supports conditional branches ("if test fails, retry with upgraded model") and gates ("don't proceed to integration until unit tests pass"). `dep: Orchestrator Agent` |

### Agentic Swarm Execution

| Feature | Size | Description |
|---------|------|-------------|
| **Swarm Dispatch** | `[XL]` | Execute the plan by spawning parallel agent sessions. Each task gets its own agent instance with a focused prompt ("you are a test writer for the auth module — write tests for these endpoints: ..."). The scheduler already supports this — Block 0 extends it from manual patterns to orchestrator-generated plans. Swarm runs show a live task board: green ✓ for done, blue ◐ for running, red ✗ for failed, grey ○ for queued. `dep: Plan Decomposition` |
| **Self-Service Model Escalation** | `[M]` | Any sub-agent (or the orchestrator) can request its model be upgraded or downgraded via the proxy. When a cheap model is stuck (detected by loop detection, repeated failures, or the agent explicitly asking for help), it auto-escalates: `haiku → sonnet-4 → opus`. When a smart model finishes quickly with high confidence, it suggests downgrading for similar tasks. This is surfaced in the UI as "Session X upgraded from haiku → sonnet-4: stuck on regex parsing." `dep: Proxy Integration` |
| **Cross-Agent Coordination** | `[L]` | The orchestrator detects when swarm agents are stepping on each other (same file, conflicting changes, circular dependencies) and intervenes: pauses one, redirects, or merges. Enables patterns like "Agent A builds API, Agent B writes tests, Agent C reviews — but C waits for A and B to finish." `dep: Swarm Dispatch, Hook-Based Status` |

### TDD Quality Gates

| Feature | Size | Description |
|---------|------|-------------|
| **Gated Specs & Test-First Dispatch** | `[XL]` | Every task in the plan ships with a spec and test suite. The swarm dispatches cheap models to write code, but **code only lands if tests pass**. This is the quality gate: even a "retarded model" can produce working code as long as the tests validate it. Workflow: (1) Orchestrator writes spec + tests (smart model), (2) dispatches cheap model to implement, (3) runs tests, (4) if pass → merge, if fail → retry with feedback or escalate model. `dep: Swarm Dispatch` |
| **Test Generation Council** | `[M]` | The QA member of the deliberative council specializes in test strategy: unit tests, integration tests, property tests, edge cases. Before any code is written, the QA council generates the test suite so the gate is ready. Uses the scheduler's existing pattern system to store test suites as reusable patterns. `dep: Orchestrator Agent` |
| **Continuous Verification Loop** | `[L]` | After code lands, the orchestrator runs a verification sweep: lint, type-check, integration tests, and a smoke test. If anything breaks, it creates a fix task and dispatches it. This loop runs until green. The user sees a live verification pipeline with pass/fail bars for each stage. `dep: Gated Specs` |

### Proxy Integration & Compression (infrastructure)

| Feature | Size | Description |
|---------|------|-------------|
| **Proxy Integration** | `[L]` | The proxy already works standalone — arbitrary model routing across any provider. Needs: (1) IPC bridge from Switchboard sessions to proxy, (2) model selector UI in session config, (3) proxy config stored in `~/.switchboard/providers.json`. No proxy code to write — just wiring. |
| **Proxy Telemetry Reporting** | `[M]` | Proxy already tracks tokens, costs, latency per request. Needs: (1) telemetry endpoint Switchboard polls/subscribes to, (2) display per-session in sidebar (token count, cost, model badge), (3) cost-per-task attribution for swarm runs. |
| **Input/Output Compression** | `[L]` | 70-80% token reduction on prompts and responses via AST-aware code dedup and semantic compression. Integrates at the proxy intercept point — compressed requests go through the existing proxy, so no new routing code needed. Per-session compression config with ratio badges. Target: slash costs on swarm runs where cheap models process large contexts. |
| **Model Fallback Chain** | `[S]` | Configure fallback chains per session: `sonnet-4 → gpt-4o → haiku`. Auto-retry on rate limit or error. Stored in provider config. |

### The UI Challenge: Displaying Everything Cleanly

The hardest part of Block 0 isn't the code — it's **displaying a deliberative council, a swarm of agents, their test results, model escalations, and the verification pipeline** without overwhelming the user.

**Design principles:**
1. **Progressive disclosure** — Top-level shows "Building auth API: 3/7 tasks done, $0.42 so far." Click to expand shows the task graph. Click a task to see the council deliberation, agent output, and test results.
2. **Color by state, not by type** — Green = passing, yellow = in-progress, red = failing, grey = queued. One color language across tasks, tests, agents, and pipeline stages.
3. **Cost always visible** — A running total in the top-right of the orchestrator panel: "$0.42 · 84k tokens · haiku (3), sonnet (1)."
4. **User stays in control** — The orchestrator proposes, the user approves or edits. No autonomous execution without consent. Override any model choice, skip any task, merge any branches.
5. **The scheduler is the canvas** — Existing scheduler UI (task list, execution overlay, pattern editor) becomes the orchestrator's interface. No new panel — just a richer view of the same data.

### Multi-Monitor Scaling: The Ant Colony View

**The goal:** You sit in front of a 49" ultrawide + three 27" monitors. Every agent session is visible at once — like watching an ant colony work. Terminals, test output, council deliberation, task graphs — all laid out across the available real estate. Nothing hidden behind tabs. Nothing clipped to 1920×1080.

**Three scaling modes:**

| Mode | Use case | Behavior |
|------|----------|----------|
| **Contained** | Laptop, single monitor | All features in the sidebar. Terminal panel switches between sessions. Compact mode for small screens. |
| **Detached** | Two monitors | Pop individual sessions into independent Electron windows. Each window is a full terminal with its own controls. Arrange manually across screens. |
| **Ant Colony** | Three+ monitors (49" ultrawide + extras) | **Tiled layout engine** — all active agent sessions tile across the available screen space in a configurable grid. Each tile shows: live terminal output (last 20 lines), task name, progress bar, model badge, cost ticker, test status. Tiles auto-resize to fill the combined monitor area. New agents spawn new tiles. Completed agents fade to half-opacity but stay visible. Failed agents flash red until acknowledged. |

**Ant Colony layout specifics:**
- **Adaptive grid** — detects total pixel dimensions of all monitors combined. Calculates optimal tile size: `floor(sqrt(totalAgents / aspectRatio))` columns × rows.
- **Per-tile density control** — click a tile to expand it to 2×2 or 4×4 size (merges with neighbors). Click again to collapse. Pin tiles to keep them large.
- **Session minimization** — idle agents shrink to a single line: "✓ Session 3 · haiku · auth tests · $0.02" — takes 30px instead of 300px.
- **Global status bar** — a thin bar across the top of the combined display: total cost, total tokens, running/queued/failed counts, current swarm phase.
- **Cross-monitor window spanning** — Electron windows request `frameless` + `fullscreen` on each monitor, with transparent borders so the grid flows seamlessly across bezels.
- **Zoom per panel** — Ctrl+scroll or pinch-zoom on any tile to scale its font size. Each tile tracks its own zoom level independently.

**The dream:** You're watching 8 agents work in parallel. Three are running tests (green bars filling), two are writing code (terminal scrolling), one is stuck and escalated to a smarter model (yellow badge, ↑ arrow), one is reviewing another agent's output (side-by-side diff), and the orchestrator council is deliberating the next phase (mini conversation view in their tile). Total cost ticker ticking up in real-time. And you can click any tile to see the full terminal, intervene, send a command, or promote/demote the model.

**Implementation note:** This extends the existing multi-window system (detach sessions) with a **coordinated layout engine** — not independent windows, but a single orchestrator view split across multiple monitors. The layout engine knows about all monitors, calculates tile positions, and tells each Electron window where to place itself and what to render.

### Implementation Order

```
1. Proxy Integration             → wire up existing proxy (foundation for everything)
2. Proxy Telemetry Reporting     → surface token/cost/model data in UI
3. Hook-Based Status Reporting   → feeds orchestrator from existing hook mechanic
4. Orchestrator Agent + Council  → deliberative decomposition engine
5. Plan Decomposition & Viz      → task graph UI (extends scheduler)
6. Swarm Dispatch                → execute plan as parallel agent sessions
7. TDD Gated Specs               → test-first quality gates
8. Test Generation Council       → QA writes tests before code
9. Self-Service Model Escalation → sub-agents request model changes via proxy
10. Cross-Agent Coordination     → orchestrator resolves conflicts
11. Continuous Verification Loop → lint → test → smoke pipeline
12. Input/Output Compression     → 70-80% token cost reduction
13. Model Fallback Chain         → reliability on top of proxy
14. Ant Colony Layout Engine     → multi-monitor tiling, adaptive grid, density control
```

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Switchboard UI                           │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Orchestrator Panel                      │   │
│  │  ┌───────────┐  ┌─────────────┐  ┌───────────────┐ │   │
│  │  │ Delibera- │  │   Plan      │  │    Swarm      │ │   │
│  │  │  tive     │→ │   Graph     │→ │  Task Board   │ │   │
│  │  │  Council  │  │  (editable) │  │  (live)       │ │   │
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
- Speckit (github/spec-kit) installed — provides constitution, spec, plan, tasks, checklists
- PostToolUse hook installed in agent configs (already done for Claude Code)
- Test runner infrastructure (can use existing scheduler patterns + `waitForOutput`)

---

## Block 0b — Agentic Routing Engine (Infrastructure Layer, 1000s session cap)

**The real product.** Switchboard defines what the experience looks like. The routing engine makes it scale. Built in Rust or Go, it's K8s semantics applied to cognitive work: pods are agent sessions, deployments are swarms, HPA is model escalation, readiness probes are test suites.

### Core Routing Kernel

| Feature | Size | Description |
|---------|------|-------------|
| **Task Graph Engine** | `[XL]` | Receives a goal, decomposes into a DAG of tasks with dependencies, classifies parallel/serial, identifies resource requirements. K8s scheduler equivalent. Exposes gRPC interface for clients. |
| **Model Router** | `[L]` | Routes each task to optimal model based on cost, capability, latency, current load. Supports OpenAI, Anthropic, Google, local Ollama. Fallback chains on error. K8s service mesh equivalent. `dep: Task Graph Engine` |
| **Agent Dispatcher** | `[XL]` | Spawns agent sessions as ephemeral "pods" — focused prompt, tool access, file context, model assignment. Monitors lifecycle: spawn → running → completed/failed. K8s kubelet equivalent. `dep: Task Graph Engine` |
| **Quality Gate Runner** | `[L]` | Executes test suites against agent output. Pass → merge. Fail → retry with feedback or escalate model. K8s readiness probe equivalent. `dep: Agent Dispatcher` |
| **Result Synthesizer** | `[L]` | Merges outputs from parallel agents, resolves file conflicts, produces final deliverable. `dep: Quality Gate Runner` |
| **Feedback Loop** | `[M]` | Learns from execution outcomes. Rewrites instructions for next time. Adjusts model selection heuristics. K8s HPA + VPA equivalent. `dep: Quality Gate Runner` |

### Cluster Infrastructure

| Feature | Size | Description |
|---------|------|-------------|
| **File-System Shared Memory Layer** | `[L]` | Distributed filesystem as "long-term memory" between agents. Each agent reads context, writes output to `specs/NNN-task-name/output.md`. File locks prevent conflicts. K8s PersistentVolume equivalent. `dep: Agent Dispatcher` |
| **Hook Event Stream** | `[L]` | PostToolUse + heartbeat events flow from agents → event bus → Prime Orchestrator in real-time. K8s event system + Prometheus metrics equivalent. gRPC streams to subscribing clients. |
| **Multi-Node Cluster Support** | `[XL]` | Deploy across 5+ machines (500GB RAM, 80-100 CPUs). Agent sessions distribute across nodes. Shared memory on distributed filesystem. Event stream over gRPC. Scales to 1000s of concurrent agents. |

### Client Integration

| Feature | Size | Description |
|---------|------|-------------|
| **gRPC API** | `[L]` | All engine capabilities exposed via gRPC: submit goal, get plan, watch swarm, query state, override decisions. Switchboard, CLI, IDE plugins all consume this. |
| **Switchboard gRPC Client** | `[M]` | Switchboard stops being the orchestrator and becomes a thin client. All orchestration logic moves to the engine. Switchboard subscribes to gRPC streams and renders the UI. `dep: gRPC API` |

**Estimated total:** ~5000 lines (Rust or Go) across task graph engine, model router, agent dispatcher, quality gate runner, result synthesizer, feedback loop, cluster support, and gRPC API.

**Design principles:**
- **Rust over Go** — memory safety, zero-cost abstractions, no GC pauses during critical routing decisions
- **gRPC-first** — all clients (Switchboard, CLI, IDE plugins) speak the same protocol
- **K8s semantics** — pods, deployments, services, HPA — but for cognitive work instead of compute
- **Stateless agents** — each session is ephemeral. Context lives in the filesystem. Kill and respawn without loss.
- **Switchboard as prototype** — every UI choice in Switchboard becomes a gRPC stream consumer in the engine client

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
| **NOW** | 0. MACS in Switchboard | Prime/Council/Swarm, TDD Gates, Proxy, Compression, Ant Colony (14 features) | ~3000+ | XL |
| **Parallel** | 0b. Routing Engine | Task Graph, Model Router, Dispatcher, Quality Gates, gRPC, Cluster (9 features) | ~5000+ | XL |
| **Next** | 1. Resilience | Retry, Error Watcher, Health Monitor, WAIT_FOR_IDLE | ~400 | Medium |
| **Next** | 2. Patterns | Quick Send, YAML/CSV, Nested, Matrix, Git Storage | ~500 | Low-Medium |
| **Then** | 3. Visualization | History+, Timeline, Dashboard, Analytics | ~800 | Medium |
| **Then** | 4. Automation | Context Relay, Event Triggers, HTTP API | ~600 | Medium-High |
| **Later** | 5. Proxy Telemetry | Cost Attribution, Security Filtering, Fidelity | ~600+ | High |
| **Future** | 6. Advanced | Sharing, Protocol, Checkpoint, Multi-Project, Collab | ~1500+ | High-XL |

**Total remaining:** ~12,500+ lines across all blocks.

---

## Dependencies Graph

```
Block 0: MACS in Switchboard (UI Layer, ~50 sessions)
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
Block 0b: Routing Engine (Infrastructure, 1000s sessions)
  Task Graph Engine ─────────────────────────┐
  Model Router ────── dep: Task Graph        │
  Agent Dispatcher ── dep: Task Graph        │
  Quality Gate Runner ─ dep: Dispatcher      │
  Result Synthesizer ─ dep: Quality Gate     │
  Feedback Loop ───── dep: Quality Gate      │
  File-System Shared Memory ─────────────────┤
  Hook Event Stream ─────────────────────────┤
  Multi-Node Cluster ── dep: all above       │
  gRPC API ────────── dep: all above         │
  Switchboard gRPC Client ─ dep: gRPC API    │
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
  Checkpoint ────────── dep: Block 0b Engine
  Multi-Project ─────── dep: session model
  Collaboration ─────── dep: everything
```

---

## Notes

- **Block 0 is the priority** — MACS (Prime → Council → Swarm) built into Switchboard first. Defines the experience. ~50 session cap on single machine.
- **Block 0b runs parallel** — the routing engine in Rust/Go. K8s semantics for cognitive work. Scales to 1000s. Switchboard becomes a gRPC client when done.
- **Block 1 and 2 can be developed in parallel** — they share no dependencies.
- **Block 3 depends on Block 1** (health data for dashboard) but can start with Timeline independently.
- **Block 4 depends on having a `runPatternByName` extraction** — do this refactor first.
- **Block 5 builds on Block 0** — requires proxy layer to exist before telemetry extensions.
- **Block 6 is speculative** — prioritize based on user demand and competitive pressure.
- **Upstream merge decision: deferred.** They went lean core, we went cognitive architecture. Different products. Cherry-pick individual bugfixes if needed later.
- **Never deploy on a Friday.** The variable names have power. The sea remembers.
