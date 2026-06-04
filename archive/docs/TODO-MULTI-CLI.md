# Switchboard — Multi-CLI Session History (Audit + Implementation)

> **Date:** 2026-06-04
> **Supersedes the status claims in `TASKS.md`** (which marked everything `[x]`
> but several items were not actually wired up, and the requested focus agents
> did not exist).

---

## Audit summary (what was already done vs. missing)

`TASKS.md` claimed F1–F5 were complete. Re-audit of the code found:

| Area | TASKS.md | Reality |
|------|----------|---------|
| F1 backend `get-agent-sessions` enrichment | done | **Real** — returns sessionId, start/end, msg/turn count, size, projectPath, summary, status, git status |
| F1 frontend per-agent selector + loading | done | **Real** — `rebuildAgentSelector` + `loadProjectsForAgent` |
| F2 time-range filters | done | **Real** — `#time-filter-bar` + `activeTimeFilter` |
| F3 sort options (incl. git) | done | **Real** — `#session-sort` + `sortSessions` |
| F4 pinned meta-view | done | **Real** — `_pinned` via `loadMetaView` |
| F5 git status color coding | done | **Real** — backend `getCachedGitStatus` + CSS `git-*` classes |
| Focus agents codex/antigravity/pi/kilo/opencode | — | **codex/opencode existed; antigravity/pi/kilo were MISSING** from both `CLI_AGENTS` and `AGENT_HISTORY` → their old sessions could never be mined |
| Right-click CLI menu on the **Claude logo** | — | Menu existed only on the sidebar **expand** button |
| "Flag" feature (view >1 CLI at once) | — | **MISSING** |
| Rotate-toolbar arrows | — | **MISSING** |
| Per-CLI session colors | partial | `AGENT_COLORS` lacked half the agents; no per-card color rail |
| Settings for the CLI tools | — | **MISSING** |
| `safeSend is not defined` crash | — | **Real bug** — `safeSend` was nested in `init()` in `session-cache.js`/`session-transitions.js`/`mcp-bridge.js`, so module-level callers threw |

---

## Tasks

### B0 — Crash fix (reported `ReferenceError: safeSend is not defined`)
- [x] B0.1: Hoist `safeSend` to module scope in `session-cache.js` (crash site: `notifyRendererProjectsChanged` ← `flushChanges` timer)
- [x] B0.2: Same fix in `session-transitions.js` (latent: fork path `safeSend('session-forked')`)
- [x] B0.3: Same fix in `mcp-bridge.js` (latent: `handleCloseTab` / `handleCloseAllDiffTabs` referenced a `safeSend` defined inside another handler) — converted to a module-level `safeSend(win, log, …)`
- [x] B0.4: Regression test `test/safe-send.test.js` exercising the exact crash path

### M1 — Focus agents (codex, antigravity, pi, kilo, opencode)
- [x] M1.1: Add `antigravity`, `pi`, `kilo` to `CLI_AGENTS` (launch defs + colors)
- [x] M1.2: Add `antigravity`, `pi`, `kilo` adapters to `AGENT_HISTORY` (session discovery + parser) using researched on-disk layouts:
  - antigravity → `~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/*.jsonl`
  - pi → `~/.pi/agent/sessions/` (organized by working dir)
  - kilo → `~/.kilocode/cli/tasks/<id>/` (api_conversation_history.json / ui_messages.json)
- [x] M1.3: Extract `AGENT_HISTORY` into testable `agent-history.js` (no Electron deps; `getAllCached` injected)
- [x] M1.4: `detect-agents` also surfaces agents that have **on-disk history** even when the binary isn't on PATH, and checks `altCmds` (antigravity `agy`)
- [x] M1.5: Fixture-based tests `test/agent-history.test.js`

### M2 — Right-click CLI selector on the Claude logo
- [x] M2.1: Attach the agent context menu to the **sessions tab (Claude logo)**, not just the expand button
- [x] M2.2: Menu lists installed/has-history CLIs with color dots + active checkmark
- [x] M2.3: Selecting a CLI loads its session history into the sidebar (respects time selector + sort)

### M3 — Flag feature (combine multiple CLIs)
- [x] M3.1: Per-CLI flag toggle in the context menu + right-click a CLI button to flag
- [x] M3.2: Persisted `flaggedAgents` (localStorage), synced from settings
- [x] M3.3: New `_flagged` meta-view aggregates sessions from all flagged CLIs
- [x] M3.4: "Running" selector (`_active`) already shows running sessions across all CLIs

### M4 — Rotate-toolbar arrows
- [x] M4.1: ◀ / ▶ buttons at the bottom of the agent selector cycle the active CLI view through `[meta-views…, CLIs…]`
- [x] M4.2: Current-view label between the arrows

### M5 — Per-CLI colors
- [x] M5.1: Complete `AGENT_COLORS` / `AGENT_LABELS` for every agent (incl. antigravity/pi/kilo)
- [x] M5.2: Session cards get a left-edge color rail in the agent's color (`--agent-color`), distinct from the activity border + git bar

### M6 — Settings for the CLI tools
- [x] M6.1: "CLI Agents" section in global settings showing each CLI's detection status (On PATH / History found / Not found)
- [x] M6.2: Flag checkboxes that persist and live-update the sidebar

---

## Validation

- `npm test` — 9/9 pass (folder-index + safeSend regression + agent-history fixtures).
- `node -c` / parse checks on all changed JS; CSS brace delta balanced.
- Full Electron GUI boot could **not** be exercised in the CI/container: `node-pty`'s
  native module can't be rebuilt because downloading Electron headers returns HTTP 403
  (network policy). This is an environment limitation, unrelated to these changes — the
  `safeSend` crash itself is covered by a direct unit test.

## Notes / assumptions

- The exact JSONL field names for antigravity and pi are not fully documented; the
  parsers use tolerant role/type heuristics (matching the existing amp/goose/continue
  adapters) and degrade to a size-based message estimate, so discovery still works even
  if message counts are approximate.
