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
- [ ] **Session templates** — `session_templates` table, save/load in new-session dialog. ~2 hr.
- [ ] **/loop monitoring** — Terminal output regex + JSONL watcher detection. Loop badge on session cards. ~2 hr.
- [x] **/compact sidebar button** — `/compact` button in terminal header, visible only for running Claude sessions.

## Phase 5: Multi-Window System

Pop sessions into independent windows. Cross-window communication. Broadcast commands.

### Core
- [ ] **Detach session to new window** — Right-click or button on any session to pop it into its own BrowserWindow. Window gets its own terminal panel, no sidebar (clean focus mode). PTY stays alive, IPC routes events to the correct window.
- [ ] **`safeSend` → multi-window routing** — Replace single `mainWindow` target with a window registry. `safeSend` broadcasts to all windows, session-specific events route to the window that owns the session. Each window registers its owned sessionIds.
- [ ] **Reattach to main window** — Drag a detached window back, or click "Reattach" to move the session back to the main window's tab system.

### Cross-Window Communication
- [ ] **Peers across windows** — Already works for free — peers broker is HTTP on :7899, each PTY registers regardless of which window owns it. Messages delivered via IPC to the correct window.
- [ ] **Broadcast command** — "Send to all" input field that injects text into every active PTY across all windows. Useful for `/compact`, status checks, coordinated multi-agent tasks.
- [ ] **Command targeting** — Send a command to a subset of sessions by tag, agent type, or project. E.g. "all Claude sessions in switchboard-fork".

### Window Features
- [ ] **Focus mode** — Detached windows are distraction-free: terminal only, no sidebar, compact header. Optional always-on-top pin.
- [ ] **Window arrangement** — Keyboard shortcuts to tile/cascade all windows. Ctrl+Shift+1/2/3 to focus specific windows.
- [ ] **Window state persistence** — Remember which sessions were detached and window positions. Restore on app restart.
- [ ] **Cross-window sparklines** — Activity events broadcast to all windows so sparkline badges stay current everywhere.

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
