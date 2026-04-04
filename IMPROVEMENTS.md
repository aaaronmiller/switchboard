# Switchboard — Consolidated Improvement Plan

> **Date:** 2026-04-03
> **Source:** Deliberative Refinement (Backend + Frontend)

---

## Backend — High Priority

### B1: Async git status (replace spawnSync)
- **Issue:** 3 spawnSync calls × 10s timeout = 30s worst-case main thread block
- **Fix:** Use async `spawn` with Promise, or batch into single `git status --branch --ahead-behind` call
- **Files:** `main.js` lines 39-83

### B2: Agent history scan caching
- **Issue:** Full filesystem walk on every `get-agent-sessions`/`get-agent-stats` call — no caching
- **Fix:** Add LRU cache with 30s TTL keyed by agent ID
- **Files:** `main.js` lines 1930-2340

### B3: gitStatusCache eviction
- **Issue:** Map entries never evicted — grows unboundedly
- **Fix:** Periodic sweep (5min) or cap at 200 entries
- **Files:** `main.js` line 29

### B4: Session file watcher cleanup on exit
- **Issue:** Watchers leak if session exits without renderer calling unwatch
- **Fix:** Call `unwatchSessionFile(sessionId)` in PTY exit handler
- **Files:** `main.js` PTY onExit handler

### B5: Shell injection prevention
- **Issue:** User-controlled values interpolated into shell commands
- **Fix:** Use array-based PTY args or shell-escape function
- **Files:** `main.js` lines 3363-3410

### B6: Path traversal via symlinks
- **Issue:** `read-file-for-panel` sandbox doesn't resolve symlinks
- **Fix:** Use `fs.realpathSync()` before sandbox check
- **Files:** `main.js` lines 1145-1161

## Backend — Medium/Low

### B7: MCP openDiff timeout (Medium)
- Add 5min timeout to diff promise
- **Files:** `mcp-bridge.js`

### B8: refreshFolder streaming (Medium)
- Stream large .jsonl files instead of readFileSync
- **Files:** `main.js` lines 633-724

### B9: Agent parsing DRY (Low)
- Extract `createAgentHistory(config)` factory — reduce 400 lines to ~80
- **Files:** `main.js` lines 1930-2340

### B10: get-agent-stats error details (Low)
- Return `errorMessage` instead of silent `{ error: true }`
- **Files:** `main.js` get-agent-stats handler

---

## Frontend — High Priority

### F6: Session loading indicator
- Show spinner/skeleton while PTY initializes
- **Files:** `app.js` openSession function + CSS

### F7: Aria-labels on icon buttons
- Add `aria-label` to all icon-only buttons
- **Files:** `index.html`, `app.js` (dynamic buttons)

### F8: Debounce search input
- 150ms debounce prevents search jank on large project lists
- **Files:** `app.js` search input handler

### F9: Focus-visible outlines
- Add `:focus-visible` styles for keyboard navigation
- **Files:** `style.css`

## Frontend — Medium Priority

### F10: Scroll-to-bottom button in conversation viewer
- Floating ↓ button appears when scrolled up
- **Files:** `style.css`, `app.js` conversation viewer

### F11: Conversation message bubbles
- Background colors on user/assistant messages for scanability
- **Files:** `style.css` .cv-user, .cv-assistant

### F12: Responsive grid card heights
- `min(450px, calc(50vh - 80px))` instead of fixed 450px
- **Files:** `style.css` .grid-card

### F13: Keyboard shortcut hints
- Subtle `⌘K`, `Ctrl+/` badges on relevant buttons
- **Files:** `index.html`, `style.css`

## Frontend — Low Priority

### F14: "Copied!" toast feedback
- Brief confirmation after copy operations
- **Files:** `app.js` copy handlers

### F15: Sidebar tab transition animation
- 150ms fade when switching tabs
- **Files:** `style.css`

### F16: Session count summary in sidebar footer
- "X sessions · Y running" at bottom
- **Files:** `app.js` refreshSidebar

### F17: Smooth collapse/expand animation
- max-height transition on project groups
- **Files:** `style.css`

### F18: Ctrl+Shift+B broadcast shortcut
- Quick keyboard access to broadcast dialog
- **Files:** `app.js` keydown handler

---

## Implementation Order

**Round 1 (now):** B1, B2, B3, F6, F7, F8, F9 (high priority, ~2h)
**Round 2:** B4, B5, B6, F10, F11, F12 (medium priority, ~3h)
**Round 3:** Remaining items as time allows
