# Switchboard — Multi-Phase Implementation Plan (executable)

> **Date:** 2026-06-04
> **Scope:** Everything from `PLAN.md`, `IMPROVEMENTS.md`, `ROADMAP.md`,
> `FULL-AUDIT.md` and `design-philosophy.md` that can be built **now, without
> further direction**. Speculative / blocked work (MACS orchestrator, routing
> engine, proxy, channels, full pi-agent-observability integration) lives in
> `/future-plan.md` with the questions that gate it.
>
> **CLI scope:** Per the user, the focus CLIs are **codex, antigravity, pi,
> kilo, opencode** (+ claude). The agents suggested in the old docs (amp, goose,
> continue, cursor, cline) are intentionally ignored here.

---

## North star

Move Switchboard from "session browser" toward "multi-CLI command center":
project-centric cards that show, at a glance, **where** the project is, **how
fresh** it is, its **git state vs. the cloud**, and **which CLI** produced the
work — with running sessions surfaced and dormant ones one click away. This is
the UI substrate the later agentic-observability layer (see `future-plan.md`)
plugs into.

---

## Phase 1 — Backend: project & git enrichment  ✅

Foundational data the new cards need. Pure main-process + tests; no UI yet.

- [x] 1.1 `getProjectLastModified(projectPath)` — mtime of the most-recently
  modified file in the project tree (skips `.git`, `node_modules`, `dist`,
  `.next`, etc.), cached with TTL + eviction. New IPC `get-project-meta`.
- [x] 1.2 Convert `getCachedGitStatus` from blocking `execFileSync` to async
  `execFile` (IMPROVEMENTS **B1**) and enrich the result with: `branch`,
  `dirty`, `ahead`, `behind`, `aheadRemote` (commits on the upstream that the
  local branch lacks → "pull would add changes"), `hasUpstream`.
- [x] 1.3 `git-list-branches` IPC — local branches + current.
- [x] 1.4 `git-checkout-branch` IPC — guarded checkout (validates branch name,
  refuses when the tree is dirty unless `force`).
- [x] 1.5 `git-fetch-remote` IPC — throttled background `git fetch` (per repo,
  ≥ 5 min apart) so "pull available" reflects the real cloud state. Off by
  default behind a `autoFetchRemote` setting; always available as a manual
  action from the card.
- [x] 1.6 Tests: `test/git-utils.test.js` against a throwaway git repo
  (branch list, checkout, ahead/behind/aheadRemote math, lastModified).

## Phase 2 — Frontend: project card redesign  ✅

The core request. One **card per project**; running sessions expanded, dormant
ones behind a pulldown.

- [x] 2.1 Project header → **project card**: project name + full path (copyable),
  last-modified date (1.1), per-CLI color accent (when in a per-CLI view the
  card border/dot uses that CLI's color; in combined views each card is colored
  by the CLI that owns its newest session).
- [x] 2.2 Git block on the card: branch name, dirty/ahead/behind badges, and a
  distinct **"⇩ pull"** signifier when `aheadRemote > 0`.
- [x] 2.3 **Session pulldown**: when a project has multiple *non-running*
  sessions, collapse them into a `<select>` (newest first, labelled with
  date · summary); choosing one opens it. Running/pending sessions always render
  as expanded cards above the pulldown. Single-session projects render inline.
- [x] 2.4 Works across every CLI view (claude + codex/antigravity/pi/kilo/
  opencode) and the meta-views (Active/Flagged/Pinned).

## Phase 3 — Git actions from the card  ✅

- [x] 3.1 Branch selector is **adjustable**: a dropdown of local branches;
  selecting one checks it out (3.x backend), with dirty-tree guard + toast.
- [x] 3.2 "Check remote" button per card → `git-fetch-remote`, then refresh the
  pull-available badge.
- [x] 3.3 Pull button appears when behind remote → runs `git pull --ff-only`,
  reports result.

## Phase 4 — Reliability & security quick wins  ✅

High-confidence hardening from `IMPROVEMENTS.md` / `FULL-AUDIT.md`.

- [x] 4.1 **B4** session file-watcher cleanup on PTY exit (no watcher leak).
- [x] 4.2 **B6** resolve symlinks (`fs.realpathSync`) before the
  `read-file-for-panel` sandbox check.
- [x] 4.3 **B7** MCP `openDiff` promise timeout (no forever-pending diffs).
- [x] 4.4 **#35** settings-injection validation — `set-setting` rejects
  non-object/oversized blobs and unknown top-level keys for known scopes.
- [x] 4.5 **B10** `get-agent-stats` returns `errorMessage` instead of silent
  `{ error: true }`.

---

## Validation strategy

- Unit tests for all backend additions (git utils, project meta) run under
  `node --test` — no Electron needed.
- `node -c` / parse checks for every changed file; CSS brace-delta check.
- Full Electron GUI boot remains blocked in CI (node-pty native module can't be
  rebuilt — Electron-headers download returns 403). UI phases are verified by
  structure + parse checks and must be confirmed locally by the user.

## Out of scope here → see `/future-plan.md`

MACS orchestrator + deliberative council, swarm dispatch, TDD gates, the
Rust/Go routing engine + gRPC, proxy integration / telemetry / compression,
`--channels` (Telegram/Discord) + permission relay, ant-colony multi-monitor
layout, and the **full pi-agent-observability integration**. Each is listed
there with the specific questions that must be answered first.
