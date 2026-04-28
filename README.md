![Title Banner](build/title-banner.png)

```
   ______       ____________________  ______  ____  ___    ____  ____ 
  / ___/ |     / /  _/_  __/ ____/ / / / __ )/ __ \/   |  / __ \/ __ \
  \__ \| | /| / // /  / / /   / /_/ / __  / / / / /| | / /_/ / / / /
 ___/ /| |/ |/ // /  / / / /___/ __  / /_/ / /_/ / ___ |/ _, _/ /_/ / 
/____/ |__/|__/___/ /_/  \____/_/ /_/_____/\____/_/  |_/_/ |_/_____/  
```

**Your command center for AI coding agents.**

Switchboard is a desktop app that gives you a unified view of all your AI CLI sessions across every project. Launch, resume, fork, and monitor sessions from a single window — manage multiple agents in parallel, orchestrate them with a visual workflow scheduler, and coordinate distributed development across sessions.

> *Every tool in the AI coding agent space tries to make you disappear. Switchboard does the opposite: it makes you more present across more agents simultaneously.*

![Switchboard](build/screenshot.png)

---

## ![Features](build/section-features.png)

| Feature | Description |
|---------|-------------|
| **Session Browser** | All your Claude Code sessions, organized by project, searchable by content |
| **Built-in Terminal** | Connect to running sessions or launch new ones without leaving the app |
| **Multi-Agent Management** | Run multiple AI CLI sessions in parallel, bypass per-session token limits |
| **Command Scheduler** | Visual step-based workflow sequencer for orchestrating commands across sessions |
| **Broadcast Mode** | Type once, send to all selected sessions simultaneously |
| **Session Roles** | Tag sessions as `@builder`, `@tester`, `@reviewer` for portable workflow patterns |
| **Pattern Library** | 20+ built-in orchestration recipes across AI, DevOps, and Utility categories |
| **Status Notifications** | In-app alerts when a session is waiting for permission approval or user input |
| **Fork & Resume** | Branch off from any point in a session's history |
| **Full-Text Search** | Find any session by what was discussed, not just when it happened |
| **IDE Emulation** | Acts as an IDE for Claude CLI, showing file diffs in a side panel |
| **Plans & Memory** | Browse and edit your plan files and CLAUDE.md memory in one place |
| **Activity Stats** | Heatmap of your coding activity across all projects |
| **Session Names** | Automatically picks up session names from Claude Code's `/rename` command |

### Session Grid Overview

Toggle the grid overview from the sidebar for a bird's-eye view of all your open sessions at once, grouped by project.

![Session Grid Overview](build/screenshot-grid.png)

- **Live terminals** — Every open session renders its full terminal in a card
- **Status at a glance** — Running/stopped/busy indicator with timestamps
- **Click to focus, double-click to expand** — Seamless navigation
- **Persistent** — Grid preference saved across restarts

### Command Scheduler

The scheduler is a visual workflow sequencer purpose-built for orchestrating multiple AI coding agents. Open it from the clock icon on any terminal header.

**9 Step Types:**

| Step | Badge | What it does |
|------|-------|--------------|
| Command | `CMD` | Send a command to targeted sessions (queue burst if no wait between) |
| Wait | `WAIT` | Pause execution for a duration (minutes + seconds, affected by speed multiplier) |
| Wait-for-Output | `WATCH` | Pause until terminal output matches a regex pattern, with timeout |
| Approval Gate | `GATE` | Human checkpoint — shows Continue / Skip / Abort dialog |
| Parallel Group | `PAR` | Fire multiple steps simultaneously, continue when all complete |
| Conditional | `IF` | Branch execution based on regex match against recent output |
| Comment | `---` | Non-executing label / section separator for readability |
| Peer Message | `MSG` | Send a message via Switchboard's peer messaging system |
| Launch Headless | `LAUNCH` | Spawn a new headless CLI session as part of the workflow |

**Key Capabilities:**

- **Per-step targeting** — Each step can target different sessions or roles
- **Session role tags** — Tag sessions `@builder`, `@tester`, `@reviewer`; target by role for portable patterns
- **Broadcast mode** — Live input mirroring to all selected sessions (toggle, not scheduled)
- **Template variables** — Built-in (`{{CYCLE}}`, `{{TIMESTAMP}}`, `{{SESSION_NAME}}`) and user-defined with defaults
- **Speed multiplier** — 0.5x / 1x / 2x / skip-all-waits for testing patterns
- **Dry run mode** — Log commands instead of sending them
- **Step breakpoints** — Pause execution at any step for inspection
- **Macro recording** — Capture keystrokes with auto-inserted wait steps, save as pattern
- **Pattern library** — 20+ built-in patterns (AI Orchestration, DevOps, Utility) plus user patterns in `~/.switchboard/patterns/`
- **Save/Load** — JSON export/import via native file dialogs, plus simple text format (one command per line)

### IDE Emulation (MCP Emulator)

Switchboard can act as an IDE for your Claude Code sessions.

![IDE Emulation](build/screenshot-ide.png)

- **Diff review** — Accept or reject file changes directly
- **Inline & side-by-side** — Toggle diff view modes
- **Partial acceptance** — Accept/reject individual chunks in unified view
- **File viewer** — Clickable file links open with syntax highlighting

To disable: Uncheck **IDE Emulation** in **Global Settings**.

### Status Notifications

Monitor all sessions in the background with status indicators.

![Status Notifications](build/screenshot-notifications.png)

- **Waiting for input** — Session highlighted when needs response
- **Permission approval** — Badge shows when Claude is blocked
- **Activity indicators** — Running, idle, or finished at a glance

---

## Editor

| Shortcut | Action |
|----------|--------|
| `Cmd+F` / `Ctrl+F` | Find in file (also works in terminal) |
| `Cmd+G` / `Ctrl+G` | Go to line |

## Download

## ![Download](build/section-download.png)

| Platform | Download |
|----------|----------|
| **Linux** | [AppImage + .deb](https://github.com/aaaronmiller/switchboard/releases/latest) (x64 + arm64) |
| **macOS** | [.dmg](https://github.com/aaaronmiller/switchboard/releases/latest) (Apple Silicon + Intel) |
| **Windows** | [.exe installer](https://github.com/aaaronmiller/switchboard/releases/latest) (x64 + arm64) |

### Linux Installation

```bash
# Download latest AppImage
curl -L -o Switchboard.AppImage \
  "$(gh release view --repo aaaronmiller/switchboard --json assets -q '.assets[] | select(.name | endswith(".AppImage")) | .url' 2>/dev/null || echo https://github.com/aaaronmiller/switchboard/releases/latest)"

# Make executable & run
chmod +x Switchboard.AppImage && ./Switchboard.AppImage
```

### Auto-Update

The app checks for updates on launch and every 4 hours via GitHub Releases.

---

## ![Development](build/section-development.png)

### Prerequisites

| Platform | Requirements |
|----------|--------------|
| **All** | Node.js 20+, npm 10+ |
| **macOS** | Xcode Command Line Tools (`xcode-select --install`) |
| **Linux** | `build-essential`, `python3` (`sudo apt install build-essential python3`) |
| **Windows** | Visual Studio Build Tools or `npm install -g windows-build-tools` |

### Quick Start

```bash
# Install dependencies
npm install

# Start development
npm start
```

For faster iteration after first run:
```bash
npm run electron
```

### Build Commands

```bash
# Current platform
npm run build

# Platform-specific
npm run build:mac     # DMG + zip (arm64 + x64)
npm run build:win     # NSIS installer (x64 + arm64)
npm run build:linux   # AppImage + deb (x64 + arm64)
```

Output goes to `dist/`.

### Project Structure

```
.
├── main.js                    # Electron main process + scheduler IPC
├── preload.js                 # Context bridge (IPC bindings)
├── db.js                      # SQLite session cache & metadata
├── mcp-bridge.js              # MCP protocol bridge
├── package.json               # Dependencies & build config
├── public/
│   ├── app.js                 # Main renderer (sessions, terminals, grid)
│   ├── scheduler.js           # Command scheduler engine + UI
│   ├── scheduler-patterns.js  # 20+ built-in orchestration patterns
│   ├── style.css              # All styling incl. scheduler step colors
│   ├── index.html             # HTML entry point
│   ├── file-panel.js          # File viewer panel
│   └── codemirror-setup.js    # Editor configuration
├── scripts/                   # Build & postinstall scripts
├── build/                     # Icons, entitlements, resources
├── ROADMAP.md                 # Feature roadmap & implementation plan
└── .github/workflows/         # CI/CD pipelines
```

---

## Fork: What's Different

This is a fork of [doctly/switchboard](https://github.com/doctly/switchboard) with significant additions for multi-agent orchestration:

| Addition | Description |
|----------|-------------|
| **Multi-session management** | Run multiple AI CLI sessions in parallel to bypass per-session token limits |
| **Command Scheduler** | 1,375-line visual workflow engine with 9 step types |
| **Pattern Library** | 20+ built-in orchestration recipes (315 lines) |
| **Session Roles & Broadcast** | Tag-based targeting and live input mirroring |
| **Macro Recording** | Capture keystrokes, auto-detect pauses, save as patterns |
| **Peer Messaging Integration** | Scheduler can send peer messages and launch headless sessions as workflow steps |

### Auto-Sync with Upstream

A GitHub Action runs daily to auto-merge upstream changes (if no conflicts).

```bash
# Manual sync (if needed)
git remote add upstream https://github.com/doctly/switchboard.git
git fetch upstream
git merge upstream/main
```

---

## License

MIT — See [LICENSE](LICENSE) for details.
test
