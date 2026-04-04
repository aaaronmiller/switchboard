# Switchboard Fork — Implementation Plan

> **Date:** 2026-03-29
> **Source docs:** `~/code/buttplug/swithcboard-update/` (audit, requirements, design)
> **Base:** v0.0.21 @ current WIP (post-sparklines, meta-views, peers fix)

---

## Already Done (this session + previous)

- Universal sparklines (hook-based + file watchers)
- PostToolUse hook installer + `/session-event` HTTP endpoint
- Session file watchers (JSONL tail for all CLIs)
- Peers messaging (fixed selector bug + red styling)
- Icon/border brightness sliders
- Independent panel zoom
- safeSend guard (Render frame disposed fix)
- Meta-views: Active + Pinned (cross-CLI aggregation)
- Popover viewport clamping fix
- Upstream merge (Electron 41, xterm 6, better-sqlite3 12)

---

## Phase 1: Security + Foundation ✅ COMPLETE

- [x] **Path sandbox for `read-file-for-panel`** — Validates resolved path against PROJECTS_DIR, PLANS_DIR, CLAUDE_DIR, and active session projectPaths. Logs blocked attempts.
- [x] **Non-Claude session summaries** — `extractSessionSummary()` reads first 8KB of session files, extracts first user message across all agent JSONL formats + Aider markdown. No more blank cards.
- [x] **`--bare` flag for headless** — Checkbox in headless dialog, passes `--bare` arg to Claude CLI. Skips hooks & LSP for faster scripted automation.

## Phase 2: Conversation Viewer + Export

#1 missing feature. Read sessions without spawning a terminal.

- [x] **`conversation.js` module** — `normalizeClaudeConversation()`, `normalizeGenericConversation()`, multi-agent JSONL → `NormalizedMessage[]`. Handles Claude (full fidelity), Codex, Gemini, Qwen, Kimi/Hermes.
- [x] **`read-session-conversation` IPC handler** — Main process handler + preload binding. Path-sandboxed, supports `filePath` override for non-Claude agents.
- [x] **Conversation viewer UI** — Shows for any non-running session. User/assistant bubbles, collapsible tool calls with inputs+results, token usage, compact summary dividers. Lightweight markdown renderer.
- [x] **Session export** — Markdown export + copy to clipboard. Buttons in viewer header.

## Phase 3: Token/Cost Tracking

Natural companion to the viewer — shows cost data alongside conversations.

- [x] **`session_tokens` SQLite table** — Schema + statements in `db.js`. Stores per-session input/output/cache tokens and last model.
- [x] **Token parsing in session scan** — Worker extracts `usage` from every Claude assistant message, accumulates totals. Stored on worker result batch.
- [x] **`tokens.js` pricing module** — Full Claude 3/3.5/4 pricing table, fuzzy model matching, `estimateCostCents()`, `formatTokens()`, `formatCost()`.
- [x] **Display in viewer + sidebar** — Cost + token count in conversation viewer header meta. Token count + cost appended to sidebar session card meta line (e.g. "3h · 42 msgs · 84.2k · $0.28").

## Phase 4: Power User Features

Daily-driver polish.

- [x] **Command palette (Ctrl+K)** — Fuzzy search overlay across sessions, projects, and quick actions (new session, broadcast, compact, grid view, settings). Arrow key navigation.
- [x] **Session templates** — `session_templates` table with save/load/delete/increment-use. Template selector in new-session dialog (pick before session options). "Save as Template" button in conversation viewer header + command palette action. Initial prompt injected into PTY on launch. Templates store name, description, prompt, project path, and session options (agent type, permission mode, etc.).
- [x] **/loop monitoring** — Detects loop events from JSONL (system subtype 'loop'/'loop_tool_call') and live terminal output. Stores loop count, last tool, last reason in `session_loops` table. Orange ⟳N badge on session cards with tooltip showing details. Live updates from terminal output for running sessions.
- [x] **/compact sidebar button** — `/compact` button in terminal header, visible only for running Claude sessions.

## Phase 5: Multi-Window System

Pop sessions into independent windows. Cross-window communication. Broadcast commands.

### Core
- [x] **Detach session to new window** — Pop-out button on any session. Window gets its own terminal panel, no sidebar (clean focus mode). PTY stays alive, IPC routes events to the correct window.
- [x] **`safeSend` → multi-window routing** — Window registry (`windowRegistry`). `safeSend` broadcasts to all windows; session-specific events route to the owning window.
- [x] **Reattach to main window** — `reattach-session` IPC handler moves session back to main window and focuses it.

### Cross-Window Communication
- [x] **Peers across windows** — Works for free — peers broker is HTTP on :7899.
- [x] **Broadcast command** — `broadcast-input` (all sessions) + `broadcast-input-targeted` (filter by agent type / project).
- [x] **Command targeting** — `broadcast-input-targeted` filters by agentFilter + projectFilter.

### Window Features
- [x] **Focus mode** — Detached windows are terminal-only, no sidebar. `toggle-window-pin` handler for always-on-top.
- [x] **Window arrangement** — `Ctrl+Shift+1/2/3` focus windows by creation order; `Ctrl+Shift+0` cascades all windows.
- [ ] **Window state persistence** — Remember which sessions were detached and window positions. Restore on app restart.
- [ ] **Cross-window sparklines** — Activity events broadcast to all windows so sparkline badges stay current everywhere.

## Phase 5b: Multi-Agent Session History (NEW)

Per-agent sidebar views, time filters, sorting, pinned enrichment, card color coding.

### F1: Per-Agent Sidebar Views
- [x] **F1.1: Enrich `get-agent-sessions` IPC** — Return `sessionId`, `startTime`, `endTime`, `messageCount`, `turnCount`, `size`, `projectPath`, `summary`, `status` (running/completed/failed)
- [x] **F1.2: Non-Claude session card rendering** — Reuse existing card template for Codex, Qwen, Gemini, etc.
- [x] **F1.3: Agent selector wiring** — Each agent button loads its sessions into sidebar
- [x] **F1.4: Project/folder label on cards** — Show which project each session belongs to

### F2: Time Range Filters
- [x] **F2.1: Filter bar HTML** — `[3d] [7d] [1m] [3m] [All] [▢]` below agent selectors
- [x] **F2.2: Client-side date filtering** — Filter sessions array by selected range
- [x] **F2.3: Custom number input** — Slide-out or modal for arbitrary day count
- [x] **F2.4: localStorage persistence** — Remember last-used filter

### F3: Sort Options
- [x] **F3.1: Sort selector** — Dropdown or toggle button near filter bar
- [x] **F3.2: Sort functions** — byDate, bySize, byMsgCount, byProject, byGitStatus
- [x] **F3.3: Sort state persistence** — localStorage

### F4: Enriched Pinned View
- [x] **F4.1: Full metadata on pinned cards** — Same enriched data as per-agent cards
- [x] **F4.2: Pinned respects filters** — Time range + sort apply to pinned view too

### F5: Card Color Coding
- [x] **F5.1: Git status discovery** — `getProjectGitStatus(projectPath)` in main.js
- [x] **F5.2: Git status cache** — Per-project, 60s TTL, invalidate on file change
- [x] **F5.3: Git status in session data** — Include in backend response
- [x] **F5.4: Activity color CSS** — Recent=green glow, 1hr=yellow, older=grey
- [x] **F5.5: Git status color CSS** — Ahead=blue, current=green, behind=orange, untracked=grey
- [x] **F5.6: Apply colors to card borders** — Dynamic class based on activity + git status

---

## Phase 6: Module Decomposition

After features stabilize. Pure refactor, no behavior changes.

- [ ] **Extract `agents.js`** — CLI_AGENTS + AGENT_HISTORY + detection + stats. ~1 hr.
- [ ] **Extract `peers.js`** — Broker, HTTP server, messaging. ~1 hr.
- [ ] **Extract `terminals.js`** — PTY lifecycle, shell profiles, spawn, OSC parsing. ~1.5 hr.
- [ ] **Extract `sessions.js`** — Cache, scan, refresh, fork detection. ~1 hr.
- [ ] **Extract `settings.js`** — Settings cascade, defaults, IPC. ~30 min.
- [ ] **Extract `menu.js`** — Native menu construction. ~30 min.
- [ ] **Reduce `main.js` to ~400 lines** — App lifecycle + require wiring only. ~1 hr.

## Phase 7: Nice-to-haves

As time allows.

- [ ] New agent support (Amp, Goose)
- [ ] Session comparison (side-by-side diff)
- [ ] Notification history drawer
- [ ] `--channels` integration (Telegram/Discord)
- [ ] Theme toggle (light mode)
- [ ] Project dashboard (per-project stats)
- [ ] Peers broker auth (token-based)

---

## Design Decisions

1. **Module split timing** — Phase 5 (after features), not Phase 1. Splitting before features creates churn. Split once dust settles.
2. **Peers auth** — Deferred. Localhost-only, same trust model as Claude Code's MCP servers.
3. **Aider sparklines** — Skipped. Markdown format has no structured tool events to parse.
4. **Codex v2 format** — Address when someone hits a parse failure, not proactively.
