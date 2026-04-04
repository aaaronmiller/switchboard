# Switchboard — Multi-Agent Session History & Sidebar Filters

> **Date:** 2026-04-03
> **Based on:** Phase 5 leftover + new session history requirements

---

## Goal

Currently only Claude Code sessions show in the sidebar. We need per-agent sidebar views with filtering, sorting, time-range selectors, and a unified "Pinned" view across all agents. Session cards should be color-coded by activity/git status.

---

## Feature Breakdown

### F1: Per-Agent Sidebar Views (one for each hardcoded CLI)

Each CLI agent gets its own sidebar view showing its recent sessions.

**Agents (from AGENT_HISTORY in main.js):**
- `claude` — already works (uses PROJECTS_DIR cache)
- `codex` — `~/.codex/sessions/`
- `qwen` — `~/.qwen/projects/`
- `gemini` — needs adapter
- `hermes` — needs adapter
- `kimi` — needs adapter

**Implementation:**
- Backend: `get-agent-sessions` IPC already exists but only returns basic session list. Need to enrich with: message count, turn count, date, size, project path
- Frontend: Agent selector buttons already exist. Need each agent button to load its sessions into the sidebar
- Session cards: Already show date, message count, token cost. Need to add: folder/project, size

**Tasks:**
- [x] F1.1: Enrich `get-agent-sessions` IPC to return: `sessionId`, `startTime`, `endTime`, `messageCount`, `turnCount`, `size`, `projectPath`, `summary`, `status` (running/completed/failed)
- [x] F1.2: Add session card rendering for non-Claude agents (reuse existing card template)
- [x] F1.3: Wire agent selector buttons to trigger sidebar load with that agent's sessions
- [x] F1.4: Add "folder/project" label to each session card

### F2: Time Range Filters

Buttons to filter sessions by age: Last 3 days, 7 days, Month, 3 months, All, or custom number.

**Implementation:**
- Add filter bar below agent selectors: `[3d] [7d] [1m] [3m] [All] [▢]`
- Custom number input opens a small text field
- Filter applies client-side to the cached sessions array
- Persist last-used filter in localStorage

**Tasks:**
- [x] F2.1: Add time range filter bar HTML to sidebar (below agent selectors)
- [x] F2.2: Implement client-side filtering by date range on sessions array
- [x] F2.3: Add custom number input (slide-out or modal)
- [x] F2.4: Persist active filter in localStorage

### F3: Sort Options

Sort sessions by: Date (default), Size, Message Count, Project/Folder, Git Status.

**Implementation:**
- Sort dropdown or cycle button near filter bar
- Sort applies to current view (after time filter)
- Default = newest first

**Tasks:**
- [x] F3.1: Add sort selector (dropdown or toggle button)
- [x] F3.2: Implement sort functions: byDate, bySize, byMsgCount, byProject, byGitStatus
- [x] F3.3: Wire sort state to localStorage persistence

### F4: Unified Pinned View (already partially exists)

The `_pinned` meta-view already exists but needs enrichment:
- Currently merges starred sessions from all agents ✅
- Needs to show the same enriched card data (date, size, turns, project)

**Tasks:**
- [x] F4.1: Enrich pinned session cards with full metadata (same as per-agent cards) — already done via loadMetaView → renderProjects pipeline
- [x] F4.2: Ensure pinned view respects time range + sort filters — confirmed in renderProjects() lines 1654, 1658

### F5: Card Color Coding (activity + git status)

Session card border/background color based on:
- **Recent activity** (last 5 min = green, last hour = yellow, older = grey)
- **Git status** (ahead = blue, current = green, behind = orange, untracked = grey)

**Git status integration:**
- If project has a `.git` dir, run `git status --porcelain` and `git rev-parse --abbrev-ref HEAD` + `git rev-list --count --left-right @{upstream}...HEAD`
- Cache git status per project path (don't re-run on every render)
- Could reuse the project dashboard's git feature if it exists

**Tasks:**
- [x] F5.1: Add git status discovery function in main.js (`getProjectGitStatus(projectPath)`)
- [x] F5.2: Cache git status per project (invalidate on file change or 60s TTL)
- [x] F5.3: Include git status in session card data from backend
- [x] F5.4: Add CSS classes for activity colors (recent = green glow, stale = grey)
- [x] F5.5: Add CSS classes for git status colors (ahead=blue, current=green, behind=orange)
- [x] F5.6: Apply color classes to session card borders

---

## Implementation Order

1. **F1 (Per-agent sidebar views)** — Foundation, needs backend enrichment first
2. **F2 (Time range filters)** — Quick frontend-only change
3. **F3 (Sort options)** — Quick frontend-only change
4. **F4 (Enrich pinned view)** — Depends on F1 card changes
5. **F5 (Card color coding)** — Depends on F1 + git status backend

---

## Technical Notes

### Current architecture
- `AGENT_HISTORY` in `main.js` maps agent ID → `{ getSessions(), parseSession() }`
- `get-agent-sessions` IPC handler calls `history.getSessions()` for each agent
- Frontend `activeAgent` variable controls which agent's sessions are shown
- `_pinned` meta-view merges starred sessions across all agents
- Session cards already show: summary, date, message count, token count, cost

### Git status command (for F5)
```bash
git -C /path/to/project status --porcelain          # dirty check
git -C /path/to/project rev-parse --abbrev-ref HEAD  # current branch
git -C /path/to/project rev-list --left-right --count @{upstream}...HEAD  # ahead/behind
```

### Existing CSS classes to reuse
- Session cards use `.session-item` / `.session-card`
- Agent badges use `.agent-badge` with `AGENT_COLORS` / `AGENT_LABELS` maps
- Error state already applies red border via `.session-card.error`

### What NOT to change
- PROJECTS_DIR cache architecture (Claude sessions still use it)
- safeSend() multi-window routing
- Existing PTY session lifecycle
