# Full Feature Audit — April 26, 2026

**Codebase:** v0.0.29, main.js ~4000 lines, commit 7bd42e0
**Source docs:** `~/code/buttplug/swithcboard-update/` (switchboard-update.md, switchboard-requirements.md, switchboard-design.md)
**PLAN.md phases:** Phases 1-5b complete, Phase 6 (Module Decomposition) not started

---

## Summary

```
✅ Fully Implemented:     14 features
🔄 Partially Implemented:  3 features
❌ Not Implemented:       17 features
Total:                    34 features
```

---

## ✅ Fully Implemented (14)

| # | Feature | Source Ref | Evidence |
|---|---------|-----------|----------|
| 1 | Session conversation viewer | #12, US-01, FR-01 | `read-session-conversation` IPC (main.js:3164), preload binding, viewer UI (app.js:2659-2960), HTML/CSS. Supports Claude/Codex/Gemini/Qwen/Kimi/Hermes. Path-sandboxed. |
| 2 | Non-Claude session summaries | #8, US-02, FR-02 | `extractSessionSummary()` reads first 8KB (main.js:660-687). 120-char truncate. Cached in `session_cache.firstPrompt`. |
| 3 | /loop monitoring UI | #1, US-03, FR-03 | `session_loops` table (db.js:405). Detects from JSONL + live terminal. Orange ⟳N badge on cards. Real-time IPC events. |
| 4 | Path sandbox (read-file-for-panel) | #32, US-04, FR-04 | main.js:1191-1210. Validates against PROJECTS_DIR, PLANS_DIR, CLAUDE_DIR, session projectPaths. Logs blocked attempts. |
| 5 | Token/cost tracking | #15/16, US-05, FR-05 | `session_tokens` table (db.js:329). `tokens.js` pricing module. Worker extracts usage (scan-projects.js:92-95). Display in sidebar + viewer. |
| 6 | --bare mode for headless | #3, US-07 | Checkbox in headless dialog (app.js:4713). Passes `--bare` to Claude CLI (main.js:2538). |
| 7 | Ctrl+K command palette | #18, US-08, FR-07 | app.js:5883-6040. Fuzzy search, arrow nav, Enter execute, Esc dismiss. |
| 8 | Session templates | #19, US-09 | `session_templates` table (db.js:344). CRUD IPC handlers. Template selector in new-session dialog. Save-as-template button. |
| 9 | /compact trigger | #7, US-10 | Button in terminal header (index.html:134, app.js:1329-1332). Claude-only, running sessions only. |
| 10 | Multi-window detach/reattach | #24, US-16 | Window registry (main.js:407+). `createDetachedWindow()` (main.js:939). safeSend multi-window routing. Ctrl+Shift+N focus. |
| 11 | Universal sparklines | Already done | Hook-based + file watchers. CHANGELOG confirms. |
| 12 | Peers messaging | Already done | Fixed selector bug, LAN federation with SHA256 token. |
| 13 | safeSend guard | Already done | Render frame disposed fix. CHANGELOG confirms. |
| 14 | Icon/brightness/zoom | Already done | Sliders, independent panel zoom. CHANGELOG confirms. |

---

## 🔄 Partially Implemented (3)

| # | Feature | Source Ref | What's Done | What's Missing |
|---|---------|-----------|-------------|----------------|
| 1 | **Session export** | #13, US-06, FR-06 | Markdown export + clipboard copy. `conversationToMarkdown()` (app.js:2904). Download .md file. Copy button. | ❌ No JSONL raw export (FR-06.2). ❌ No JSON array export (FR-06.3). ❌ No context menu trigger (FR-06.5). |
| 2 | **Gemini /resume detection** | #9 | `resumeFlag: '--resume'` in CLI_AGENTS (main.js:2022). AGENT_HISTORY has Gemini session discovery. | ❌ No UI surfacing of /resume capability. ❌ No special resume command detection. |
| 3 | **Peers broker auth (LAN)** | #33 | `lanPeersToken` exists (main.js:2861). SHA256 matching for LAN federation (lan-peers.js:13). | ❌ Localhost port 7899 has zero auth. Any local process can send messages, register, impersonate. |

---

## ❌ Not Implemented (17)

### P1 — High Priority

| # | Feature | Source Ref | Details |
|---|---------|-----------|---------|
| 1 | **Module decomposition** | #36, FR-08 | main.js 4245 lines (grew from 3317). No agents.js, peers.js, terminals.js, sessions.js, settings.js, menu.js. Single biggest technical debt. |
| 2 | **Session export JSONL/JSON** | FR-06.2, FR-06.3 | Only Markdown+clipboard done. Raw JSONL and parsed JSON array export missing. |
| 3 | **Worktree sparse-checkout** | #6, US-11 | Worktree toggle exists (`worktree: false`, `worktreeName: ''`) but no sparsePaths config UI. |
| 4 | **MCP bridge SSRF fix** | #34 | `handleOpenFile()` in mcp-bridge.js reads arbitrary FS paths with NO validation against workspaceFolders. |
| 5 | **Settings injection validation** | #35 | `set-setting` IPC accepts arbitrary JSON blobs. No schema validation, no type checking. |

### P2 — Medium Priority

| # | Feature | Source Ref | Details |
|---|---------|-----------|---------|
| 6 | **Session comparison** | #14, US-12 | Side-by-side diff of two session conversations. Not started. |
| 7 | **Notification history drawer** | #21, US-13 | Persistent notification center with timestamps, mark-all-read, snooze. Notifications currently ephemeral. |
| 8 | **--channels integration** | #2, US-14 | Telegram/Discord relay UI. No channel config, no message routing. |
| 9 | **Project dashboard** | #20, US-18, FR-05.5 | Per-project stats: sessions-over-time, active agents, cost breakdown chart. |
| 10 | **Dark/light theme toggle** | #22, US-17 | Hardcoded terminal-noir. No light mode CSS, no theme preference setting. |
| 11 | **New agent: Amp** | #26, US-15 | Sourcegraph's coding agent CLI. Not in CLI_AGENTS or AGENT_HISTORY. |
| 12 | **New agent: Goose** | #27, US-15 | Block's open-source coding agent. Not in CLI_AGENTS or AGENT_HISTORY. |
| 13 | **New agent: Continue** | #28, US-15 | Open-source coding agent. Not in CLI_AGENTS or AGENT_HISTORY. |
| 14 | **New agent: Cursor CLI** | #29, US-15 | Cursor's headless CLI mode. Not in CLI_AGENTS or AGENT_HISTORY. |
| 15 | **New agent: Cline** | #30, US-15 | VSCode extension with CLI mode. Not in CLI_AGENTS or AGENT_HISTORY. |
| 16 | **Permission relay** | #4 | Remote approval via channels/mobile. Switchboard detects permission prompts but can't relay. |
| 17 | **Auto-memory visibility** | #5 | No visibility into what Claude remembers per session. |

---

## Functional Requirements Audit (switchboard-design.md)

| ID | Requirement | Status |
|----|------------|--------|
| FR-01.1 | Parse JSONL, extract messages | ✅ Done |
| FR-01.2 | Render formatted conversation view | ✅ Done |
| FR-01.3 | Multi-agent format support | ✅ Done |
| FR-01.4 | Timestamps, tokens, model display | ✅ Done |
| FR-01.5 | In-view search (Ctrl+F) | ❓ Unclear |
| FR-01.6 | Syntax highlighting for code | ✅ Done |
| FR-01.7 | Lazy loading >500 messages | ❌ Not Done |
| FR-01.8 | read-session-conversation IPC | ✅ Done |
| FR-02.1-02.4 | Non-Claude summaries (8KB, cache, 120char) | ✅ Done |
| FR-03.1-03.5 | /loop monitoring (detect, track, badge, IPC) | ✅ Done |
| FR-04.1-04.3 | Path sandbox (validate, block .., log) | ✅ Done |
| FR-05.1-05.4 | Token tracking (parse, store, price, display) | ✅ Done |
| FR-05.5 | Project dashboard cost chart | ❌ Not Done |
| FR-06.1 | Export as Markdown | ✅ Done |
| FR-06.2 | Export as raw JSONL | ❌ Not Done |
| FR-06.3 | Export as JSON array | ❌ Not Done |
| FR-06.4 | Copy to clipboard | ✅ Done |
| FR-06.5 | Context menu trigger | ❌ Not Done |
| FR-07.1-07.4 | Command palette (Ctrl+K, fuzzy, nav, esc) | ✅ Done |
| FR-07.5 | MRU ordering | ❌ Not Done |
| FR-08.1-08.4 | Module decomposition | ❌ Not Done |

---

## User Stories Audit (switchboard-requirements.md)

| ID | Story | Status |
|----|-------|--------|
| US-01 | Read Session History | ✅ Done |
| US-02 | See Non-Claude Session Content | ✅ Done |
| US-03 | Monitor /loop Tasks | ✅ Done |
| US-04 | Secure File Access | ✅ Done |
| US-05 | Track Token Usage | ✅ Done |
| US-06 | Export Sessions | 🔄 Partial |
| US-07 | Headless Bare Mode | ✅ Done |
| US-08 | Command Palette | ✅ Done |
| US-09 | Session Templates | ✅ Done |
| US-10 | Compact Trigger | ✅ Done |
| US-11 | Worktree Sparse Paths | ❌ Not Done |
| US-12 | Compare Sessions | ❌ Not Done |
| US-13 | Notification History | ❌ Not Done |
| US-14 | Channel Messages | ❌ Not Done |
| US-15 | New Agent Support | ❌ Not Done |
| US-16 | Detached Terminal Windows | ✅ Done (no persistence) |
| US-17 | Theme Toggle | ❌ Not Done |
| US-18 | Project Dashboard | ❌ Not Done |

---

## Key Findings

1. **main.js grew 28%** — 3317 → 4245 lines. Features bolted on, not decomposed.
2. **All Tier 1/P0 gaps closed** — conversation viewer, summaries, loop monitoring, path sandbox all done.
3. **Tier 2/P1 mostly done** — bare mode, command palette, templates complete. Module split and export formats missing.
4. **Tier 3/P2 barely touched** — 2 of 13 done. Multi-window and /compact only.
5. **Security: 2/3 done** — Path sandbox implemented. MCP SSRF and settings validation untouched.
6. **Zero new agents added** since audit — still 10 agents (claude, codex, qwen, gemini, kimi, aider, opencode, hermes, letta).
7. **`tokens.js` is the only successful module extraction** — conversation.js inlined in main.js.

---

## Implementation Priority (Recommended)

### Round 1 — Security Quick Wins (1-2 hrs)
1. MCP bridge SSRF fix
2. Settings injection validation

### Round 2 — Complete Partial Features (1 hr)
3. Session export JSONL/JSON
4. Gemini resume UI polish

### Round 3 — New Agents (2 hrs)
5. Amp, Goose, Continue, Cursor CLI, Cline (5 agents, ~20 min each)

### Round 4 — UX Features (3-4 hrs)
6. Dark/light theme toggle
7. Notification history drawer
8. Session comparison
9. Project dashboard
10. Worktree sparse-checkout

### Round 5 — Bigger Items (when time allows)
11. Module decomposition (biggest effort, ~4 hrs)
12. --channels integration
13. Permission relay
14. Auto-memory visibility
