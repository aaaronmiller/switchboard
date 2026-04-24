# Changelog

All notable changes to Switchboard are documented in this file.

## [Unreleased]

### Added
- **Card color coding (F5)** — Session cards in the sidebar now show color-coded left borders based on activity recency (green = <5 min with pulse animation, yellow = <1 hour, grey = stale) and git status (blue ↑ = ahead, green = current, orange ↓ = behind/diverged, purple = dirty, grey = unknown). Git status takes visual priority over activity coloring.
- **Sort options for session sidebar** — Dropdown selector below the time filter bar with 7 sort modes: Newest first, Oldest first, Largest first, Smallest first, Most messages first, By project, By git status. Sort applies after time filtering but before priority grouping (pinned/running sessions still surface to top). Active sort mode persists in localStorage and applies to all views (per-agent, pinned, active).
- **Time range filter bar** — Sidebar now has a filter bar below agent selectors with preset buttons: 3d, 7d, 1m, 3m, All, plus a custom days input (▢) for arbitrary ranges. Filter persists in localStorage and applies to all views (per-agent, pinned, active)

### Fixed
- **Critical white screen crash** — Added missing `safeSend` and `safeSendToSession` functions in main.js that were accidentally removed during module refactoring. These functions handle IPC communication safely by catching disposed render frame errors, preventing renderer crashes (Co-authored-by: Qwen-Coder <qwen-coder@alibabacloud.com>)
- **Per-agent sidebar views (F1)** — Non-Claude agent sessions (Codex, Qwen, Gemini, Kimi, Hermes, etc.) now render in the sidebar with full metadata: accurate message/turn counts from parsed session files, start/end timestamps, file size, running/completed status, project path, and session summary
- **Project path labels on session cards** — Each session card now shows a truncated project/folder path label below the summary in monospace muted text, making it easy to identify which project a session belongs to
- **Agent badge wiring for non-Claude sessions** — Agent badges now use `session.agent` directly from IPC data (not just sessionAgentMap), ensuring non-Claude sessions loaded via `get-agent-sessions` display their colored agent badge correctly
- **Sidebar meta-views** — "Active" and "Pinned" buttons in the agent selector aggregate running/starred sessions across ALL installed CLIs into unified views. Running/star filter buttons now switch to/from meta-views rather than filtering within a single CLI
- **Agent selector tabs** — Switch between CLI agents (Claude, Codex, Qwen, Gemini, etc.) in the sidebar to view each agent's session history independently, with meta-views always visible
- **Per-agent session discovery** — Backend `get-agent-sessions` IPC endpoint using `AGENT_HISTORY` to discover sessions for non-Claude CLI tools
- **Cross-agent pinned view** — Pinned meta-view merges starred sessions from all installed agents with agent badges
- **Icon brightness slider** — Global Settings slider to adjust brightness of all SVG icons across the app (range 0.3-3x)
- **Border brightness slider** — Global Settings slider to adjust brightness of all UI borders and dividers (range 0.3-5x)
- **Independent panel zoom** — Sidebar and main panel zoom independently via Ctrl+scroll or Ctrl+/- (based on cursor position), with sliders in Global Settings
- **Peers messaging button fix** — Fixed peers button not appearing in terminal header (was querying by class instead of id)
- **Peers button styling** — Made peers button prominent with red styling and "Peers" label
- **Hook-based activity monitoring** — Claude Code PostToolUse hook sends real-time tool events to Switchboard via HTTP, powering sidebar sparklines for all sessions (not just headless)
- **Cross-CLI session file watchers** — `fs.watch` tails JSONL session files for Codex, Qwen, Gemini, Kimi, Hermes, and other CLIs, parsing tool events for sparkline visualization
- **Universal sparklines** — Activity sparklines now render on ALL session types (PTY, headless, file-watched), not just headless sessions — color-coded by tool type (blue=read, yellow=write, purple=bash, cyan=agent, green=success, red=error)
- **Activity hook installer** — One-click install of Switchboard's PostToolUse hook into Claude Code settings from Global Settings panel
- **`/session-event` HTTP endpoint** — New endpoint on peers broker (port 7899) accepts tool events from hooks and external integrations
- **Non-Claude session summaries** — `extractSessionSummary()` reads first 8KB of each session file and extracts the first user message across all agent formats (Codex, Qwen, Gemini, Kimi, Hermes, Aider). No more blank session cards.
- **Headless bare mode** — Checkbox in headless launch dialog to pass `--bare` flag, skipping hooks and LSP for faster scripted automation
- **Session error state** — Sidebar session cards turn red when agents error out, hit API rate limits, or exit with non-zero codes. Detects overloaded/rate-limit/auth/billing errors in terminal output and hook events. Clears automatically when session resumes activity.
- **Multi-window support** — Window registry tracks all open BrowserWindows; IPC events route to owning window (`terminal-data`, `cli-busy-state`, `terminal-notification`) while sidebar events broadcast to all windows
- **Detach session** — Pop-out button (↗) in terminal header opens any session in its own focused BrowserWindow; detached window shows terminal only (no sidebar)
- **Broadcast command** — Antenna icon in session filters bar opens a dialog to send any text/command to all currently running PTY sessions simultaneously
- **Conversation viewer** — Clicking any non-running historical session shows a full conversation viewer instead of spawning a terminal. Renders user/assistant messages, collapsible tool calls with inputs+results, token usage badges, and `/compact` summary dividers. Export to Markdown or copy to clipboard. "Resume" button re-opens as terminal.
- **Token + cost tracking** — Session scanner now extracts token usage (input/output/cache read/write) from Claude JSONL. Stored in new `session_tokens` SQLite table. `tokens.js` pricing module covers Claude 3/3.5/4 models with fuzzy model matching. Token counts and estimated cost shown on sidebar session cards and in the conversation viewer header.
- **Command palette (Ctrl+K)** — Fuzzy search overlay across all sessions, projects, and quick actions. Arrow key navigation, Enter to execute. Actions include: new session, broadcast command, /compact active session, toggle grid view, settings.
- **/compact button** — Quick `/compact` button in terminal header, visible only for running Claude sessions. One click to compress context.
- **Loop detection** — Detects `/loop` events from both JSONL (system subtype 'loop'/'loop_tool_call') and live terminal output. Orange `⟳N` badge on session cards shows loop count with tooltip (tool name + reason). Persisted in `session_loops` table, live-updates as sessions run.
- **Session templates** — Save and reuse prompt configurations across sessions. `session_templates` SQLite table stores name, description, initial prompt, and session options (agent type, permission mode, etc.). Template selector at the top of the new-session dialog. "Save as Template" button in conversation viewer header and command palette. Initial prompt auto-injected into PTY on launch. Templates sorted by usage count.
- **Window arrangement shortcuts** — `Ctrl+Shift+1/2/3` focuses the 1st/2nd/3rd open window by creation order; `Ctrl+Shift+0` cascades all windows. Global shortcuts registered via Electron's `globalShortcut`.
- **Reattach session** — `reattach-session` IPC handler moves a detached session back to the main window and focuses it. Exposed via `window.api.reattachSession()`.
- **Window pin (always-on-top)** — `toggle-window-pin` IPC handler toggles always-on-top for the calling window. Exposed via `window.api.toggleWindowPin()`.
- **Targeted broadcast** — `broadcast-input-targeted` IPC handler sends text to a filtered subset of running PTY sessions by agent type and/or project path. Exposed via `window.api.broadcastInputTargeted()`.
- **LAN peer federation** — `lan-peers.js` module: UDP multicast discovery on `239.255.255.250:7898`, 30s announce interval, 90s stale TTL. Enable via Global Settings → LAN Peers toggle. Optional shared token (sha256-matched) restricts federation to trusted machines. Peers broker binds to `0.0.0.0` when LAN is on. Remote peers appear in the peers popover with a machine hostname badge. `/list-peers` merges local + remote; `/send-message` proxies to remote brokers. Zero new npm dependencies — uses Node built-ins only (`dgram`, `http`, `crypto`, `os`).

### Fixed
- **Path traversal in `read-file-for-panel`** — File panel reads now sandboxed to PROJECTS_DIR, PLANS_DIR, CLAUDE_DIR, and active session project paths. Blocked attempts logged at warn level.
- **White screen crash** — All `webContents.send()` calls now go through `safeSend()` which guards against disposed render frames during reload/navigation, preventing the "Render frame was disposed" crash loop
- **New-session popover clipping** — Popover now clamps to viewport edges on all sides with fallback scrolling, preventing the CLI list from extending off-screen when the anchor is near the top
- **CI workflow failure** — Fixed merge conflict detection logic (was using `git diff --check` for whitespace instead of actual conflicts), added `git config` for CI bot identity (exit code 128 fix)

### Changed
- **Upstream merge** — Integrated 8 upstream commits: Electron 33→41, xterm.js 6.0, better-sqlite3 12, UI contrast improvements, grid stop button, scroll position fix, Linux multi-arch build fixes
- **Code cleanup** — Removed dead functions (`readFolderFromFilesystem`, `populateCacheFromFilesystem`, `safeSendToWindow`) and unused variables (`hasToolResults`, `useWslProfile`, `changed`, `sessionId`) from `main.js`

## [0.0.17] - 2026-03-25

### Added
- RPM build target for Fedora
- Production-ready builds: sync-upstream workflow, build-all workflow
- ASCII art banner and section header images for README
- Install script for AppImage setup
- Flatpak manifest (for future use)
- Design philosophy document
- Metrics dashboard with `switchboard --metrics` (agent loyalty, activity sparklines, peak hours, streaks)
- CLI TUI launcher with color-coded AI agent multiplexer and proxy support

### Fixed
- Windows/Linux keyboard fixes (Ctrl+Enter preventDefault)
- Simplified unread tracking and empty project visibility with filters
- WSL shell profiles: path translation and Claude session fallback

## [0.0.16] - 2026-03-15

### Added
- Session grid overview (bird's-eye view of all open sessions)
- Terminal lifecycle refactor
- Update toast improvements

## [0.0.15] - 2026-03-10

### Added
- Markdown preview with localStorage persistence
- Configurable shell profiles for terminal sessions
- Drag-and-drop file path insertion for terminal sessions

## [0.0.14] - 2026-03-05

### Added
- Sidebar visual refresh (card-styled project groups, hover-reveal buttons)
- Agent Files tab (renamed from Memory)
- GEMINI.md scanning support
- Check for updates button with version display in global settings

## [0.0.13] - 2026-02-28

### Added
- Live stats refresh with rate limit usage display
- Release notes link in update toast

### Fixed
- Strip WT_SESSION env for Windows PTY compatibility
- Fix refresh-stats spawn for Windows
- Detect OSC 9;4 running state
