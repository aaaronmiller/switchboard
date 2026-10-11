// Agent color map (matches CLI_AGENTS in main.js)
const AGENT_COLORS = {
  claude: '#d97757', codex: '#4ade80', qwen: '#60a5fa',
  gemini: '#22d3ee', kimi: '#fb923c', aider: '#a78bfa',
  opencode: '#f472b6', hermes: '#fbbf24', letta: '#34d399',
  amp: '#e879f9', goose: '#fb7185', continue: '#06b6d4',
  cursor: '#8b5cf6', cline: '#f97316',
  antigravity: '#2dd4bf', pi: '#c084fc', kilo: '#facc15',
};
const AGENT_LABELS = {
  claude: 'Claude', codex: 'Codex', qwen: 'Qwen',
  gemini: 'Gemini', kimi: 'Kimi', aider: 'Aider',
  opencode: 'OpenCode', hermes: 'Hermes', letta: 'Letta',
  amp: 'Amp', goose: 'Goose', continue: 'Continue',
  cursor: 'Cursor', cline: 'Cline',
  antigravity: 'Antigravity', pi: 'Pi', kilo: 'Kilo',
};

const statusBarInfo = document.getElementById('status-bar-info');
const statusBarActivity = document.getElementById('status-bar-activity');
const terminalsEl = document.getElementById('terminals');
const sidebarContent = document.getElementById('sidebar-content');
const plansContent = document.getElementById('plans-content');
const placeholder = document.getElementById('placeholder');
const archiveToggle = document.getElementById('archive-toggle');
const starToggle = document.getElementById('star-toggle');
const searchInput = document.getElementById('search-input');
const terminalHeader = document.getElementById('terminal-header');
const terminalHeaderName = document.getElementById('terminal-header-name');
const terminalHeaderId = document.getElementById('terminal-header-id');
const terminalHeaderStatus = document.getElementById('terminal-header-status');
const terminalHeaderShell = document.getElementById('terminal-header-shell');
const terminalStopBtn = document.getElementById('terminal-stop-btn');
const runningToggle = document.getElementById('running-toggle');
const todayToggle = document.getElementById('today-toggle');
const planViewer = document.getElementById('plan-viewer');
const planPanel = new ViewerPanel(planViewer, {
  copyPath: true, copyContent: true,
  language: 'markdown', storageKey: 'markdownPreviewMode',
  onSave: (filePath, content) => window.api.savePlan(filePath, content),
});

// --- Independent panel zoom ---
let sidebarZoom = parseFloat(localStorage.getItem('sidebarZoom') || '1');
let mainZoom = parseFloat(localStorage.getItem('mainZoom') || '1');
let hoverPanel = 'main'; // which panel the cursor is over

const sidebar = document.getElementById('sidebar');
const mainEl = document.getElementById('main');

function applyZoom() {
  sidebar.style.zoom = sidebarZoom;
  mainEl.style.zoom = mainZoom;
  localStorage.setItem('sidebarZoom', sidebarZoom);
  localStorage.setItem('mainZoom', mainZoom);
}
applyZoom();

// Track which panel the mouse is over
sidebar.addEventListener('mouseenter', () => { hoverPanel = 'sidebar'; });
mainEl.addEventListener('mouseenter', () => { hoverPanel = 'main'; });

function panelZoom(direction) {
  const step = 0.05;
  if (hoverPanel === 'sidebar') {
    if (direction === 'in') sidebarZoom = Math.min(3, sidebarZoom + step);
    else if (direction === 'out') sidebarZoom = Math.max(0.4, sidebarZoom - step);
    else sidebarZoom = 1;
  } else {
    if (direction === 'in') mainZoom = Math.min(3, mainZoom + step);
    else if (direction === 'out') mainZoom = Math.max(0.4, mainZoom - step);
    else mainZoom = 1;
  }
  applyZoom();
}

// Ctrl+scroll for per-panel zoom
document.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  panelZoom(e.deltaY < 0 ? 'in' : 'out');
}, { passive: false });

// Menu-driven zoom (Ctrl+/-, Ctrl+0) via IPC
window.api.onPanelZoom((direction) => panelZoom(direction));

// --- Global brightness controls ---
let iconBrightness = parseFloat(localStorage.getItem('iconBrightness') || '1');
let borderBrightness = parseFloat(localStorage.getItem('borderBrightness') || '1');

function applyBrightness() {
  document.documentElement.style.setProperty('--icon-brightness', iconBrightness);
  // For borders: inject/update a dynamic style that scales all border opacities
  let borderStyle = document.getElementById('border-brightness-style');
  if (!borderStyle) {
    borderStyle = document.createElement('style');
    borderStyle.id = 'border-brightness-style';
    document.head.appendChild(borderStyle);
  }
  // Scale factor: 1 = default, >1 = brighter borders, <1 = dimmer
  const b = borderBrightness;
  borderStyle.textContent = `
    #sidebar, #sidebar *, #terminal-header, #terminal-header *,
    .session-item, .session-actions button, .tab-btn,
    .toolbar button, .project-group, .settings-field,
    .settings-input, .settings-select, .peers-popover,
    .peer-toast, .filter-btn, #search-input, #jsonl-viewer,
    .file-panel-header, .diff-toolbar, .memory-toolbar,
    .plan-toolbar, #grid-viewer-header {
      border-color: rgba(255, 255, 255, ${(0.06 * b).toFixed(3)}) !important;
    }
    .session-item:hover, .tab-btn:hover, .filter-btn.active {
      border-color: rgba(255, 255, 255, ${(0.12 * b).toFixed(3)}) !important;
    }
  `;
}

applyBrightness();

// --- Color customization sliders (restore from localStorage) ---
(function initColorSliders() {
  const hue = parseInt(localStorage.getItem('cardBorderHue') || '0', 10);
  const brightness = parseInt(localStorage.getItem('cardTextBrightness') || '100', 10);
  document.documentElement.style.setProperty('--card-border-hue', String(hue));
  document.documentElement.style.setProperty('--card-text-brightness', String(brightness / 100));
})();

let currentPlanContent = '';
let currentPlanFilePath = '';
let currentPlanFilename = '';
// currentPlanContent, currentPlanFilePath, currentPlanFilename → plans-memory-view.js
const loadingStatus = document.getElementById('loading-status');
const sessionFilters = document.getElementById('session-filters');
const searchBar = document.getElementById('search-bar');
const statsContent = document.getElementById('stats-content');
const memoryContent = document.getElementById('memory-content');
const statsViewer = document.getElementById('stats-viewer');
const statsViewerBody = document.getElementById('stats-viewer-body');
const memoryViewer = document.getElementById('memory-viewer');
const memoryPanel = new ViewerPanel(memoryViewer, {
  copyPath: true, copyContent: true,
  language: 'markdown', storageKey: 'markdownPreviewMode',
  onSave: (filePath, content) => window.api.saveMemory(filePath, content),
});
const terminalArea = document.getElementById('terminal-area');
const settingsViewer = document.getElementById('settings-viewer');
const globalSettingsBtn = document.getElementById('global-settings-btn');
const addProjectBtn = document.getElementById('add-project-btn');
const projectsContent = document.getElementById('projects-content');
const resortBtn = document.getElementById('resort-btn');
const jsonlViewer = document.getElementById('jsonl-viewer');
const jsonlViewerTitle = document.getElementById('jsonl-viewer-title');
const jsonlViewerSessionId = document.getElementById('jsonl-viewer-session-id');
const jsonlViewerBody = document.getElementById('jsonl-viewer-body');
const gridViewer = document.getElementById('grid-viewer');
const gridViewerCount = document.getElementById('grid-viewer-count');
let gridViewActive = localStorage.getItem('gridViewActive') === '1';

// Map<sessionId, { terminal, element, fitAddon, session, closed }>
const openSessions = new Map();
window._openSessions = openSessions;
// sessionStorage covers renderer reloads; localStorage also restores the last
// terminal after the Electron process itself restarts.
const ACTIVE_SESSION_KEY = 'activeSessionId';
let activeSessionId = sessionStorage.getItem(ACTIVE_SESSION_KEY) || localStorage.getItem(ACTIVE_SESSION_KEY) || null;
function setActiveSession(id) {
  activeSessionId = id;
  if (id) {
    sessionStorage.setItem(ACTIVE_SESSION_KEY, id);
    localStorage.setItem(ACTIVE_SESSION_KEY, id);
  } else {
    sessionStorage.removeItem(ACTIVE_SESSION_KEY);
    localStorage.removeItem(ACTIVE_SESSION_KEY);
  }
  // Update file panel to show this session's open files/diffs
  if (typeof switchPanel === 'function') switchPanel(id);
}
// Persist slug group expand state across reloads
function getExpandedSlugs() {
  try { return new Set(JSON.parse(sessionStorage.getItem('expandedSlugs') || '[]')); } catch { return new Set(); }
}
function saveExpandedSlugs() {
  const expanded = [];
  document.querySelectorAll('.slug-group:not(.collapsed)').forEach(g => { if (g.id) expanded.push(g.id); });
  sessionStorage.setItem('expandedSlugs', JSON.stringify(expanded));
}
let showArchived = false;
let showStarredOnly = false;
let showRunningOnly = false;
let showTodayOnly = false;
let activeTimeFilter = (() => {
  const saved = localStorage.getItem('activeTimeFilter');
  return saved !== null ? parseInt(saved, 10) : 7;
})(); // default: 7 days
let activeSortMode = localStorage.getItem('activeSortMode') || 'date-desc';
let cachedProjects = [];
let cachedAllProjects = [];
// Projects tab (projects-view.js): project → tracks → sessions, from
// getProjectTree. Same session objects as the two caches above (dedupTree).
let cachedProjectTree = { projects: [] };    // archived excluded
let cachedProjectTreeAll = { projects: [] }; // everything
let activePtyIds = new Set();
let sessionAgentMap = new Map(); // sessionId → cliAgent id
let tokenCache = {}; // sessionId → { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, model, costCents }
let loopCache = {}; // sessionId → { loopCount, lastLoopAt, lastLoopTool, lastLoopReason }
let headlessState = new Map(); // sessionId → { events: [], lastAction: '', startTime }
let sortedOrder = []; // [{ projectPath, itemIds: [itemId, ...] }, ...] — single source of truth for sidebar order
// Only Sessions and Projects are remembered: the others (Plans, Agent Files,
// Stats) are places you visit, not places you work from.
const REMEMBERED_TABS = ['sessions', 'projects'];
const LAST_TAB_KEY = 'lastTab';
function rememberedTab() {
  try {
    const saved = localStorage.getItem(LAST_TAB_KEY);
    return REMEMBERED_TABS.includes(saved) ? saved : 'sessions';
  } catch { return 'sessions'; }
}
let activeTab = 'sessions';
let activeAgent = localStorage.getItem('activeAgent') || 'claude'; // which CLI agent's sessions to show
let multiAgentMode = localStorage.getItem('multiAgentMode') === '1'; // show all agents stacked
// Multi-sidebar layout: 'stack' (vertical panels) or 'columns' (side-by-side panes,
// ideal for ultrawide monitors where you want every CLI's sidebar open at once).
let multiSidebarLayout = localStorage.getItem('multiSidebarLayout') || 'stack';
// Auto-show a CLI's pane only if it has a session within this many days (default 90).
let agentRecencyDays = parseInt(localStorage.getItem('agentRecencyDays') || '90', 10);
// Per-agent collapse state in multi-sidebar, remembered across restarts.
// Map of agentId → 'collapsed' | 'expanded'. Absence means "use stale heuristic".
let multiAgentCollapseState = (() => {
  try { return JSON.parse(localStorage.getItem('multiAgentCollapseState') || '{}'); } catch { return {}; }
})();
function saveMultiAgentCollapseState() {
  localStorage.setItem('multiAgentCollapseState', JSON.stringify(multiAgentCollapseState));
}
// Re-load + re-render the multi-agent sidebar (used after layout/recency changes).
function refreshMultiSidebar() {
  loadAllAgentsData().then(agentData => { renderMultiSidebar(agentData); renderDefaultStatus(); });
}
let cachedAgentProjects = new Map(); // agentId → projects[] cache
let installedAgents = {}; // populated on init
// Flagged agents: a user-curated set of CLIs whose sessions are shown together
// in the "Flagged" meta-view (lets you watch >1 CLI at once without losing the
// single-CLI views). Persisted across restarts.
let flaggedAgents = new Set((() => {
  try { return JSON.parse(localStorage.getItem('flaggedAgents') || '[]'); } catch { return []; }
})());
function saveFlaggedAgents() {
  localStorage.setItem('flaggedAgents', JSON.stringify([...flaggedAgents]));
}
// Allow the settings panel to push flag changes back into the live sidebar.
window._syncFlaggedAgents = function () {
  try { flaggedAgents = new Set(JSON.parse(localStorage.getItem('flaggedAgents') || '[]')); } catch {}
  if (typeof rebuildAgentSelector === 'function') rebuildAgentSelector();
  if (activeAgent === '_flagged' && typeof loadMetaView === 'function') loadMetaView('_flagged');
};
let cachedPlans = [];
let visibleSessionCount = 10;
let sessionMaxAgeDays = 3;
const pendingSessions = new Map(); // sessionId → { session, projectPath, folder }

// Bridge functions for settings-panel.js
window._setVisibleSessionCount = (v) => { visibleSessionCount = v; };
window._setSessionMaxAge = (v) => { sessionMaxAgeDays = v; };
window._applyTerminalTheme = (themeName) => {
  currentThemeName = themeName;
  TERMINAL_THEME = getTerminalTheme();
  for (const [, entry] of openSessions) {
    entry.terminal.options.theme = TERMINAL_THEME;
    entry.element.style.backgroundColor = TERMINAL_THEME.background;
  }
};
let searchMatchIds = null; // null = no search active; Set<string> = matched session IDs
let searchMatchProjectPaths = null; // Set<string> of project paths matched by name

// --- Activity tracking ---
//
// Activity is determined by two signals:
//   1. OSC 0 spinner (authoritative: Claude CLI prefixes the title with a
//      braille or half-circle spinner frame)
//   2. Noise-filtered terminal output (fallback: non-noise, non-TUI-repaint data)
//
// Both feed into setActivity(sessionId, active):
//   active=true  → cli-busy (spinner dot)
//   active=false → response-ready if not focused (terminal state until user clicks)
// OSC 0 idle signal is the authoritative source for marking sessions as idle.
//
const attentionSessions = new Set(); // sessions needing user action (OSC 9)
const responseReadySessions = new Set(); // CLI finished, user hasn't looked (terminal state)
const sessionBusyState = new Map(); // sessionId → boolean (currently active)

// Unread and needs-you outlive the app. A session that finished, or asked for
// something, while you were away still says so after a restart; only opening
// it (or Mark as read) clears it. Busy is not saved: nothing is running yet.
const SESSION_NOTICES_KEY = 'sessionNotices';

// When something last happened to a session that is worth moving it for: a
// new session started, a turn finished, or the CLI asked for something.
// Opening or resuming a session does not count, so the list holds still under
// a click. Not persisted: every event coincides with a transcript write, so
// after a restart the transcript's own last-message time says the same thing.
const sessionEventTimes = new Map(); // sessionId → ms since epoch

function bumpSessionEvent(sessionId) {
  if (!sessionId) return;
  sessionEventTimes.set(sessionId, Date.now());
  saveSessionNotices();
  if (typeof refreshProjectViews === 'function') refreshProjectViews({ reason: 'sessions' });
}

/**
 * The time to sort a session by: the later of its last event and the
 * transcript's last message. A working session rewrites its transcript
 * constantly, so while the CLI is busy the session keeps the time it had when
 * the turn began (frozen in setActivity); the turn ending moves it.
 */
function sessionEventTime(session) {
  const id = session.sessionId;
  const known = sessionEventTimes.get(id) || 0;
  const t = new Date(session.modified).getTime();
  const modified = Number.isFinite(t) ? t : 0;
  if (known && sessionBusyState.get(id) === true) return known;
  return Math.max(known, modified);
}

function saveSessionNotices() {
  try {
    // Ids of sessions that no longer exist cost nothing but should not pile up.
    const cap = (set) => [...set].slice(-200);
    localStorage.setItem(SESSION_NOTICES_KEY, JSON.stringify({ ready: cap(responseReadySessions), attention: cap(attentionSessions) }));
  } catch {}
}
try {
  const saved = JSON.parse(localStorage.getItem(SESSION_NOTICES_KEY) || 'null');
  for (const id of saved?.ready || []) responseReadySessions.add(id);
  for (const id of saved?.attention || []) attentionSessions.add(id);
} catch {}

// Some CLIs (notably Codex) start under a temporary ID and are re-keyed once
// their transcript appears. Activity often begins before that detection, so it
// must move with the rest of the session or the eventual idle event will have
// no matching busy state to transition from.
function rekeySessionActivity(oldId, newId) {
  if (oldId === newId) return;

  if (attentionSessions.delete(oldId)) attentionSessions.add(newId);
  if (responseReadySessions.delete(oldId)) responseReadySessions.add(newId);
  if (sessionBusyState.has(oldId)) {
    sessionBusyState.set(newId, sessionBusyState.get(oldId));
    sessionBusyState.delete(oldId);
  }
  if (activePtyIds.delete(oldId)) activePtyIds.add(newId);
  if (sessionEventTimes.has(oldId)) { sessionEventTimes.set(newId, sessionEventTimes.get(oldId)); sessionEventTimes.delete(oldId); }
  saveSessionNotices();
}

// A session row can be on screen twice: under its folder in the Sessions tab
// and in a project's pane or track card. State classes go to every copy.
function forEachSessionItem(sessionId, fn) {
  document.querySelectorAll(`.session-item[data-session-id="${sessionId}"], .pane-session[data-session-id="${sessionId}"]`).forEach(fn);
}

// Central activity dispatcher
function setActivity(sessionId, active) {
  const wasActive = sessionBusyState.get(sessionId) || false;
  // A new turn clears the previous unread response. Repeated busy signals
  // during that turn preserve a manual "Mark as unread" reminder.
  if (active && !wasActive && responseReadySessions.has(sessionId)) {
    responseReadySessions.delete(sessionId);
  }

  sessionBusyState.set(sessionId, active);
  if (active && typeof hideSessionHoverPreview === 'function') hideSessionHoverPreview(sessionId);
  // A turn is starting: pin the row where it is until the turn ends.
  if (active && !wasActive) {
    const session = sessionMap.get(sessionId);
    if (session) sessionEventTimes.set(sessionId, sessionEventTime(session));
  }

  // Clear error state when session becomes active again (restarted/recovered)
  if (active && errorSessions.has(sessionId)) {
    errorSessions.delete(sessionId);
    const errItem = document.querySelector(`.session-item[data-session-id="${sessionId}"]`);
    if (errItem) errItem.classList.remove('session-error');
  }

  if (wasActive && !active) {
    bumpSessionEvent(sessionId);
    // Activity ended → response-ready if user isn't looking at this session
    if (sessionId !== activeSessionId) {
      responseReadySessions.add(sessionId);
    }
  }

  // Activity and unread are independent: a reminder must not stop the spinner.
  forEachSessionItem(sessionId, item => {
    item.classList.toggle('cli-busy', active);
    item.classList.toggle('response-ready', responseReadySessions.has(sessionId));
  });
  // The Projects tab rolls working / finished / needs-you up onto its rows.
  if (typeof updateProjectStatusDots === 'function') updateProjectStatusDots();
  saveSessionNotices();
}

function clearUnread(sessionId) {
  responseReadySessions.delete(sessionId);
  forEachSessionItem(sessionId, item => item.classList.remove('response-ready'));
  if (typeof updateProjectStatusDots === 'function') updateProjectStatusDots();
  saveSessionNotices();
}

// User-initiated reminder; it does not change what the process is doing.
function markUnread(sessionId) {
  if (responseReadySessions.has(sessionId)) return;
  responseReadySessions.add(sessionId);
  forEachSessionItem(sessionId, item => item.classList.add('response-ready'));
  if (typeof updateProjectStatusDots === 'function') updateProjectStatusDots();
  saveSessionNotices();
}

function clearNotifications(sessionId) {
  // Opening a session is not an event: the row stays where it is so the
  // list does not reshuffle under the pointer.
  clearUnread(sessionId);
  attentionSessions.delete(sessionId);
  forEachSessionItem(sessionId, item => item.classList.remove('needs-attention'));
  if (typeof updateProjectStatusDots === 'function') updateProjectStatusDots();
  saveSessionNotices();
}
// Terminal themes, utils (cleanDisplayName, formatDate, escapeHtml, shellEscape)
// are defined in terminal-themes.js and utils.js (loaded before app.js).

// Terminal key bindings, write buffering, isAtBottom, safeFit, fitAndScroll → terminal-manager.js

// --- IPC listeners from main process ---

window.api.onTerminalData((sessionId, data) => {
  // Detect live loop events from terminal output (Claude echoes /loop when it detects one)
  if (data.includes('/loop') || data.includes('loop detected') || data.includes('Loop detected')) {
    if (!loopCache[sessionId]) loopCache[sessionId] = { loopCount: 0 };
    loopCache[sessionId].loopCount = (loopCache[sessionId].loopCount || 0) + 1;
    loopCache[sessionId].lastLoopAt = new Date().toISOString();
    // Update sidebar badge immediately
    refreshSessionCard(sessionId);
  }

  const entry = openSessions.get(sessionId);
  if (entry) {
    let buf = terminalWriteBuffers.get(sessionId);
    if (!buf) {
      buf = { chunks: [], syncDepth: 0, rafId: 0, timerId: 0 };
      terminalWriteBuffers.set(sessionId, buf);
    }
    buf.chunks.push(data);

    // Track sync start/end nesting
    if (data.includes(ESC_SYNC_START)) buf.syncDepth++;
    if (data.includes(ESC_SYNC_END)) buf.syncDepth = Math.max(0, buf.syncDepth - 1);

    if (buf.syncDepth > 0) {
      // Inside a synchronized update — keep buffering.
      // Set a safety timeout so we never hold data forever.
      cancelAnimationFrame(buf.rafId);
      if (!buf.timerId) {
        buf.timerId = setTimeout(() => flushTerminalBuffer(sessionId), SYNC_BUFFER_TIMEOUT);
      }
    } else {
      // Not in a sync block (or sync just ended) — flush on next frame.
      clearTimeout(buf.timerId);
      buf.timerId = 0;
      scheduleFlush(sessionId, buf);
    }
  }
});

window.api.onSessionDetected((tempId, realId) => {
  const entry = openSessions.get(tempId);
  if (!entry) return;

  entry.session.sessionId = realId;
  if (activeSessionId === tempId) setActiveSession(realId);
  rekeySessionActivity(tempId, realId);
  rekeyTerminalHistory(tempId, realId);
  if (typeof rekeyProjectSessionState === 'function') rekeyProjectSessionState(tempId, realId);

  // Re-key in openSessions
  openSessions.delete(tempId);
  openSessions.set(realId, entry);

  // Re-key file panel state for the new session ID
  if (typeof rekeyFilePanelState === 'function') rekeyFilePanelState(tempId, realId);

  // Re-key the pending entry so the sidebar row survives until the DB has real
  // data. Without this the temp id keeps being re-injected by loadProjects and
  // the session appears twice.
  const pendingEntry = pendingSessions.get(tempId);
  pendingSessions.delete(tempId);
  if (pendingEntry) {
    pendingEntry.sessionId = realId;
    pendingSessions.set(realId, pendingEntry);
  }
  sessionMap.delete(tempId);
  sessionMap.set(realId, entry.session);

  terminalHeaderId.textContent = realId;

  // Refresh sidebar to show the new session, then select it
  loadProjects().then(() => {
    const item = document.querySelector(`[data-session-id="${realId}"]`);
    if (item) {
      document.querySelectorAll('.session-item.active').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
    }
  });
  pollActiveSessions();
});

window.api.onSessionForked((oldId, newId) => {
  const entry = openSessions.get(oldId);
  if (!entry) return;

  entry.session.sessionId = newId;
  if (activeSessionId === oldId) setActiveSession(newId);
  rekeySessionActivity(oldId, newId);
  rekeyTerminalHistory(oldId, newId);
  if (typeof rekeyProjectSessionState === 'function') rekeyProjectSessionState(oldId, newId);

  openSessions.delete(oldId);
  openSessions.set(newId, entry);

  // Re-key file panel state for the new session ID
  if (typeof rekeyFilePanelState === 'function') rekeyFilePanelState(oldId, newId);

  // Re-key pending session to newId so sidebar item persists until DB has real data
  const pendingEntry = pendingSessions.get(oldId);
  pendingSessions.delete(oldId);
  if (pendingEntry) {
    pendingEntry.sessionId = newId;
    pendingSessions.set(newId, pendingEntry);
  }
  sessionMap.delete(oldId);
  sessionMap.set(newId, entry.session);

  terminalHeaderId.textContent = newId;

  loadProjects().then(() => {
    const item = document.querySelector(`[data-session-id="${newId}"]`);
    if (item) {
      document.querySelectorAll('.session-item.active').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      const summary = item.querySelector('.session-summary');
      if (summary) terminalHeaderName.textContent = summary.textContent;
    }
  });
  pollActiveSessions();
});

window.api.onProcessExited((sessionId, exitCode, signal, userStopped) => {
  const entry = openSessions.get(sessionId);
  const session = sessionMap.get(sessionId);
  if (entry) entry.closed = true;

  const intentional = wasIntentionalExit({ exitCode, signal, userStopped });

  // A Claude session that died stays mounted behind an exit banner so the user
  // can read the error it printed (claude / devbox / shell stderr) — without
  // this, a fast-failing pre-launch command tears the terminal down before the
  // error is readable. Cleanup is deferred to openSession, which destroys the
  // closed entry when the user re-clicks the session. The sidebar row stays
  // put too, so there's somewhere to relaunch from.
  if (session?.type !== 'terminal' && !intentional) {
    if (entry) {
      try {
        const reason = signal ? `signal ${signal}` : `code ${exitCode}`;
        entry.terminal.write(`\r\n\x1b[33m── session exited (${reason}) ──\x1b[0m\r\n`);
      } catch {}
    }
    // A pending session that died never wrote a .jsonl, so loadProjects keeps
    // re-injecting it. Mark it dead so it stops sorting as a running session.
    const pending = pendingSessions.get(sessionId);
    if (pending) pending.exited = true;
    if (gridViewActive) {
      gridViewerCount.textContent = gridCards.size + ' session' + (gridCards.size !== 1 ? 's' : '');
    }
    pollActiveSessions();
    return;
  }

  // Everything else — a raw shell that exited and harness sessions the user
  // ended themselves — goes away, including its retained terminal history.
  // Run cleanup even if the pane was already detached from the renderer.
  destroySession(sessionId);
  if (gridViewActive) {
    gridViewerCount.textContent = gridCards.size + ' session' + (gridCards.size !== 1 ? 's' : '');
  } else if (activeSessionId === sessionId) {
    setActiveSession(null);
    terminalHeader.style.display = 'none';
    hideConversationViewer();
    placeholder.style.display = '';
  }

  // Drop the sidebar row for sessions with nothing to reopen: plain terminals,
  // and Claude sessions still pending (no .jsonl was ever written). A session
  // that produced real data keeps its row and reloads from the DB.
  if (session?.type === 'terminal' || pendingSessions.has(sessionId)) {
    pendingSessions.delete(sessionId);
    for (const projList of [cachedProjects, cachedAllProjects]) {
      for (const proj of projList) {
        proj.sessions = proj.sessions.filter(s => s.sessionId !== sessionId);
      }
    }
    removeSessionFromTrees(sessionId);
    sessionMap.delete(sessionId);
    refreshSidebar();
    // The pending marker can outlive the .jsonl by a beat (reconciliation only
    // runs in loadProjects), so re-sync: a session that did write real data
    // gets its row back from the DB rather than vanishing until the next watch.
    if (session?.type !== 'terminal') loadProjects();
  }

  pollActiveSessions();
});

// --- Terminal notifications (iTerm2 OSC 9 — "needs attention") ---
window.api.onTerminalNotification((sessionId, message, kind) => {
  // `kind` is classified by the session's harness in main, since the wording is
  // per-CLI: Claude says "needs your permission to use {tool}", codex says
  // "Approval requested: <command>".
  if (kind === 'attention' && sessionId !== activeSessionId) {
    attentionSessions.add(sessionId);
    bumpSessionEvent(sessionId);
    // The same session can be on screen in both tabs.
    document.querySelectorAll(`.session-item[data-session-id="${sessionId}"]`).forEach(item => item.classList.add('needs-attention'));
    if (typeof updateProjectStatusDots === 'function') updateProjectStatusDots();
  } else if (kind === 'idle') {
    // A completion notification is authoritative even if a quick turn never
    // produced a busy frame, or its busy state arrived under a temporary ID.
    // Active sessions are already being viewed, so they only need to go idle.
    setActivity(sessionId, false);
    if (sessionId !== activeSessionId) markUnread(sessionId);
  }

  // Show in header if active
  if (sessionId === activeSessionId && terminalHeaderPtyTitle) {
    terminalHeaderPtyTitle.textContent = message;
    terminalHeaderPtyTitle.style.display = '';
  }
});

// --- CLI busy state (OSC 0 title spinner and OSC 9;4 progress detection) ---
window.api.onCliBusyState((sessionId, busy) => {
  setActivity(sessionId, busy);
});

// --- Headless session events ---
window.api.onHeadlessEvent((sessionId, event) => {
  let state = headlessState.get(sessionId);
  if (!state) {
    state = { events: [], lastAction: '', startTime: Date.now() };
    headlessState.set(sessionId, state);
  }

  state.events.push(event);
  if (state.events.length > 50) state.events.shift();

  // Update last action text
  if (event.type === 'tool_start' || event.type === 'tool_use') {
    state.lastAction = event.name || 'tool';
    state.lastActionTime = event.ts;
  } else if (event.type === 'text') {
    state.lastAction = event.text?.slice(0, 40) || 'thinking...';
    state.lastActionTime = event.ts;
  } else if (event.type === 'error') {
    state.lastAction = 'error: ' + (event.text || '').slice(0, 30);
    state.lastActionTime = event.ts;
  } else if (event.type === 'complete') {
    state.lastAction = event.exitCode === 0 ? 'completed' : 'failed (exit ' + event.exitCode + ')';
    state.lastActionTime = event.ts;
    state.completed = true;
  }

  // Update the sparkline in the sidebar without full rebuild
  updateHeadlessSparkline(sessionId, state);

  // Live-update log panel if it's open for this session
  if (window._headlessLogUpdater) {
    window._headlessLogUpdater(sessionId, event);
  }
});

// --- Hook-based + file-watcher session activity (all CLIs) ---
window.api.onSessionActivity((sessionId, event) => {
  let state = headlessState.get(sessionId);
  if (!state) {
    state = { events: [], lastAction: '', startTime: Date.now() };
    headlessState.set(sessionId, state);
  }

  state.events.push(event);
  if (state.events.length > 50) state.events.shift();

  if (event.type === 'tool_start' || event.type === 'tool_use') {
    state.lastAction = event.name || 'tool';
    state.lastActionTime = event.ts;
  } else if (event.type === 'text') {
    state.lastAction = event.text?.slice(0, 40) || 'thinking...';
    state.lastActionTime = event.ts;
  } else if (event.type === 'error') {
    state.lastAction = 'error: ' + (event.text || '').slice(0, 30);
    state.lastActionTime = event.ts;
    // Mark session as errored
    errorSessions.add(sessionId);
    const errItem = document.querySelector(`.session-item[data-session-id="${sessionId}"]`);
    if (errItem) errItem.classList.add('session-error');
  }

  // Update sparkline (reuses same function — works for any session type)
  updateHeadlessSparkline(sessionId, state);

  if (window._headlessLogUpdater) {
    window._headlessLogUpdater(sessionId, event);
  }
});

function sparkColor(event) {
  if (event.type === 'error') return '#ef4444';
  if (event.type === 'complete') return event.exitCode === 0 ? '#22c55e' : '#ef4444';
  if (event.type === 'tool_start' || event.type === 'tool_use') {
    const name = (event.name || '').toLowerCase();
    if (name.includes('read') || name.includes('glob') || name.includes('grep')) return '#60a5fa';
    if (name.includes('write') || name.includes('edit')) return '#eab308';
    if (name.includes('bash') || name.includes('exec')) return '#a855f7';
    if (name.includes('agent') || name.includes('task')) return '#22d3ee';
    return '#22c55e';
  }
  if (event.type === 'text') return '#64748b';
  if (event.type === 'message_start') return '#334155';
  return '#475569';
}

function updateHeadlessSparkline(sessionId, state) {
  const sparkline = document.getElementById('sparkline-' + sessionId);
  if (!sparkline) return;

  // Only render tool-related events in the sparkline (skip text/message noise)
  const toolEvents = state.events.filter(e =>
    e.type === 'tool_start' || e.type === 'tool_use' || e.type === 'error' || e.type === 'complete'
  ).slice(-30);

  sparkline.innerHTML = '';
  for (const ev of toolEvents) {
    const block = document.createElement('span');
    block.className = 'spark-block';
    block.style.background = sparkColor(ev);
    block.title = (ev.name || ev.type) + (ev.type === 'error' ? ': ' + (ev.text || '') : '');
    sparkline.appendChild(block);
  }

  // Update the meta text
  const metaEl = sparkline.parentElement?.querySelector('.session-meta');
  if (metaEl && state.lastAction) {
    const elapsed = state.lastActionTime ? formatElapsed(Date.now() - state.lastActionTime) : '';
    metaEl.textContent = state.lastAction + (elapsed ? ' \u00b7 ' + elapsed : '');
  }
}

function formatElapsed(ms) {
  if (ms < 1000) return 'now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  return Math.floor(m / 60) + 'h ago';
}

function buildLogEntry(ev) {
  const entry = document.createElement('div');
  entry.className = 'headless-log-entry';

  const time = document.createElement('span');
  time.className = 'headless-log-time';
  const d = new Date(ev.ts || Date.now());
  time.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const typeEl = document.createElement('span');
  typeEl.className = 'headless-log-type';
  typeEl.style.color = sparkColor(ev);
  typeEl.textContent = ev.type === 'tool_start' ? 'TOOL' : ev.type.toUpperCase();

  const text = document.createElement('span');
  text.className = 'headless-log-text';
  if (ev.type === 'tool_start' || ev.type === 'tool_use') {
    text.textContent = ev.name || 'unknown tool';
  } else if (ev.type === 'text') {
    text.textContent = ev.text || '';
  } else if (ev.type === 'error') {
    text.textContent = ev.text || 'error';
    text.style.color = '#ef4444';
  } else if (ev.type === 'complete') {
    text.textContent = ev.exitCode === 0 ? 'Session completed successfully' : 'Exited with code ' + ev.exitCode;
  } else if (ev.type === 'result') {
    text.textContent = (ev.text || '').slice(0, 200);
  } else {
    text.textContent = ev.type;
  }

  entry.appendChild(time);
  entry.appendChild(typeEl);
  entry.appendChild(text);
  return entry;
}

// ============================================================
// PEERS — Cross-session messaging UI
// ============================================================

const activePeers = new Map(); // peerId -> peer data

async function refreshPeers() {
  try {
    const peers = await window.api.peerList('machine');
    activePeers.clear();
    for (const p of peers) activePeers.set(p.id, p);
  } catch {}
}

// Listen for peer changes
window.api.onPeersChanged(() => refreshPeers());

// Listen for incoming messages and show a toast
window.api.onPeerMessage((msg) => {
  const agentLabel = AGENT_LABELS[msg.fromAgent] || msg.fromAgent;
  const agentColor = AGENT_COLORS[msg.fromAgent] || '#888';
  showPeerMessageToast(msg, agentLabel, agentColor);
});

function showPeerMessageToast(msg, agentLabel, agentColor) {
  // Remove existing toast if any
  const existing = document.querySelector('.peer-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'peer-toast';
  toast.innerHTML = `
    <div class="peer-toast-header">
      <span class="peer-toast-agent" style="color:${agentColor}">${agentLabel}</span>
      <span class="peer-toast-path">${msg.fromCwd ? msg.fromCwd.split('/').pop() : ''}</span>
      <button class="peer-toast-close">&times;</button>
    </div>
    <div class="peer-toast-body">${escapeHtml(msg.text).slice(0, 300)}</div>
    <div class="peer-toast-actions">
      <button class="peer-toast-reply" data-from="${msg.fromPeerId}" data-to="${msg.toPeerId}">Reply</button>
    </div>
  `;

  toast.querySelector('.peer-toast-close').onclick = () => toast.remove();
  toast.querySelector('.peer-toast-reply').onclick = () => {
    toast.remove();
    showPeerMessageDialog(msg.fromPeerId, msg.toPeerId);
  };

  document.body.appendChild(toast);

  // Auto-dismiss after 15s
  setTimeout(() => { if (toast.parentElement) toast.remove(); }, 15000);
}

function showPeerMessageDialog(toPeerId, fromPeerId) {
  const overlay = document.createElement('div');
  overlay.className = 'headless-prompt-overlay';

  const peer = activePeers.get(toPeerId);
  const agentLabel = peer ? (AGENT_LABELS[peer.agent] || peer.agent) : 'Peer';
  const agentColor = peer ? (AGENT_COLORS[peer.agent] || '#888') : '#888';

  const dialog = document.createElement('div');
  dialog.className = 'headless-prompt-dialog';
  dialog.innerHTML = `
    <h3>
      <span style="color:${agentColor}">Send to ${agentLabel}</span>
      <span style="color:#555; font-size:11px; margin-left:8px">${peer?.cwd?.split('/').pop() || toPeerId}</span>
    </h3>
    <textarea placeholder="Type your message..." autofocus></textarea>
    <div class="headless-prompt-actions">
      <button class="headless-cancel-btn">Cancel</button>
      <button class="headless-start-btn" style="background:rgba(${hexToRgb(agentColor)},0.15); color:${agentColor}; border-color:${agentColor}40 !important">Send</button>
    </div>
  `;

  const textarea = dialog.querySelector('textarea');
  const sendBtn = dialog.querySelector('.headless-start-btn');
  const cancelBtn = dialog.querySelector('.headless-cancel-btn');

  cancelBtn.onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  sendBtn.onclick = async () => {
    const text = textarea.value.trim();
    if (!text) return;
    overlay.remove();
    const result = await window.api.peerSendMessage(fromPeerId || 'ui', toPeerId, text);
    if (!result.ok) {
      statusBarActivity.textContent = `Message failed: ${result.error}`;
      setTimeout(() => { statusBarActivity.textContent = ''; }, 5000);
    }
  };

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendBtn.click(); }
    if (e.key === 'Escape') overlay.remove();
  });

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  setTimeout(() => textarea.focus(), 50);
}

function hexToRgb(hex) {
  // Handle 3-char (#abc) and 6-char (#aabbcc) hex
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return `${r},${g},${b}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTokenCount(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function formatCentsCost(cents) {
  if (!cents || cents === 0) return null;
  if (cents < 1) return '<$0.01';
  const dollars = cents / 100;
  if (dollars >= 1) return '$' + dollars.toFixed(2);
  return '$0.' + String(cents).padStart(2, '0');
}

function showPeersPopover(sessionId, anchorEl) {
  // Remove any existing popover
  document.querySelectorAll('.peers-popover').forEach(p => p.remove());

  const popover = document.createElement('div');
  popover.className = 'peers-popover';

  // Get this session's peer ID
  let myPeerId = null;
  for (const [peerId, peer] of activePeers) {
    if (peer.session_id === sessionId) { myPeerId = peerId; break; }
  }

  const otherPeers = [...activePeers.values()].filter(p => p.session_id !== sessionId);

  if (otherPeers.length === 0) {
    popover.innerHTML = '<div class="peers-popover-empty">No other active sessions</div>';
  } else {
    for (const peer of otherPeers) {
      const agentColor = AGENT_COLORS[peer.agent] || '#888';
      const agentLabel = AGENT_LABELS[peer.agent] || peer.agent;
      const dirName = peer.cwd ? peer.cwd.split('/').pop() : '?';

      const btn = document.createElement('button');
      btn.className = 'popover-option peers-popover-peer';
      btn.innerHTML = `
        <span class="popover-agent-dot" style="background:${agentColor}"></span>
        <span class="peers-peer-label">${agentLabel} <span style="color:#555">${dirName}</span>${peer._machine ? `<span class="peers-remote-badge">${escapeHtml(peer._machine)}</span>` : ''}</span>
        ${peer.summary ? `<span class="peers-peer-summary">${escapeHtml(peer.summary).slice(0, 60)}</span>` : ''}
      `;
      btn.onclick = () => {
        popover.remove();
        showPeerMessageDialog(peer.id, myPeerId);
      };
      popover.appendChild(btn);
    }
  }

  // Position near anchor
  const rect = anchorEl.getBoundingClientRect();
  popover.style.position = 'fixed';
  popover.style.top = (rect.bottom + 4) + 'px';
  popover.style.right = (window.innerWidth - rect.right) + 'px';

  document.body.appendChild(popover);

  // Close on outside click
  const closeHandler = (e) => {
    if (!popover.contains(e.target) && e.target !== anchorEl) {
      popover.remove();
      document.removeEventListener('mousedown', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', closeHandler), 0);
}

// Initial load
refreshPeers();

// --- Time range filter ---
function filterSessionsByDate(sessions, days) {
  if (days === 0) return sessions; // "All" — no filtering
  const cutoff = Date.now() - days * 86400000;
  return sessions.filter(s => {
    const t = s.endTime ? new Date(s.endTime).getTime() : (s.startTime ? new Date(s.startTime).getTime() : 0);
    return t >= cutoff;
  });
}

// Sort sessions by the given mode
function sortSessions(sessions, mode) {
  const sorted = [...sessions];
  switch (mode) {
    case 'date-desc':
      sorted.sort((a, b) => new Date(b.endTime || b.startTime || 0) - new Date(a.endTime || a.startTime || 0));
      break;
    case 'date-asc':
      sorted.sort((a, b) => new Date(a.startTime || a.endTime || 0) - new Date(b.startTime || b.endTime || 0));
      break;
    case 'size-desc':
      sorted.sort((a, b) => (b.size || 0) - (a.size || 0));
      break;
    case 'size-asc':
      sorted.sort((a, b) => (a.size || 0) - (b.size || 0));
      break;
    case 'msgs-desc':
      sorted.sort((a, b) => (b.messageCount || b.turnCount || 0) - (a.messageCount || a.turnCount || 0));
      break;
    case 'project':
      sorted.sort((a, b) => (a.projectPath || '').localeCompare(b.projectPath || ''));
      break;
    case 'git': {
      const gitOrder = { ahead: 0, current: 1, behind: 2, dirty: 3, unknown: 4 };
      sorted.sort((a, b) => (gitOrder[a.gitStatus || 'unknown'] ?? 4) - (gitOrder[b.gitStatus || 'unknown'] ?? 4));
      break;
    }
  }
  return sorted;
}

// Sync time filter button states with activeTimeFilter value
function updateTimeFilterButtons() {
  const bar = document.getElementById('time-filter-bar');
  if (!bar) return;

  // Check days-based buttons
  bar.querySelectorAll('.time-filter-btn[data-days]').forEach(btn => {
    const d = parseInt(btn.dataset.days, 10);
    btn.classList.toggle('active', d === activeTimeFilter);
  });

  // Check hours-based buttons (25h etc)
  bar.querySelectorAll('.time-filter-btn[data-hours]').forEach(btn => {
    const h = parseInt(btn.dataset.hours, 10);
    const daysValue = h / 24;
    btn.classList.toggle('active', Math.abs(activeTimeFilter - daysValue) < 0.01);
  });

  const customBtn = document.getElementById('custom-days-btn');
  if (customBtn) {
    const standardDays = [3, 7, 14, 30, 60, 90, 180, 0];
    const standardHours = [25];
    const isPreset = standardDays.includes(activeTimeFilter) ||
                     standardHours.some(h => Math.abs(activeTimeFilter - h / 24) < 0.01);
    customBtn.classList.toggle('active', !isPreset);
    customBtn.textContent = isPreset ? '\u25A2' : '\u2713';
  }
}

// Apply time filter button click handlers
(function initTimeFilterBar() {
  const bar = document.getElementById('time-filter-bar');
  if (!bar) return;

  // Days-based buttons
  bar.querySelectorAll('.time-filter-btn[data-days]').forEach(btn => {
    btn.addEventListener('click', () => {
      const days = parseInt(btn.dataset.days, 10);
      activeTimeFilter = days;
      localStorage.setItem('activeTimeFilter', String(days));
      updateTimeFilterButtons();
      // Hide custom input if visible
      const customInput = document.getElementById('custom-days-input');
      if (customInput) customInput.style.display = 'none';
      // Clear today toggle when time filter is active
      if (days !== 0 && showTodayOnly) {
        showTodayOnly = false;
        todayToggle.classList.remove('active');
      }
      refreshSidebar({ resort: true });
    });
  });

  // Hours-based buttons (e.g. 25h)
  bar.querySelectorAll('.time-filter-btn[data-hours]').forEach(btn => {
    btn.addEventListener('click', () => {
      const hours = parseInt(btn.dataset.hours, 10);
      const daysValue = hours / 24;
      activeTimeFilter = daysValue;
      localStorage.setItem('activeTimeFilter', String(daysValue));
      updateTimeFilterButtons();
      const customInput = document.getElementById('custom-days-input');
      if (customInput) customInput.style.display = 'none';
      if (showTodayOnly) {
        showTodayOnly = false;
        todayToggle.classList.remove('active');
      }
      refreshSidebar({ resort: true });
    });
  });

  // Custom days toggle
  const customBtn = document.getElementById('custom-days-btn');
  const customInputDiv = document.getElementById('custom-days-input');
  const customField = document.getElementById('custom-days-field');
  const customApply = document.getElementById('custom-days-apply');

  if (customBtn && customInputDiv) {
    customBtn.addEventListener('click', () => {
      const isVisible = customInputDiv.style.display !== 'none';
      if (!isVisible) {
        // Pre-fill with current custom value
        if (customField) customField.value = activeTimeFilter || '';
        customInputDiv.style.display = 'flex';
        if (customField) customField.focus();
      } else {
        customInputDiv.style.display = 'none';
      }
    });
  }

  function applyCustomDays() {
    const val = parseInt(customField?.value, 10);
    if (!val || val < 1 || val > 3650) return;
    activeTimeFilter = val;
    localStorage.setItem('activeTimeFilter', String(val));
    updateTimeFilterButtons();
    customInputDiv.style.display = 'none';
    refreshSidebar({ resort: true });
  }

  if (customApply) customApply.addEventListener('click', applyCustomDays);
  if (customField) {
    customField.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); applyCustomDays(); }
    });
  }

  // Restore custom value display if stored
  updateTimeFilterButtons();
})();

// Initialize sort dropdown
(function initSortDropdown() {
  const select = document.getElementById('session-sort');
  if (!select) return;
  select.value = activeSortMode;
  select.addEventListener('change', () => {
    activeSortMode = select.value;
    localStorage.setItem('activeSortMode', activeSortMode);
    refreshSidebar({ resort: true });
  });
})();

// --- Single entry point for all sidebar renders ---
// resort=true: re-sort items by priority+time (use for user-initiated actions)
// resort=false (default): preserve existing DOM order, new items go to top
// `reason` is passed straight to the Projects tab: 'sessions' means only the
// session list moved, so the project page patches itself instead of rebuilding.
function refreshSidebar({ resort = false, reason = 'project' } = {}) {
  // When searching, always use all projects (search ignores archive filter)
  let projects = (searchMatchIds !== null)
    ? cachedAllProjects
    : (showArchived ? cachedAllProjects : cachedProjects);

  if (searchMatchIds !== null) {
    projects = projects.map(p => {
      const hasMatchingSessions = p.sessions.some(s => searchMatchIds.has(s.sessionId));
      const projectMatched = searchMatchProjectPaths && searchMatchProjectPaths.has(p.projectPath);
      if (!hasMatchingSessions && !projectMatched) return null;
      return {
        ...p,
        sessions: hasMatchingSessions ? p.sessions.filter(s => searchMatchIds.has(s.sessionId)) : [],
        _projectMatchedOnly: projectMatched && !hasMatchingSessions,
      };
    }).filter(Boolean);
  }

  renderProjects(projects, resort);
  if (typeof refreshProjectViews === 'function') refreshProjectViews({ reason });
}

// --- Archive toggle ---
archiveToggle.innerHTML = ICONS.archive(18);
archiveToggle.addEventListener('click', () => {
  showArchived = !showArchived;
  archiveToggle.classList.toggle('active', showArchived);
  refreshSidebar({ resort: true });
});

// --- Star filter toggle ---
// Clicking star now switches to the "_pinned" meta-view (or back to previous agent)
starToggle.addEventListener('click', async () => {
  const container = document.getElementById('agent-selector');
  if (activeAgent === '_pinned') {
    // Toggle off — go back to Claude
    showStarredOnly = false;
    starToggle.classList.remove('active');
    const prevAgent = localStorage.getItem('prevAgent') || 'claude';
    activeAgent = prevAgent;
    localStorage.setItem('activeAgent', prevAgent);
    if (container) container.querySelectorAll('.agent-selector-btn').forEach(b => b.classList.toggle('active', b.dataset.agent === prevAgent));
    loadProjectsForAgent();
  } else {
    // Toggle on — switch to pinned meta-view
    localStorage.setItem('prevAgent', activeAgent);
    showStarredOnly = true; showRunningOnly = false;
    starToggle.classList.add('active'); runningToggle.classList.remove('active');
    activeAgent = '_pinned';
    localStorage.setItem('activeAgent', '_pinned');
    if (container) container.querySelectorAll('.agent-selector-btn').forEach(b => b.classList.toggle('active', b.dataset.agent === '_pinned'));
    loadMetaView('_pinned');
  }
});

// --- Running filter toggle ---
// Clicking running now switches to the "_active" meta-view (or back)
runningToggle.addEventListener('click', () => {
  const container = document.getElementById('agent-selector');
  if (activeAgent === '_active') {
    // Toggle off — go back to previous agent
    showRunningOnly = false;
    runningToggle.classList.remove('active');
    const prevAgent = localStorage.getItem('prevAgent') || 'claude';
    activeAgent = prevAgent;
    localStorage.setItem('activeAgent', prevAgent);
    if (container) container.querySelectorAll('.agent-selector-btn').forEach(b => b.classList.toggle('active', b.dataset.agent === prevAgent));
    loadProjectsForAgent();
  } else {
    // Toggle on — switch to active meta-view
    localStorage.setItem('prevAgent', activeAgent);
    showRunningOnly = true; showStarredOnly = false;
    runningToggle.classList.add('active'); starToggle.classList.remove('active');
    activeAgent = '_active';
    localStorage.setItem('activeAgent', '_active');
    if (container) container.querySelectorAll('.agent-selector-btn').forEach(b => b.classList.toggle('active', b.dataset.agent === '_active'));
    loadMetaView('_active');
  }
});

// --- Today filter toggle ---
todayToggle.addEventListener('click', () => {
  showTodayOnly = !showTodayOnly;
  todayToggle.classList.toggle('active', showTodayOnly);
  // Reset time filter when today toggle is on (they conflict)
  if (showTodayOnly && activeTimeFilter !== 0) {
    activeTimeFilter = 0;
    localStorage.setItem('activeTimeFilter', '0');
    updateTimeFilterButtons();
  }
  refreshSidebar({ resort: true });
});

// --- Re-sort button ---
resortBtn.addEventListener('click', () => {
  loadProjects({ resort: true });
});

// --- Multi-agent toggle ---
const multiAgentToggle = document.getElementById('multi-agent-toggle');
if (multiAgentToggle) {
  multiAgentToggle.addEventListener('click', async () => {
    multiAgentMode = !multiAgentMode;
    localStorage.setItem('multiAgentMode', multiAgentMode ? '1' : '0');
    multiAgentToggle.classList.toggle('active', multiAgentMode);

    if (multiAgentMode) {
      // Switch to multi-agent view
      await loadAllAgentsData().then(agentData => {
        renderMultiSidebar(agentData);
        renderDefaultStatus();
      });
    } else {
      // Switch back to single-agent view
      loadProjectsForAgent();
    }
  });
}

// --- Global settings gear button ---
globalSettingsBtn.innerHTML = ICONS.gear(18);
globalSettingsBtn.addEventListener('click', () => {
  openSettingsViewer('global');
});

// --- "More" button: Plans, Agent Files, Stats and Global settings share one
// menu so the tab strip stays short. The tab buttons stay in the DOM, hidden,
// so everything that clicks them (shortcuts, the quota gauge) keeps working.
const sidebarMoreBtn = document.getElementById('sidebar-more-btn');
const MORE_TABS = ['plans', 'memory', 'stats'];
const moreIdleIcon = sidebarMoreBtn.innerHTML;
const tabButton = (name) => document.querySelector(`.sidebar-tab[data-tab="${name}"]`);
const menuIcon = (svg) => svg.replace(/width="18" height="18"/, 'width="14" height="14"');

/** Show the active hidden tab's icon on the more button, or the dots when none is active. */
function updateMoreButton() {
  const tab = MORE_TABS.includes(activeTab) ? tabButton(activeTab) : null;
  sidebarMoreBtn.innerHTML = tab ? tab.innerHTML : moreIdleIcon;
  sidebarMoreBtn.title = tab ? tab.title : 'More';
  sidebarMoreBtn.classList.toggle('active', !!tab);
}

sidebarMoreBtn.addEventListener('click', (e) => {
  const slackLink = document.getElementById('status-bar-slack');
  const tabItem = (name) => {
    const tab = tabButton(name);
    return { label: tab.title, icon: menuIcon(tab.innerHTML), muted: activeTab === name, onClick: () => tab.click() };
  };
  showContextMenu([
    ...MORE_TABS.map(tabItem),
    { sep: true },
    { label: 'Global settings', icon: ICONS.gear(14), onClick: () => globalSettingsBtn.click() },
    { label: 'Join Slack', icon: slackLink.querySelector('svg').outerHTML, onClick: () => window.api.openExternal(slackLink.href) },
  ], { anchor: e.currentTarget });
});

// --- Add folder / new project buttons ---
addProjectBtn.addEventListener('click', () => {
  showAddProjectDialog();
});

// --- Search (debounced, per-tab FTS) ---
let searchDebounceTimer = null;
const searchClear = document.getElementById('search-clear');
const searchTitlesToggle = document.getElementById('search-titles-toggle');
let searchTitlesOnly = false;

// Load persisted preference
(async () => {
  const saved = await window.api.getSetting('searchTitlesOnly');
  if (saved) {
    searchTitlesOnly = true;
    searchTitlesToggle.classList.add('active');
  }
})();

searchTitlesToggle.addEventListener('click', async () => {
  searchTitlesOnly = !searchTitlesOnly;
  searchTitlesToggle.classList.toggle('active', searchTitlesOnly);
  await window.api.setSetting('searchTitlesOnly', searchTitlesOnly);
  // Re-run current search if there's a query
  const query = searchInput.value.trim();
  if (query) {
    searchInput.dispatchEvent(new Event('input'));
  }
});

function clearSearch() {
  searchInput.value = '';
  searchBar.classList.remove('has-query');
  if (searchDebounceTimer) { clearTimeout(searchDebounceTimer); searchDebounceTimer = null; }
  if (activeTab === 'sessions' || activeTab === 'projects') {
    searchMatchIds = null;
    searchMatchProjectPaths = null;
    refreshSidebar({ resort: true });
  } else if (activeTab === 'plans') {
    renderPlans(cachedPlans);
  } else if (activeTab === 'memory') {
    renderMemories();
  }
}

searchClear.addEventListener('click', () => {
  clearSearch();
  searchInput.focus();
});

searchInput.addEventListener('input', () => {
  // Toggle clear button visibility
  searchBar.classList.toggle('has-query', searchInput.value.length > 0);

  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(async () => {
    searchDebounceTimer = null;
    const query = searchInput.value.trim();

    if (!query) {
      clearSearch();
      return;
    }

    try {
      if (activeTab === 'sessions' || activeTab === 'projects') {
        const results = await window.api.search('session', query, searchTitlesOnly);
        searchMatchIds = new Set(results.map(r => r.id));
        // When title-only, also match project names
        searchMatchProjectPaths = null;
        if (searchTitlesOnly) {
          const lowerQ = query.toLowerCase();
          for (const p of cachedAllProjects) {
            const shortName = shortProjectPath(p.projectPath);
            if (shortName.toLowerCase().includes(lowerQ)) {
              if (!searchMatchProjectPaths) searchMatchProjectPaths = new Set();
              searchMatchProjectPaths.add(p.projectPath);
            }
          }
        }
        refreshSidebar({ resort: true });
      } else if (activeTab === 'plans') {
        const results = await window.api.search('plan', query, searchTitlesOnly);
        const matchIds = new Set(results.map(r => r.id));
        renderPlans(cachedPlans.filter(p => matchIds.has(p.filename)));
      } else if (activeTab === 'memory') {
        const results = await window.api.search('memory', query, searchTitlesOnly);
        const matchIds = new Set(results.map(r => r.id));
        renderMemories(matchIds);
      }
    } catch {
      if (activeTab === 'sessions' || activeTab === 'projects') {
        searchMatchIds = null;
        searchMatchProjectPaths = null;
        refreshSidebar({ resort: true });
      }
    }
  }, 150);
});

// --- Stop session helper ---
/**
 * A row for a session that never produced a transcript, and is not running.
 *
 * These exist so a session that died on launch can be relaunched or read, but
 * nothing on disk backs them — so nothing else can ever clear them, and without
 * a way out they sit in the sidebar for good.
 */
function isDismissibleSession(sessionId) {
  return pendingSessions.has(sessionId) && !activePtyIds.has(sessionId);
}

/** Drop such a row. Purely renderer state, so it cannot come back. */
function dismissSession(sessionId) {
  const session = sessionMap.get(sessionId);
  pendingSessions.delete(sessionId);
  sessionMap.delete(sessionId);
  for (const projList of [cachedProjects, cachedAllProjects]) {
    for (const proj of projList) {
      proj.sessions = proj.sessions.filter(s => s.sessionId !== sessionId);
    }
  }
  if (typeof removeSessionFromTrees === 'function') removeSessionFromTrees(sessionId);
  if (openSessions.has(sessionId)) destroySession(sessionId);
  else {
    forgetTerminalHistory(sessionId);
    if (session?.type === 'terminal') forgetPersistedTerminalSession(sessionId);
  }
  if (activeSessionId === sessionId) {
    setActiveSession(null);
    terminalHeader.style.display = 'none';
    placeholder.style.display = '';
  }
  attentionSessions.delete(sessionId);
  responseReadySessions.delete(sessionId);
  refreshSidebar();
}

async function confirmAndStopSession(sessionId) {
  if (!confirm('Stop this session?')) return;
  await window.api.stopSession(sessionId);
  activePtyIds.delete(sessionId);
  if (!gridViewActive && activeSessionId === sessionId) {
    setActiveSession(null);
    terminalHeader.style.display = 'none';
    placeholder.style.display = '';
  }
  refreshSidebar();
}

// --- Terminal header controls ---
terminalStopBtn.addEventListener('click', () => {
  if (activeTaskView) return;
  if (activeSessionId) confirmAndStopSession(activeSessionId);
});


const terminalCompactBtn = document.getElementById('terminal-compact-btn');
terminalCompactBtn.addEventListener('click', () => {
  if (!activeSessionId || !activePtyIds.has(activeSessionId)) return;
  window.api.sendInput(activeSessionId, '/compact\r');
});

const terminalRestartBtn = document.getElementById('terminal-restart-btn');
terminalRestartBtn.addEventListener('click', async () => {
  if (!activeSessionId) return;
  const session = sessionMap.get(activeSessionId);
  if (!session) return;
  // Stop current session, then reopen it
  await window.api.stopSession(activeSessionId);
  await openSession(session);
});

const terminalDetachBtn = document.getElementById('terminal-detach-btn');
terminalDetachBtn.addEventListener('click', async () => {
  if (!activeSessionId) return;
  const result = await window.api.detachSession(activeSessionId);
  if (!result.ok) {
    statusBarActivity.textContent = 'Failed to detach: ' + (result.error || 'unknown');
    setTimeout(() => { statusBarActivity.textContent = ''; }, 4000);
  }
});

// --- Poll for active PTY sessions ---
// Adaptive cadence: poll fast (3s) only while PTYs are running; when idle, back
// off to 30s. Every renderer path that starts a session (launchNewSession,
// openSession, launchTerminalSession, onSessionDetected/Forked) calls
// pollActiveSessions() explicitly, which re-arms the fast cadence immediately.
// The 30s idle floor still catches sessions started outside the renderer
// (scheduler-spawned PTYs, other windows) within at most 30s.
const POLL_FAST_MS = 3000;
const POLL_IDLE_MS = 30000;
let pollTimer = null;

function scheduleActiveSessionsPoll() {
  if (pollTimer) clearTimeout(pollTimer);
  const delay = activePtyIds.size > 0 ? POLL_FAST_MS : POLL_IDLE_MS;
  pollTimer = setTimeout(pollActiveSessions, delay);
}

async function pollActiveSessions() {
  try {
    const ids = await window.api.getActiveSessions();
    // A new session that just came alive is news. A resumed one keeps its
    // place until the agent does something.
    for (const id of ids) {
      if (activePtyIds.has(id)) continue;
      const pending = pendingSessions.get(id);
      if (pending && !pending.restored) sessionEventTimes.set(id, Date.now());
    }
    activePtyIds = new Set(ids);
    updateRunningIndicators();
    updateTerminalHeader();
    // Auto-refresh the "Active" meta-view when PTY count changes
    if (activeAgent === '_active' && activePtyIds.size !== prevSize) {
      loadMetaView('_active');
    }
  } catch {}
  scheduleActiveSessionsPoll();
}

function updateRunningIndicators() {
  document.querySelectorAll('.session-item').forEach(item => {
    const id = item.dataset.sessionId;
    const running = activePtyIds.has(id);
    item.classList.toggle('has-running-pty', running);
    if (!running) {
      // Unread and needs-you stay until the user looks; only busy needs a PTY.
      item.classList.remove('cli-busy');
      item.classList.toggle('needs-attention', attentionSessions.has(id));
      item.classList.toggle('response-ready', responseReadySessions.has(id));
      sessionBusyState.delete(id);
    }
    const dot = item.querySelector('.session-status-dot');
    if (dot) dot.classList.toggle('running', running);
  });
  // Update slug group running dots
  document.querySelectorAll('.slug-group').forEach(group => {
    const hasRunning = group.querySelector('.session-item.has-running-pty') !== null;
    const dot = group.querySelector('.slug-group-dot');
    if (dot) dot.classList.toggle('running', hasRunning);
  });
  if (typeof updateProjectStatusDots === 'function') updateProjectStatusDots();
  // Update grid card dots and status text
  for (const [sid, card] of gridCards) {
    const running = activePtyIds.has(sid);
    const busy = sessionBusyState.get(sid) || false;
    const dot = card.querySelector('.grid-card-dot');
    if (dot) dot.className = 'grid-card-dot ' + (busy ? 'busy' : (running ? 'running' : 'stopped'));
    const footer = card.querySelector('.grid-card-footer');
    if (footer) footer.children[0].textContent = running ? 'Running' : 'Stopped';
    const stopBtn = card.querySelector('.grid-card-stop-btn');
    if (stopBtn) stopBtn.style.display = running ? '' : 'none';
  }
}

function updateTerminalHeader() {
  if (!activeSessionId) return;
  const running = activePtyIds.has(activeSessionId);
  const agentId = sessionAgentMap.get(activeSessionId) || 'claude';
  terminalHeaderStatus.className = running ? 'running' : 'stopped';
  terminalHeaderStatus.textContent = running ? 'Running' : 'Stopped';
  terminalStopBtn.style.display = running ? '' : 'none';
  // /compact only relevant for running Claude sessions
  terminalCompactBtn.style.display = (running && agentId === 'claude') ? '' : 'none';
  updatePtyTitle();
}

const terminalHeaderPtyTitle = document.getElementById('terminal-header-pty-title');

function updatePtyTitle() {
  if (!activeSessionId || !terminalHeaderPtyTitle) return;
  const entry = openSessions.get(activeSessionId);
  const title = entry?.ptyTitle || '';
  terminalHeaderPtyTitle.textContent = title;
  terminalHeaderPtyTitle.style.display = title ? '' : 'none';
}

scheduleActiveSessionsPoll();

// Refresh sidebar timeago labels every 30s so "just now" ticks forward
setInterval(() => {
  for (const [sessionId, session] of sessionMap) {
    if (!session.modified) continue;
    const item = document.getElementById('si-' + sessionId);
    if (!item) continue;
    const timeEl = item.querySelector('.session-time');
    if (!timeEl) continue;
    const msgSuffix = session.messageCount ? ' \u00b7 ' + session.messageCount + ' msgs' : '';
    timeEl.textContent = formatDate(new Date(session.modified)) + msgSuffix;
  }
}, 30000);

// Shared session map so all caches reference the same objects
const sessionMap = new Map();

function dedup(projects) {
  for (const p of projects) {
    for (let i = 0; i < p.sessions.length; i++) {
      const s = p.sessions[i];
      if (sessionMap.has(s.sessionId)) {
        Object.assign(sessionMap.get(s.sessionId), s);
        p.sessions[i] = sessionMap.get(s.sessionId);
      } else {
        sessionMap.set(s.sessionId, s);
      }
    }
  }
}

/**
 * Raw terminals have no transcript/database row. Recreate their renderer rows
 * from localStorage before the sidebar/project panes render after a restart.
 */
function injectPersistedTerminalRows() {
  for (const saved of persistedTerminalSessions()) {
    if (pendingSessions.has(saved.sessionId)) continue;
    const session = sessionMap.get(saved.sessionId) || saved;
    Object.assign(session, saved);
    sessionMap.set(session.sessionId, session);
    const folder = encodeProjectPath(session.projectPath);
    pendingSessions.set(session.sessionId, {
      session,
      projectPath: session.projectPath,
      folder,
      restored: true,
    });
    for (const projList of [cachedProjects, cachedAllProjects]) {
      let proj = projList.find(p => p.projectPath === session.projectPath);
      if (!proj) {
        proj = { folder, projectPath: session.projectPath, sessions: [] };
        projList.unshift(proj);
      }
      if (!proj.sessions.some(item => item.sessionId === session.sessionId)) proj.sessions.unshift(session);
    }
    injectPendingIntoTree(session);
  }
}

/** Reopen every saved raw terminal as a fresh shell, initially hidden. */
async function restorePersistedTerminalProcesses() {
  const jobs = [];
  for (const saved of persistedTerminalSessions()) {
    if (openSessions.has(saved.sessionId)) continue;
    const session = sessionMap.get(saved.sessionId) || saved;
    jobs.push(openRawTerminalSession(session, { show: false }));
  }
  if (jobs.length) {
    await Promise.all(jobs);
    await pollActiveSessions();
  }
}

async function loadProjects({ resort = false, reason = 'project' } = {}) {
  const wasEmpty = cachedProjects.length === 0;
  if (wasEmpty) {
    loadingStatus.textContent = 'Loading\u2026';
    loadingStatus.className = 'active';
    loadingStatus.style.display = '';
  }
  const [defaultProjects, allProjects, tree, treeAll] = await Promise.all([
    window.api.getProjects(false),
    window.api.getProjects(true),
    window.api.getProjectTree(false).catch(() => ({ projects: [] })),
    window.api.getProjectTree(true).catch(() => ({ projects: [] })),
    // Scheduled tasks ride along: the folder clocks and session chips read them.
    typeof loadSchedules === 'function' ? loadSchedules() : null,
  ]);
  cachedProjects = defaultProjects;
  cachedAllProjects = allProjects;
  cachedProjectTree = tree || { projects: [] };
  cachedProjectTreeAll = treeAll || { projects: [] };
  loadingStatus.style.display = 'none';
  loadingStatus.className = '';
  dedup(cachedProjects);
  dedup(cachedAllProjects);
  dedupTree(cachedProjectTree);
  dedupTree(cachedProjectTreeAll);

  // Reconcile pending sessions: remove ones that now have real data
  let hasReinjected = false;
  for (const [sid, pending] of [...pendingSessions]) {
    const realExists = allProjects.some(p => p.sessions.some(s => s.sessionId === sid));
    if (realExists) {
      pendingSessions.delete(sid);
    } else {
      hasReinjected = true;
      // Still pending — re-inject into cached data
      for (const projList of [cachedProjects, cachedAllProjects]) {
        let proj = projList.find(p => p.projectPath === pending.projectPath);
        if (!proj) {
          // Project not in list (no other sessions) — create a synthetic entry
          proj = { folder: pending.folder, projectPath: pending.projectPath, sessions: [] };
          projList.unshift(proj);
        }
        if (!proj.sessions.some(s => s.sessionId === sid)) {
          proj.sessions.unshift(pending.session);
        }
      }
      injectPendingIntoTree(pending.session);
    }
  }

  // Track active plain terminals in pendingSessions/sessionMap (data now comes from backend)
  try {
    const activeTerminals = await window.api.getActiveTerminals();
    for (const { sessionId, projectPath, projectId, trackId } of activeTerminals) {
      if (pendingSessions.has(sessionId)) continue; // already tracked
      const folder = encodeProjectPath(projectPath);
      // Find the session object already injected by the backend
      let session;
      for (const proj of cachedAllProjects) {
        session = proj.sessions.find(s => s.sessionId === sessionId);
        if (session) break;
      }
      if (!session) continue;
      // An attached folder can sit outside the project's root, so cwd alone is
      // not enough to restore where this ephemeral terminal belongs.
      if (projectId) session.projectId = projectId;
      if (trackId) session.trackId = trackId;
      // Also adopts terminals that were already running when this persistence
      // feature was introduced; the next restart should retain them too.
      persistTerminalSession(session);
      pendingSessions.set(sessionId, { session, projectPath, folder });
      sessionMap.set(sessionId, session);
    }
  } catch {}

  // A full app exit kills raw PTYs, so the main-process active list is empty on
  // the next launch. Their durable descriptors still put them back in the same
  // project/track and starting folder.
  injectPersistedTerminalRows();

  // Project roots and attached folders get their tasks too, even with no
  // sessions of their own, so a project's task menu is complete.
  await hydrateProjectTasks([cachedProjects, cachedAllProjects], treeTaskPaths(cachedProjectTreeAll));
  await pollActiveSessions();
  refreshSidebar({ resort, reason });
  renderDefaultStatus();
}

// Sidebar rendering (slugId, folderId, buildSlugGroup, renderProjects,
// rebindSidebarEvents, buildSessionItem, startRename) → sidebar.js

function folderId(projectPath) {
  return 'project-' + projectPath.replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function launchNewSession(project, sessionOptions, { focus = true } = {}) {
  // A temporary id. Claude is told to use it (--session-id); codex cannot be,
  // so main watches for its transcript and sends session-detected with the real
  // one, which re-keys everything below.
  const sessionId = crypto.randomUUID();
  const projectPath = project.projectPath;
  const runtime = sessionOptions?.runtime || 'claude';
  const session = {
    sessionId,
    summary: 'New session',
    firstPrompt: '',
    projectPath,
    runtime,
    name: null,
    starred: 0,
    archived: 0,
    messageCount: 0,
    modified: new Date().toISOString(),
    created: new Date().toISOString(),
  };

  // Launched from a project (or one of its tracks): main files the session
  // there when it spawns, and the Projects tab shows it right away.
  const options = { ...(sessionOptions || {}) };
  if (project.projectId) {
    options.projectId = project.projectId;
    if (project.trackId) options.trackId = project.trackId;
    session.projectId = project.projectId;
    session.trackId = project.trackId || null;
  }
  // Started by a scheduled task: the row shows the chip from the first
  // moment, not only once the DB has the link (main records it on spawn).
  if (options.scheduleId) {
    session.scheduleId = options.scheduleId;
    session.scheduledAt = new Date().toISOString();
  }

  // Track as pending (no .jsonl yet)
  const folder = encodeProjectPath(projectPath);
  pendingSessions.set(sessionId, { session, projectPath, folder });

  // Inject into cached project data so it appears in sidebar immediately
  sessionMap.set(sessionId, session);
  for (const projList of [cachedProjects, cachedAllProjects]) {
    let proj = projList.find(p => p.projectPath === projectPath);
    if (!proj) {
      proj = { folder, projectPath, sessions: [] };
      projList.unshift(proj);
    }
    proj.sessions.unshift(session);
  }
  injectPendingIntoTree(session);
  refreshSidebar();

  const entry = createTerminalEntry(session);

  // Open terminal in main process with session options
  const result = await window.api.openTerminal(sessionId, projectPath, true, Object.keys(options).length ? options : null);
  if (!result.ok) {
    entry.terminal.write(`\r\nError: ${result.error}\r\n`);
    entry.closed = true;
    return;
  }
  if (typeof setSessionMcpActive === 'function') setSessionMcpActive(sessionId, !!result.mcpActive);

  // A scheduled launch runs in the background: it shows up in the lists like
  // any session, but does not take over whatever the user is looking at.
  if (focus) showSession(sessionId);
  pollActiveSessions();
}

// Legacy alias
function openNewSession(project) {
  return launchNewSession(project);
}

async function showTerminalHeader(session) {
  const displayName = cleanDisplayName(session.name || session.aiTitle || session.summary);
  terminalHeaderName.textContent = displayName;
  terminalHeaderId.textContent = session.sessionId;
  terminalHeader.style.display = '';
  updateTerminalHeader();

  // Show agent indicator in header
  let agentTag = terminalHeader.querySelector('.terminal-header-agent');
  const agentId = sessionAgentMap.get(session.sessionId);
  if (agentId && agentId !== 'claude') {
    if (!agentTag) {
      agentTag = document.createElement('span');
      agentTag.className = 'terminal-header-agent';
      terminalHeaderId.parentElement.insertBefore(agentTag, terminalHeaderId.nextSibling);
    }
    agentTag.textContent = AGENT_LABELS[agentId] || agentId;
    agentTag.style.color = AGENT_COLORS[agentId] || '#8888a0';
    agentTag.style.borderColor = AGENT_COLORS[agentId] || '#8888a0';
    agentTag.style.display = '';
  } else if (agentTag) {
    agentTag.style.display = 'none';
  }

  // Scheduler button
  let schedBtn = terminalHeader.querySelector('.scheduler-btn');
  if (!schedBtn) {
    schedBtn = document.createElement('button');
    schedBtn.className = 'scheduler-btn';
    schedBtn.title = 'Command Scheduler';
    schedBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
    const headerRight = terminalHeader.querySelector('.terminal-header-status')?.parentElement || terminalHeader;
    headerRight.appendChild(schedBtn);
  }
  schedBtn.onclick = () => {
    if (typeof openScheduler === 'function') openScheduler(session.sessionId);
  };
  // Update running dot
  if (typeof updateSchedulerBtnState === 'function') updateSchedulerBtnState(session.sessionId, schedBtn);

  // Peers messaging button
  let peersBtn = terminalHeader.querySelector('.terminal-header-peers-btn');
  if (!peersBtn) {
    peersBtn = document.createElement('button');
    peersBtn.className = 'terminal-header-peers-btn';
    peersBtn.title = 'Send message to peers';
    peersBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> Peers';
    const headerControls = document.getElementById('terminal-header-controls');
    if (headerControls) {
      headerControls.insertBefore(peersBtn, headerControls.firstChild);
    } else {
      terminalHeader.appendChild(peersBtn);
    }
  }
  peersBtn.onclick = async () => {
    await refreshPeers();
    showPeersPopover(session.sessionId, peersBtn);
  };

  // Show active shell profile
  try {
    const effective = await window.api.getEffectiveSettings(session.projectPath);
    const profileId = effective.shellProfile || 'auto';
    if (profileId === 'auto') {
      terminalHeaderShell.style.display = 'none';
    } else {
      const profiles = await window.api.getShellProfiles();
      const profile = profiles.find(p => p.id === profileId);
      terminalHeaderShell.textContent = profile ? profile.name : profileId;
      terminalHeaderShell.style.display = '';
    }
  } catch {
    terminalHeaderShell.style.display = 'none';
  }
}

// --- Shared terminal lifecycle helpers ---

// Create an xterm instance, wire up IPC, and register in openSessions.
// Returns the entry. Does NOT make it visible or fit it — call showSession() for that.
function createTerminalEntry(session) {
  const { sessionId } = session;
  const container = document.createElement('div');
  container.className = 'terminal-container';
  terminalsEl.appendChild(container);

  const terminal = new Terminal({
    fontSize: 12,
    fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
    theme: TERMINAL_THEME,
    cursorBlink: true,
    scrollback: 10000,
    convertEol: true,
    allowProposedApi: true,
    linkHandler: {
      activate: (_event, uri) => {
        if (uri.startsWith('file://') && typeof openFileInPanel === 'function') {
          try { openFileInPanel(sessionId, decodeURIComponent(new URL(uri).pathname)); } catch {}
        } else {
          window.api.openExternal(uri);
        }
      },
      allowNonHttpProtocols: true,
    },
  });

  const fitAddon = new FitAddon.FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon.WebLinksAddon((_event, url) => {
    if (url.startsWith('file://') && typeof openFileInPanel === 'function') {
      try { openFileInPanel(sessionId, decodeURIComponent(new URL(url).pathname)); } catch {}
    } else {
      window.api.openExternal(url);
    }
  }));
  const searchAddon = new SearchAddon.SearchAddon();
  terminal.loadAddon(searchAddon);
  terminal.open(container);
  container.style.backgroundColor = TERMINAL_THEME.background;

  // --- Terminal search bar (Cmd/Ctrl+F) ---
  const searchBar = document.createElement('div');
  searchBar.className = 'terminal-search-bar';
  searchBar.style.display = 'none';
  searchBar.innerHTML = `
    <input type="text" class="terminal-search-input" placeholder="Find..." />
    <span class="terminal-search-count"></span>
    <button class="terminal-search-prev" title="Previous (Shift+Enter)">&#x25B2;</button>
    <button class="terminal-search-next" title="Next (Enter)">&#x25BC;</button>
    <button class="terminal-search-close" title="Close (Escape)">&times;</button>
  `;
  container.appendChild(searchBar);
  const searchInput = searchBar.querySelector('.terminal-search-input');
  const searchCount = searchBar.querySelector('.terminal-search-count');
  const searchOpts = { decorations: { matchBackground: '#515C6A', activeMatchBackground: '#EAA549', matchOverviewRuler: '#515C6A', activeMatchColorOverviewRuler: '#EAA549' } };

  function openSearchBar() {
    searchBar.style.display = 'flex';
    searchInput.focus();
    const sel = terminal.getSelection();
    if (sel) { searchInput.value = sel; searchAddon.findNext(sel, searchOpts); }
  }
  function closeSearchBar() {
    searchBar.style.display = 'none';
    searchAddon.clearDecorations();
    searchInput.value = '';
    searchCount.textContent = '';
    terminal.focus();
  }
  searchInput.addEventListener('input', () => {
    const q = searchInput.value;
    if (q) { searchAddon.findNext(q, searchOpts); } else { searchAddon.clearDecorations(); searchCount.textContent = ''; }
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSearchBar(); e.preventDefault(); }
    else if (e.key === 'Enter' && e.shiftKey) { searchAddon.findPrevious(searchInput.value, searchOpts); e.preventDefault(); }
    else if (e.key === 'Enter') { searchAddon.findNext(searchInput.value, searchOpts); e.preventDefault(); }
  });
  searchBar.querySelector('.terminal-search-next').addEventListener('click', () => searchAddon.findNext(searchInput.value, searchOpts));
  searchBar.querySelector('.terminal-search-prev').addEventListener('click', () => searchAddon.findPrevious(searchInput.value, searchOpts));
  searchBar.querySelector('.terminal-search-close').addEventListener('click', closeSearchBar);

  const entry = { terminal, element: container, fitAddon, searchAddon, openSearchBar, closeSearchBar, session, closed: false };
  openSessions.set(sessionId, entry);

  // Wire up IPC (use entry.session.sessionId so fork re-keying works)
  terminal.onData(data => {
    if (data === '\x1b[I' || data === '\x1b[O') return;
    window.api.sendInput(entry.session.sessionId, data);
    // Scheduler: broadcast mode — mirror input to all broadcast targets
    if (typeof schedulerGetBroadcastTargets === 'function') {
      const targets = schedulerGetBroadcastTargets();
      if (targets) { for (const sid of targets) { if (sid !== entry.session.sessionId) window.api.sendInput(sid, data); } }
    }
    // Scheduler: macro recording — capture keystrokes
    if (typeof recordMacroInput === 'function') recordMacroInput(data);
  });
  setupTerminalKeyBindings(terminal, container, () => entry.session.sessionId, { onFind: openSearchBar });
  setupDragAndDrop(container, () => entry.session.sessionId);
  terminal.onResize(({ cols, rows }) => {
    window.api.resizeTerminal(entry.session.sessionId, cols, rows);
  });
  terminal.onTitleChange(title => {
    entry.ptyTitle = title;
    if (activeSessionId === entry.session.sessionId) updatePtyTitle();
  });
  terminal.onBell(() => {
    trackActivity(entry.session.sessionId, '\x07');
  });

  return entry;
}

// Clean up a closed session entry (dispose terminal, remove DOM, remove from maps).
function destroySession(sessionId) {
  const entry = openSessions.get(sessionId);
  if (!entry) return;
  window.api.closeTerminal(sessionId);
  entry.terminal.dispose();
  entry.element.remove();
  openSessions.delete(sessionId);
  const card = gridCards.get(sessionId);
  if (card) { card.remove(); gridCards.delete(sessionId); }
}

// Make a session visible in the current view mode (grid or single).
// Handles sidebar highlight, notifications, header, fit, and focus.
function showSession(sessionId) {
  const entry = openSessions.get(sessionId);
  const session = sessionMap.get(sessionId) || (entry && entry.session);

  // Update sidebar active state
  document.querySelectorAll('.session-item.active').forEach(el => el.classList.remove('active'));
  const item = document.querySelector(`[data-session-id="${sessionId}"]`);
  if (item) item.classList.add('active');
  setActiveSession(sessionId);
  clearNotifications(sessionId);

  if (gridViewActive) {
    // Ensure grid layout is set up (e.g. on first session after startup restore)
    if (!terminalsEl.classList.contains('grid-layout')) {
      showGridView();
    }
    if (entry && gridCards.has(sessionId)) {
      // Already in grid — just focus it
      focusGridCard(sessionId);
    } else if (entry) {
      // New entry not yet in grid — wrap and focus
      wrapInGridCard(sessionId);
      fitAndScroll(entry);
      requestAnimationFrame(() => focusGridCard(sessionId));
      gridViewerCount.textContent = gridCards.size + ' session' + (gridCards.size !== 1 ? 's' : '');
    }
  } else {
    // Single terminal view
    document.querySelectorAll('.terminal-container').forEach(el => el.classList.remove('visible'));
    placeholder.style.display = 'none';
    hidePlanViewer();
    hideConversationViewer();

    // Remove any existing headless log panel
    const oldLog = document.getElementById('headless-log-panel');
    if (oldLog) oldLog.remove();

    if (session && session.type === 'headless') {
      // Show headless event log instead of terminal
      if (session) showTerminalHeader(session);
      const logPanel = document.createElement('div');
      logPanel.id = 'headless-log-panel';
      logPanel.className = 'headless-log terminal-container visible';
      const state = headlessState.get(sessionId);
      if (state) {
        for (const ev of state.events) {
          logPanel.appendChild(buildLogEntry(ev));
        }
        logPanel.scrollTop = logPanel.scrollHeight;
      }
      terminalsEl.appendChild(logPanel);

      // Live-update the log as events come in
      if (!logPanel._listener) {
        logPanel._listener = true;
        window._headlessLogUpdater = (sid, ev) => {
          if (sid !== sessionId) return;
          const panel = document.getElementById('headless-log-panel');
          if (!panel) return;
          panel.appendChild(buildLogEntry(ev));
          panel.scrollTop = panel.scrollHeight;
        };
      }
    } else {
      if (session) showTerminalHeader(session);
      if (entry) {
        entry.element.classList.add('visible');
        entry.terminal.focus();
        fitAndScroll(entry);
      }
    }
  }
}

// --- End shared terminal lifecycle helpers ---
// Terminal lifecycle (createTerminalEntry, destroySession, showSession, setupDragAndDrop) → terminal-manager.js

async function unarchiveSessionBeforeOpen(session) {
  if (!session.archived) return true;

  const displayName = cleanDisplayName(session.name || session.aiTitle || session.summary) || 'This session';
  if (!confirm(`“${displayName}” is archived.\n\nUnarchive it and open it?`)) return false;

  const result = await window.api.archiveSession(session.sessionId, 0);
  if (result?.error) {
    alert(result.error);
    return false;
  }
  session.archived = 0;
  await loadProjects();
  return true;
}

async function openSession(session, customOptions) {
  if (!await unarchiveSessionBeforeOpen(session)) return;

  const { sessionId, projectPath } = session;

  // Headless sessions don't need a terminal — just show the log panel
  if (session.type === 'headless') {
    showSession(sessionId);
    return;
  }

  // Non-running historical sessions → show conversation viewer instead of spawning terminal
  const isRunning = activePtyIds.has(sessionId);
  if (!isRunning && session.type !== 'terminal') {
    activeSessionId = sessionId;
    await showConversationViewer(session);
    return;
  }

  // If already open, handle closed-session cleanup or just show it
  if (openSessions.has(sessionId)) {
    const entry = openSessions.get(sessionId);
    if (entry.closed) {
      destroySession(sessionId, {
        forgetPersisted: session.type !== 'terminal',
        preserveHistory: true,
      });
      if (session.type === 'terminal') {
        await openRawTerminalSession(session);
        pollActiveSessions();
        return;
      }
    } else {
      showSession(sessionId);
      return;
    }
  }

  if (session.type === 'terminal') {
    await openRawTerminalSession(session);
    pollActiveSessions();
    return;
  }

  // Create new terminal entry (hidden until showSession)
  const entry = createTerminalEntry(session);

  // Show loading overlay
  const loadingEl = document.getElementById('terminal-loading');
  if (loadingEl) loadingEl.style.display = 'flex';

  // Open terminal in main process
  const resumeOptions = { ...(customOptions || await resolveDefaultSessionOptions({ projectPath })) };
  // Which CLI to resume with. Main re-reads this from the cached row and only
  // trusts the hint for sessions it has never indexed.
  if (session.runtime) resumeOptions.runtime = session.runtime;
  const result = await window.api.openTerminal(sessionId, projectPath, false, resumeOptions);
  if (!result.ok) {
    entry.terminal.write(`\r\nError: ${result.error}\r\n`);
    entry.closed = true;
    return;
  }
  if (typeof setSessionMcpActive === 'function') setSessionMcpActive(sessionId, !!result.mcpActive);

  // Relaunching a session that had died clears the dead marker on its pending entry
  const pending = pendingSessions.get(sessionId);
  if (pending) pending.exited = false;

  showSession(sessionId);
  pollActiveSessions();
}

// Handle window resize
window.addEventListener('resize', () => {
  if (gridViewActive) {
    for (const entry of openSessions.values()) {
      fitAndScroll(entry);
    }
    return;
  }
  if (activeSessionId && openSessions.has(activeSessionId)) {
    const entry = openSessions.get(activeSessionId);
    safeFit(entry);
  }
});

function cleanDisplayName(name) {
  if (!name) return name;
  const prefix = 'Implement the following plan:';
  if (name.startsWith(prefix)) name = name.slice(prefix.length).trim();
  // Strip XML/HTML-like tags (e.g. <command>, </message>, <system-reminder>)
  name = name.replace(/<\/?[a-zA-Z][a-zA-Z0-9_-]*(?:\s[^>]*)?\/?>/g, ' ');
  // Collapse multiple spaces and trim
  name = name.replace(/\s+/g, ' ').trim();
  return name;
}

function formatDate(date) {
  const now = new Date();
  const diff = now - date;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function shellEscape(path) {
  return "'" + path.replace(/'/g, "'\\''") + "'";
}

function setupDragAndDrop(container, getSessionId) {
  let dragCounter = 0;
  container.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    container.classList.add('drag-over');
  });
  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  container.addEventListener('dragleave', () => {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      container.classList.remove('drag-over');
    }
  });
  container.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    container.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (!files.length) return;
    const paths = Array.from(files).map(f => shellEscape(window.api.getPathForFile(f)));
    window.api.sendInput(getSessionId(), paths.join(' '));
  });
}

// --- Tab switching ---
document.querySelectorAll('.sidebar-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;
    // The more button shares the tab styling but opens a menu instead.
    if (!tabName || tabName === activeTab) return;
    // Leaving the Projects tab takes its page, strip and pane with it.
    if (activeTab === 'projects' && typeof leaveProjectViews === 'function') leaveProjectViews();
    activeTab = tabName;
    if (REMEMBERED_TABS.includes(tabName)) { try { localStorage.setItem(LAST_TAB_KEY, tabName); } catch {} }
    document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
    updateMoreButton();

    // Clear search on tab switch
    searchInput.value = '';
    searchBar.classList.remove('has-query');
    searchMatchIds = null;
    searchMatchProjectPaths = null;

    // Hide all sidebar content areas
    sidebarContent.style.display = 'none';
    projectsContent.style.display = 'none';
    plansContent.style.display = 'none';
    statsContent.style.display = 'none';
    memoryContent.style.display = 'none';
    sessionFilters.style.display = 'none';
    searchBar.style.display = 'none';

    // Sessions and Projects share the main area: the grid, the active
    // terminal, or the placeholder.
    function restoreTerminalArea() {
      hideAllViewers();
      if (gridViewActive) {
        // Grid is still set up — just re-show it and refit
        placeholder.style.display = 'none';
        terminalHeader.style.display = 'none';
        gridViewer.style.display = 'block';
        for (const entry of openSessions.values()) {
          if (!entry.closed) fitAndScroll(entry);
        }
      } else if (activeSessionId && openSessions.has(activeSessionId)) {
        showSession(activeSessionId);
      } else {
        placeholder.style.display = '';
      }
    }

    if (tabName === 'sessions') {
      sessionFilters.style.display = '';
      searchBar.style.display = '';
      searchInput.placeholder = 'Search sessions...';
      sidebarContent.style.display = '';
      restoreTerminalArea();
      // Catch up on changes that happened while on another tab
      if (projectsChangedWhileAway) {
        projectsChangedWhileAway = false;
        loadProjects();
      }
    } else if (tabName === 'projects') {
      searchBar.style.display = '';
      searchInput.placeholder = 'Search projects...';
      projectsContent.style.display = '';
      if (projectsChangedWhileAway) {
        projectsChangedWhileAway = false;
        loadProjects().then(() => showProjectHome());
      } else {
        renderProjectList();
        showProjectHome();
      }
    } else if (tabName === 'plans') {
      searchBar.style.display = '';
      searchInput.placeholder = 'Search plans...';
      plansContent.style.display = '';
      loadPlans();
    } else if (tabName === 'stats') {
      statsContent.style.display = '';
      // Immediately show stats viewer in main area
      placeholder.style.display = 'none';
      terminalArea.style.display = 'none';
      planViewer.style.display = 'none';
      memoryViewer.style.display = 'none';
      settingsViewer.style.display = 'none';
      statsViewer.style.display = 'flex';
      loadStats();
    } else if (tabName === 'memory') {
      searchBar.style.display = '';
      searchInput.placeholder = 'Search agent files...';
      memoryContent.style.display = '';
      loadMemories();
    }
  });
});

// Plans & viewer helpers → plans-memory-view.js


// Grid view → grid-view.js
// Initialize grid observers now that DOM refs are ready
initGridObservers();

// JSONL viewer (renderJsonlText, formatDuration, makeCollapsible, renderJsonlEntry, showJsonlViewer) → jsonl-viewer.js

// Stats view (loadStats, buildUsageSection, buildDailyBarChart, buildHeatmap, calculateStreak, buildStatsSummary) → stats-view.js

// Memory viewer → plans-memory-view.js


// Dialogs (resolveDefaultSessionOptions, forkSession, showNewSessionPopover,
// showNewSessionDialog, showResumeSessionDialog, showAddProjectDialog, launchTerminalSession) → dialogs.js

async function openPlan(plan) {
  // Mark active in sidebar
  plansContent.querySelectorAll('.plan-item.active').forEach(el => el.classList.remove('active'));
  const items = plansContent.querySelectorAll('.plan-item');
  items.forEach(el => {
    if (el.querySelector('.session-id')?.textContent === plan.filename) {
      el.classList.add('active');
    }
  });

  const result = await window.api.readPlan(plan.filename);
  currentPlanContent = result.content;
  currentPlanFilePath = result.filePath;
  currentPlanFilename = plan.filename;

  // Hide terminal area and placeholder, show plan viewer
  placeholder.style.display = 'none';
  terminalArea.style.display = 'none';
  statsViewer.style.display = 'none';
  memoryViewer.style.display = 'none';
  settingsViewer.style.display = 'none';
  planViewer.style.display = 'flex';

  planPanel.open(plan.title, currentPlanFilePath, currentPlanContent);
}

function hideAllViewers() {
  planViewer.style.display = 'none';
  statsViewer.style.display = 'none';
  memoryViewer.style.display = 'none';
  settingsViewer.style.display = 'none';
  jsonlViewer.style.display = 'none';
  terminalArea.style.display = '';
}

function hidePlanViewer() {
  hideAllViewers();
}

// --- Session Grid Overview ---
// No reparenting — terminals stay in #terminals. We wrap each terminal container
// with an in-place card overlay (header/footer) and switch #terminals to grid layout.

let gridCards = new Map(); // sessionId → card wrapper element
let gridFocusedSessionId = null;

function wrapInGridCard(sessionId) {
  const entry = openSessions.get(sessionId);
  const session = sessionMap.get(sessionId) || (entry && entry.session);
  if (!session || !entry) return;

  const displayName = cleanDisplayName(session.name || session.summary) || sessionId;
  const shortProject = session.projectPath ? session.projectPath.split('/').filter(Boolean).slice(-2).join('/') : '';

  // Create card wrapper
  const card = document.createElement('div');
  card.className = 'grid-card';
  card.dataset.sessionId = sessionId;

  // Header
  const header = document.createElement('div');
  header.className = 'grid-card-header';
  const dot = document.createElement('span');
  dot.className = 'grid-card-dot';
  header.appendChild(dot);
  const name = document.createElement('span');
  name.className = 'grid-card-name';
  name.textContent = displayName;
  header.appendChild(name);
  const project = document.createElement('span');
  project.className = 'grid-card-project';
  project.textContent = shortProject;
  header.appendChild(project);

  // Agent label in grid card header (for non-claude sessions)
  const cardAgentId = sessionAgentMap.get(sessionId);
  if (cardAgentId && cardAgentId !== 'claude') {
    const agentLabel = document.createElement('span');
    agentLabel.className = 'grid-card-agent';
    agentLabel.textContent = AGENT_LABELS[cardAgentId] || cardAgentId;
    agentLabel.style.color = AGENT_COLORS[cardAgentId] || '#8888a0';
    header.appendChild(agentLabel);
  }

  const gridSchedBtn = document.createElement('button');
  gridSchedBtn.className = 'grid-card-scheduler-btn';
  gridSchedBtn.title = 'Command Scheduler';
  gridSchedBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
  gridSchedBtn.onclick = (e) => {
    e.stopPropagation();
    if (typeof openScheduler === 'function') openScheduler(sessionId);
  };
  header.appendChild(gridSchedBtn);

  const stopBtn = document.createElement('button');
  stopBtn.className = 'grid-card-stop-btn';
  stopBtn.title = 'Stop session';
  stopBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="2" width="8" height="8" rx="1"/></svg>';
  stopBtn.style.display = activePtyIds.has(sessionId) ? '' : 'none';
  stopBtn.onclick = (e) => {
    e.stopPropagation();
    confirmAndStopSession(sessionId);
  };
  header.appendChild(stopBtn);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'grid-card-footer';
  const statusSpan = document.createElement('span');
  const timeSpan = document.createElement('span');
  timeSpan.textContent = formatDate(lastActivityTime.get(sessionId) || new Date(session.modified));
  footer.appendChild(statusSpan);
  footer.appendChild(timeSpan);

  // Build the card DOM
  card.appendChild(header);
  entry.element.classList.add('visible', 'grid-mode');
  card.appendChild(entry.element);
  card.appendChild(footer);

  // Insert card into the correct project group in the grid
  if (gridViewActive) {
    const pp = session.projectPath || '';
    // Find or create the project heading for this session
    let targetHeading = null;
    for (const h of terminalsEl.querySelectorAll('.grid-project-heading')) {
      if (h.dataset.projectPath === pp) { targetHeading = h; break; }
    }
    if (!targetHeading) {
      targetHeading = document.createElement('div');
      targetHeading.className = 'grid-project-heading';
      targetHeading.dataset.projectPath = pp;
      targetHeading.textContent = pp ? pp.split('/').filter(Boolean).slice(-2).join('/') : 'Other';
      // Insert heading in sortedOrder position
      const orderIndex = new Map(sortedOrder.map((e, i) => [e.projectPath, i]));
      const myIdx = orderIndex.get(pp);
      let inserted = false;
      if (myIdx !== undefined) {
        for (const h of terminalsEl.querySelectorAll('.grid-project-heading')) {
          const hIdx = orderIndex.get(h.dataset.projectPath);
          if (hIdx !== undefined && hIdx > myIdx) {
            terminalsEl.insertBefore(targetHeading, h);
            inserted = true;
            break;
          }
        }
      }
      if (!inserted) terminalsEl.appendChild(targetHeading);
    }
    // Insert card after the heading and any existing cards in this group
    // (find next heading or end of container)
    let insertBefore = targetHeading.nextSibling;
    while (insertBefore && !insertBefore.classList.contains('grid-project-heading')) {
      insertBefore = insertBefore.nextSibling;
    }
    terminalsEl.insertBefore(card, insertBefore);
  } else {
    // Not in grid view — just place where the terminal container was
    terminalsEl.appendChild(card);
  }

  // Click header or footer to focus
  header.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    focusGridCard(sessionId);
  });
  // Double-click header to switch to full terminal view
  header.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    gridFocusedSessionId = sessionId;
    toggleGridView();
  });
  footer.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    focusGridCard(sessionId);
  });

  // Clicking/focusing the terminal area also selects the card
  entry.element.addEventListener('focusin', () => {
    if (gridViewActive && gridFocusedSessionId !== sessionId) {
      focusGridCard(sessionId);
    }
  });

  gridCards.set(sessionId, card);
  // Set initial status from the single source of truth
  updateRunningIndicators();
}

function unwrapGridCards() {
  for (const [sid, card] of gridCards) {
    const entry = openSessions.get(sid);
    if (entry) {
      entry.element.classList.remove('grid-mode', 'visible');
      // Move terminal container back out of the card, before the card
      card.parentNode.insertBefore(entry.element, card);
    }
    card.remove();
  }
  gridCards.clear();
  // Remove project headings inserted by showGridView
  terminalsEl.querySelectorAll('.grid-project-heading').forEach(el => el.remove());
}

function focusGridCard(sessionId) {
  gridFocusedSessionId = sessionId;
  setActiveSession(sessionId);
  clearNotifications(sessionId);
  // Update sidebar active highlight
  document.querySelectorAll('.session-item.active').forEach(el => el.classList.remove('active'));
  const sidebarItem = document.querySelector(`.session-item[data-session-id="${sessionId}"]`);
  if (sidebarItem) sidebarItem.classList.add('active');
  // Update visual focus
  document.querySelectorAll('.grid-card').forEach(c => c.classList.remove('focused'));
  const card = gridCards.get(sessionId);
  if (card) {
    card.classList.add('focused');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  const entry = openSessions.get(sessionId);
  if (entry) entry.terminal.focus();
}

function showGridView() {
  gridViewActive = true;
  localStorage.setItem('gridViewActive', '1');
  placeholder.style.display = 'none';
  terminalHeader.style.display = 'none';

  // Hide other viewers but keep terminal-area visible
  planViewer.style.display = 'none';
  statsViewer.style.display = 'none';
  memoryViewer.style.display = 'none';
  settingsViewer.style.display = 'none';
  jsonlViewer.style.display = 'none';
  terminalArea.style.display = '';

  // Switch #terminals to grid layout
  terminalsEl.classList.add('grid-layout');

  // Collect open (non-closed) session IDs
  const openSet = new Set();
  for (const [sid, entry] of openSessions) {
    if (!entry.closed) openSet.add(sid);
  }

  // Use cachedProjects sorted by sortedOrder — same grouping & order as sidebar
  let projects = [...cachedProjects];
  if (sortedOrder.length > 0) {
    const orderIndex = new Map(sortedOrder.map((e, i) => [e.projectPath, i]));
    projects.sort((a, b) => {
      const aPos = orderIndex.get(a.projectPath);
      const bPos = orderIndex.get(b.projectPath);
      if (aPos !== undefined && bPos !== undefined) return aPos - bPos;
      if (aPos === undefined && bPos !== undefined) return -1;
      if (aPos !== undefined && bPos === undefined) return 1;
      return 0;
    });
  }

  // Hide all terminals first, then wrap cards in sidebar order (grouped by project)
  document.querySelectorAll('.terminal-container').forEach(el => el.classList.remove('visible'));
  const sessionIds = [];
  // Walk sidebar items to get sessions in display order, grouped by project
  const sidebarItems = sidebarContent.querySelectorAll('.session-item[data-session-id]');
  let currentProjectPath = null;
  for (const item of sidebarItems) {
    const sid = item.dataset.sessionId;
    if (!openSet.has(sid)) continue;
    // Determine project path for this session
    const session = sessionMap.get(sid);
    const projectPath = session ? session.projectPath : null;
    // Add project heading when project changes
    if (projectPath && projectPath !== currentProjectPath) {
      currentProjectPath = projectPath;
      const heading = document.createElement('div');
      heading.className = 'grid-project-heading';
      heading.dataset.projectPath = projectPath;
      heading.textContent = projectPath.split('/').filter(Boolean).slice(-2).join('/');
      terminalsEl.appendChild(heading);
    }
    wrapInGridCard(sid);
    sessionIds.push(sid);
  }

  // Show grid header bar with session count
  gridViewer.style.display = 'block';
  gridViewerCount.textContent = sessionIds.length + ' session' + (sessionIds.length !== 1 ? 's' : '');

  const btn = document.getElementById('grid-toggle-btn');
  if (btn) btn.classList.add('active');

  // Fit all terminals after layout resolves
  for (const sid of sessionIds) {
    const entry = openSessions.get(sid);
    if (entry) fitAndScroll(entry);
  }
  // Focus active or first (deferred so fitAndScroll's rAF runs first)
  requestAnimationFrame(() => {
    const toFocus = activeSessionId && sessionIds.includes(activeSessionId) ? activeSessionId : sessionIds[0];
    if (toFocus) focusGridCard(toFocus);
  });
}

function updateGridColumns() {
  if (!gridViewActive) return;
  const width = terminalsEl.clientWidth;
  const minCardWidth = 560;
  const gap = 14;
  const fitCols = Math.max(1, Math.floor((width + gap) / (minCardWidth + gap)));
  const cardCount = terminalsEl.querySelectorAll('.grid-card').length;
  const cols = Math.max(1, Math.min(fitCols, cardCount || 1));
  terminalsEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
}
new ResizeObserver(updateGridColumns).observe(terminalsEl);
new MutationObserver(updateGridColumns).observe(terminalsEl, { childList: true });

function hideGridView() {
  gridViewActive = false;
  localStorage.setItem('gridViewActive', '0');
  unwrapGridCards();
  terminalsEl.classList.remove('grid-layout');
  terminalsEl.style.gridTemplateColumns = '';
  gridViewer.style.display = 'none';
  const btn = document.getElementById('grid-toggle-btn');
  if (btn) btn.classList.remove('active');
}

function toggleGridView() {
  if (gridViewActive) {
    const restoreId = gridFocusedSessionId || activeSessionId;
    hideGridView();
    gridFocusedSessionId = null;
    if (restoreId && openSessions.has(restoreId)) {
      showSession(restoreId);
    } else {
      placeholder.style.display = '';
    }
  } else {
    terminalHeader.style.display = 'none';
    showGridView();
  }
}

// --- Session navigation (Cmd+Shift+[/], Cmd+Arrow) ---

// Returns ordered list of open (non-closed) session IDs matching sidebar order.
function getOrderedOpenSessionIds() {
  const items = sidebarContent.querySelectorAll('.session-item[data-session-id]');
  const ids = [];
  for (const item of items) {
    const sid = item.dataset.sessionId;
    const entry = openSessions.get(sid);
    if (entry && !entry.closed) ids.push(sid);
  }
  return ids;
}

function navigateSession(direction) {
  const ids = getOrderedOpenSessionIds();
  const current = gridViewActive ? gridFocusedSessionId : activeSessionId;
  const idx = ids.indexOf(current);
  let next;
  if (idx === -1) {
    next = ids[0];
  } else {
    next = ids[(idx + direction + ids.length) % ids.length];
  }
  if (ids.length === 0 || !next) return;
  if (gridViewActive) {
    focusGridCard(next);
  } else {
    showSession(next);
  }
}

// Navigate the grid in 2D by visual position using bounding rects.
// Project headings break the simple index math, so we use actual screen positions.
function navigateGrid(direction) {
  if (!gridViewActive) return;
  const cards = [...terminalsEl.querySelectorAll('.grid-card')];
  if (cards.length === 0) return;
  const currentCard = gridCards.get(gridFocusedSessionId || activeSessionId);
  if (!currentCard || !cards.includes(currentCard)) {
    for (const [sid, card] of gridCards) {
      if (card === cards[0]) { focusGridCard(sid); return; }
    }
    return;
  }
  const cur = currentCard.getBoundingClientRect();
  const curCx = cur.left + cur.width / 2;
  const curCy = cur.top + cur.height / 2;
  let best = null;
  let bestDist = Infinity;
  for (const card of cards) {
    if (card === currentCard) continue;
    const r = card.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    // Filter by direction
    const dx = cx - curCx;
    const dy = cy - curCy;
    let valid = false;
    switch (direction) {
      case 'left':  valid = dx < -10; break;
      case 'right': valid = dx > 10; break;
      case 'up':    valid = dy < -10; break;
      case 'down':  valid = dy > 10; break;
    }
    if (!valid) continue;
    // For left/right prefer same row (small dy), for up/down prefer same column (small dx)
    let dist;
    if (direction === 'left' || direction === 'right') {
      dist = Math.abs(dy) * 3 + Math.abs(dx);
    } else {
      dist = Math.abs(dx) * 3 + Math.abs(dy);
    }
    if (dist < bestDist) {
      bestDist = dist;
      best = card;
    }
  }
  if (!best) return;
  for (const [sid, card] of gridCards) {
    if (card === best) { focusGridCard(sid); return; }
  }
}

// Returns true if the key combo is a session nav shortcut (used by xterm to block without acting)
function isSessionNavKey(e) {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (!mod || e.altKey) return false;
  if (e.shiftKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')) return true;
  if (!e.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return true;
  return false;
}

function handleSessionNavKey(e) {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (!mod || e.altKey) return false;

  // Cmd+Shift+[ or Cmd+Shift+] — prev/next session
  // On macOS, Shift changes e.key to { / }, so check code for reliable matching
  if (e.shiftKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
    e.preventDefault();
    if (e.type === 'keydown') navigateSession(e.code === 'BracketLeft' ? -1 : 1);
    return true;
  }

  // Cmd+Arrow — in grid view: 2D grid navigation; in single view: left/right cycle sessions
  if (!e.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    e.preventDefault();
    if (e.type === 'keydown') {
      if (gridViewActive) {
        const dirMap = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
        navigateGrid(dirMap[e.key]);
      } else {
        const dir = (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 1;
        navigateSession(dir);
      }
    }
    return true;
  }

  return false;
}

// --- JSONL Message History Viewer ---
function renderJsonlText(text) {
  let html = escapeHtml(text);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="jsonl-code-block"><code>$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code class="jsonl-inline-code">$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return html;
}

function formatDuration(ms) {
  if (ms < 1000) return ms + 'ms';
  const s = (ms / 1000).toFixed(1);
  return s + 's';
}

function makeCollapsible(className, headerText, bodyContent, startExpanded) {
  const wrapper = document.createElement('div');
  wrapper.className = className;
  const header = document.createElement('div');
  header.className = 'jsonl-toggle' + (startExpanded ? ' expanded' : '');
  header.textContent = headerText;
  const body = document.createElement('pre');
  body.className = 'jsonl-tool-body';
  body.style.display = startExpanded ? '' : 'none';
  if (typeof bodyContent === 'string') {
    body.textContent = bodyContent;
  } else {
    try { body.textContent = JSON.stringify(bodyContent, null, 2); } catch { body.textContent = String(bodyContent); }
  }
  header.onclick = () => {
    const showing = body.style.display !== 'none';
    body.style.display = showing ? 'none' : '';
    header.classList.toggle('expanded', !showing);
  };
  wrapper.appendChild(header);
  wrapper.appendChild(body);
  return wrapper;
}

function renderJsonlEntry(entry) {
  const ts = entry.timestamp;
  const timeStr = ts ? new Date(ts).toLocaleTimeString() : '';

  // --- custom-title ---
  if (entry.type === 'custom-title') {
    const div = document.createElement('div');
    div.className = 'jsonl-entry jsonl-meta-entry';
    div.innerHTML = '<span class="jsonl-meta-icon">T</span> Title set: <strong>' + escapeHtml(entry.customTitle || '') + '</strong>';
    return div;
  }

  // --- system entries ---
  if (entry.type === 'system') {
    const div = document.createElement('div');
    div.className = 'jsonl-entry jsonl-meta-entry';
    if (entry.subtype === 'turn_duration') {
      div.innerHTML = '<span class="jsonl-meta-icon">&#9201;</span> Turn duration: <strong>' + formatDuration(entry.durationMs) + '</strong>'
        + (timeStr ? ' <span class="jsonl-ts">' + timeStr + '</span>' : '');
    } else if (entry.subtype === 'local_command') {
      const cmdMatch = (entry.content || '').match(/<command-name>(.*?)<\/command-name>/);
      const cmd = cmdMatch ? cmdMatch[1] : entry.content || 'unknown';
      div.innerHTML = '<span class="jsonl-meta-icon">$</span> Command: <code class="jsonl-inline-code">' + escapeHtml(cmd) + '</code>'
        + (timeStr ? ' <span class="jsonl-ts">' + timeStr + '</span>' : '');
    } else {
      return null;
    }
    return div;
  }

  // --- progress entries ---
  if (entry.type === 'progress') {
    const data = entry.data;
    if (!data || typeof data !== 'object') return null;
    const dt = data.type;
    if (dt === 'bash_progress') {
      const div = document.createElement('div');
      div.className = 'jsonl-entry jsonl-meta-entry';
      const elapsed = data.elapsedTimeSeconds ? ` (${data.elapsedTimeSeconds}s, ${data.totalLines || 0} lines)` : '';
      div.innerHTML = '<span class="jsonl-meta-icon">&#9658;</span> Bash output' + escapeHtml(elapsed);
      if (data.output || data.fullOutput) {
        const output = data.fullOutput || data.output || '';
        div.appendChild(makeCollapsible('jsonl-tool-result', 'Output', output, false));
      }
      return div;
    }
    // Skip noisy progress types
    return null;
  }

  // --- user / assistant messages ---
  let role = null;
  let contentBlocks = null;

  if (entry.type === 'user' || (entry.type === 'message' && entry.role === 'user')) {
    role = 'user';
    contentBlocks = entry.message?.content || entry.content;
  } else if (entry.type === 'assistant' || (entry.type === 'message' && entry.role === 'assistant')) {
    role = 'assistant';
    contentBlocks = entry.message?.content || entry.content;
  } else {
    return null;
  }

  if (!contentBlocks) return null;
  if (typeof contentBlocks === 'string') {
    contentBlocks = [{ type: 'text', text: contentBlocks }];
  }
  if (!Array.isArray(contentBlocks)) return null;

  const div = document.createElement('div');
  div.className = 'jsonl-entry ' + (role === 'user' ? 'jsonl-user' : 'jsonl-assistant');

  const labelRow = document.createElement('div');
  labelRow.className = 'jsonl-role-label';
  labelRow.textContent = role === 'user' ? 'User' : 'Assistant';
  if (timeStr) {
    const tsSpan = document.createElement('span');
    tsSpan.className = 'jsonl-ts';
    tsSpan.textContent = timeStr;
    labelRow.appendChild(tsSpan);
  }
  div.appendChild(labelRow);

  for (const block of contentBlocks) {
    if (block.type === 'thinking' && block.thinking) {
      div.appendChild(makeCollapsible('jsonl-thinking', 'Thinking', block.thinking, false));
    } else if (block.type === 'text' && block.text) {
      const textEl = document.createElement('div');
      textEl.className = 'jsonl-text';
      textEl.innerHTML = renderJsonlText(block.text);
      div.appendChild(textEl);
    } else if (block.type === 'tool_use') {
      div.appendChild(makeCollapsible('jsonl-tool-call',
        'Tool: ' + (block.name || 'unknown'),
        typeof block.input === 'string' ? block.input : block.input,
        false));
    } else if (block.type === 'tool_result') {
      const resultContent = block.content || block.output || '';
      div.appendChild(makeCollapsible('jsonl-tool-result',
        'Tool Result' + (block.tool_use_id ? ' (' + block.tool_use_id.slice(0, 12) + '...)' : ''),
        resultContent,
        false));
    }
  }

  return div;
}

async function showJsonlViewer(session) {
  const result = await window.api.readSessionJsonl(session.sessionId);
  hideAllViewers();
  placeholder.style.display = 'none';
  terminalArea.style.display = 'none';
  jsonlViewer.style.display = 'flex';

  const displayName = session.name || session.summary || session.sessionId;
  jsonlViewerTitle.textContent = displayName;
  jsonlViewerSessionId.textContent = session.sessionId;
  jsonlViewerBody.innerHTML = '';

  if (result.error) {
    jsonlViewerBody.innerHTML = '<div class="plans-empty">Error loading messages: ' + escapeHtml(result.error) + '</div>';
    return;
  }

  const entries = result.entries || [];
  let rendered = 0;
  for (const entry of entries) {
    const el = renderJsonlEntry(entry);
    if (el) {
      jsonlViewerBody.appendChild(el);
      rendered++;
    }
  }

  if (rendered === 0) {
    jsonlViewerBody.innerHTML = '<div class="plans-empty">No messages found in this session.</div>';
  }
}

// --- Stats ---
let cachedUsage = null;

async function loadStats() {
  statsViewerBody.innerHTML = '';

  // Show spinner while refreshing
  const spinner = document.createElement('div');
  spinner.className = 'stats-spinner';
  spinner.innerHTML = `<div class="stats-spinner-icon"></div><span>Updating stats\u2026</span>`;
  statsViewerBody.appendChild(spinner);

  // Refresh stats cache via PTY (/stats + /usage)
  let stats, usage;
  try {
    const result = await window.api.refreshStats();
    stats = result?.stats;
    usage = result?.usage || {};
    cachedUsage = usage;
  } catch {
    // Fallback to cached stats
    stats = await window.api.getStats();
    usage = cachedUsage || {};
  }

  statsViewerBody.innerHTML = '';

  if (!stats && !Object.keys(usage).length) {
    statsViewerBody.innerHTML = '<div class="plans-empty">No stats data found. Run some Claude sessions first.</div>';
    return;
  }

  if (stats) {
    // dailyActivity may be an array of {date, messageCount, ...} or an object
    const rawDaily = stats.dailyActivity || {};
    let dailyMap = {};
    if (Array.isArray(rawDaily)) {
      for (const entry of rawDaily) {
        dailyMap[entry.date] = entry.messageCount || 0;
      }
    } else {
      for (const [date, data] of Object.entries(rawDaily)) {
        dailyMap[date] = typeof data === 'number' ? data : (data?.messageCount || data?.messages || data?.count || 0);
      }
    }
    buildHeatmap(dailyMap);
    buildDailyBarChart(stats);
    buildStatsSummary(stats, dailyMap);
  }

  // Build usage section below charts (from /usage output)
  if (Object.keys(usage).length) {
    buildUsageSection(usage);
  }

  // Multi-agent usage breakdown
  try {
    const agentStats = await window.api.getAgentStats();
    if (agentStats && Object.keys(agentStats).length) {
      buildAgentStatsSection(agentStats);
    }
  } catch {}

  if (stats) {
    const notice = document.createElement('div');
    notice.className = 'stats-notice';
    const lastDate = stats.lastComputedDate || 'unknown';
    notice.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-2px;margin-right:6px;flex-shrink:0"><circle cx="8" cy="8" r="7"/><line x1="8" y1="5" x2="8" y2="9"/><circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none"/></svg>Data sourced from Claude\u2019s stats cache (last updated ${escapeHtml(lastDate)}).`;
    statsViewerBody.appendChild(notice);
  }
}

function buildUsageSection(usage) {
  // Remove existing usage container if present (for refresh)
  const existing = statsViewerBody.querySelector('.usage-container');
  if (existing) existing.remove();

  const container = document.createElement('div');
  container.className = 'usage-container';

  const titleRow = document.createElement('div');
  titleRow.className = 'usage-title-row';
  const title = document.createElement('div');
  title.className = 'daily-chart-title';
  title.textContent = 'Rate Limits';
  titleRow.appendChild(title);

  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'usage-refresh-btn';
  refreshBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>';
  refreshBtn.title = 'Refresh usage';
  refreshBtn.onclick = async () => {
    refreshBtn.classList.add('usage-refresh-spinning');
    refreshBtn.disabled = true;
    try {
      const freshUsage = await window.api.getUsage();
      if (freshUsage && Object.keys(freshUsage).length) {
        cachedUsage = freshUsage;
        buildUsageSection(freshUsage);
      }
    } catch {}
    refreshBtn.classList.remove('usage-refresh-spinning');
    refreshBtn.disabled = false;
  };
  titleRow.appendChild(refreshBtn);
  container.appendChild(titleRow);

  // Show rate limit or error notice
  if (usage._rateLimited || usage._error) {
    const notice = document.createElement('div');
    notice.className = 'usage-rate-limited';
    if (usage._rateLimited) {
      const secs = usage.retryAfterSeconds || 0;
      const mins = Math.ceil(secs / 60);
      notice.textContent = secs > 0
        ? `Usage API rate limited. Try again in ~${mins} min${mins !== 1 ? 's' : ''}.`
        : 'Usage API rate limited. Try again later.';
    } else {
      notice.textContent = usage.message || 'Could not fetch usage data.';
    }
    container.appendChild(notice);
    const statsNotice = statsViewerBody.querySelector('.stats-notice');
    if (statsNotice) statsViewerBody.insertBefore(container, statsNotice);
    else statsViewerBody.appendChild(container);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'usage-grid';

  const items = [
    { key: 'session', label: 'Current session', resetKey: 'sessionReset' },
    { key: 'weekAll', label: 'Week (all models)', resetKey: 'weekAllReset' },
    { key: 'weekSonnet', label: 'Week (Sonnet)', resetKey: 'weekSonnetReset' },
    { key: 'weekOpus', label: 'Week (Opus)', resetKey: 'weekOpusReset' },
  ];

  for (const item of items) {
    if (usage[item.key] === undefined) continue;
    const pct = usage[item.key];
    const card = document.createElement('div');
    card.className = 'usage-card';

    const header = document.createElement('div');
    header.className = 'usage-card-header';
    const label = document.createElement('span');
    label.className = 'usage-card-label';
    label.textContent = item.label;
    header.appendChild(label);
    const pctEl = document.createElement('span');
    pctEl.className = 'usage-card-pct';
    pctEl.textContent = pct + '%';
    header.appendChild(pctEl);
    card.appendChild(header);

    const track = document.createElement('div');
    track.className = 'usage-track';
    const fill = document.createElement('div');
    fill.className = 'usage-fill' + (pct >= 80 ? ' usage-fill-high' : '');
    fill.style.width = Math.max(pct, 1) + '%';
    track.appendChild(fill);
    card.appendChild(track);

    if (usage[item.resetKey]) {
      const reset = document.createElement('div');
      reset.className = 'usage-card-reset';
      reset.textContent = 'Resets ' + usage[item.resetKey];
      card.appendChild(reset);
    }

    grid.appendChild(card);
  }

  container.appendChild(grid);
  // Insert before the stats notice footer if it exists, otherwise append
  const statsNotice = statsViewerBody.querySelector('.stats-notice');
  if (statsNotice) statsViewerBody.insertBefore(container, statsNotice);
  else statsViewerBody.appendChild(container);
}

function buildDailyBarChart(stats) {
  const rawTokens = stats.dailyModelTokens || [];
  const rawActivity = stats.dailyActivity || [];

  // Build maps for last 30 days
  const tokenMap = {};
  if (Array.isArray(rawTokens)) {
    for (const entry of rawTokens) {
      let total = 0;
      for (const count of Object.values(entry.tokensByModel || {})) total += count;
      tokenMap[entry.date] = total;
    }
  }
  const activityMap = {};
  if (Array.isArray(rawActivity)) {
    for (const entry of rawActivity) activityMap[entry.date] = entry;
  }

  // Generate last 30 days
  const days = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  const tokenValues = days.map(d => tokenMap[d] || 0);
  const msgValues = days.map(d => activityMap[d]?.messageCount || 0);
  const toolValues = days.map(d => activityMap[d]?.toolCallCount || 0);
  const maxTokens = Math.max(...tokenValues, 1);
  const maxMsgs = Math.max(...msgValues, 1);

  const container = document.createElement('div');
  container.className = 'daily-chart-container';

  const title = document.createElement('div');
  title.className = 'daily-chart-title';
  title.textContent = 'Last 30 days';
  container.appendChild(title);

  const chart = document.createElement('div');
  chart.className = 'daily-chart';

  for (let i = 0; i < days.length; i++) {
    const col = document.createElement('div');
    col.className = 'daily-chart-col';

    const bar = document.createElement('div');
    bar.className = 'daily-chart-bar';
    const pct = (tokenValues[i] / maxTokens) * 100;
    bar.style.height = Math.max(pct, tokenValues[i] > 0 ? 3 : 0) + '%';

    const msgPct = (msgValues[i] / maxMsgs) * 100;
    const msgBar = document.createElement('div');
    msgBar.className = 'daily-chart-bar-msgs';
    msgBar.style.height = Math.max(msgPct, msgValues[i] > 0 ? 3 : 0) + '%';

    const d = new Date(days[i]);
    const dayLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    let tokStr;
    if (tokenValues[i] >= 1e6) tokStr = (tokenValues[i] / 1e6).toFixed(1) + 'M';
    else if (tokenValues[i] >= 1e3) tokStr = (tokenValues[i] / 1e3).toFixed(1) + 'K';
    else tokStr = tokenValues[i].toString();
    col.title = `${dayLabel}\n${tokStr} tokens\n${msgValues[i]} messages\n${toolValues[i]} tool calls`;

    const label = document.createElement('div');
    label.className = 'daily-chart-label';
    label.textContent = d.getDate().toString();

    col.appendChild(bar);
    col.appendChild(msgBar);
    col.appendChild(label);
    chart.appendChild(col);
  }

  container.appendChild(chart);

  // Legend
  const legend = document.createElement('div');
  legend.className = 'daily-chart-legend';
  legend.innerHTML = '<span class="daily-chart-legend-dot tokens"></span> Tokens <span class="daily-chart-legend-dot msgs"></span> Messages';
  container.appendChild(legend);

  statsViewerBody.appendChild(container);
}

function buildHeatmap(counts) {
  const container = document.createElement('div');
  container.className = 'heatmap-container';

  // Generate 52 weeks of dates ending today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOfWeek = today.getDay(); // 0=Sun
  const endDate = new Date(today);
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - (52 * 7 + dayOfWeek));

  // Month labels
  const monthLabels = document.createElement('div');
  monthLabels.className = 'heatmap-month-labels';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let lastMonth = -1;
  const weekStarts = [];
  const d = new Date(startDate);
  while (d <= endDate) {
    if (d.getDay() === 0) {
      weekStarts.push(new Date(d));
    }
    d.setDate(d.getDate() + 1);
  }

  // Calculate month label positions
  const colWidth = 16; // 13px cell + 3px gap
  for (let w = 0; w < weekStarts.length; w++) {
    const m = weekStarts[w].getMonth();
    if (m !== lastMonth) {
      const label = document.createElement('span');
      label.className = 'heatmap-month-label';
      label.textContent = months[m];
      label.style.position = 'absolute';
      label.style.left = (w * colWidth) + 'px';
      monthLabels.appendChild(label);
      lastMonth = m;
    }
  }
  monthLabels.style.position = 'relative';
  monthLabels.style.height = '16px';
  container.appendChild(monthLabels);

  // Grid wrapper (day labels + grid)
  const wrapper = document.createElement('div');
  wrapper.className = 'heatmap-grid-wrapper';

  // Day labels
  const dayLabels = document.createElement('div');
  dayLabels.className = 'heatmap-day-labels';
  const dayNames = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
  for (const name of dayNames) {
    const label = document.createElement('div');
    label.className = 'heatmap-day-label';
    label.textContent = name;
    dayLabels.appendChild(label);
  }
  wrapper.appendChild(dayLabels);

  // Quartile thresholds
  const nonZero = Object.values(counts).filter(c => c > 0).sort((a, b) => a - b);
  const q1 = nonZero[Math.floor(nonZero.length * 0.25)] || 1;
  const q2 = nonZero[Math.floor(nonZero.length * 0.5)] || 2;
  const q3 = nonZero[Math.floor(nonZero.length * 0.75)] || 3;

  // Grid
  const grid = document.createElement('div');
  grid.className = 'heatmap-grid';

  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const dateStr = cursor.toISOString().slice(0, 10);
    const count = counts[dateStr] || 0;
    let level = 0;
    if (count > 0) {
      if (count <= q1) level = 1;
      else if (count <= q2) level = 2;
      else if (count <= q3) level = 3;
      else level = 4;
    }

    const cell = document.createElement('div');
    cell.className = `heatmap-cell heatmap-level-${level}`;
    const displayDate = cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    cell.title = count > 0 ? `${displayDate}: ${count} messages` : `${displayDate}: No activity`;
    grid.appendChild(cell);

    cursor.setDate(cursor.getDate() + 1);
  }

  wrapper.appendChild(grid);
  container.appendChild(wrapper);

  // Legend
  const legend = document.createElement('div');
  legend.className = 'heatmap-legend';
  const lessLabel = document.createElement('span');
  lessLabel.className = 'heatmap-legend-label';
  lessLabel.textContent = 'Less';
  legend.appendChild(lessLabel);
  for (let i = 0; i <= 4; i++) {
    const cell = document.createElement('div');
    cell.className = `heatmap-legend-cell heatmap-level-${i}`;
    legend.appendChild(cell);
  }
  const moreLabel = document.createElement('span');
  moreLabel.className = 'heatmap-legend-label';
  moreLabel.textContent = 'More';
  legend.appendChild(moreLabel);
  container.appendChild(legend);

  statsViewerBody.appendChild(container);
}

function calculateStreak(counts) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let current = 0;
  let longest = 0;
  let streak = 0;

  const d = new Date(today);
  let started = false;
  for (let i = 0; i < 365; i++) {
    const dateStr = d.toISOString().slice(0, 10);
    const count = counts[dateStr] || 0;
    if (count > 0) {
      streak++;
      started = true;
    } else {
      if (started) {
        if (!current) current = streak;
        if (streak > longest) longest = streak;
        streak = 0;
        if (current) started = false;
      }
    }
    d.setDate(d.getDate() - 1);
  }
  if (streak > longest) longest = streak;
  if (!current && streak > 0) current = streak;

  return { current, longest };
}

function buildStatsSummary(stats, dailyMap) {
  const summaryEl = document.createElement('div');
  summaryEl.className = 'stats-summary';

  const { current: currentStreak, longest: longestStreak } = calculateStreak(dailyMap);

  // Total messages from map
  let totalMessages = 0;
  for (const count of Object.values(dailyMap)) {
    totalMessages += count;
  }
  // Prefer stats.totalMessages if available and larger
  if (stats.totalMessages && stats.totalMessages > totalMessages) {
    totalMessages = stats.totalMessages;
  }

  const totalSessions = stats.totalSessions || Object.keys(dailyMap).length;

  // Model usage — values are objects with token counts, show as cards
  const models = stats.modelUsage || {};

  const cards = [
    { value: totalSessions.toLocaleString(), label: 'Total Sessions' },
    { value: totalMessages.toLocaleString(), label: 'Total Messages' },
    { value: currentStreak + 'd', label: 'Current Streak' },
    { value: longestStreak + 'd', label: 'Longest Streak' },
  ];

  for (const [model, usage] of Object.entries(models)) {
    const shortName = model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
    const tokens = (usage?.inputTokens || 0) + (usage?.outputTokens || 0);
    const label = shortName;
    // Format token count in millions/thousands
    let valueStr;
    if (tokens >= 1e9) valueStr = (tokens / 1e9).toFixed(1) + 'B';
    else if (tokens >= 1e6) valueStr = (tokens / 1e6).toFixed(1) + 'M';
    else if (tokens >= 1e3) valueStr = (tokens / 1e3).toFixed(1) + 'K';
    else valueStr = tokens.toLocaleString();
    cards.push({ value: valueStr, label: label + ' tokens' });
  }

  for (const card of cards) {
    const el = document.createElement('div');
    el.className = 'stat-card';
    el.innerHTML = `<span class="stat-card-value">${escapeHtml(card.value)}</span><span class="stat-card-label">${escapeHtml(card.label)}</span>`;
    summaryEl.appendChild(el);
  }

  statsViewerBody.appendChild(summaryEl);
}

function buildAgentStatsSection(agentStats) {
  const container = document.createElement('div');
  container.className = 'agent-stats-container';

  const title = document.createElement('div');
  title.className = 'daily-chart-title';
  title.textContent = 'AI Agent Usage (All CLIs)';
  container.appendChild(title);

  const sorted = Object.entries(agentStats)
    .filter(([, s]) => !s.error && s.totalSessions > 0)
    .sort((a, b) => b[1].last30Days - a[1].last30Days);

  if (!sorted.length) {
    container.innerHTML += '<div class="plans-empty">No agent history found.</div>';
    statsViewerBody.appendChild(container);
    return;
  }

  const maxSessions = Math.max(...sorted.map(([, s]) => s.last30Days), 1);

  for (const [agentId, s] of sorted) {
    const row = document.createElement('div');
    row.className = 'agent-stat-row';

    const barWidth = Math.max(2, (s.last30Days / maxSessions) * 100);
    const sizeStr = s.totalSizeBytes >= 1e6
      ? (s.totalSizeBytes / 1e6).toFixed(1) + ' MB'
      : (s.totalSizeBytes / 1e3).toFixed(0) + ' KB';

    const lastUsedStr = s.lastUsed
      ? new Date(s.lastUsed).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : 'never';

    row.innerHTML = `
      <div class="agent-stat-label">
        <span class="agent-stat-dot" style="background:${s.color}"></span>
        <span class="agent-stat-name">${escapeHtml(s.name)}</span>
      </div>
      <div class="agent-stat-bar-wrap">
        <div class="agent-stat-bar" style="width:${barWidth}%;background:${s.color}"></div>
      </div>
      <div class="agent-stat-meta">
        <span>${s.last30Days} / 30d</span>
        <span>${s.last7Days} / 7d</span>
        <span>${s.totalSessions} total</span>
        <span>${sizeStr}</span>
        <span>Last: ${lastUsedStr}</span>
      </div>
    `;
    container.appendChild(row);
  }

  const totalMsgs = sorted.reduce((sum, [, s]) => sum + (s.estimatedMessages || 0), 0);
  const totalTools = sorted.reduce((sum, [, s]) => sum + (s.estimatedToolUses || 0), 0);
  if (totalMsgs > 0) {
    const summary = document.createElement('div');
    summary.className = 'agent-stats-summary';
    summary.innerHTML = `
      <span>Est. messages (recent): ${totalMsgs.toLocaleString()}</span>
      ${totalTools > 0 ? `<span>Tool uses: ${totalTools.toLocaleString()}</span>` : ''}
    `;
    container.appendChild(summary);
  }

  statsViewerBody.appendChild(container);
}

// --- Memory ---
let cachedMemoryData = { global: { files: [] }, projects: [] };
let currentMemoryFilePath = null;
let currentMemoryContent = '';
const memoryCollapsedState = new Map(); // key → boolean (true = collapsed)

async function loadMemories() {
  cachedMemoryData = await window.api.getMemories();
  renderMemories();
}

function renderMemories(filterIds) {
  memoryContent.innerHTML = '';
  const data = cachedMemoryData;
  const allFiles = [...data.global.files, ...data.projects.flatMap(p => p.files)];
  if (allFiles.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'plans-empty';
    empty.textContent = 'No memory files found.';
    memoryContent.appendChild(empty);
    return;
  }

  // Global group
  if (data.global.files.length > 0) {
    const globalFiles = filterIds ? data.global.files.filter(f => filterIds.has(f.filePath)) : data.global.files;
    if (globalFiles.length > 0) {
      memoryContent.appendChild(buildMemoryGroup('__global__', 'Global', globalFiles));
    }
  }

  // Per-project groups
  for (const proj of data.projects) {
    const projFiles = filterIds ? proj.files.filter(f => filterIds.has(f.filePath)) : proj.files;
    if (projFiles.length === 0) continue;
    memoryContent.appendChild(buildMemoryGroup(proj.folder, proj.shortName, projFiles));
  }
}

function buildMemoryGroup(key, label, files) {
  const group = document.createElement('div');
  group.className = 'project-group';
  const isCollapsed = memoryCollapsedState.get(key) === true; // default expanded
  if (isCollapsed) group.classList.add('collapsed');

  // Header
  const header = document.createElement('div');
  header.className = 'project-header';

  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.innerHTML = '&#9660;';
  header.appendChild(arrow);

  const nameSpan = document.createElement('span');
  nameSpan.className = 'project-name';
  nameSpan.textContent = label;
  header.appendChild(nameSpan);

  const countBadge = document.createElement('span');
  countBadge.className = 'memory-file-count';
  countBadge.textContent = files.length;
  header.appendChild(countBadge);

  header.addEventListener('click', () => {
    const nowCollapsed = !group.classList.contains('collapsed');
    group.classList.toggle('collapsed');
    memoryCollapsedState.set(key, nowCollapsed);
  });

  group.appendChild(header);

  // Files list
  const filesList = document.createElement('div');
  filesList.className = 'project-sessions';
  for (const file of files) {
    filesList.appendChild(buildMemoryItem(file));
  }
  group.appendChild(filesList);

  return group;
}

function buildMemoryItem(file) {
  const item = document.createElement('div');
  item.className = 'session-item memory-item';
  item.dataset.filepath = file.filePath;

  const row = document.createElement('div');
  row.className = 'session-row';

  // Brain icon (same position as session pin)
  const brain = document.createElement('span');
  brain.className = 'memory-brain-icon';
  brain.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/><path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/><path d="M3.477 10.896a4 4 0 0 1 .585-.396"/><path d="M19.938 10.5a4 4 0 0 1 .585.396"/><path d="M6 18a4 4 0 0 1-1.967-.516"/><path d="M19.967 17.484A4 4 0 0 1 18 18"/></svg>';
  row.appendChild(brain);

  const info = document.createElement('div');
  info.className = 'session-info';

  const titleEl = document.createElement('div');
  titleEl.className = 'session-summary';
  titleEl.textContent = file.filename;

  const pathEl = document.createElement('div');
  pathEl.className = 'session-id';
  pathEl.textContent = file.displayPath;

  const metaEl = document.createElement('div');
  metaEl.className = 'session-meta';
  metaEl.textContent = formatDate(new Date(file.modified));

  info.appendChild(titleEl);
  info.appendChild(pathEl);
  info.appendChild(metaEl);
  row.appendChild(info);
  item.appendChild(row);

  item.addEventListener('click', () => openMemory(file));
  return item;
}

async function openMemory(file) {
  // Mark active in sidebar
  memoryContent.querySelectorAll('.memory-item.active').forEach(el => el.classList.remove('active'));
  const target = memoryContent.querySelector(`.memory-item[data-filepath="${CSS.escape(file.filePath)}"]`);
  if (target) target.classList.add('active');

  const content = await window.api.readMemory(file.filePath);
  currentMemoryFilePath = file.filePath;
  currentMemoryContent = content;

  // Show memory viewer in main area
  placeholder.style.display = 'none';
  terminalArea.style.display = 'none';
  planViewer.style.display = 'none';
  statsViewer.style.display = 'none';
  settingsViewer.style.display = 'none';
  memoryViewer.style.display = 'flex';

  memoryPanel.open(file.filename, file.filePath, content);
}

// --- New session dialog ---
async function resolveDefaultSessionOptions(project) {
  const effective = await window.api.getEffectiveSettings(project.projectPath);
  const options = {};
  if (effective.dangerouslySkipPermissions) {
    options.dangerouslySkipPermissions = true;
  } else if (effective.permissionMode) {
    options.permissionMode = effective.permissionMode;
  }
  if (effective.worktree) {
    options.worktree = true;
    if (effective.worktreeName) options.worktreeName = effective.worktreeName;
  }
  if (effective.chrome) options.chrome = true;
  if (effective.preLaunchCmd) options.preLaunchCmd = effective.preLaunchCmd;
  if (effective.addDirs) options.addDirs = effective.addDirs;
  if (effective.mcpEmulation === false) options.mcpEmulation = false;
  if (effective.cliAgent) options.cliAgent = effective.cliAgent;
  return options;
}

async function forkSession(session, project) {
  const options = await resolveDefaultSessionOptions(project);
  options.forkFrom = session.sessionId;
  // Carry parent session's agent (e.g. forking a Codex session should fork as Codex)
  const parentAgent = sessionAgentMap.get(session.sessionId);
  if (parentAgent) options.cliAgent = parentAgent;
  launchNewSession(project, options);
}

async function showNewSessionPopover(project, anchorEl) {
  // Remove any existing popover
  document.querySelectorAll('.new-session-popover').forEach(el => el.remove());

  const popover = document.createElement('div');
  popover.className = 'new-session-popover';

  // Detect installed agents and build buttons dynamically
  let agents;
  try { agents = await window.api.detectAgents(); } catch { agents = {}; }

  for (const [id, agent] of Object.entries(agents)) {
    const btn = document.createElement('button');
    btn.className = 'popover-option' + (agent.installed ? '' : ' popover-option-disabled');
    btn.innerHTML = `<span class="popover-agent-dot" style="background:${agent.installed ? agent.color : '#555'}"></span> ${escapeHtml(agent.name)}${agent.installed ? '' : ' <span class="popover-not-installed">not installed</span>'}`;
    if (agent.installed) {
      btn.onclick = async () => {
        popover.remove();
        const options = await resolveDefaultSessionOptions(project);
        options.cliAgent = id;
        launchNewSession(project, options);
      };
    } else {
      btn.disabled = true;
    }
    popover.appendChild(btn);
  }

  // Headless button (Claude-only for now)
  const headlessBtn = document.createElement('button');
  headlessBtn.className = 'popover-option popover-option-headless';
  headlessBtn.innerHTML = '<svg class="popover-option-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg> Headless...';
  const claudeAgent = agents['claude'];
  if (claudeAgent && claudeAgent.installed) {
    headlessBtn.onclick = () => { popover.remove(); showHeadlessPromptDialog(project); };
  } else {
    headlessBtn.disabled = true;
    headlessBtn.classList.add('popover-option-disabled');
  }
  popover.appendChild(headlessBtn);

  // Configure button (opens full dialog with permission modes etc)
  const configBtn = document.createElement('button');
  configBtn.className = 'popover-option popover-option-config';
  configBtn.innerHTML = '<svg class="popover-option-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> Configure...';
  configBtn.onclick = () => { popover.remove(); showNewSessionDialog(project); };
  popover.appendChild(configBtn);

  // Separator + Terminal
  const sep = document.createElement('div');
  sep.className = 'popover-separator';
  popover.appendChild(sep);

  const termBtn = document.createElement('button');
  termBtn.className = 'popover-option popover-option-terminal';
  termBtn.innerHTML = '<svg class="popover-option-icon terminal-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg> Terminal';
  termBtn.onclick = () => { popover.remove(); launchTerminalSession(project); };
  popover.appendChild(termBtn);

  // Position relative to anchor — try below, flip above, clamp to viewport
  document.body.appendChild(popover);
  const rect = anchorEl.getBoundingClientRect();
  const popoverHeight = popover.offsetHeight;
  const popoverWidth = popover.offsetWidth;
  let top, left;

  if (rect.bottom + 4 + popoverHeight <= window.innerHeight) {
    // Fits below the anchor
    top = rect.bottom + 4;
  } else if (rect.top - popoverHeight - 4 >= 0) {
    // Fits above the anchor
    top = rect.top - popoverHeight - 4;
  } else {
    // Doesn't fit above or below — clamp to viewport with padding
    top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - popoverHeight - 8));
  }

  left = rect.left;
  // Clamp horizontally too
  if (left + popoverWidth > window.innerWidth - 8) {
    left = window.innerWidth - popoverWidth - 8;
  }
  if (left < 8) left = 8;

  popover.style.top = top + 'px';
  popover.style.left = left + 'px';
  popover.style.maxHeight = (window.innerHeight - 16) + 'px';
  popover.style.overflowY = 'auto';

  // Close on click outside
  function onClickOutside(e) {
    if (!popover.contains(e.target) && e.target !== anchorEl) {
      popover.remove();
      document.removeEventListener('mousedown', onClickOutside);
    }
  }
  setTimeout(() => document.addEventListener('mousedown', onClickOutside), 0);
}

async function launchTerminalSession(project) {
  const sessionId = crypto.randomUUID();
  const projectPath = project.projectPath;
  const session = {
    sessionId,
    summary: 'Terminal',
    firstPrompt: '',
    projectPath,
    name: null,
    starred: 0,
    archived: 0,
    messageCount: 0,
    modified: new Date().toISOString(),
    created: new Date().toISOString(),
    type: 'terminal',
  };

  // Track as pending
  const folder = projectPath.replace(/[/_]/g, '-').replace(/^-/, '-');
  pendingSessions.set(sessionId, { session, projectPath, folder });

  // Inject into cached project data
  sessionMap.set(sessionId, session);
  for (const projList of [cachedProjects, cachedAllProjects]) {
    let proj = projList.find(p => p.projectPath === projectPath);
    if (!proj) {
      proj = { folder, projectPath, sessions: [] };
      projList.unshift(proj);
    }
    proj.sessions.unshift(session);
  }
  refreshSidebar();

  const entry = createTerminalEntry(session);

  const result = await window.api.openTerminal(sessionId, projectPath, true, { type: 'terminal' });
  if (!result.ok) {
    entry.terminal.write(`\r\nError: ${result.error}\r\n`);
    entry.closed = true;
    return;
  }

  showSession(sessionId);
  pollActiveSessions();
}

// --- Headless session support ---

function showHeadlessPromptDialog(project) {
  const overlay = document.createElement('div');
  overlay.className = 'headless-prompt-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'headless-prompt-dialog';
  dialog.innerHTML = `
    <h3>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
      Headless Session
    </h3>
    <textarea placeholder="Enter your prompt for Claude..." autofocus></textarea>
    <div class="headless-prompt-options">
      <label class="headless-option"><input type="checkbox" id="headless-bare"> <span>Bare mode</span> <span class="headless-option-hint">Skip hooks &amp; LSP</span></label>
    </div>
    <div class="headless-prompt-actions">
      <button class="headless-cancel-btn">Cancel</button>
      <button class="headless-start-btn">Start</button>
    </div>
  `;

  const textarea = dialog.querySelector('textarea');
  const bareCheckbox = dialog.querySelector('#headless-bare');
  const startBtn = dialog.querySelector('.headless-start-btn');
  const cancelBtn = dialog.querySelector('.headless-cancel-btn');

  cancelBtn.onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  startBtn.onclick = async () => {
    const prompt = textarea.value.trim();
    if (!prompt) return;
    const bare = bareCheckbox.checked;
    overlay.remove();
    await launchHeadlessSession(project, prompt, { bare });
  };

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      startBtn.click();
    }
    if (e.key === 'Escape') overlay.remove();
  });

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  setTimeout(() => textarea.focus(), 50);
}

async function launchHeadlessSession(project, prompt, extraOptions = {}) {
  const sessionId = crypto.randomUUID();
  const projectPath = project.projectPath;
  const options = await resolveDefaultSessionOptions(project);
  if (extraOptions.bare) options.bare = true;

  const session = {
    sessionId,
    summary: prompt.slice(0, 60) + (prompt.length > 60 ? '...' : ''),
    firstPrompt: prompt,
    projectPath,
    name: null,
    starred: 0,
    archived: 0,
    messageCount: 0,
    modified: new Date().toISOString(),
    created: new Date().toISOString(),
    type: 'headless',
  };

  // Initialize headless state
  headlessState.set(sessionId, { events: [], lastAction: 'starting...', startTime: Date.now() });

  // Track agent
  sessionAgentMap.set(sessionId, 'claude');

  // Inject into cached project data
  sessionMap.set(sessionId, session);
  const folder = projectPath.replace(/[/_]/g, '-').replace(/^-/, '-');
  for (const projList of [cachedProjects, cachedAllProjects]) {
    let proj = projList.find(p => p.projectPath === projectPath);
    if (!proj) {
      proj = { folder, projectPath, sessions: [] };
      projList.unshift(proj);
    }
    proj.sessions.unshift(session);
  }
  refreshSidebar();

  // Launch headless in main process
  const result = await window.api.launchHeadless(sessionId, projectPath, prompt, options);
  if (!result.ok) {
    const state = headlessState.get(sessionId);
    if (state) {
      state.lastAction = 'failed: ' + (result.error || 'unknown');
      state.events.push({ type: 'error', text: result.error, ts: Date.now() });
      updateHeadlessSparkline(sessionId, state);
    }
  }

  showSession(sessionId);
  pollActiveSessions();
}

async function showNewSessionDialog(project) {
  const [effective, agents, templatesResult] = await Promise.all([
    window.api.getEffectiveSettings(project.projectPath),
    window.api.detectAgents(),
    window.api.getTemplates(),
  ]);
  const templates = templatesResult.ok ? templatesResult.templates : [];

  const overlay = document.createElement('div');
  overlay.className = 'new-session-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'new-session-dialog';

  let selectedAgent = effective.cliAgent || 'claude';
  let selectedMode = effective.permissionMode || null;
  let dangerousSkip = effective.dangerouslySkipPermissions || false;
  let selectedTemplateId = null;
  let promptValue = '';

  const modes = [
    { value: null, label: 'Default', desc: 'Prompt for all actions' },
    { value: 'acceptEdits', label: 'Accept Edits', desc: 'Auto-accept file edits, prompt for others' },
    { value: 'plan', label: 'Plan Mode', desc: 'Read-only exploration, no writes' },
    { value: 'dontAsk', label: "Don't Ask", desc: 'Auto-deny tools not explicitly allowed' },
    { value: 'bypassPermissions', label: 'Bypass', desc: 'Auto-accept all tool calls' },
  ];

  function renderAgentGrid() {
    return Object.entries(agents).map(([id, agent]) => {
      const isSelected = selectedAgent === id;
      const notInstalled = !agent.installed;
      return `<button class="agent-option${isSelected ? ' selected' : ''}${notInstalled ? ' disabled' : ''}" data-agent="${id}" ${notInstalled ? 'disabled' : ''} style="--agent-color: ${agent.color}"><span class="agent-dot" style="background:${agent.color}"></span><span class="agent-name">${agent.name}</span>${notInstalled ? '<span class="agent-missing">not installed</span>' : ''}</button>`;
    }).join('');
  }

  function renderModeGrid() {
    return modes.map(m => {
      const isSelected = !dangerousSkip && selectedMode === m.value;
      return `<button class="permission-option${isSelected ? ' selected' : ''}" data-mode="${m.value}"><span class="perm-name">${m.label}</span><span class="perm-desc">${m.desc}</span></button>`;
    }).join('') +
    `<button class="permission-option dangerous${dangerousSkip ? ' selected' : ''}" data-mode="dangerous-skip"><span class="perm-name">Dangerous Skip</span><span class="perm-desc">Skip all safety prompts (use with caution)</span></button>`;
  }

  function renderTemplateGrid() {
    let html = `<button class="template-option none${selectedTemplateId === null ? ' selected' : ''}" data-template="">No template</button>`;
    for (const tpl of templates) {
      html += `<button class="template-option${selectedTemplateId === tpl.id ? ' selected' : ''}" data-template="${tpl.id}"><span class="template-name">${escapeHtml(tpl.name)}</span><span class="template-desc">${escapeHtml(tpl.description || '')}</span><span class="template-uses">${tpl.useCount}x</span><button class="template-delete-btn" data-delete="${tpl.id}" title="Delete template">✕</button></button>`;
    }
    return html;
  }

  dialog.innerHTML = `
    <h3>New Session — ${escapeHtml(project.projectPath.split('/').filter(Boolean).slice(-2).join('/'))}</h3>
    <div class="settings-field">
      <div class="settings-label">Permission Mode</div>
      <div class="permission-grid" id="nsd-mode-grid">${renderModeGrid()}</div>
    </div>
    <div class="settings-field">
      <div class="settings-field-info">
        <span class="settings-label">Worktree</span>
        <div class="settings-description">Run session in an isolated git worktree</div>
      </div>
      <div class="settings-field-control">
        <input type="text" class="settings-input" id="nsd-worktree-name" placeholder="name (optional)" value="${escapeHtml(effective.worktreeName || '')}" style="width:140px">
        <label class="settings-toggle"><input type="checkbox" id="nsd-worktree" ${effective.worktree ? 'checked' : ''}><span class="settings-toggle-slider"></span></label>
      </div>
    </div>
    <div class="settings-field">
      <div class="settings-field-info">
        <span class="settings-label">Chrome</span>
        <div class="settings-description">Enable Chrome browser automation</div>
      </div>
      <div class="settings-field-control">
        <label class="settings-toggle"><input type="checkbox" id="nsd-chrome" ${effective.chrome ? 'checked' : ''}><span class="settings-toggle-slider"></span></label>
      </div>
    </div>
    <div class="settings-field settings-field-wide">
      <div class="settings-field-info">
        <span class="settings-label">Pre-launch Command</span>
        <div class="settings-description">Prepended to the claude command</div>
      </div>
      <div class="settings-field-control">
        <input type="text" class="settings-input" id="nsd-pre-launch" placeholder="e.g. aws-vault exec profile --" value="${escapeHtml(effective.preLaunchCmd || '')}">
      </div>
    </div>
    <div class="settings-field settings-field-wide">
      <div class="settings-field-info">
        <span class="settings-label">Additional Directories</span>
        <div class="settings-description">Extra directories to include (comma-separated)</div>
      </div>
      <div class="settings-field-control">
        <input type="text" class="settings-input" id="nsd-add-dirs" placeholder="/path/to/dir1, /path/to/dir2" value="${escapeHtml(effective.addDirs || '')}">
      </div>
    </div>
    <div class="new-session-actions">
      <button class="new-session-cancel-btn">Cancel</button>
      <button class="new-session-start-btn">Start</button>
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  // Bind mode grid clicks
  const modeGrid = dialog.querySelector('#nsd-mode-grid');
  modeGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.permission-option');
    if (!btn) return;
    const mode = btn.dataset.mode;
    if (mode === 'dangerous-skip') {
      dangerousSkip = !dangerousSkip;
      if (dangerousSkip) selectedMode = null;
    } else {
      dangerousSkip = false;
      selectedMode = mode === 'null' ? null : mode;
    }
    modeGrid.innerHTML = renderModeGrid();
  });

  function renderPromptField() {
    return `<div class="settings-field" id="nsd-prompt-wrap">
      <div class="settings-label">Initial Prompt</div>
      <textarea class="template-prompt-textarea" id="nsd-prompt" placeholder="What would you like to work on?" rows="3">${escapeHtml(promptValue)}</textarea>
    </div>`;
  }

  function render() {
    dialog.innerHTML = `
      <h3>New Session — ${escapeHtml(project.projectPath.split('/').filter(Boolean).slice(-2).join('/'))}</h3>
      <div class="settings-field">
        <div class="settings-label">Template</div>
        <div class="template-grid" id="nsd-template-grid">${renderTemplateGrid()}</div>
      </div>
      <div class="settings-field">
        <div class="settings-label">AI Agent</div>
        <div class="agent-grid" id="nsd-agent-grid">${renderAgentGrid()}</div>
      </div>
      ${renderPromptField()}
      <div class="settings-field">
        <div class="settings-label">Permission Mode</div>
        <div class="permission-grid" id="nsd-mode-grid">${renderModeGrid()}</div>
      </div>
      <div class="settings-field">
        <div class="settings-checkbox-row">
          <input type="checkbox" id="nsd-worktree" ${effective.worktree ? 'checked' : ''}>
          <label for="nsd-worktree">Worktree</label>
          <input type="text" class="settings-input" id="nsd-worktree-name" placeholder="name (optional)" value="${escapeHtml(effective.worktreeName || '')}" style="width:120px;margin-left:8px;">
        </div>
        <div class="settings-checkbox-row" style="margin-top:8px">
          <input type="text" class="settings-input" id="nsd-sparse-paths" placeholder="src/, docs/, tests/" value="${escapeHtml(effective.sparsePaths || '')}" style="width:280px">
          <span style="font-size:12px;color:#888;margin-left:4px">Sparse paths (comma-separated)</span>
        </div>
      </div>
      <div class="settings-field">
        <div class="settings-checkbox-row">
          <input type="checkbox" id="nsd-chrome" ${effective.chrome ? 'checked' : ''}>
          <label for="nsd-chrome">Chrome</label>
        </div>
      </div>
      <div class="settings-field">
        <div class="settings-label">Pre-launch Command</div>
        <input type="text" class="settings-input" id="nsd-pre-launch" placeholder="e.g. aws-vault exec profile --" value="${escapeHtml(effective.preLaunchCmd || '')}">
      </div>
      <div class="settings-field">
        <div class="settings-label">Add Directories (comma-separated)</div>
        <input type="text" class="settings-input" id="nsd-add-dirs" placeholder="/path/to/dir1, /path/to/dir2" value="${escapeHtml(effective.addDirs || '')}">
      </div>
      <div class="new-session-actions">
        <button class="new-session-cancel-btn">Cancel</button>
        <button class="new-session-start-btn">Start</button>
      </div>
    `;
    bindEvents();
  }

  function bindEvents() {
    const agentGrid = dialog.querySelector('#nsd-agent-grid');
    agentGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('.agent-option:not(.disabled)');
      if (!btn) return;
      selectedAgent = btn.dataset.agent;
      agentGrid.innerHTML = renderAgentGrid();
    });

    const modeGrid = dialog.querySelector('#nsd-mode-grid');
    modeGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('.permission-option');
      if (!btn) return;
      const mode = btn.dataset.mode;
      if (mode === 'dangerous-skip') {
        dangerousSkip = !dangerousSkip;
        if (dangerousSkip) selectedMode = null;
      } else {
        dangerousSkip = false;
        selectedMode = mode === 'null' ? null : mode;
      }
      modeGrid.innerHTML = renderModeGrid();
    });

    const templateGrid = dialog.querySelector('#nsd-template-grid');
    templateGrid.addEventListener('click', async (e) => {
      if (e.target.classList.contains('template-delete-btn')) {
        e.stopPropagation();
        const id = e.target.dataset.delete;
        if (confirm('Delete this template?')) {
          await window.api.deleteTemplate(id);
          const res = await window.api.getTemplates();
          templates.length = 0;
          if (res.ok) templates.push(...res.templates);
          selectedTemplateId = null;
          promptValue = '';
          render();
        }
        return;
      }
      const btn = e.target.closest('.template-option');
      if (!btn) return;
      selectedTemplateId = btn.dataset.template || null;
      if (selectedTemplateId) {
        const tpl = templates.find(t => t.id === selectedTemplateId);
        if (tpl) {
          promptValue = tpl.prompt || '';
          if (tpl.options) {
            try {
              const opts = JSON.parse(tpl.options);
              if (opts.cliAgent) selectedAgent = opts.cliAgent;
            } catch {}
          }
        }
      } else {
        promptValue = '';
      }
      render();
    });

    dialog.querySelector('.new-session-cancel-btn').onclick = close;
    dialog.querySelector('.new-session-start-btn').onclick = start;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    function onKey(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
      if (e.key === 'Enter' && !e.target.matches('input,textarea')) { start(); document.removeEventListener('keydown', onKey); }
    }
    document.addEventListener('keydown', onKey);
  }

  function close() {
    overlay.remove();
  }

  function start() {
    const options = {};
    options.cliAgent = selectedAgent;
    if (dangerousSkip) {
      options.dangerouslySkipPermissions = true;
    } else if (selectedMode) {
      options.permissionMode = selectedMode;
    }
    if (dialog.querySelector('#nsd-worktree').checked) {
      options.worktree = true;
      options.worktreeName = dialog.querySelector('#nsd-worktree-name').value.trim();
      const sparsePaths = dialog.querySelector('#nsd-sparse-paths').value.trim();
      if (sparsePaths) options.sparsePaths = sparsePaths;
    }
    if (dialog.querySelector('#nsd-chrome').checked) {
      options.chrome = true;
    }
    const preLaunch = dialog.querySelector('#nsd-pre-launch').value.trim();
    if (preLaunch) options.preLaunchCmd = preLaunch;
    options.addDirs = dialog.querySelector('#nsd-add-dirs').value.trim();
    if (effective.mcpEmulation === false) options.mcpEmulation = false;
    const prompt = (dialog.querySelector('#nsd-prompt') || {}).value || '';
    close();
    if (selectedTemplateId) {
      window.api.useTemplate(selectedTemplateId);
    }
    launchNewSession(project, options, prompt);
  }

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  render();
}

// --- Template save from session ---
async function showSaveTemplateDialog(project, sessionOptions, currentPrompt) {
  const overlay = document.createElement('div');
  overlay.className = 'new-session-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'template-save-dialog';
  dialog.innerHTML = `
    <h3>Save as Template</h3>
    <div class="settings-field">
      <div class="settings-label">Template Name</div>
      <input type="text" class="settings-input" id="tpl-name" placeholder="e.g. Code Review, Bug Investigation" value="">
    </div>
    <div class="settings-field">
      <div class="settings-label">Description</div>
      <input type="text" class="settings-input" id="tpl-desc" placeholder="One-line description" value="">
    </div>
    <div class="settings-field">
      <div class="settings-label">Initial Prompt</div>
      <textarea class="template-prompt-textarea" id="tpl-prompt" placeholder="What would you like to work on?" rows="3">${escapeHtml(currentPrompt || '')}</textarea>
    </div>
    <div class="new-session-actions">
      <button class="new-session-cancel-btn">Cancel</button>
      <button class="new-session-start-btn">Save Template</button>
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  function close() { overlay.remove(); }

  dialog.querySelector('.new-session-cancel-btn').onclick = close;
  dialog.querySelector('.new-session-start-btn').onclick = async () => {
    const name = dialog.querySelector('#tpl-name').value.trim();
    const desc = dialog.querySelector('#tpl-desc').value.trim();
    const prompt = dialog.querySelector('#tpl-prompt').value.trim();
    if (!name) { alert('Template name is required'); return; }
    const opts = { cliAgent: sessionOptions.cliAgent };
    await window.api.saveTemplate({
      id: 'tpl_' + Date.now(),
      name,
      description: desc,
      projectPath: project.projectPath,
      prompt,
      options: JSON.stringify(opts),
    });
    close();
  };

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  dialog.querySelector('#tpl-name').focus();
}

async function showResumeSessionDialog(session) {
  const effective = await window.api.getEffectiveSettings(session.projectPath);

  const overlay = document.createElement('div');
  overlay.className = 'new-session-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'new-session-dialog';

  let selectedMode = effective.permissionMode || null;
  let dangerousSkip = effective.dangerouslySkipPermissions || false;

  const modes = [
    { value: null, label: 'Default', desc: 'Prompt for all actions' },
    { value: 'acceptEdits', label: 'Accept Edits', desc: 'Auto-accept file edits, prompt for others' },
    { value: 'plan', label: 'Plan Mode', desc: 'Read-only exploration, no writes' },
    { value: 'dontAsk', label: "Don't Ask", desc: 'Auto-deny tools not explicitly allowed' },
    { value: 'bypassPermissions', label: 'Bypass', desc: 'Auto-accept all tool calls' },
  ];

  function renderModeGrid() {
    return modes.map(m => {
      const isSelected = !dangerousSkip && selectedMode === m.value;
      return `<button class="permission-option${isSelected ? ' selected' : ''}" data-mode="${m.value}"><span class="perm-name">${m.label}</span><span class="perm-desc">${m.desc}</span></button>`;
    }).join('') +
    `<button class="permission-option dangerous${dangerousSkip ? ' selected' : ''}" data-mode="dangerous-skip"><span class="perm-name">Dangerous Skip</span><span class="perm-desc">Skip all safety prompts (use with caution)</span></button>`;
  }

  const sessionName = session.name || session.summary || session.sessionId.slice(0, 8);

  function fieldDisabled(fieldName) {
    if (!isProject) return '';
    return (current[fieldName] === undefined || current[fieldName] === null) ? 'disabled' : '';
  }

  const permModeValue = fieldValue('permissionMode', '');
  const worktreeValue = fieldValue('worktree', false);
  const worktreeNameValue = fieldValue('worktreeName', '');
  const chromeValue = fieldValue('chrome', false);
  const preLaunchValue = fieldValue('preLaunchCmd', '');
  const addDirsValue = fieldValue('addDirs', '');
  const visCountValue = fieldValue('visibleSessionCount', 10);
  const maxAgeValue = fieldValue('sessionMaxAgeDays', 3);
  const themeValue = fieldValue('terminalTheme', 'switchboard');
  const mcpEmulationValue = fieldValue('mcpEmulation', true);
  const shellProfileValue = fieldValue('shellProfile', 'auto');
  const cliAgentValue = fieldValue('cliAgent', 'claude');
  const lanPeersValue = fieldValue('lanPeers', false);
  const lanTokenValue = fieldValue('lanPeersToken', '');

  // Discover available shell profiles and agents
  let shellProfiles = [];
  try { shellProfiles = await window.api.getShellProfiles(); } catch {};
  let detectedAgents = {};
  try { detectedAgents = await window.api.detectAgents(); } catch {};
  let lanStatus = { enabled: false, localIp: '', port: 7899, remoteBrokers: [] };
  if (!isProject) { try { lanStatus = await window.api.getLanStatus(); } catch {} }

  settingsViewerBody.innerHTML = `
    <div class="settings-form">
      <div class="settings-section">
        <div class="settings-section-title">CLI Agent Options</div>
        <div class="settings-hint">Options passed to the selected CLI agent when launching sessions.</div>

        <div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Permission Mode</span>
            ${useGlobalCheckbox('permissionMode')}
          </div>
          <select class="settings-select" id="sv-perm-mode" ${fieldDisabled('permissionMode')}>
            <option value="">Default (none)</option>
            <option value="acceptEdits" ${permModeValue === 'acceptEdits' ? 'selected' : ''}>Accept Edits</option>
            <option value="plan" ${permModeValue === 'plan' ? 'selected' : ''}>Plan Mode</option>
            <option value="dontAsk" ${permModeValue === 'dontAsk' ? 'selected' : ''}>Don't Ask</option>
            <option value="bypassPermissions" ${permModeValue === 'bypassPermissions' ? 'selected' : ''}>Bypass</option>
          </select>
        </div>

        <div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Worktree</span>
            ${useGlobalCheckbox('worktree')}
          </div>
          <div class="settings-checkbox-row">
            <input type="checkbox" id="sv-worktree" ${worktreeValue ? 'checked' : ''} ${fieldDisabled('worktree')}>
            <label for="sv-worktree">Enable worktree for new sessions</label>
          </div>
        </div>

        <div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Worktree Name</span>
            ${useGlobalCheckbox('worktreeName')}
          </div>
          <input type="text" class="settings-input" id="sv-worktree-name" placeholder="auto" value="${escapeHtml(worktreeNameValue)}" ${fieldDisabled('worktreeName')}>
        </div>

        <div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Chrome</span>
            ${useGlobalCheckbox('chrome')}
          </div>
          <div class="settings-checkbox-row">
            <input type="checkbox" id="sv-chrome" ${chromeValue ? 'checked' : ''} ${fieldDisabled('chrome')}>
            <label for="sv-chrome">Enable Chrome browser automation</label>
          </div>
        </div>

        <div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Additional Directories</span>
            ${useGlobalCheckbox('addDirs')}
          </div>
          <input type="text" class="settings-input" id="sv-add-dirs" placeholder="/path/to/dir1, /path/to/dir2" value="${escapeHtml(addDirsValue)}" ${fieldDisabled('addDirs')}>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Session Launch</div>
        <div class="settings-hint">Options that control how sessions are started.</div>

        <div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Default AI Agent</span>
            ${useGlobalCheckbox('cliAgent')}
          </div>
          <div class="settings-hint">Which CLI tool to launch for new sessions in this project.</div>
          <select class="settings-select" id="sv-cli-agent" ${fieldDisabled('cliAgent')}>
            ${Object.entries(detectedAgents).map(([id, a]) =>
              `<option value="${escapeHtml(id)}" ${cliAgentValue === id ? 'selected' : ''} ${!a.installed ? 'disabled' : ''}>${escapeHtml(a.name)}${!a.installed ? ' (not installed)' : ''}</option>`
            ).join('')}
          </select>
        </div>

        <div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Pre-launch Command</span>
            ${useGlobalCheckbox('preLaunchCmd')}
          </div>
          <div class="settings-hint">Prepended to the CLI command (e.g. "aws-vault exec profile --" or "source .env &&")</div>
          <input type="text" class="settings-input" id="sv-pre-launch" placeholder="e.g. aws-vault exec profile --" value="${escapeHtml(preLaunchValue)}" ${fieldDisabled('preLaunchCmd')}>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Application</div>
        <div class="settings-hint">Switchboard display and appearance settings.</div>

        ${!isProject ? `<div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Terminal Theme</span>
          </div>
          <select class="settings-select" id="sv-terminal-theme">
            ${Object.entries(TERMINAL_THEMES).map(([key, t]) =>
              `<option value="${key}" ${themeValue === key ? 'selected' : ''}>${escapeHtml(t.label)}</option>`
            ).join('')}
          </select>
        </div>` : ''}

        <div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Shell Profile</span>
            ${useGlobalCheckbox('shellProfile')}
          </div>
          <div class="settings-hint">Shell used for terminal and Claude sessions. Changes take effect for new sessions only.</div>
          <select class="settings-select" id="sv-shell-profile" ${fieldDisabled('shellProfile')}>
            <option value="auto" ${shellProfileValue === 'auto' ? 'selected' : ''}>Auto (detect)</option>
            ${shellProfiles.map(p =>
              `<option value="${escapeHtml(p.id)}" ${shellProfileValue === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
            ).join('')}
          </select>
        </div>

        <div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Max Visible Sessions</span>
            ${useGlobalCheckbox('visibleSessionCount')}
          </div>
          <div class="settings-hint">Show up to this many sessions before collapsing the rest behind "+N older"</div>
          <input type="number" class="settings-input" id="sv-visible-count" min="1" max="100" value="${visCountValue}" ${fieldDisabled('visibleSessionCount')}>
        </div>

        ${!isProject ? `<div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Hide Sessions Older Than (days)</span>
          </div>
          <div class="settings-hint">Sessions older than this are hidden behind "+N older" even if under the count limit</div>
          <input type="number" class="settings-input" id="sv-max-age" min="1" max="365" value="${maxAgeValue}">
        </div>` : ''}

        ${!isProject ? `<div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Icon Brightness</span>
          </div>
          <div class="settings-hint">Make icons brighter or dimmer across the entire app.</div>
          <div class="settings-slider-row">
            <input type="range" class="settings-range" id="sv-icon-brightness" min="0.3" max="3" step="0.1" value="${iconBrightness}">
            <span class="settings-range-value" id="sv-icon-brightness-val">${iconBrightness.toFixed(1)}</span>
          </div>
        </div>` : ''}

        ${!isProject ? `<div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Border Brightness</span>
          </div>
          <div class="settings-hint">Make borders and dividers brighter or dimmer across the entire app.</div>
          <div class="settings-slider-row">
            <input type="range" class="settings-range" id="sv-border-brightness" min="0.3" max="5" step="0.1" value="${borderBrightness}">
            <span class="settings-range-value" id="sv-border-brightness-val">${borderBrightness.toFixed(1)}</span>
          </div>
        </div>` : ''}

        ${!isProject ? `<div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Sidebar Zoom</span>
          </div>
          <div class="settings-hint">Zoom level for the sidebar panel. Ctrl+scroll over sidebar also works.</div>
          <div class="settings-slider-row">
            <input type="range" class="settings-range" id="sv-sidebar-zoom" min="0.5" max="2" step="0.05" value="${sidebarZoom}">
            <span class="settings-range-value" id="sv-sidebar-zoom-val">${Math.round(sidebarZoom * 100)}%</span>
          </div>
        </div>` : ''}

        ${!isProject ? `<div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Main Panel Zoom</span>
          </div>
          <div class="settings-hint">Zoom level for the terminal / content area. Ctrl+scroll over main panel also works.</div>
          <div class="settings-slider-row">
            <input type="range" class="settings-range" id="sv-main-zoom" min="0.5" max="2" step="0.05" value="${mainZoom}">
            <span class="settings-range-value" id="sv-main-zoom-val">${Math.round(mainZoom * 100)}%</span>
          </div>
        </div>` : ''}

        ${!isProject ? `<div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">IDE Emulation</span>
          </div>
          <div class="settings-checkbox-row">
            <input type="checkbox" id="sv-mcp-emulation" ${mcpEmulationValue ? 'checked' : ''}>
            <label for="sv-mcp-emulation">Emulate an IDE for Claude CLI sessions</label>
          </div>
          <div class="settings-hint">When enabled, Switchboard acts as an IDE so Claude can open files and diffs in a side panel. Disable this if you want Claude to use your own IDE (e.g. VS Code, Cursor) instead. Changes take effect for new sessions only — running sessions are not affected.</div>
        </div>` : ''}
      </div>

      ${!isProject ? `<div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Activity Monitoring Hook</span>
          </div>
          <div class="settings-hint">Install a Claude Code PostToolUse hook that sends real-time tool activity to Switchboard, powering sidebar sparklines for all sessions.</div>
          <div class="settings-hook-row" id="sv-hook-row">
            <span class="settings-hook-status" id="sv-hook-status">Checking...</span>
            <button class="settings-hook-btn" id="sv-install-hook-btn" style="display:none">Install Hook</button>
          </div>
        </div>` : ''}

      ${!isProject ? `<div class="settings-section">
        <div class="settings-section-title">LAN Peers</div>
        <div class="settings-hint">Let agents on other machines in your local network discover and message each other. Requires the same shared token on every machine.</div>

        <div class="settings-field">
          <div class="settings-checkbox-row">
            <input type="checkbox" id="sv-lan-peers" ${lanPeersValue ? 'checked' : ''}>
            <label for="sv-lan-peers">Enable LAN peer discovery</label>
          </div>
          <div class="settings-hint" id="sv-lan-ip-hint">${lanStatus.enabled ? `Broadcasting on ${lanStatus.localIp}:${lanStatus.port}` : 'Disabled — broker listens on localhost only'}</div>
        </div>

        <div class="settings-field">
          <div class="settings-label">Shared Token</div>
          <input type="password" class="settings-input" id="sv-lan-token" placeholder="Leave blank for open LAN mode" value="${escapeHtml(lanTokenValue)}" autocomplete="off">
          <div class="settings-hint">Only machines with the same token will be federated. Blank = no auth (trusted home network).</div>
        </div>

        ${lanStatus.enabled && lanStatus.remoteBrokers.length > 0 ? `
        <div class="settings-field">
          <div class="settings-label">Discovered Machines</div>
          <div class="settings-lan-machines">
            ${lanStatus.remoteBrokers.map(b => `<span class="lan-machine-badge">${escapeHtml(b.host)} <span class="lan-machine-ip">${b.ip}</span></span>`).join('')}
          </div>
        </div>` : ''}
      </div>` : ''}

      ${!isProject ? `<div class="settings-section settings-updates-section">
        <div class="settings-section-title">Updates</div>
        <div class="settings-updates-row">
          <span class="settings-current-version" id="sv-current-version"></span>
          <span class="settings-update-status" id="sv-update-status"></span>
          <button class="settings-check-updates-btn" id="sv-check-updates-btn">Check for Updates</button>
        </div>
      </div>` : ''}

      <div class="settings-btn-row">
        <button class="settings-cancel-btn" id="sv-cancel-btn">Cancel</button>
        <button class="settings-save-btn" id="sv-save-btn">Save Settings</button>
      </div>
    </div>
  `;

  // Use-global checkboxes toggle field disabled state
  settingsViewerBody.querySelectorAll('.use-global-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const field = cb.dataset.field;
      const inputs = settingsViewerBody.querySelectorAll(`#sv-perm-mode, #sv-worktree, #sv-worktree-name, #sv-add-dirs, #sv-visible-count`);
      // Map field name to input element
      const fieldMap = {
        permissionMode: 'sv-perm-mode',
        worktree: 'sv-worktree',
        worktreeName: 'sv-worktree-name',
        chrome: 'sv-chrome',
        cliAgent: 'sv-cli-agent',
        preLaunchCmd: 'sv-pre-launch',
        addDirs: 'sv-add-dirs',
        visibleSessionCount: 'sv-visible-count',
        shellProfile: 'sv-shell-profile',
      };
      const input = settingsViewerBody.querySelector('#' + fieldMap[field]);
      if (input) input.disabled = cb.checked;
    });
  });

  // Brightness sliders — live preview as you drag
  const iconSlider = settingsViewerBody.querySelector('#sv-icon-brightness');
  const iconVal = settingsViewerBody.querySelector('#sv-icon-brightness-val');
  if (iconSlider) {
    iconSlider.addEventListener('input', () => {
      iconBrightness = parseFloat(iconSlider.value);
      if (iconVal) iconVal.textContent = iconBrightness.toFixed(1);
      applyBrightness();
    });
  }
  const borderSlider = settingsViewerBody.querySelector('#sv-border-brightness');
  const borderVal = settingsViewerBody.querySelector('#sv-border-brightness-val');
  if (borderSlider) {
    borderSlider.addEventListener('input', () => {
      borderBrightness = parseFloat(borderSlider.value);
      if (borderVal) borderVal.textContent = borderBrightness.toFixed(1);
      applyBrightness();
    });
  }

  // Zoom sliders — live preview as you drag
  const sidebarZoomSlider = settingsViewerBody.querySelector('#sv-sidebar-zoom');
  const sidebarZoomVal = settingsViewerBody.querySelector('#sv-sidebar-zoom-val');
  if (sidebarZoomSlider) {
    sidebarZoomSlider.addEventListener('input', () => {
      sidebarZoom = parseFloat(sidebarZoomSlider.value);
      if (sidebarZoomVal) sidebarZoomVal.textContent = Math.round(sidebarZoom * 100) + '%';
      applyZoom();
    });
  }
  const mainZoomSlider = settingsViewerBody.querySelector('#sv-main-zoom');
  const mainZoomVal = settingsViewerBody.querySelector('#sv-main-zoom-val');
  if (mainZoomSlider) {
    mainZoomSlider.addEventListener('input', () => {
      mainZoom = parseFloat(mainZoomSlider.value);
      if (mainZoomVal) mainZoomVal.textContent = Math.round(mainZoom * 100) + '%';
      applyZoom();
    });
  }

  // Save button
  settingsViewerBody.querySelector('#sv-save-btn').addEventListener('click', async () => {
    const settings = {};

    if (isProject) {
      // Only save fields where "use global" is unchecked
      settingsViewerBody.querySelectorAll('.use-global-cb').forEach(cb => {
        if (!cb.checked) {
          const field = cb.dataset.field;
          const fieldMap = {
            permissionMode: () => settingsViewerBody.querySelector('#sv-perm-mode').value || null,
            cliAgent: () => settingsViewerBody.querySelector('#sv-cli-agent').value || 'claude',
            worktree: () => settingsViewerBody.querySelector('#sv-worktree').checked,
            worktreeName: () => settingsViewerBody.querySelector('#sv-worktree-name').value.trim(),
            chrome: () => settingsViewerBody.querySelector('#sv-chrome').checked,
            preLaunchCmd: () => settingsViewerBody.querySelector('#sv-pre-launch').value.trim(),
            addDirs: () => settingsViewerBody.querySelector('#sv-add-dirs').value.trim(),
            visibleSessionCount: () => parseInt(settingsViewerBody.querySelector('#sv-visible-count').value) || 10,
            shellProfile: () => settingsViewerBody.querySelector('#sv-shell-profile').value || 'auto',
          };
          if (fieldMap[field]) settings[field] = fieldMap[field]();
        }
      });
    } else {
      settings.permissionMode = settingsViewerBody.querySelector('#sv-perm-mode').value || null;
      settings.cliAgent = settingsViewerBody.querySelector('#sv-cli-agent').value || 'claude';
      settings.worktree = settingsViewerBody.querySelector('#sv-worktree').checked;
      settings.worktreeName = settingsViewerBody.querySelector('#sv-worktree-name').value.trim();
      settings.chrome = settingsViewerBody.querySelector('#sv-chrome').checked;
      settings.preLaunchCmd = settingsViewerBody.querySelector('#sv-pre-launch').value.trim();
      settings.addDirs = settingsViewerBody.querySelector('#sv-add-dirs').value.trim();
      settings.visibleSessionCount = parseInt(settingsViewerBody.querySelector('#sv-visible-count').value) || 10;
      settings.sessionMaxAgeDays = parseInt(settingsViewerBody.querySelector('#sv-max-age').value) || 3;
      settings.terminalTheme = settingsViewerBody.querySelector('#sv-terminal-theme').value || 'switchboard';
      settings.mcpEmulation = settingsViewerBody.querySelector('#sv-mcp-emulation').checked;
      settings.shellProfile = settingsViewerBody.querySelector('#sv-shell-profile').value || 'auto';
      settings.lanPeers = settingsViewerBody.querySelector('#sv-lan-peers').checked;
      settings.lanPeersToken = settingsViewerBody.querySelector('#sv-lan-token').value.trim();
      // Brightness sliders — persist to localStorage (instant, no restart needed)
      const ib = settingsViewerBody.querySelector('#sv-icon-brightness');
      const bb = settingsViewerBody.querySelector('#sv-border-brightness');
      if (ib) { iconBrightness = parseFloat(ib.value); localStorage.setItem('iconBrightness', iconBrightness); }
      if (bb) { borderBrightness = parseFloat(bb.value); localStorage.setItem('borderBrightness', borderBrightness); }
      applyBrightness();
      // Zoom sliders — persist
      const sz = settingsViewerBody.querySelector('#sv-sidebar-zoom');
      const mz = settingsViewerBody.querySelector('#sv-main-zoom');
      if (sz) { sidebarZoom = parseFloat(sz.value); localStorage.setItem('sidebarZoom', sidebarZoom); }
      if (mz) { mainZoom = parseFloat(mz.value); localStorage.setItem('mainZoom', mainZoom); }
      applyZoom();
    }

    // Preserve windowBounds and sidebarWidth if they exist
    if (!isProject) {
      const existing = (await window.api.getSetting('global')) || {};
      if (existing.windowBounds) settings.windowBounds = existing.windowBounds;
      if (existing.sidebarWidth) settings.sidebarWidth = existing.sidebarWidth;
    }

    await window.api.setSetting(settingsKey, settings);

    // Update visibleSessionCount, sessionMaxAgeDays, and theme
    if (!isProject) {
      if (settings.visibleSessionCount) visibleSessionCount = settings.visibleSessionCount;
      if (settings.sessionMaxAgeDays) sessionMaxAgeDays = settings.sessionMaxAgeDays;
      if (settings.terminalTheme) {
        currentThemeName = settings.terminalTheme;
        TERMINAL_THEME = getTerminalTheme();
        // Apply to all open terminals
        for (const [, entry] of openSessions) {
          entry.terminal.options.theme = TERMINAL_THEME;
          entry.element.style.backgroundColor = TERMINAL_THEME.background;
        }
      }
      refreshSidebar();
    }

    // Notify if LAN Peers changed
    if (!isProject && settings.lanPeers !== lanPeersValue) {
      const notice = document.createElement('div');
      notice.className = 'settings-notice';
      notice.textContent = `LAN Peers ${settings.lanPeers ? 'enabled' : 'disabled'}. Restart Switchboard to apply.`;
      const saveBtn = settingsViewerBody.querySelector('#sv-save-btn');
      if (saveBtn) saveBtn.parentElement.insertBefore(notice, saveBtn);
      setTimeout(() => notice.remove(), 8000);
    }

    // Notify if IDE Emulation changed
    if (!isProject && settings.mcpEmulation !== mcpEmulationValue) {
      const notice = document.createElement('div');
      notice.className = 'settings-notice';
      notice.textContent = 'IDE Emulation setting changed. New sessions will use the updated setting \u2014 running sessions are not affected.';
      const saveBtn = settingsViewerBody.querySelector('#sv-save-btn');
      saveBtn.parentElement.insertBefore(notice, saveBtn);
      setTimeout(() => notice.remove(), 8000);
    }

    closeSettingsViewer();
  });

  // Activity monitoring hook status
  const hookStatusEl = settingsViewerBody.querySelector('#sv-hook-status');
  const hookInstallBtn = settingsViewerBody.querySelector('#sv-install-hook-btn');
  if (hookStatusEl && hookInstallBtn) {
    window.api.checkActivityHook().then(({ installed }) => {
      if (installed) {
        hookStatusEl.textContent = 'Installed';
        hookStatusEl.style.color = '#22c55e';
        hookInstallBtn.style.display = 'none';
      } else {
        hookStatusEl.textContent = 'Not installed';
        hookStatusEl.style.color = '#ef4444';
        hookInstallBtn.style.display = '';
      }
    });
    hookInstallBtn.addEventListener('click', async () => {
      hookInstallBtn.disabled = true;
      hookInstallBtn.textContent = 'Installing...';
      const result = await window.api.installActivityHook();
      if (result.ok) {
        hookStatusEl.textContent = result.already ? 'Already installed' : 'Installed';
        hookStatusEl.style.color = '#22c55e';
        hookInstallBtn.style.display = 'none';
      } else {
        hookStatusEl.textContent = 'Error: ' + (result.error || 'unknown');
        hookInstallBtn.disabled = false;
        hookInstallBtn.textContent = 'Retry';
      }
    });
  }

  // Remove project button
  const removeBtn = settingsViewerBody.querySelector('#sv-remove-btn');
  if (removeBtn) {
    removeBtn.addEventListener('click', async () => {
      if (!confirm(`Remove project "${shortName}" from Switchboard?\n\nThis hides the project from the sidebar. Your session files are not deleted.`)) return;
      await window.api.removeProject(projectPath);
      settingsViewer.style.display = 'none';
      placeholder.style.display = 'flex';
      loadProjects();
    });
  }

  // Cancel button
  const cancelBtn = settingsViewerBody.querySelector('#sv-cancel-btn');
  if (cancelBtn) cancelBtn.addEventListener('click', () => { closeSettingsViewer(); });
}

// Settings viewer is in settings-panel.js (openSettingsViewer / closeSettingsViewer)

// Global settings gear button
globalSettingsBtn.innerHTML = ICONS.gear(18);
globalSettingsBtn.addEventListener('click', () => {
  openSettingsViewer('global');
});

// Add project button
addProjectBtn.addEventListener('click', () => {
  showAddProjectDialog();
});

// --- Broadcast button ---
const broadcastBtn = document.getElementById('broadcast-btn');
broadcastBtn.addEventListener('click', () => {
  showBroadcastDialog();
});

async function showBroadcastDialog() {
  const [projects, agents] = await Promise.all([
    window.api.getProjects(),
    window.api.detectAgents(),
  ]);

  const overlay = document.createElement('div');
  overlay.className = 'add-project-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'add-project-dialog';
  dialog.style.maxWidth = '560px';

  dialog.innerHTML = `
    <h3>Broadcast Command</h3>
    <div class="add-project-hint">Send a command to running sessions. Filter by agent type or project.</div>

    <div class="broadcast-filters">
      <div class="broadcast-filter-group">
        <label>Agent Type</label>
        <div id="broadcast-agent-filter" class="filter-chips">
          <button class="filter-chip active" data-agent="all">All Agents</button>
          ${Object.entries(agents).map(([id, agent]) => `<button class="filter-chip" data-agent="${id}">${agent.name}</button>`).join('')}
        </div>
      </div>
      <div class="broadcast-filter-group">
        <label>Project</label>
        <div id="broadcast-project-filter" class="filter-chips">
          <button class="filter-chip active" data-project="all">All Projects</button>
          ${projects.map(p => `<button class="filter-chip" data-project="${encodeURIComponent(p.projectPath)}">${escapeHtml(p.projectPath.split('/').filter(Boolean).slice(-2).join('/'))}</button>`).join('')}
        </div>
      </div>
    </div>

    <div class="folder-input-row">
      <input type="text" id="broadcast-input" placeholder="e.g.  /compact  or  git status" autocomplete="off" spellcheck="false">
    </div>
    <label style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:12px;color:var(--text-muted);">
      <input type="checkbox" id="broadcast-newline" checked> Append Enter (send as command)
    </label>
    <div class="add-project-error" id="broadcast-error"></div>
    <div class="add-project-actions">
      <button id="broadcast-cancel-btn" class="add-project-btn-secondary">Cancel</button>
      <button id="broadcast-send-btn" class="add-project-btn-primary">Broadcast</button>
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const input = dialog.querySelector('#broadcast-input');
  const sendBtn = dialog.querySelector('#broadcast-send-btn');
  const cancelBtn = dialog.querySelector('#broadcast-cancel-btn');
  const errorEl = dialog.querySelector('#broadcast-error');
  const newlineChk = dialog.querySelector('#broadcast-newline');
  const agentFilter = dialog.querySelector('#broadcast-agent-filter');
  const projectFilter = dialog.querySelector('#broadcast-project-filter');

  let selectedAgent = 'all';
  let selectedProject = 'all';

  input.focus();

  const close = () => overlay.remove();

  // Filter chip handlers
  agentFilter.addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip[data-agent]');
    if (!chip) return;
    selectedAgent = chip.dataset.agent;
    agentFilter.querySelectorAll('.filter-chip').forEach(c => c.classList.toggle('active', c === chip));
  });

  projectFilter.addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip[data-project]');
    if (!chip) return;
    selectedProject = chip.dataset.project === 'all' ? 'all' : decodeURIComponent(chip.dataset.project);
    projectFilter.querySelectorAll('.filter-chip').forEach(c => c.classList.toggle('active', c === chip));
  });

  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const doSend = async () => {
    const text = input.value;
    if (!text.trim()) { errorEl.textContent = 'Enter a command'; return; }
    const payload = newlineChk.checked ? text + '\r' : text;
    const result = await window.api.broadcastInputTargeted(payload, selectedAgent, selectedProject);
    if (result.ok) {
      statusBarActivity.textContent = `Broadcast sent to ${result.count} session${result.count !== 1 ? 's' : ''}`;
      setTimeout(() => { statusBarActivity.textContent = ''; }, 3000);
      close();
    } else {
      errorEl.textContent = result.error || 'Broadcast failed';
    }
  };

  sendBtn.addEventListener('click', doSend);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSend();
    if (e.key === 'Escape') close();
  });
}

function showAddProjectDialog() {
  const overlay = document.createElement('div');
  overlay.className = 'add-project-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'add-project-dialog';

  dialog.innerHTML = `
    <h3>Add Project</h3>
    <div class="add-project-hint">Select a folder to create a new project. To start a session in an existing project, use the + on its project header.</div>
    <div class="folder-input-row">
      <input type="text" id="add-project-path" placeholder="/path/to/project" autocomplete="off" spellcheck="false">
      <button class="add-project-browse-btn">Browse</button>
    </div>
    <div class="add-project-error" id="add-project-error"></div>
    <div class="add-project-actions">
      <button class="add-project-cancel-btn">Cancel</button>
      <button class="add-project-add-btn">Add</button>
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const pathInput = dialog.querySelector('#add-project-path');
  const errorEl = dialog.querySelector('#add-project-error');
  pathInput.focus();

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }

  async function addProject() {
    const projectPath = pathInput.value.trim();
    if (!projectPath) {
      errorEl.textContent = 'Please enter a folder path.';
      errorEl.style.display = 'block';
      return;
    }
    errorEl.style.display = 'none';
    const result = await window.api.addProject(projectPath);
    if (result.error) {
      errorEl.textContent = result.error;
      errorEl.style.display = 'block';
      return;
    }
    close();

    await loadProjects();
  }

  dialog.querySelector('.add-project-browse-btn').onclick = async () => {
    const folder = await window.api.browseFolder();
    if (folder) pathInput.value = folder;
  };

  dialog.querySelector('.add-project-cancel-btn').onclick = close;
  dialog.querySelector('.add-project-add-btn').onclick = addProject;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  function onKey(e) {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter') addProject();
  }
  document.addEventListener('keydown', onKey);
}

// --- Sidebar toggle ---
{
  const sidebar = document.getElementById('sidebar');
  const collapseBtn = document.getElementById('sidebar-collapse-btn');
  const expandBtn = document.getElementById('sidebar-expand-btn');

  collapseBtn.addEventListener('click', () => sidebar.classList.add('collapsed'));
  expandBtn.addEventListener('click', () => sidebar.classList.remove('collapsed'));

  // Right-click context menu \u2014 pick a CLI to view, or flag CLIs to combine.
  // Attached to both the sidebar expand button and the Claude logo (sessions tab).
  const ctxMenu = document.getElementById('agent-context-menu');

  function selectAgentView(id) {
    activeAgent = id;
    localStorage.setItem('activeAgent', id);
    const selContainer = document.getElementById('agent-selector');
    if (selContainer) {
      selContainer.querySelectorAll('.agent-selector-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.agent === id)
      );
    }
    showStarredOnly = false; showRunningOnly = false;
    if (starToggle) starToggle.classList.remove('active');
    if (runningToggle) runningToggle.classList.remove('active');
    if (typeof rebuildAgentSelector === 'function') rebuildAgentSelector();
    loadProjectsForAgent();
  }

  async function openAgentContextMenu(anchorEl, e) {
    e.preventDefault();
    e.stopPropagation();

    let agents = installedAgents;
    if (!agents || Object.keys(agents).length === 0) {
      try { agents = await window.api.detectAgents(); } catch { agents = {}; }
    }
    const installedEntries = Object.entries(agents).filter(([, a]) => a.installed);
    if (installedEntries.length === 0) return;

    ctxMenu.innerHTML = '';

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'agent-context-menu-header';
    hdr.textContent = 'Show CLI sessions';
    ctxMenu.appendChild(hdr);

    for (const [id, agent] of installedEntries) {
      const item = document.createElement('div');
      item.className = 'agent-context-menu-item' + (id === activeAgent ? ' active' : '');
      const dotColor = agent.color || AGENT_COLORS[id] || '#888';
      const isActive = id === activeAgent;
      const isFlagged = flaggedAgents.has(id);

      const label = document.createElement('button');
      label.className = 'ctx-item-label';
      label.innerHTML = `
        <span class="ctx-dot" style="background:${dotColor}"></span>
        <span>${agent.name}</span>
        ${isActive ? '<span class="ctx-checkmark">\u2713</span>' : ''}
      `;
      label.addEventListener('click', () => {
        selectAgentView(id);
        ctxMenu.style.display = 'none';
      });

      // Flag toggle \u2014 adds/removes this CLI from the combined "Flagged" view
      const flagBtn = document.createElement('button');
      flagBtn.className = 'ctx-flag-btn' + (isFlagged ? ' flagged' : '');
      flagBtn.title = isFlagged ? 'Remove from Flagged view' : 'Add to Flagged view';
      flagBtn.innerHTML = isFlagged ? '\u2691' : '\u2690'; // filled / outline flag
      flagBtn.style.color = isFlagged ? dotColor : '';
      flagBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (flaggedAgents.has(id)) flaggedAgents.delete(id);
        else flaggedAgents.add(id);
        saveFlaggedAgents();
        flagBtn.classList.toggle('flagged');
        flagBtn.innerHTML = flaggedAgents.has(id) ? '\u2691' : '\u2690';
        flagBtn.style.color = flaggedAgents.has(id) ? dotColor : '';
        if (typeof rebuildAgentSelector === 'function') rebuildAgentSelector();
        // If currently viewing the flagged combined view, refresh it live
        if (activeAgent === '_flagged') loadMetaView('_flagged');
      });

      item.appendChild(label);
      item.appendChild(flagBtn);
      ctxMenu.appendChild(item);
    }

    // Footer action: open the combined Flagged view
    const sep = document.createElement('div');
    sep.className = 'agent-context-menu-sep';
    ctxMenu.appendChild(sep);
    const flaggedView = document.createElement('button');
    flaggedView.className = 'agent-context-menu-item ctx-item-label';
    flaggedView.innerHTML = `<span class="ctx-dot" style="background:#ef4444">\u2691</span><span>View Flagged (${flaggedAgents.size})</span>`;
    flaggedView.addEventListener('click', () => {
      selectAgentView('_flagged');
      ctxMenu.style.display = 'none';
    });
    ctxMenu.appendChild(flaggedView);

    const rect = anchorEl.getBoundingClientRect();
    ctxMenu.style.top = (rect.bottom + 4) + 'px';
    ctxMenu.style.left = rect.left + 'px';
    ctxMenu.style.display = 'block';
  }

  expandBtn.addEventListener('contextmenu', (e) => openAgentContextMenu(expandBtn, e));
  // The Claude logo (sessions tab) \u2014 primary right-click target per UX request.
  const sessionsTabIcon = document.querySelector('.sidebar-tab[data-tab="sessions"]');
  if (sessionsTabIcon) {
    sessionsTabIcon.addEventListener('contextmenu', (e) => openAgentContextMenu(sessionsTabIcon, e));
  }

  // Close context menu on click outside or Escape
  document.addEventListener('mousedown', (e) => {
    if (ctxMenu.style.display === 'block' && !ctxMenu.contains(e.target)) {
      ctxMenu.style.display = 'none';
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ctxMenu.style.display === 'block') {
      ctxMenu.style.display = 'none';
    }
  });
}

// --- Sidebar resize ---
{
  const sidebar = document.getElementById('sidebar');
  const handle = document.getElementById('sidebar-resize-handle');
  let dragging = false;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const width = Math.min(600, Math.max(200, e.clientX));
    sidebar.style.width = width + 'px';
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    // Refit active terminal
    if (!gridViewActive && activeSessionId && openSessions.has(activeSessionId)) {
      const entry = openSessions.get(activeSessionId);
      safeFit(entry);
    }
    // Save sidebar width to settings
    const width = parseInt(sidebar.style.width);
    if (width) {
      window.api.getSetting('global').then(g => {
        const global = g || {};
        global.sidebarWidth = width;
        window.api.setSetting('global', global);
      });
    }
  });
}

// --- Grid view toggle button (next to resort button in sidebar filters) ---
{
  const gridToggleBtn = document.createElement('button');
  gridToggleBtn.id = 'grid-toggle-btn';
  gridToggleBtn.title = 'Session overview';
  gridToggleBtn.innerHTML = '<svg width="14" height="14" stroke="currentColor" fill="none" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>';
  gridToggleBtn.addEventListener('click', toggleGridView);
  // Insert next to the resort button
  resortBtn.parentElement.insertBefore(gridToggleBtn, resortBtn);

  // Global keyboard shortcuts (covers non-terminal focus)
  // When a terminal is focused, xterm's customKeyEventHandler fires first and sets
  // e._handled to prevent the document listener from double-firing the same action.
  document.addEventListener('keydown', (e) => {
    if (e._handled) return;
    // Cmd/Ctrl+Shift+G → toggle grid view
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (e.key === 'g' && mod && e.shiftKey && !e.altKey) {
      e.preventDefault();
      toggleGridView();
      return;
    }
    // Session navigation: Cmd+Shift+[/], Cmd+Arrow
    handleSessionNavKey(e);
  });
}

// Warm up xterm.js renderer so first terminal open is fast
setTimeout(() => {
  const warmEl = document.createElement('div');
  warmEl.style.cssText = 'position:absolute;left:-9999px;width:400px;height:200px;';
  document.body.appendChild(warmEl);
  const warmTerm = new Terminal({ cols: 80, rows: 10 });
  const warmFit = new FitAddon.FitAddon();
  warmTerm.loadAddon(warmFit);
  warmTerm.open(warmEl);
  warmTerm.write(' ');
  requestAnimationFrame(() => {
    warmTerm.dispose();
    warmEl.remove();
  });
}, 100);


// ============================================================
// COMMAND PALETTE (Ctrl+K)
// Fuzzy search across sessions, projects, and quick actions.
// ============================================================

const cmdPalette = document.getElementById('cmd-palette');
const cmdPaletteInput = document.getElementById('cmd-palette-input');
const cmdPaletteResults = document.getElementById('cmd-palette-results');
let cmdPaletteOpen = false;
let cmdPaletteCursor = -1;

const CMD_ACTIONS = [
  { type: 'action', label: 'Add Project', hint: 'Add a new project folder', icon: '✦', run: () => { showAddProjectDialog(); } },
  { type: 'action', label: '/compact — Compress context', hint: 'Send /compact to active session', icon: '⟳', run: () => { if (activeSessionId && activePtyIds.has(activeSessionId)) window.api.sendInput(activeSessionId, '/compact\r'); } },
  { type: 'action', label: 'Broadcast command…', hint: 'Send to all running sessions', icon: '⋰', run: () => { showBroadcastDialog(); } },
  { type: 'action', label: 'Toggle grid view', hint: 'Show all terminals in grid', icon: '⊞', run: () => { toggleGridView(); } },
  { type: 'action', label: 'Global Settings', hint: 'Open settings panel', icon: '⚙', run: () => { document.getElementById('global-settings-btn')?.click(); } },
  { type: 'action', label: 'Save as Template…', hint: 'Save current session as a reusable template', icon: '▣', run: () => {
    if (!activeSessionId) return;
    const session = sessionMap.get(activeSessionId);
    if (!session) return;
    const project = cachedProjects.find(p => p.projectPath === session.projectPath) || cachedProjects[0];
    if (!project) return;
    showSaveTemplateDialog(project, { cliAgent: sessionAgentMap.get(activeSessionId) || 'claude' }, '');
  } },
];

function cmdPaletteScore(query, text) {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return 2 + (t.startsWith(q) ? 1 : 0);
  // Fuzzy: every char of query must appear in order
  let ti = 0;
  for (const ch of q) {
    ti = t.indexOf(ch, ti);
    if (ti === -1) return 0;
    ti++;
  }
  return 1;
}

function buildCmdItems(query) {
  const items = [];

  // Actions
  for (const action of CMD_ACTIONS) {
    const score = cmdPaletteScore(query, action.label);
    if (score > 0) items.push({ ...action, score });
  }

  // Sessions from cache
  for (const project of cachedAllProjects) {
    for (const session of project.sessions) {
      const name = cleanDisplayName(session.name || session.sessionId);
      const score = cmdPaletteScore(query, name + ' ' + project.path);
      if (score > 0) {
        items.push({
          type: 'session',
          label: name,
          hint: project.path.split('/').slice(-2).join('/'),
          icon: activePtyIds.has(session.sessionId) ? '●' : '○',
          score,
          session,
        });
      }
    }
  }

  // Sort: actions first (by score), then sessions (by score + recency)
  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'action' ? -1 : 1;
    return b.score - a.score;
  });

  return items.slice(0, 12);
}

function renderCmdResults(items) {
  cmdPaletteResults.innerHTML = '';
  if (items.length === 0) {
    cmdPaletteResults.innerHTML = '<div class="cmd-empty">No results</div>';
    cmdPaletteCursor = -1;
    return;
  }
  items.forEach((item, i) => {
    const el = document.createElement('div');
    el.className = 'cmd-item' + (i === cmdPaletteCursor ? ' cmd-item-active' : '');
    el.dataset.index = i;
    const iconEl = `<span class="cmd-item-icon">${item.icon || '○'}</span>`;
    const labelEl = `<span class="cmd-item-label">${escapeHtml(item.label)}</span>`;
    const hintEl = item.hint ? `<span class="cmd-item-hint">${escapeHtml(item.hint)}</span>` : '';
    el.innerHTML = iconEl + labelEl + hintEl;
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      executeCmdItem(item);
    });
    el.addEventListener('mouseover', () => {
      cmdPaletteCursor = i;
      renderCmdResults(items);
    });
    cmdPaletteResults.appendChild(el);
  });
}

let _cmdItems = [];

function openCmdPalette() {
  cmdPaletteOpen = true;
  cmdPalette.style.display = 'flex';
  cmdPaletteInput.value = '';
  cmdPaletteCursor = -1;
  _cmdItems = buildCmdItems('');
  renderCmdResults(_cmdItems);
  requestAnimationFrame(() => cmdPaletteInput.focus());
}

function closeCmdPalette() {
  cmdPaletteOpen = false;
  cmdPalette.style.display = 'none';
  cmdPaletteInput.value = '';
}

function executeCmdItem(item) {
  closeCmdPalette();
  if (item.type === 'action') {
    item.run();
  } else if (item.type === 'session') {
    openSession(item.session);
  }
}

cmdPaletteInput.addEventListener('input', () => {
  _cmdItems = buildCmdItems(cmdPaletteInput.value.trim());
  cmdPaletteCursor = _cmdItems.length > 0 ? 0 : -1;
  renderCmdResults(_cmdItems);
});

cmdPaletteInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeCmdPalette(); return; }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    cmdPaletteCursor = Math.min(cmdPaletteCursor + 1, _cmdItems.length - 1);
    renderCmdResults(_cmdItems);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    cmdPaletteCursor = Math.max(cmdPaletteCursor - 1, 0);
    renderCmdResults(_cmdItems);
  } else if (e.key === 'Enter') {
    if (cmdPaletteCursor >= 0 && _cmdItems[cmdPaletteCursor]) {
      executeCmdItem(_cmdItems[cmdPaletteCursor]);
    }
  }
});

document.getElementById('cmd-palette-backdrop').addEventListener('click', closeCmdPalette);

// Ctrl+K / Cmd+K to open
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    cmdPaletteOpen ? closeCmdPalette() : openCmdPalette();
  }
  if (e.key === 'Escape' && cmdPaletteOpen) closeCmdPalette();
});

// --- Init: restore settings ---
(async () => {
  const global = await window.api.getSetting('global');
  if (global) {
    if (global.sidebarWidth) {
      document.getElementById('sidebar').style.width = global.sidebarWidth + 'px';
    }
    if (global.visibleSessionCount) {
      visibleSessionCount = global.visibleSessionCount;
    }
    if (global.sessionMaxAgeDays) {
      sessionMaxAgeDays = global.sessionMaxAgeDays;
    }
    if (global.terminalTheme && TERMINAL_THEMES[global.terminalTheme]) {
      currentThemeName = global.terminalTheme;
      TERMINAL_THEME = getTerminalTheme();
    }
  }
})();

loadProjects().then(async () => {
  // Open the tab the user was last working in.
  const lastTab = rememberedTab();
  if (lastTab !== activeTab) document.querySelector(`.sidebar-tab[data-tab="${lastTab}"]`)?.click();
  await restoreActiveTaskView();
  await restorePersistedTerminalProcesses();
  // Restore grid view preference before opening sessions so they enter grid mode
  if (!activeTaskView && localStorage.getItem('gridViewActive') === '1') {
    showGridView();
  }
  // Restore the active session after a renderer reload or full app restart.
  // Raw terminals were reopened above but deliberately left hidden until this
  // point, so an already-open entry still needs showSession().
  if (activeSessionId) {
    const session = sessionMap.get(activeSessionId);
    if (session?.archived) {
      setActiveSession(null);
    } else if (session) {
      if (openSessions.has(activeSessionId)) showSession(activeSessionId);
      else openSession(session);
    }
    else setActiveSession(null);
  }
  // Start file watchers for recent sessions to power sidebar sparklines
  startSessionFileWatchers(cachedAllProjects);
});

} // end if (_detachedSessionId) else block

// Live-reload sidebar when filesystem changes are detected
let projectsChangedTimer = null;
// The strongest reason seen while the debounce window is open.
let projectsChangedReason = 'sessions';
let projectsChangedWhileAway = false;
window.api.onProjectsChanged((reason) => {
  // Debounce to avoid rapid re-renders during bulk changes
  if (projectsChangedTimer) clearTimeout(projectsChangedTimer);
  if (activeTab !== 'sessions' && activeTab !== 'projects') {
    projectsChangedWhileAway = true;
    return;
  }
  // A batch that mixes both is a project change: the wider refresh covers both.
  if (reason !== 'sessions') projectsChangedReason = 'project';
  projectsChangedTimer = setTimeout(() => {
    projectsChangedTimer = null;
    const only = projectsChangedReason;
    projectsChangedReason = 'sessions';
    loadProjects({ reason: only });
  }, 300);
});

// Load token cache on startup
window.api.getAllSessionTokens().then(data => { if (data) tokenCache = data; });
window.api.getAllSessionLoops().then(data => { if (data) loopCache = data; });

// Status bar
let activityTimer = null;

function renderDefaultStatus() {
  const totalSessions = cachedAllProjects.reduce((n, p) => n + p.sessions.length, 0);
  const totalProjects = cachedAllProjects.length;
  const running = activePtyIds.size;
  const parts = [];
  if (running > 0) parts.push(`${running} running`);
  parts.push(`${totalSessions} sessions`);
  parts.push(`${totalProjects} folders`);
  const projectCount = (cachedProjectTreeAll?.projects || []).filter(p => p.status === 'active').length;
  if (projectCount > 0) parts.push(`${projectCount} project${projectCount === 1 ? '' : 's'}`);
  statusBarInfo.textContent = parts.join(' \u00b7 ');
}

window.api.onStatusUpdate((text, type) => {
  if (activityTimer) clearTimeout(activityTimer);
  statusBarActivity.textContent = text;
  statusBarActivity.className = type === 'done' ? 'status-done' : '';
  if (!text || type === 'done') {
    activityTimer = setTimeout(() => {
      statusBarActivity.textContent = '';
      statusBarActivity.className = '';
    }, type === 'done' ? 3000 : 0);
  }
});

// --- Auto-update status + toast ---
const statusBarUpdater = document.getElementById('status-bar-updater');
let updaterStatusTimer = null;
function setUpdaterStatus(text, duration) {
  if (updaterStatusTimer) clearTimeout(updaterStatusTimer);
  statusBarUpdater.textContent = text;
  if (duration) {
    updaterStatusTimer = setTimeout(() => { statusBarUpdater.textContent = ''; }, duration);
  }
}
const updaterHandler = (type, data) => {
  switch (type) {
    case 'checking':
      setUpdaterStatus('Checking for updates…');
      break;
    case 'update-available':
      setUpdaterStatus(`Downloading v${data.version}…`);
      break;
    case 'update-not-available':
      setUpdaterStatus('Up to date', 3000);
      break;
    case 'download-progress':
      setUpdaterStatus(`Updating… ${Math.round(data.percent)}%`);
      break;
    case 'update-downloaded': {
      setUpdaterStatus(`v${data.version} ready — restart to update`);
      const dismissed = localStorage.getItem('update-dismissed');
      if (dismissed === data.version) return;
      const toast = document.getElementById('update-toast');
      const msg = document.getElementById('update-toast-msg');
      const notice = (data.releaseName && data.releaseName !== `v${data.version}` && data.releaseName !== data.version) ? `<span class="update-summary">${escapeHtml(data.releaseName)}</span>` : '';
      msg.innerHTML = `New Version Ready<br><span class="update-version">v${data.version}</span> (<a href="https://github.com/doctly/switchboard/releases" target="_blank" class="update-notes-link">release notes</a>)${notice}`;
      toast.classList.remove('hidden');
      document.getElementById('update-restart-btn').onclick = () => window.api.updaterInstall();
      document.getElementById('update-dismiss-btn').onclick = () => {
        toast.classList.add('hidden');
        localStorage.setItem('update-dismissed', data.version);
      };
      break;
    }
    case 'error':
      setUpdaterStatus('Update check failed', 5000);
      break;
  }
};
window.api.onUpdaterEvent(updaterHandler);

// --- Quota gauges in status bar ---
// One bar per limit window the usage API reports — a 5-hour session window, a
// weekly all-models window, and a weekly window per model. Which one bites
// first varies, and the 5-hour is usually the emptiest while resetting within
// the day, so showing a single window would read as "plenty left" while a
// weekly one is the one actually running out. Rows come from the API
// self-describing, so a newly launched model gets a bar without a code change.
const quotaGaugeEl = document.getElementById('status-bar-quota');

// Full labels ("Week (all models)") are too long for a status bar; the tooltip
// carries them in full.
function shortQuotaLabel(row) {
  // codex names its own windows by length, since it reports a duration in
  // seconds rather than a named bucket like Claude does.
  if (row.short) return row.short;
  if (row.kind === 'session') return '5h';
  if (row.kind === 'weekly_all') return 'Week';
  return row.model || 'Week';
}

function buildQuotaBar(row) {
  const wrap = document.createElement('span');
  wrap.className = 'quota-item';

  if (row.runtime) wrap.classList.add('quota-item-' + row.runtime);

  const label = document.createElement('span');
  label.className = 'quota-label';
  label.textContent = shortQuotaLabel(row);
  wrap.appendChild(label);

  const track = document.createElement('span');
  track.className = 'quota-track';
  const fill = document.createElement('span');
  const pct = row.percent;
  fill.className = 'quota-fill' + (pct >= 80 ? ' quota-high' : pct >= 60 ? ' quota-mid' : '');
  fill.style.width = Math.min(Math.max(pct, 1), 100) + '%';
  track.appendChild(fill);
  wrap.appendChild(track);

  const pctEl = document.createElement('span');
  pctEl.className = 'quota-pct';
  pctEl.textContent = pct + '%';
  wrap.appendChild(pctEl);

  const who = row.runtime === 'codex' ? 'Codex' : 'Claude';
  wrap.title = `${who} \u2014 ${row.label}: ${pct}%` + (row.reset ? ` \u2014 resets ${row.reset}` : '');
  return wrap;
}

function quotaRowsFor(usage, runtime) {
  // Prefer the API's self-describing rows; fall back to the flat 5-hour keys.
  const rows = Array.isArray(usage?.limits) && usage.limits.length
    ? usage.limits
    : (usage?.session !== undefined
      ? [{ kind: 'session', label: 'Current session', percent: usage.session, reset: usage.sessionReset }]
      : []);
  return rows.map(r => ({ runtime, ...r }));
}

/**
 * One CLI's bars behind its logo.
 *
 * The logo goes on the group rather than each bar: with two CLIs on the bar a
 * label like "Week" is ambiguous, but repeating the mark per bar is noise.
 */
function buildQuotaGroup(runtime, rows) {
  const group = document.createElement('span');
  group.className = 'quota-group quota-group-' + runtime;

  const icon = document.createElement('span');
  icon.className = 'quota-runtime-icon';
  icon.innerHTML = runtime === 'codex' ? ICONS.codex(12) : ICONS.claude(12);
  icon.title = runtime === 'codex' ? 'Codex' : 'Claude';
  group.appendChild(icon);

  for (const row of rows) group.appendChild(buildQuotaBar(row));
  return group;
}

async function refreshQuotaGauge() {
  try {
    // Both CLIs, in parallel and independently: one being signed out or
    // switched off must not cost the other its bars.
    const [claudeUsage, codexUsage] = await Promise.all([
      window.api.getUsage().catch(() => ({})),
      window.api.getCodexUsage?.().catch(() => ({})) ?? {},
    ]);
    const groups = [];
    for (const [runtime, usage] of [['claude', claudeUsage], ['codex', codexUsage]]) {
      const rows = quotaRowsFor(usage, runtime);
      if (rows.length) groups.push(buildQuotaGroup(runtime, rows));
    }
    if (!groups.length) { quotaGaugeEl.style.display = 'none'; return; }

    quotaGaugeEl.replaceChildren(...groups);
    quotaGaugeEl.style.display = '';
  } catch {}
}
refreshQuotaGauge();
setInterval(refreshQuotaGauge, 5 * 60 * 1000);

// Switching a CLI on or off changes which bars belong on the gauge and which
// sessions belong in the sidebar. Both are otherwise only refreshed on a timer.
window.api.onHarnessesChanged?.(() => {
  refreshQuotaGauge();
  loadProjects({ resort: true });
});
quotaGaugeEl.addEventListener('click', () => {
  document.querySelector('.sidebar-tab[data-tab="stats"]')?.click();
});

// --- Initialize file panel (MCP bridge UI) ---
if (typeof initFilePanel === 'function') initFilePanel();

// ========== COMMAND SCHEDULER (bridge to scheduler.js) ==========
// openScheduler, updateSchedulerBtnState, schedulerOnTerminalData,
// schedulerToggleBroadcast, schedulerGetBroadcastTargets, recordMacroInput
// are all defined in scheduler.js (loaded after app.js)

