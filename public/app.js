// Agent color map (matches CLI_AGENTS in main.js)
const AGENT_COLORS = {
  claude: '#d97757', codex: '#4ade80', qwen: '#60a5fa',
  gemini: '#22d3ee', kimi: '#fb923c', aider: '#a78bfa',
  opencode: '#f472b6', hermes: '#fbbf24', letta: '#34d399',
};
const AGENT_LABELS = {
  claude: 'Claude', codex: 'Codex', qwen: 'Qwen',
  gemini: 'Gemini', kimi: 'Kimi', aider: 'Aider',
  opencode: 'OpenCode', hermes: 'Hermes', letta: 'Letta',
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
let activeSessionId = sessionStorage.getItem('activeSessionId') || null;
function setActiveSession(id) {
  activeSessionId = id;
  if (id) sessionStorage.setItem('activeSessionId', id);
  else sessionStorage.removeItem('activeSessionId');
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
let activePtyIds = new Set();
let sessionAgentMap = new Map(); // sessionId → cliAgent id
let tokenCache = {}; // sessionId → { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, model, costCents }
let loopCache = {}; // sessionId → { loopCount, lastLoopAt, lastLoopTool, lastLoopReason }
let headlessState = new Map(); // sessionId → { events: [], lastAction: '', startTime }
let sortedOrder = []; // [{ projectPath, itemIds: [itemId, ...] }, ...] — single source of truth for sidebar order
let activeTab = 'sessions';
let activeAgent = localStorage.getItem('activeAgent') || 'claude'; // which CLI agent's sessions to show
let cachedAgentProjects = new Map(); // agentId → projects[] cache
let installedAgents = {}; // populated on init
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
//   1. OSC 0 braille spinner (authoritative: Claude CLI sets title to spinner chars)
//   2. Noise-filtered terminal output (fallback: non-noise, non-TUI-repaint data)
//
// Both feed into setActivity(sessionId, active):
//   active=true  → cli-busy (spinner dot)
//   active=false → response-ready if not focused (terminal state until user clicks)
// OSC 0 idle signal is the authoritative source for marking sessions as idle.
//
const attentionSessions = new Set(); // sessions needing user action (OSC 9)
const responseReadySessions = new Set(); // Claude finished, user hasn't looked (terminal state)
const sessionBusyState = new Map(); // sessionId → boolean (currently active)
const errorSessions = new Set(); // sessions that errored out / API issues / non-zero exit
const lastActivityTime = new Map(); // sessionId → Date of last terminal output

// Noise patterns — these don't count as activity
const activityNoiseRe = /file-history-snapshot|^\s*$/;

// Central activity dispatcher
function setActivity(sessionId, active) {
  if (responseReadySessions.has(sessionId)) {
    return;
  }

  const wasActive = sessionBusyState.get(sessionId) || false;
  sessionBusyState.set(sessionId, active);

  // Clear error state when session becomes active again (restarted/recovered)
  if (active && errorSessions.has(sessionId)) {
    errorSessions.delete(sessionId);
    const errItem = document.querySelector(`.session-item[data-session-id="${sessionId}"]`);
    if (errItem) errItem.classList.remove('session-error');
  }

  if (wasActive && !active) {
    // Activity ended → response-ready if user isn't looking at this session
    if (sessionId !== activeSessionId) {
      responseReadySessions.add(sessionId);
      const item = document.querySelector(`.session-item[data-session-id="${sessionId}"]`);
      if (item) {
        item.classList.remove('cli-busy');
        item.classList.add('response-ready');
      }
    }
  }

  // Sync cli-busy class (only if not response-ready)
  if (!responseReadySessions.has(sessionId)) {
    const item = document.querySelector(`.session-item[data-session-id="${sessionId}"]`);
    if (item) item.classList.toggle('cli-busy', active);
  }
}

// Terminal output activity — updates lastActivityTime only, busy state driven by backend
// Patterns that indicate API errors, rate limits, auth failures, or crashes
const errorPatterns = /overloaded|rate.limit|exceeded|api.error|unauthorized|authentication.failed|invalid.api.key|quota|529|503|502|500.*error|credit|billing|internal.server.error/i;

function trackActivity(sessionId, data) {
  if (activityNoiseRe.test(data)) return;
  lastActivityTime.set(sessionId, new Date());

  // Detect API/auth errors in terminal output
  if (errorPatterns.test(data)) {
    errorSessions.add(sessionId);
    const item = document.querySelector(`.session-item[data-session-id="${sessionId}"]`);
    if (item) item.classList.add('session-error');
  }
}

function clearUnread(sessionId) {
  responseReadySessions.delete(sessionId);
  const item = document.querySelector(`.session-item[data-session-id="${sessionId}"]`);
  if (item) {
    item.classList.remove('response-ready');
  }
}

function clearNotifications(sessionId) {
  clearUnread(sessionId);
  attentionSessions.delete(sessionId);
  const item = document.querySelector(`.session-item[data-session-id="${sessionId}"]`);
  if (item) item.classList.remove('needs-attention');
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
  // Update last activity time (noise-filtered)
  trackActivity(sessionId, data);
  // Feed terminal output to scheduler (wait-for-output, condition checks)
  if (typeof schedulerOnTerminalData === 'function') schedulerOnTerminalData(sessionId, data);
});

window.api.onSessionDetected((tempId, realId) => {
  const entry = openSessions.get(tempId);
  if (!entry) return;

  entry.session.sessionId = realId;
  if (activeSessionId === tempId) setActiveSession(realId);

  // Re-key in openSessions
  openSessions.delete(tempId);
  openSessions.set(realId, entry);

  terminalHeaderId.textContent = realId;
  terminalHeaderName.textContent = 'New session';

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

window.api.onProcessExited((sessionId, exitCode) => {
  const entry = openSessions.get(sessionId);
  const session = sessionMap.get(sessionId);
  if (entry) {
    entry.closed = true;
  }

  // Mark as errored if non-zero exit (crash, API failure, etc.)
  if (exitCode !== 0 && exitCode != null) {
    errorSessions.add(sessionId);
    const item = document.querySelector(`.session-item[data-session-id="${sessionId}"]`);
    if (item) item.classList.add('session-error');
  }

  // Clean up terminal UI on exit (uses destroySession to handle grid cards too)
  if (entry) {
    destroySession(sessionId);
  }
  if (gridViewActive) {
    gridViewerCount.textContent = gridCards.size + ' session' + (gridCards.size !== 1 ? 's' : '');
  } else if (activeSessionId === sessionId) {
    setActiveSession(null);
    terminalHeader.style.display = 'none';
    hideConversationViewer();
    placeholder.style.display = '';
  }

  // Plain terminal sessions: remove from sidebar entirely (ephemeral)
  if (session?.type === 'terminal') {
    pendingSessions.delete(sessionId);
    for (const projList of [cachedProjects, cachedAllProjects]) {
      for (const proj of projList) {
        proj.sessions = proj.sessions.filter(s => s.sessionId !== sessionId);
      }
    }
    sessionMap.delete(sessionId);
    refreshSidebar();
    pollActiveSessions();
    return;
  }

  // Clean up no-op pending sessions (never created a .jsonl)
  if (pendingSessions.has(sessionId)) {
    pendingSessions.delete(sessionId);
    // Remove from cached project data
    for (const projList of [cachedProjects, cachedAllProjects]) {
      for (const proj of projList) {
        proj.sessions = proj.sessions.filter(s => s.sessionId !== sessionId);
      }
    }
    sessionMap.delete(sessionId);
    refreshSidebar();
  }

  pollActiveSessions();
});

// --- Terminal notifications (iTerm2 OSC 9 — "needs attention") ---
window.api.onTerminalNotification((sessionId, message) => {
  // Only mark as needing attention for "attention" messages, not "waiting for input"
  // Matches all four CLI notification types:
  // 1. "Claude Code needs your attention"         → attention
  // 2. "Claude Code needs your approval for the plan" → approval, needs your
  // 3. "Claude needs your permission to use {tool}"   → permission, needs your
  // 4. "Claude Code wants to enter plan mode"         → wants to enter
  if (/attention|approval|permission|needs your|wants to enter/i.test(message) && sessionId !== activeSessionId) {
    attentionSessions.add(sessionId);
    const item = document.querySelector(`.session-item[data-session-id="${sessionId}"]`);
    if (item) item.classList.add('needs-attention');
  } else if (/waiting for your input/i.test(message)) {
    // "Claude is waiting for your input" — delayed idle notification, mark response-ready
    setActivity(sessionId, false);
  }

  // Show in header if active
  if (sessionId === activeSessionId && terminalHeaderPtyTitle) {
    terminalHeaderPtyTitle.textContent = message;
    terminalHeaderPtyTitle.style.display = '';
  }
});

// --- CLI busy state (OSC 0 title spinner detection) ---
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
function refreshSidebar({ resort = false } = {}) {
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

// --- Global settings gear button ---
globalSettingsBtn.innerHTML = ICONS.gear(18);
globalSettingsBtn.addEventListener('click', () => {
  openSettingsViewer('global');
});

// --- Add project button ---
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
  if (activeTab === 'sessions') {
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
      if (activeTab === 'sessions') {
        const results = await window.api.search('session', query, searchTitlesOnly);
        searchMatchIds = new Set(results.map(r => r.id));
        // When title-only, also match project names
        searchMatchProjectPaths = null;
        if (searchTitlesOnly) {
          const lowerQ = query.toLowerCase();
          for (const p of cachedAllProjects) {
            const shortName = p.projectPath.split('/').filter(Boolean).slice(-2).join('/');
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
      if (activeTab === 'sessions') {
        searchMatchIds = null;
        searchMatchProjectPaths = null;
        refreshSidebar({ resort: true });
      }
    }
  }, 150);
});

// --- Stop session helper ---
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
async function pollActiveSessions() {
  try {
    const sessions = await window.api.getActiveSessions();
    const prevSize = activePtyIds.size;
    activePtyIds = new Set(sessions.map(s => s.sessionId));
    for (const s of sessions) sessionAgentMap.set(s.sessionId, s.cliAgent);
    updateRunningIndicators();
    updateTerminalHeader();
    // Auto-refresh the "Active" meta-view when PTY count changes
    if (activeAgent === '_active' && activePtyIds.size !== prevSize) {
      loadMetaView('_active');
    }
  } catch {}
}

function updateRunningIndicators() {
  document.querySelectorAll('.session-item').forEach(item => {
    const id = item.dataset.sessionId;
    const running = activePtyIds.has(id);
    item.classList.toggle('has-running-pty', running);
    if (!running) {
      item.classList.remove('needs-attention', 'response-ready', 'cli-busy');
      attentionSessions.delete(id);
      responseReadySessions.delete(id);
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

setInterval(pollActiveSessions, 3000);

// Refresh sidebar timeago labels every 30s so "just now" ticks forward
setInterval(() => {
  for (const [sessionId, time] of lastActivityTime) {
    const item = document.getElementById('si-' + sessionId);
    if (!item) continue;
    const meta = item.querySelector('.session-meta');
    if (!meta) continue;
    const session = sessionMap.get(sessionId);
    const msgSuffix = session?.messageCount ? ' \u00b7 ' + session.messageCount + ' msgs' : '';
    meta.textContent = formatDate(time) + msgSuffix;
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

async function loadProjects({ resort = false } = {}) {
  const wasEmpty = cachedProjects.length === 0;
  if (wasEmpty) {
    loadingStatus.textContent = 'Loading\u2026';
    loadingStatus.className = 'active';
    loadingStatus.style.display = '';
  }
  const [defaultProjects, allProjects] = await Promise.all([
    window.api.getProjects(false),
    window.api.getProjects(true),
  ]);
  cachedProjects = defaultProjects;
  cachedAllProjects = allProjects;
  loadingStatus.style.display = 'none';
  loadingStatus.className = '';
  dedup(cachedProjects);
  dedup(cachedAllProjects);

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
    }
  }

  // Track active plain terminals in pendingSessions/sessionMap (data now comes from backend)
  try {
    const activeTerminals = await window.api.getActiveTerminals();
    for (const { sessionId, projectPath } of activeTerminals) {
      if (pendingSessions.has(sessionId)) continue; // already tracked
      const folder = projectPath.replace(/[/_]/g, '-').replace(/^-/, '-');
      // Find the session object already injected by the backend
      let session;
      for (const proj of cachedAllProjects) {
        session = proj.sessions.find(s => s.sessionId === sessionId);
        if (session) break;
      }
      if (!session) continue;
      pendingSessions.set(sessionId, { session, projectPath, folder });
      sessionMap.set(sessionId, session);
    }
  } catch {}

  await pollActiveSessions();
  refreshSidebar({ resort });
  renderDefaultStatus();
}

// Sidebar rendering (slugId, folderId, buildSlugGroup, renderProjects,
// rebindSidebarEvents, buildSessionItem, startRename) → sidebar.js

function folderId(projectPath) {
  return 'project-' + projectPath.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function buildSlugGroup(slug, sessions) {
  const group = document.createElement('div');
  const id = slugId(slug);
  const expanded = getExpandedSlugs().has(id);
  group.className = expanded ? 'slug-group' : 'slug-group collapsed';
  group.id = id;

  const mostRecent = sessions.reduce((a, b) => {
    const aTime = lastActivityTime.get(a.sessionId) || new Date(a.modified);
    const bTime = lastActivityTime.get(b.sessionId) || new Date(b.modified);
    return bTime > aTime ? b : a;
  });
  const displayName = cleanDisplayName(mostRecent.name || mostRecent.summary || slug);
  const mostRecentTime = lastActivityTime.get(mostRecent.sessionId) || new Date(mostRecent.modified);
  const timeStr = formatDate(mostRecentTime);

  const header = document.createElement('div');
  header.className = 'slug-group-header';

  const row = document.createElement('div');
  row.className = 'slug-group-row';

  const expand = document.createElement('span');
  expand.className = 'slug-group-expand';
  expand.innerHTML = '<span class="arrow">&#9654;</span>';

  const info = document.createElement('div');
  info.className = 'slug-group-info';

  const nameEl = document.createElement('div');
  nameEl.className = 'slug-group-name';
  nameEl.textContent = displayName;

  const hasRunning = sessions.some(s => activePtyIds.has(s.sessionId));

  const meta = document.createElement('div');
  meta.className = 'slug-group-meta';
  meta.innerHTML = `<span class="slug-group-dot${hasRunning ? ' running' : ''}"></span><span class="slug-group-count">${sessions.length} sessions</span> ${escapeHtml(timeStr)}`;

  const archiveSlugBtn = document.createElement('button');
  archiveSlugBtn.className = 'slug-group-archive-btn';
  archiveSlugBtn.title = 'Archive all sessions in group';
  archiveSlugBtn.innerHTML = ICONS.archive(14);

  info.appendChild(nameEl);
  info.appendChild(meta);
  row.appendChild(expand);
  row.appendChild(info);
  row.appendChild(archiveSlugBtn);
  header.appendChild(row);

  const sessionsContainer = document.createElement('div');
  sessionsContainer.className = 'slug-group-sessions';

  const promoted = [];
  const rest = [];
  for (const session of sessions) {
    if (activePtyIds.has(session.sessionId)) {
      promoted.push(session);
    } else {
      rest.push(session);
    }
  }

  if (promoted.length > 0) {
    group.classList.add('has-promoted');
    for (const session of promoted) {
      sessionsContainer.appendChild(buildSessionItem(session));
    }
    if (rest.length > 0) {
      const moreBtn = document.createElement('div');
      moreBtn.className = 'slug-group-more';
      moreBtn.id = 'sgm-' + id;
      moreBtn.textContent = `+ ${rest.length} more`;

      const olderDiv = document.createElement('div');
      olderDiv.className = 'slug-group-older';
      olderDiv.id = 'sgo-' + id;
      for (const session of rest) {
        olderDiv.appendChild(buildSessionItem(session));
      }

      sessionsContainer.appendChild(moreBtn);
      sessionsContainer.appendChild(olderDiv);
    }
  } else {
    for (const session of sessions) {
      sessionsContainer.appendChild(buildSessionItem(session));
    }
  }

  group.appendChild(header);
  group.appendChild(sessionsContainer);
  return group;
}

function renderProjects(projects, resort) {
  const newSidebar = document.createElement('div');

  // Sort project groups using sortedOrder as source of truth
  if (!resort && sortedOrder.length > 0) {
    const orderIndex = new Map(sortedOrder.map((e, i) => [e.projectPath, i]));
    projects = [...projects].sort((a, b) => {
      const aPos = orderIndex.get(a.projectPath);
      const bPos = orderIndex.get(b.projectPath);
      if (aPos !== undefined && bPos !== undefined) return aPos - bPos;
      if (aPos === undefined && bPos !== undefined) return -1;
      if (aPos !== undefined && bPos === undefined) return 1;
      return 0;
    });
  }
  // projects are now in the correct order (data order for resort, preserved order otherwise)

  const newSortedOrder = [];

  for (const project of projects) {
    // === STEP 1: Filter ===
    let filtered = project.sessions;
    if (showStarredOnly) {
      filtered = filtered.filter(s => s.starred);
    }
    if (showRunningOnly) {
      filtered = filtered.filter(s => activePtyIds.has(s.sessionId));
    }
    if (showTodayOnly) {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      filtered = filtered.filter(s => {
        if (!s.modified) return false;
        const d = new Date(s.modified);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === todayStr;
      });
    }
    // Time range filter (applies to all views including pinned/active)
    if (activeTimeFilter > 0) {
      filtered = filterSessionsByDate(filtered, activeTimeFilter);
    }

    // === STEP 1.5: User-selected sort (applies after filters, before priority grouping) ===
    filtered = sortSessions(filtered, activeSortMode);

    const anyFilterActive = showStarredOnly || showRunningOnly || showTodayOnly || activeTimeFilter > 0 || searchMatchIds !== null;
    if (filtered.length === 0 && !project._projectMatchedOnly && (project.sessions.length > 0 || anyFilterActive)) continue;
    const fId = folderId(project.projectPath);

    // === STEP 2: Priority sort ===
    // Priority: pinned+running > running > pinned > rest (within each tier, use user sort mode)
    filtered = [...filtered].sort((a, b) => {
      const aRunning = activePtyIds.has(a.sessionId) || pendingSessions.has(a.sessionId);
      const bRunning = activePtyIds.has(b.sessionId) || pendingSessions.has(b.sessionId);
      const aPri = (a.starred && aRunning ? 3 : aRunning ? 2 : a.starred ? 1 : 0);
      const bPri = (b.starred && bRunning ? 3 : bRunning ? 2 : b.starred ? 1 : 0);
      if (aPri !== bPri) return bPri - aPri;
      // Within same priority tier, use user-selected sort
      switch (activeSortMode) {
        case 'date-desc':
          return new Date(b.endTime || b.startTime || 0) - new Date(a.endTime || a.startTime || 0);
        case 'date-asc':
          return new Date(a.startTime || a.endTime || 0) - new Date(b.startTime || b.endTime || 0);
        case 'size-desc':
          return (b.size || 0) - (a.size || 0);
        case 'size-asc':
          return (a.size || 0) - (b.size || 0);
        case 'msgs-desc':
          return (b.messageCount || b.turnCount || 0) - (a.messageCount || a.turnCount || 0);
        case 'project':
          return (a.projectPath || '').localeCompare(b.projectPath || '');
        case 'git': {
          const gitOrder = { ahead: 0, current: 1, behind: 2, dirty: 3, unknown: 4 };
          return (gitOrder[a.gitStatus || 'unknown'] ?? 4) - (gitOrder[b.gitStatus || 'unknown'] ?? 4);
        }
        default:
          return new Date(b.modified) - new Date(a.modified);
      }
    });

    // === STEP 3: Slug grouping ===
    const slugMap = new Map(); // slug → sessions[]
    const ungrouped = [];
    for (const session of filtered) {
      if (session.slug) {
        if (!slugMap.has(session.slug)) slugMap.set(session.slug, []);
        slugMap.get(session.slug).push(session);
      } else {
        ungrouped.push(session);
      }
    }

    // Build render items (slug group = 1 item)
    const allItems = [];
    for (const session of ungrouped) {
      const isRunning = activePtyIds.has(session.sessionId) || pendingSessions.has(session.sessionId);
      allItems.push({
        sortTime: new Date(session.modified).getTime(),
        pinned: !!session.starred, running: isRunning,
        element: buildSessionItem(session),
      });
    }
    for (const [slug, sessions] of slugMap) {
      const mostRecentTime = Math.max(...sessions.map(s => new Date(s.modified).getTime()));
      const hasRunning = sessions.some(s => activePtyIds.has(s.sessionId) || pendingSessions.has(s.sessionId));
      const hasPinned = sessions.some(s => s.starred);
      const element = sessions.length === 1 ? buildSessionItem(sessions[0]) : buildSlugGroup(slug, sessions);
      allItems.push({
        sortTime: mostRecentTime,
        pinned: hasPinned, running: hasRunning,
        element,
      });
    }

    // === STEP 4: Sort render items ===
    const prevEntry = sortedOrder.find(e => e.projectPath === project.projectPath);
    if (resort || !prevEntry) {
      // Full sort by priority + modified time
      allItems.sort((a, b) => {
        const aPri = (a.pinned && a.running ? 3 : a.running ? 2 : a.pinned ? 1 : 0);
        const bPri = (b.pinned && b.running ? 3 : b.running ? 2 : b.pinned ? 1 : 0);
        if (aPri !== bPri) return bPri - aPri;
        return b.sortTime - a.sortTime;
      });
    } else {
      // Preserve last-sorted order; new items go to top
      const orderIndex = new Map(prevEntry.itemIds.map((id, i) => [id, i]));
      allItems.sort((a, b) => {
        const aPos = orderIndex.get(a.element.id);
        const bPos = orderIndex.get(b.element.id);
        if (aPos !== undefined && bPos !== undefined) return aPos - bPos;
        if (aPos === undefined && bPos !== undefined) return -1;
        if (aPos !== undefined && bPos === undefined) return 1;
        return b.sortTime - a.sortTime;
      });
    }
    // Save current order for this project
    newSortedOrder.push({ projectPath: project.projectPath, itemIds: allItems.map(item => item.element.id) });

    // === STEP 5: Truncate — split into visible vs older ===
    let visible = [];
    let older = [];
    if (searchMatchIds !== null || showStarredOnly || showRunningOnly || showTodayOnly) {
      visible = allItems;
    } else {
      let count = 0;
      const ageCutoff = Date.now() - sessionMaxAgeDays * 86400000;
      for (const item of allItems) {
        // Running and pinned always show; others must be within count AND age limit
        if (item.running || item.pinned || (count < visibleSessionCount && item.sortTime >= ageCutoff)) {
          visible.push(item);
          count++;
        } else {
          older.push(item);
        }
      }
      // If visible is empty but older has items, show them directly
      if (visible.length === 0 && older.length > 0) {
        visible = older;
        older = [];
      }
    }

    // === STEP 6: Build DOM ===
    const group = document.createElement('div');
    group.className = 'project-group';
    group.id = fId;

    const header = document.createElement('div');
    header.className = 'project-header';
    header.id = 'ph-' + fId;
    const shortName = project.projectPath.split('/').filter(Boolean).slice(-2).join('/');
    header.innerHTML = `<span class="arrow">&#9660;</span> <span class="project-name">${shortName}</span>`;

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'project-settings-btn';
    settingsBtn.title = 'Project settings';
    settingsBtn.innerHTML = ICONS.gear(16);
    header.appendChild(settingsBtn);

    const archiveGroupBtn = document.createElement('button');
    archiveGroupBtn.className = 'project-archive-btn';
    archiveGroupBtn.title = 'Archive all sessions';
    archiveGroupBtn.innerHTML = ICONS.archive(18);
    header.appendChild(archiveGroupBtn);

    const newBtn = document.createElement('button');
    newBtn.className = 'project-new-btn';
    newBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="6" y1="2" x2="6" y2="10"/><line x1="2" y1="6" x2="10" y2="6"/></svg>';
    newBtn.title = 'New session';
    header.appendChild(newBtn);

    const sessionsList = document.createElement('div');
    sessionsList.className = 'project-sessions';
    sessionsList.id = 'sessions-' + fId;

    for (const item of visible) {
      sessionsList.appendChild(item.element);
    }

    if (older.length > 0) {
      const moreBtn = document.createElement('div');
      moreBtn.className = 'sessions-more-toggle';
      moreBtn.id = 'older-' + fId;
      moreBtn.textContent = `+ ${older.length} older`;
      const olderList = document.createElement('div');
      olderList.className = 'sessions-older';
      olderList.id = 'older-list-' + fId;
      olderList.style.display = 'none';
      for (const item of older) {
        olderList.appendChild(item.element);
      }
      sessionsList.appendChild(moreBtn);
      sessionsList.appendChild(olderList);
    }

    // Auto-collapse if most recent session is older than 5 days, or project matched with no sessions
    if (project._projectMatchedOnly) {
      header.classList.add('collapsed');
    } else if (searchMatchIds === null && !showStarredOnly && !showRunningOnly) {
      const mostRecent = filtered[0]?.modified;
      if (mostRecent && (Date.now() - new Date(mostRecent)) > sessionMaxAgeDays * 86400000) {
        header.classList.add('collapsed');
      }
    }

    group.appendChild(header);
    group.appendChild(sessionsList);
    newSidebar.appendChild(group);
  }

  // Re-apply active state
  if (activeSessionId) {
    const activeItem = newSidebar.querySelector(`[data-session-id="${activeSessionId}"]`);
    if (activeItem) activeItem.classList.add('active');
  }

  morphdom(sidebarContent, newSidebar, {
    childrenOnly: true,
    onBeforeElUpdated(fromEl, toEl) {
      // Skip updating session items that have an active rename input
      if (fromEl.classList.contains('session-item') && fromEl.querySelector('.session-rename-input')) {
        return false;
      }
      if (fromEl.classList.contains('project-header')) {
        if (fromEl.classList.contains('collapsed')) {
          toEl.classList.add('collapsed');
        } else {
          toEl.classList.remove('collapsed');
        }
      }
      if (fromEl.classList.contains('slug-group')) {
        if (fromEl.classList.contains('collapsed')) {
          toEl.classList.add('collapsed');
        } else {
          toEl.classList.remove('collapsed');
        }
      }
      if (fromEl.classList.contains('sessions-older') && fromEl.style.display !== 'none') {
        toEl.style.display = '';
      }
      if (fromEl.classList.contains('sessions-more-toggle') && fromEl.classList.contains('expanded')) {
        toEl.classList.add('expanded');
        toEl.textContent = '- hide older';
      }
      if (fromEl.classList.contains('slug-group-older') && fromEl.style.display !== 'none') {
        toEl.style.display = '';
      }
      if (fromEl.classList.contains('slug-group-more') && fromEl.classList.contains('expanded')) {
        toEl.classList.add('expanded');
      }
      return true;
    },
    getNodeKey(node) {
      return node.id || undefined;
    }
  });

  // Save the full sorted order (project order + item order) as source of truth
  sortedOrder = newSortedOrder;

  rebindSidebarEvents(projects);

  // Restore terminal focus after morphdom DOM updates, but not if the user is
  // interacting with an input/textarea (search box, rename input, dialogs, etc.)
  const ae = document.activeElement;
  const isUserTyping = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable || ae.closest('.modal-overlay'));
  if (activeSessionId && openSessions.has(activeSessionId) && !isUserTyping) {
    openSessions.get(activeSessionId).terminal.focus();
  }
}

function rebindSidebarEvents(projects) {
  for (const project of projects) {
    const fId = folderId(project.projectPath);
    const header = document.getElementById('ph-' + fId);
    if (!header) continue;
    const newBtn = header.querySelector('.project-new-btn');
    if (newBtn) {
      newBtn.onclick = (e) => { e.stopPropagation(); showNewSessionPopover(project, newBtn); };
    }
    const settingsBtn = header.querySelector('.project-settings-btn');
    if (settingsBtn) {
      settingsBtn.onclick = (e) => { e.stopPropagation(); openSettingsViewer('project', project.projectPath); };
    }
    const archiveGroupBtn = header.querySelector('.project-archive-btn');
    if (archiveGroupBtn) {
      archiveGroupBtn.onclick = async (e) => {
        e.stopPropagation();
        const sessions = project.sessions.filter(s => !s.archived);
        if (sessions.length === 0) return;
        const shortName = project.projectPath.split('/').filter(Boolean).slice(-2).join('/');
        if (!confirm(`Archive all ${sessions.length} session${sessions.length > 1 ? 's' : ''} in ${shortName}?`)) return;
        for (const s of sessions) {
          if (activePtyIds.has(s.sessionId)) {
            await window.api.stopSession(s.sessionId);
          }
          await window.api.archiveSession(s.sessionId, 1);
          s.archived = 1;
        }
        pollActiveSessions();
        loadProjects();
      };
    }
    header.onclick = (e) => {
      if (e.target.closest('.project-new-btn') || e.target.closest('.project-archive-btn') || e.target.closest('.project-settings-btn')) return;
      header.classList.toggle('collapsed');
    };
  }

  sidebarContent.querySelectorAll('.slug-group-header').forEach(header => {
    const archiveBtn = header.querySelector('.slug-group-archive-btn');
    if (archiveBtn) {
      archiveBtn.onclick = async (e) => {
        e.stopPropagation();
        const group = header.parentElement;
        const sessionItems = group.querySelectorAll('.session-item');
        for (const item of sessionItems) {
          const sid = item.dataset.sessionId;
          const session = sessionMap.get(sid);
          if (!session || session.archived) continue;
          if (activePtyIds.has(sid)) await window.api.stopSession(sid);
          await window.api.archiveSession(sid, 1);
          session.archived = 1;
        }
        pollActiveSessions();
        loadProjects();
      };
    }
    header.onclick = (e) => {
      if (e.target.closest('.slug-group-archive-btn')) return;
      header.parentElement.classList.toggle('collapsed');
      saveExpandedSlugs();
    };
  });

  sidebarContent.querySelectorAll('.slug-group-more').forEach(moreBtn => {
    moreBtn.onclick = () => {
      const group = moreBtn.closest('.slug-group');
      if (group) {
        group.classList.remove('collapsed');
        saveExpandedSlugs();
      }
    };
  });

  sidebarContent.querySelectorAll('.sessions-more-toggle').forEach(moreBtn => {
    const olderList = moreBtn.nextElementSibling;
    if (!olderList || !olderList.classList.contains('sessions-older')) return;
    const count = olderList.children.length;
    moreBtn.onclick = () => {
      const showing = olderList.style.display !== 'none';
      olderList.style.display = showing ? 'none' : '';
      moreBtn.classList.toggle('expanded', !showing);
      moreBtn.textContent = showing ? `+ ${count} older` : '- hide older';
    };
  });

  sidebarContent.querySelectorAll('.session-item').forEach(item => {
    const sessionId = item.dataset.sessionId;
    const session = sessionMap.get(sessionId);
    if (!session) return;

    item.onclick = () => openSession(session);

    const pin = item.querySelector('.session-pin');
    if (pin) {
      pin.onclick = async (e) => {
        e.stopPropagation();
        const { starred } = await window.api.toggleStar(session.sessionId);
        session.starred = starred;
        refreshSidebar({ resort: true });
      };
    }

    const summaryEl = item.querySelector('.session-summary');
    if (summaryEl) {
      summaryEl.ondblclick = (e) => { e.stopPropagation(); startRename(summaryEl, session); };
    }

    const stopBtn = item.querySelector('.session-stop-btn');
    if (stopBtn) {
      stopBtn.onclick = (e) => {
        e.stopPropagation();
        confirmAndStopSession(session.sessionId);
      };
    }

    const launchConfigBtn = item.querySelector('.session-launch-config-btn');
    if (launchConfigBtn) {
      launchConfigBtn.onclick = (e) => {
        e.stopPropagation();
        showResumeSessionDialog(session);
      };
    }

    const forkBtn = item.querySelector('.session-fork-btn');
    if (forkBtn) {
      forkBtn.onclick = async (e) => {
        e.stopPropagation();
        // Find the project for this session
        const project = [...cachedAllProjects, ...cachedProjects].find(p =>
          p.sessions.some(s => s.sessionId === session.sessionId)
        );
        if (project) {
          forkSession(session, project);
        }
      };
    }

    const jsonlBtn = item.querySelector('.session-jsonl-btn');
    if (jsonlBtn) {
      jsonlBtn.onclick = (e) => {
        e.stopPropagation();
        showJsonlViewer(session);
      };
    }

    const archiveBtn = item.querySelector('.session-archive-btn');
    if (archiveBtn) {
      archiveBtn.onclick = async (e) => {
        e.stopPropagation();
        const newVal = session.archived ? 0 : 1;
        if (newVal && activePtyIds.has(session.sessionId)) {
          await window.api.stopSession(session.sessionId);
          pollActiveSessions();
        }
        await window.api.archiveSession(session.sessionId, newVal);
        session.archived = newVal;
        loadProjects();
      };
    }
  });

  // Auto-expand slug group if it contains the active session
  if (activeSessionId) {
    const activeItem = sidebarContent.querySelector(`[data-session-id="${activeSessionId}"]`);
    const collapsedGroup = activeItem?.closest('.slug-group.collapsed');
    if (collapsedGroup) {
      collapsedGroup.classList.remove('collapsed');
      saveExpandedSlugs();
    }
  }
}

// Refresh loop badge on an existing session card without full rebuild
function refreshSessionCard(sessionId) {
  const card = document.querySelector(`[data-session-id="${sessionId}"]`);
  if (!card) return;
  const summaryEl = card.querySelector('.session-summary');
  if (!summaryEl) return;
  // Remove existing loop badge
  const existing = summaryEl.querySelector('.loop-badge');
  if (existing) existing.remove();
  // Add updated badge
  const lp = loopCache[sessionId];
  if (lp && lp.loopCount > 0) {
    const loopBadge = document.createElement('span');
    loopBadge.className = 'loop-badge';
    loopBadge.title = `Loop detected ${lp.loopCount}x${lp.lastLoopTool ? ' with ' + lp.lastLoopTool : ''}${lp.lastLoopReason ? ': ' + lp.lastLoopReason : ''}`;
    loopBadge.textContent = '\u21BB' + lp.loopCount;
    summaryEl.appendChild(loopBadge);
  }
}

// F5.6: Determine activity color class from session timestamp
function getActivityClass(session) {
  const ts = session.endTime || session.modified;
  if (!ts) return 'activity-stale';
  const age = Date.now() - new Date(ts).getTime();
  if (age < 5 * 60 * 1000) return 'activity-recent';       // < 5 min
  if (age < 60 * 60 * 1000) return 'activity-recent-hour'; // < 1 hour
  return 'activity-stale';
}

function buildSessionItem(session) {
  const item = document.createElement('div');
  item.className = 'session-item';
  item.id = 'si-' + session.sessionId;
  if (session.type === 'terminal') item.classList.add('is-terminal');
  if (session.archived) item.classList.add('archived-item');
  if (activePtyIds.has(session.sessionId)) item.classList.add('has-running-pty');
  if (attentionSessions.has(session.sessionId)) item.classList.add('needs-attention');
  if (errorSessions.has(session.sessionId)) item.classList.add('session-error');
  if (responseReadySessions.has(session.sessionId)) item.classList.add('response-ready');
  if (sessionBusyState.get(session.sessionId)) item.classList.add('cli-busy');

  // F5.6: Activity color class
  const activityClass = getActivityClass(session);
  item.classList.add(activityClass);

  // F5.6: Git status color class
  const gitClass = session.gitStatus ? `git-${session.gitStatus}` : 'git-unknown';
  item.classList.add(gitClass);

  item.dataset.sessionId = session.sessionId;

  const modified = lastActivityTime.get(session.sessionId) || new Date(session.modified);
  const timeStr = formatDate(modified);
  const displayName = cleanDisplayName(session.name || session.summary);

  const row = document.createElement('div');
  row.className = 'session-row';

  // Pin
  const pin = document.createElement('span');
  pin.className = 'session-pin' + (session.starred ? ' pinned' : '');
  pin.innerHTML = session.starred
    ? '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1-.707.707c-.28-.28-.576-.49-.888-.656L10.073 9.333l-.07 3.181a.5.5 0 0 1-.853.354l-3.535-3.536-4.243 4.243a.5.5 0 1 1-.707-.707l4.243-4.243L1.372 5.11a.5.5 0 0 1 .354-.854l3.18-.07L8.37 .722A3.37 3.37 0 0 1 9.12.074a.5.5 0 0 1 .708.002l-.707.707z"/></svg>'
    : '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1-.707.707c-.28-.28-.576-.49-.888-.656L10.073 9.333l-.07 3.181a.5.5 0 0 1-.853.354l-3.535-3.536-4.243 4.243a.5.5 0 1 1-.707-.707l4.243-4.243L1.372 5.11a.5.5 0 0 1 .354-.854l3.18-.07L8.37 .722A3.37 3.37 0 0 1 9.12.074a.5.5 0 0 1 .708.002l-.707.707z"/></svg>';

  // Running status dot
  const dot = document.createElement('span');
  dot.className = 'session-status-dot' + (activePtyIds.has(session.sessionId) ? ' running' : '');

  // Info block
  const info = document.createElement('div');
  info.className = 'session-info';

  const summaryEl = document.createElement('div');
  summaryEl.className = 'session-summary';
  summaryEl.textContent = displayName;

  // F5.6: LIVE badge for recently active sessions (<5 min)
  if (activityClass === 'activity-recent') {
    const liveBadge = document.createElement('span');
    liveBadge.className = 'session-live-badge';
    liveBadge.textContent = 'LIVE';
    summaryEl.appendChild(liveBadge);
  }

  const idEl = document.createElement('div');
  idEl.className = 'session-id';
  idEl.textContent = session.sessionId;

  const metaEl = document.createElement('div');
  metaEl.className = 'session-meta';
  let metaText = timeStr + (session.messageCount ? ' \u00b7 ' + session.messageCount + ' msgs' : '');
  const tok = tokenCache[session.sessionId];
  if (tok) {
    const totalTok = (tok.inputTokens || 0) + (tok.outputTokens || 0);
    if (totalTok > 0) metaText += ' \u00b7 ' + formatTokenCount(totalTok);
    const cost = formatCentsCost(tok.costCents);
    if (cost) metaText += ' \u00b7 ' + cost;
  }
  metaEl.textContent = metaText;

  if (session.type === 'terminal') {
    const badge = document.createElement('span');
    badge.className = 'terminal-badge';
    badge.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>';
    summaryEl.prepend(badge);
  }

  if (session.type === 'headless') {
    item.classList.add('is-headless');
    const badge = document.createElement('span');
    badge.className = 'headless-badge';
    badge.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>';
    summaryEl.prepend(badge);
  }

  // Agent badge — use session.agent (from IPC for non-Claude) or sessionAgentMap
  const agentId = session.agent || sessionAgentMap.get(session.sessionId);
  if (agentId && agentId !== 'claude') {
    const agentBadge = document.createElement('span');
    agentBadge.className = 'agent-badge';
    agentBadge.style.color = AGENT_COLORS[agentId] || '#8888a0';
    agentBadge.style.borderColor = AGENT_COLORS[agentId] || '#8888a0';
    agentBadge.textContent = AGENT_LABELS[agentId] || agentId;
    summaryEl.appendChild(agentBadge);
  }

  // Project/folder label — show truncated path below summary
  if (session.projectPath) {
    const projectLabel = document.createElement('div');
    projectLabel.className = 'session-project-label';
    const segments = session.projectPath.split('/').filter(Boolean);
    const truncated = segments.length > 3
      ? '\u2026/' + segments.slice(-3).join('/')
      : session.projectPath;
    projectLabel.textContent = truncated;
    info.appendChild(projectLabel);
  }

  // Loop badge — orange warning indicator when Claude detected a repeat loop
  const lp = loopCache[session.sessionId];
  if (lp && lp.loopCount > 0) {
    const loopBadge = document.createElement('span');
    loopBadge.className = 'loop-badge';
    loopBadge.title = `Loop detected ${lp.loopCount}x${lp.lastLoopTool ? ' with ' + lp.lastLoopTool : ''}${lp.lastLoopReason ? ': ' + lp.lastLoopReason : ''}`;
    loopBadge.textContent = '\u21BB' + lp.loopCount;
    summaryEl.appendChild(loopBadge);
  }
  info.appendChild(summaryEl);
  info.appendChild(idEl);
  info.appendChild(metaEl);

  // Activity sparkline row — shown for ANY session with tool activity (headless, PTY, or file-watched)
  {
    const sparkline = document.createElement('div');
    sparkline.className = 'headless-sparkline';
    sparkline.id = 'sparkline-' + session.sessionId;
    const state = headlessState.get(session.sessionId);
    if (state) {
      updateHeadlessSparkline(session.sessionId, state);
    }
    info.appendChild(sparkline);
  }

  // Action buttons container
  const actions = document.createElement('div');
  actions.className = 'session-actions';

  const stopBtn = document.createElement('button');
  stopBtn.className = 'session-stop-btn';
  stopBtn.title = 'Stop session';
  stopBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="2" width="8" height="8" rx="1"/></svg>';

  const archiveBtn = document.createElement('button');
  archiveBtn.className = 'session-archive-btn';
  archiveBtn.title = session.archived ? 'Unarchive' : 'Archive';
  archiveBtn.innerHTML = ICONS.archive(16);

  const forkBtn = document.createElement('button');
  forkBtn.className = 'session-fork-btn';
  forkBtn.title = 'Fork session';
  forkBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M8 3h-5v5"/><path d="M21 3l-7.536 7.536a5 5 0 0 0-1.464 3.534v6.93"/><path d="M3 3l7.536 7.536a5 5 0 0 1 1.464 3.534v.93"/></svg>';

  const jsonlBtn = document.createElement('button');
  jsonlBtn.className = 'session-jsonl-btn';
  jsonlBtn.title = 'View messages';
  jsonlBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/></svg>';

  const launchConfigBtn = document.createElement('button');
  launchConfigBtn.className = 'session-launch-config-btn';
  launchConfigBtn.title = 'Resume with config';
  launchConfigBtn.innerHTML = ICONS.launchConfig(14);

  actions.appendChild(stopBtn);
  if (session.type !== 'terminal') {
    actions.appendChild(forkBtn);
    actions.appendChild(jsonlBtn);
    actions.appendChild(archiveBtn);
    actions.appendChild(launchConfigBtn);
  }

  row.appendChild(pin);
  row.appendChild(dot);
  row.appendChild(info);
  row.appendChild(actions);
  item.appendChild(row);

  return item;
}

function startRename(summaryEl, session) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'session-rename-input';
  input.value = session.name || session.summary;

  summaryEl.replaceWith(input);
  input.focus();
  input.select();

  const save = async () => {
    const newName = input.value.trim();
    const nameToSave = (newName && newName !== session.summary) ? newName : null;
    await window.api.renameSession(session.sessionId, nameToSave);
    session.name = nameToSave;

    const newSummary = document.createElement('div');
    newSummary.className = 'session-summary';
    newSummary.textContent = nameToSave || session.summary;
    newSummary.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startRename(newSummary, session);
    });
    input.replaceWith(newSummary);
  };

  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      input.removeEventListener('blur', save);
      const restored = document.createElement('div');
      restored.className = 'session-summary';
      restored.textContent = session.name || session.summary;
      restored.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        startRename(restored, session);
      });
      input.replaceWith(restored);
    }
  });
}

async function launchNewSession(project, sessionOptions, initialPrompt) {
  const sessionId = crypto.randomUUID();
  const projectPath = project.projectPath;
  const session = {
    sessionId,
    summary: 'New session',
    firstPrompt: '',
    projectPath,
    name: null,
    starred: 0,
    archived: 0,
    messageCount: 0,
    modified: new Date().toISOString(),
    created: new Date().toISOString(),
  };

  // Track as pending (no .jsonl yet)
  const folder = projectPath.replace(/[/_]/g, '-').replace(/^-/, '-');
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
  refreshSidebar();

  const entry = createTerminalEntry(session);

  // Open terminal in main process with session options
  const result = await window.api.openTerminal(sessionId, projectPath, true, { ...sessionOptions, _initialPrompt: initialPrompt });
  if (!result.ok) {
    entry.terminal.write(`\r\nError: ${result.error}\r\n`);
    entry.closed = true;
    return;
  }
  if (typeof setSessionMcpActive === 'function') setSessionMcpActive(sessionId, !!result.mcpActive);

  showSession(sessionId);
  pollActiveSessions();
}

// Legacy alias
function openNewSession(project) {
  return launchNewSession(project);
}

async function showTerminalHeader(session) {
  const displayName = cleanDisplayName(session.name || session.summary);
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

async function openSession(session, customOptions) {
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
      destroySession(sessionId);
      if (session.type === 'terminal') {
        launchTerminalSession({ projectPath: session.projectPath });
        return;
      }
    } else {
      showSession(sessionId);
      return;
    }
  }

  // Create new terminal entry (hidden until showSession)
  const entry = createTerminalEntry(session);

  // Show loading overlay
  const loadingEl = document.getElementById('terminal-loading');
  if (loadingEl) loadingEl.style.display = 'flex';

  // Open terminal in main process
  const resumeOptions = await resolveDefaultSessionOptions({ projectPath });
  try {
    const result = await window.api.openTerminal(sessionId, projectPath, false, resumeOptions);
    if (!result.ok) {
      entry.terminal.write(`\r\nError: ${result.error}\r\n`);
      entry.closed = true;
      return;
    }
    if (typeof setSessionMcpActive === 'function') setSessionMcpActive(sessionId, !!result.mcpActive);
  } finally {
    if (loadingEl) loadingEl.style.display = 'none';
  }

  showSession(sessionId);
  pollActiveSessions();
}

// ============================================================
// CONVERSATION VIEWER
// Shows historical sessions without spawning a terminal.
// ============================================================

const cvPanel = document.getElementById('conversation-viewer');
const cvMessages = document.getElementById('cv-messages');
const cvSessionName = document.getElementById('cv-session-name');
const cvSessionMeta = document.getElementById('cv-session-meta');
const cvExportMdBtn = document.getElementById('cv-export-md-btn');
const cvCopyBtn = document.getElementById('cv-copy-btn');
const cvResumeBtn = document.getElementById('cv-resume-btn');
const cvSaveTemplateBtn = document.getElementById('cv-save-template-btn');

let cvCurrentSession = null;
let cvCurrentMessages = [];

function hideConversationViewer() {
  cvPanel.style.display = 'none';
  cvCurrentSession = null;
  cvCurrentMessages = [];
}

async function showConversationViewer(session) {
  // Update sidebar active state
  document.querySelectorAll('.session-item.active').forEach(el => el.classList.remove('active'));
  const item = document.querySelector(`[data-session-id="${session.sessionId}"]`);
  if (item) item.classList.add('active');
  setActiveSession(session.sessionId);

  // Hide terminal/placeholder, show viewer
  placeholder.style.display = 'none';
  terminalHeader.style.display = 'none';
  hidePlanViewer();
  for (const entry of openSessions.values()) entry.element.classList.remove('visible');
  cvPanel.style.display = 'flex';

  cvCurrentSession = session;
  cvSessionName.textContent = cleanDisplayName(session.name || session.sessionId);
  cvSessionMeta.textContent = '';
  cvMessages.innerHTML = '<div class="cv-loading">Loading conversation…</div>';

  const agentId = session.agent || sessionAgentMap.get(session.sessionId) || 'claude';
  const result = await window.api.readSessionConversation(session.sessionId, session.file || null, agentId);

  if (result.error) {
    cvMessages.innerHTML = `<div class="cv-error">Could not load conversation: ${escapeHtml(result.error)}</div>`;
    return;
  }

  cvCurrentMessages = result.messages || [];
  renderConversationMessages(cvCurrentMessages, agentId);

  // Meta: message counts + token/cost from cache
  const userCount = cvCurrentMessages.filter(m => m.role === 'user').length;
  const toolCount = cvCurrentMessages.reduce((n, m) => n + (m.tools?.length || 0), 0);
  const parts = [`${userCount} turns`];
  if (toolCount > 0) parts.push(`${toolCount} tool calls`);
  const tok = tokenCache[session.sessionId];
  if (tok) {
    const totalTok = (tok.inputTokens || 0) + (tok.outputTokens || 0);
    if (totalTok > 0) parts.push(formatTokenCount(totalTok) + ' tokens');
    if (tok.costCents > 0) parts.push(formatCentsCost(tok.costCents));
    if (tok.model) parts.push(tok.model.replace('claude-', '').replace(/-\d{8}$/, ''));
  }
  cvSessionMeta.textContent = parts.join(' · ');

  // Update header for main area
  updateTerminalHeader();
}

function renderConversationMessages(messages, agentId) {
  if (messages.length === 0) {
    cvMessages.innerHTML = '<div class="cv-empty">No messages found in this session.</div>';
    return;
  }

  const frag = document.createDocumentFragment();

  for (const msg of messages) {
    const el = buildMessageEl(msg);
    if (el) frag.appendChild(el);
  }

  cvMessages.innerHTML = '';
  cvMessages.appendChild(frag);
}

function buildMessageEl(msg) {
  if (msg.role === 'summary') {
    const el = document.createElement('div');
    el.className = 'cv-summary';
    el.innerHTML = `<span class="cv-summary-label">⟳ Compacted</span><span class="cv-summary-text">${escapeHtml(msg.text)}</span>`;
    return el;
  }

  if (msg.role === 'system') {
    const el = document.createElement('div');
    el.className = 'cv-system';
    el.textContent = msg.text;
    return el;
  }

  const el = document.createElement('div');
  el.className = `cv-message cv-${msg.role}`;

  // Header
  const header = document.createElement('div');
  header.className = 'cv-msg-header';
  const roleLabel = document.createElement('span');
  roleLabel.className = 'cv-msg-role';
  roleLabel.textContent = msg.role === 'user' ? 'You' : 'Assistant';
  header.appendChild(roleLabel);

  if (msg.ts) {
    const timeEl = document.createElement('span');
    timeEl.className = 'cv-msg-time';
    try { timeEl.textContent = new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch {}
    header.appendChild(timeEl);
  }
  if (msg.model) {
    const modelEl = document.createElement('span');
    modelEl.className = 'cv-msg-model';
    modelEl.textContent = msg.model.replace('claude-', '').replace(/-\d{8}$/, '');
    header.appendChild(modelEl);
  }
  el.appendChild(header);

  // Text body
  if (msg.text) {
    const body = document.createElement('div');
    body.className = 'cv-msg-body';
    body.innerHTML = renderMarkdownLite(msg.text);
    el.appendChild(body);
  }

  // Tool calls
  if (msg.tools && msg.tools.length > 0) {
    const toolsEl = document.createElement('div');
    toolsEl.className = 'cv-tools';
    for (const tool of msg.tools) {
      toolsEl.appendChild(buildToolCallEl(tool));
    }
    el.appendChild(toolsEl);
  }

  // Token usage badge
  if (msg.usage) {
    const usage = document.createElement('div');
    usage.className = 'cv-usage';
    usage.textContent = `↑${msg.usage.input_tokens?.toLocaleString() || 0} ↓${msg.usage.output_tokens?.toLocaleString() || 0} tokens`;
    el.appendChild(usage);
  }

  return el;
}

function buildToolCallEl(tool) {
  const el = document.createElement('details');
  el.className = 'cv-tool';

  const summary = document.createElement('summary');
  summary.className = 'cv-tool-summary';

  const nameEl = document.createElement('span');
  nameEl.className = 'cv-tool-name';
  nameEl.textContent = tool.name;

  // Quick preview of first input key
  const inputKeys = tool.input ? Object.keys(tool.input) : [];
  if (inputKeys.length > 0) {
    const preview = document.createElement('span');
    preview.className = 'cv-tool-preview';
    const val = tool.input[inputKeys[0]];
    const previewText = typeof val === 'string' ? val.slice(0, 60) : JSON.stringify(val).slice(0, 60);
    preview.textContent = previewText + (previewText.length >= 60 ? '…' : '');
    summary.appendChild(nameEl);
    summary.appendChild(preview);
  } else {
    summary.appendChild(nameEl);
  }

  if (tool.result?.isError) {
    const errBadge = document.createElement('span');
    errBadge.className = 'cv-tool-err-badge';
    errBadge.textContent = 'error';
    summary.appendChild(errBadge);
  }

  el.appendChild(summary);

  // Input
  if (inputKeys.length > 0) {
    const inputEl = document.createElement('div');
    inputEl.className = 'cv-tool-input';
    inputEl.innerHTML = `<pre>${escapeHtml(JSON.stringify(tool.input, null, 2))}</pre>`;
    el.appendChild(inputEl);
  }

  // Result
  if (tool.result) {
    const resultEl = document.createElement('div');
    resultEl.className = `cv-tool-result${tool.result.isError ? ' cv-tool-result-error' : ''}`;
    const resultText = tool.result.text || '';
    // Truncate very long results
    const display = resultText.length > 2000 ? resultText.slice(0, 2000) + `\n… (${resultText.length - 2000} chars truncated)` : resultText;
    resultEl.innerHTML = `<pre>${escapeHtml(display)}</pre>`;
    el.appendChild(resultEl);
  }

  return el;
}

// Lightweight markdown renderer — handles code blocks, bold, italic, inline code, headers
function renderMarkdownLite(text) {
  if (!text) return '';
  let html = escapeHtml(text);

  // Fenced code blocks (```lang\n...\n```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
    `<pre class="cv-code-block${lang ? ' lang-' + lang : ''}">${code}</pre>`
  );

  // Inline code
  html = html.replace(/`([^`\n]+)`/g, '<code class="cv-inline-code">$1</code>');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3 class="cv-h3">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="cv-h2">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="cv-h1">$1</h1>');

  // Bold / italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Paragraphs (double newline → paragraph break)
  html = html.replace(/\n\n+/g, '</p><p>');
  html = '<p>' + html + '</p>';

  // Single newlines → <br> inside paragraphs
  html = html.replace(/\n/g, '<br>');

  return html;
}

// Export conversation as Markdown
function conversationToMarkdown(messages, sessionName) {
  const lines = [`# ${sessionName || 'Conversation'}\n`];
  for (const msg of messages) {
    if (msg.role === 'summary') {
      lines.push(`---\n> **[Compacted]** ${msg.text}\n---\n`);
      continue;
    }
    if (msg.role === 'system') {
      lines.push(`> *System: ${msg.text}*\n`);
      continue;
    }
    const label = msg.role === 'user' ? '## You' : '## Assistant';
    lines.push(label);
    if (msg.text) lines.push(msg.text);
    if (msg.tools && msg.tools.length > 0) {
      for (const tool of msg.tools) {
        lines.push(`\n**Tool: \`${tool.name}\`**`);
        if (Object.keys(tool.input || {}).length > 0) {
          lines.push('```json\n' + JSON.stringify(tool.input, null, 2) + '\n```');
        }
        if (tool.result?.text) {
          lines.push('**Result:**');
          lines.push('```\n' + tool.result.text.slice(0, 1000) + '\n```');
        }
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

// Wire up export/copy/resume buttons
const cvExportBtn = document.getElementById('cv-export-btn');
const cvExportMenu = document.getElementById('cv-export-menu');
const cvExportDropdown = document.getElementById('cv-export-dropdown');

// Toggle export menu
cvExportBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  cvExportMenu.style.display = cvExportMenu.style.display === 'none' ? 'flex' : 'none';
});

// Export format handlers
cvExportMenu.querySelectorAll('button[data-format]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const format = btn.dataset.format;
    exportConversation(format);
    cvExportMenu.style.display = 'none';
  });
});

// Close export menu on outside click
document.addEventListener('click', () => { cvExportMenu.style.display = 'none'; });

function exportConversation(format) {
  if (!cvCurrentMessages.length) return;
  const sessionName = cvCurrentSession?.name || cvCurrentSession?.sessionId || 'conversation';

  if (format === 'markdown') {
    const md = conversationToMarkdown(cvCurrentMessages, sessionName);
    downloadBlob(md, 'text/markdown', `${sessionName}.md`);
  } else if (format === 'jsonl') {
    // Raw JSONL export — one JSON object per line
    const jsonl = cvCurrentMessages.map(m => JSON.stringify(m)).join('\n');
    downloadBlob(jsonl, 'application/x-ndjson', `${sessionName}.jsonl`);
  } else if (format === 'json') {
    // JSON array of all messages
    const json = JSON.stringify(cvCurrentMessages, null, 2);
    downloadBlob(json, 'application/json', `${sessionName}.json`);
  }
}

function downloadBlob(content, mimeType, filename) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

cvCopyBtn.addEventListener('click', async () => {
  if (!cvCurrentMessages.length) return;
  const md = conversationToMarkdown(cvCurrentMessages, cvCurrentSession?.name || cvCurrentSession?.sessionId);
  try {
    await navigator.clipboard.writeText(md);
    cvCopyBtn.textContent = 'Copied!';
    setTimeout(() => { cvCopyBtn.textContent = 'Copy'; }, 2000);
  } catch {}
});

cvResumeBtn.addEventListener('click', async () => {
  if (!cvCurrentSession) return;
  hideConversationViewer();
  // Force terminal open even though session isn't in activePtyIds yet
  activeSessionId = cvCurrentSession.sessionId;
  const session = sessionMap.get(cvCurrentSession.sessionId) || cvCurrentSession;
  // Temporarily mark as running type so openSession goes to terminal path
  const originalType = session.type;
  session._forceTerminal = true;
  await openSessionForced(session);
  session._forceTerminal = false;
});

cvSaveTemplateBtn.addEventListener('click', async () => {
  if (!cvCurrentSession) return;
  const session = cvCurrentSession;
  const project = cachedProjects.find(p => p.projectPath === session.projectPath) || cachedAllProjects.find(p => p.projectPath === session.projectPath);
  if (!project) return;
  const opts = { cliAgent: sessionAgentMap.get(session.sessionId) || 'claude' };
  // Extract first user message from conversation as prompt suggestion
  const firstPrompt = cvCurrentMessages.find(m => m.role === 'user')?.text || '';
  showSaveTemplateDialog(project, opts, firstPrompt);
});

// Open session directly as terminal (bypass conversation viewer)
async function openSessionForced(session, customOptions) {
  const { sessionId, projectPath } = session;
  if (openSessions.has(sessionId)) {
    showSession(sessionId);
    return;
  }
  const entry = createTerminalEntry(session);
  const resumeOptions = customOptions || await resolveDefaultSessionOptions({ projectPath });
  const result = await window.api.openTerminal(sessionId, projectPath, false, resumeOptions);
  if (!result.ok) {
    entry.terminal.write(`\r\nError: ${result.error}\r\n`);
    entry.closed = true;
    return;
  }
  if (typeof setSessionMcpActive === 'function') setSessionMcpActive(sessionId, !!result.mcpActive);
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
    if (tabName === activeTab) return;
    activeTab = tabName;
    document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));

    // Clear search on tab switch
    searchInput.value = '';
    searchBar.classList.remove('has-query');
    searchMatchIds = null;
    searchMatchProjectPaths = null;

    // Hide all sidebar content areas
    sidebarContent.style.display = 'none';
    plansContent.style.display = 'none';
    statsContent.style.display = 'none';
    memoryContent.style.display = 'none';
    sessionFilters.style.display = 'none';
    searchBar.style.display = 'none';

    const agentSelector = document.getElementById('agent-selector');
    if (agentSelector) agentSelector.style.display = tabName === 'sessions' ? '' : 'none';

    if (tabName === 'sessions') {
      sessionFilters.style.display = '';
      searchBar.style.display = '';
      searchInput.placeholder = 'Search sessions...';
      sidebarContent.style.display = '';
      // Restore terminal area
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
      // Catch up on changes that happened while on another tab
      if (projectsChangedWhileAway) {
        projectsChangedWhileAway = false;
        loadProjects();
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

  info.appendChild(titleEl);
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

  // Right-click context menu on sidebar expand button
  const ctxMenu = document.getElementById('agent-context-menu');
  expandBtn.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Detect agents if not already cached
    let agents = installedAgents;
    if (!agents || Object.keys(agents).length === 0) {
      try { agents = await window.api.detectAgents(); } catch { agents = {}; }
    }

    const installedEntries = Object.entries(agents).filter(([, a]) => a.installed);
    if (installedEntries.length === 0) return;

    // Build menu items
    ctxMenu.innerHTML = '';
    for (const [id, agent] of installedEntries) {
      const item = document.createElement('button');
      item.className = 'agent-context-menu-item';
      const dotColor = agent.color || '#888';
      const isActive = id === activeAgent;
      item.innerHTML = `
        <span class="ctx-dot" style="background:${dotColor}"></span>
        <span>${agent.name}</span>
        ${isActive ? '<span class="ctx-checkmark">\u2713</span>' : ''}
      `;
      item.addEventListener('click', () => {
        if (id === activeAgent) return;
        activeAgent = id;
        localStorage.setItem('activeAgent', id);
        // Update agent-selector buttons
        const selContainer = document.getElementById('agent-selector');
        if (selContainer) {
          selContainer.querySelectorAll('.agent-selector-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.agent === id)
          );
        }
        // Clear meta-view state
        showStarredOnly = false; showRunningOnly = false;
        if (starToggle) starToggle.classList.remove('active');
        if (runningToggle) runningToggle.classList.remove('active');
        loadProjectsForAgent();
        ctxMenu.style.display = 'none';
      });
      ctxMenu.appendChild(item);
    }

    // Position menu below the button
    const rect = expandBtn.getBoundingClientRect();
    ctxMenu.style.top = (rect.bottom + 4) + 'px';
    ctxMenu.style.left = rect.left + 'px';
    ctxMenu.style.display = 'block';
  });

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

// --- Agent selector initialization ---
// Meta-views: special sidebar views that aggregate across CLIs
const META_VIEWS = {
  '_active': { label: 'Active', icon: '&#9679;', color: '#22c55e', title: 'All running sessions across every CLI' },
  '_pinned': { label: 'Pinned', icon: '&#9733;', color: '#eab308', title: 'Pinned sessions from all CLIs' },
};

async function loadMetaView(viewId) {
  // Gather sessions from ALL installed agents
  const allProjects = [];
  const agentIds = Object.entries(installedAgents).filter(([, a]) => a.installed).map(([id]) => id);

  const results = await Promise.all(agentIds.map(async (id) => {
    if (id === 'claude') {
      const [def, all] = await Promise.all([window.api.getProjects(false), window.api.getProjects(true)]);
      return { id, projects: all, defaults: def };
    } else {
      const projects = await window.api.getAgentSessions(id);
      return { id, projects, defaults: projects };
    }
  }));

  for (const { id, projects } of results) {
    for (const proj of projects) {
      // Tag each session with its agent for badge rendering
      for (const s of proj.sessions) {
        if (!s.agent) s.agent = id;
        sessionAgentMap.set(s.sessionId, id);
      }
      allProjects.push(proj);
    }
  }

  // Merge projects with same path
  const merged = new Map();
  for (const proj of allProjects) {
    if (merged.has(proj.projectPath)) {
      const existing = merged.get(proj.projectPath);
      for (const s of proj.sessions) {
        if (!existing.sessions.some(e => e.sessionId === s.sessionId)) {
          existing.sessions.push(s);
        }
      }
    } else {
      merged.set(proj.projectPath, { ...proj, sessions: [...proj.sessions] });
    }
  }

  let projects = Array.from(merged.values());

  if (viewId === '_active') {
    // Keep only projects with running sessions
    projects = projects.map(p => ({
      ...p,
      sessions: p.sessions.filter(s => activePtyIds.has(s.sessionId)),
    })).filter(p => p.sessions.length > 0);
  } else if (viewId === '_pinned') {
    // Keep only pinned sessions
    projects = projects.map(p => ({
      ...p,
      sessions: p.sessions.filter(s => s.starred),
    })).filter(p => p.sessions.length > 0);
  }

  cachedProjects = projects;
  cachedAllProjects = projects;
  refreshSidebar({ resort: true });
  renderDefaultStatus();
  startSessionFileWatchers(projects);
}

(async function initAgentSelector() {
  try {
    installedAgents = await window.api.detectAgents();
  } catch { installedAgents = {}; }

  const container = document.getElementById('agent-selector');
  if (!container) return;

  const agentsToShow = Object.entries(installedAgents).filter(([, a]) => a.installed);

  // Always show — meta-views are useful even with only Claude
  container.style.display = '';
  container.innerHTML = '';

  function setActive(viewId) {
    activeAgent = viewId;
    localStorage.setItem('activeAgent', viewId);
    container.querySelectorAll('.agent-selector-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.agent === viewId)
    );
  }

  // Meta-view buttons first
  for (const [viewId, meta] of Object.entries(META_VIEWS)) {
    const btn = document.createElement('button');
    btn.className = 'agent-selector-btn meta-view-btn' + (viewId === activeAgent ? ' active' : '');
    btn.dataset.agent = viewId;
    btn.title = meta.title;
    btn.innerHTML = `<span class="agent-dot meta-dot" style="background:${meta.color}">${meta.icon}</span><span class="agent-selector-label">${meta.label}</span>`;
    btn.addEventListener('click', () => {
      if (viewId === activeAgent) return;
      setActive(viewId);
      // Clear filters when switching to meta view (they're built-in)
      showStarredOnly = false; showRunningOnly = false;
      starToggle.classList.remove('active'); runningToggle.classList.remove('active');
      loadMetaView(viewId);
    });
    container.appendChild(btn);
  }

  // Separator
  const sep = document.createElement('span');
  sep.className = 'agent-selector-sep';
  container.appendChild(sep);

  // Per-CLI agent buttons
  for (const [id, agent] of agentsToShow) {
    const btn = document.createElement('button');
    btn.className = 'agent-selector-btn' + (id === activeAgent ? ' active' : '');
    btn.dataset.agent = id;
    btn.title = agent.name;
    btn.innerHTML = `<span class="agent-dot" style="background:${agent.color}"></span><span class="agent-selector-label">${agent.name.split(' ')[0]}</span>`;
    btn.addEventListener('click', () => {
      if (id === activeAgent) return;
      setActive(id);
      // Clear meta-view state
      showStarredOnly = false; showRunningOnly = false;
      starToggle.classList.remove('active'); runningToggle.classList.remove('active');
      loadProjectsForAgent();
    });
    container.appendChild(btn);
  }
})();

// Start file watchers for recently active sessions (last 24h) that have JSONL files.
// This powers sparkline activity for PTY sessions across all CLIs.
function startSessionFileWatchers(projects) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24h ago
  for (const proj of projects) {
    for (const session of proj.sessions) {
      if (!session.file) continue;
      if (!session.file.endsWith('.jsonl')) continue;
      // Only watch recently-modified sessions
      const mod = session.modified ? new Date(session.modified).getTime() : 0;
      if (mod < cutoff) continue;
      // Skip headless sessions (they already get events via stream-json)
      if (session.type === 'headless') continue;
      const agentId = session.agent || sessionAgentMap.get(session.sessionId) || 'claude';
      window.api.watchSessionFile(session.sessionId, session.file, agentId);
    }
  }
}

async function loadProjectsForAgent() {
  // Meta-views (starts with _) use their own loader
  if (activeAgent.startsWith('_')) {
    await loadMetaView(activeAgent);
    return;
  }
  if (activeAgent === 'claude') {
    await loadProjects({ resort: true });
  } else {
    const projects = await window.api.getAgentSessions(activeAgent);
    cachedAgentProjects.set(activeAgent, projects);
    cachedProjects = projects;
    cachedAllProjects = projects;
    refreshSidebar({ resort: true });
    renderDefaultStatus();
    startSessionFileWatchers(projects);
  }
}

// --- Detached window mode ---
// When loaded with ?detached=<sessionId>, show just the terminal (no sidebar nav).
const _detachedSessionId = new URLSearchParams(window.location.search).get('detached');
if (_detachedSessionId) {
  // Hide sidebar and filters — it's a focus terminal window
  document.getElementById('sidebar').style.display = 'none';
  document.getElementById('sidebar-resize-handle').style.display = 'none';
  document.getElementById('main').style.borderLeft = 'none';

  // Inject a compact detached-header above the terminal
  const detachedHeader = document.createElement('div');
  detachedHeader.id = 'detached-header';
  detachedHeader.innerHTML = `
    <span id="detached-title">Detached</span>
    <div id="detached-controls">
      <button id="detached-reattach-btn" title="Move session back to main window">Reattach</button>
      <button id="detached-pin-btn" title="Toggle always-on-top">Pin</button>
    </div>
  `;
  document.getElementById('main').insertBefore(detachedHeader, document.getElementById('main').firstChild);

  const detachReattachBtn = document.getElementById('detached-reattach-btn');
  const detachPinBtn = document.getElementById('detached-pin-btn');

  detachReattachBtn.addEventListener('click', async () => {
    await window.api.reattachSession(_detachedSessionId);
  });

  detachPinBtn.addEventListener('click', async () => {
    const pinned = await window.api.toggleWindowPin();
    detachPinBtn.textContent = pinned ? 'Unpin' : 'Pin';
    detachPinBtn.classList.toggle('pinned', pinned);
  });

  // Load enough session data to open the terminal
  loadProjects().then(() => {
    const session = sessionMap.get(_detachedSessionId);
    if (session) {
      openSession(session);
    } else {
      // Session not in projects cache — build a minimal stub from active sessions
      window.api.getActiveSessions().then(actives => {
        const active = actives.find(s => s.sessionId === _detachedSessionId);
        if (active) openSession({ sessionId: _detachedSessionId, name: active.name || _detachedSessionId, projectPath: active.projectPath || '', type: 'pty', sessions: [] });
      });
    }
  });
} else {

// Initial load — respect saved meta-view or agent selection
(activeAgent.startsWith('_') ? loadMetaView(activeAgent) : loadProjects()).then(() => {
  // Sync filter button states for meta-views
  if (activeAgent === '_active') { showRunningOnly = true; runningToggle.classList.add('active'); }
  if (activeAgent === '_pinned') { showStarredOnly = true; starToggle.classList.add('active'); }
  // Restore grid view preference before opening sessions so they enter grid mode
  if (localStorage.getItem('gridViewActive') === '1') {
    showGridView();
  }
  // Restore active session after reload
  if (activeSessionId && !openSessions.has(activeSessionId)) {
    const session = sessionMap.get(activeSessionId);
    if (session) openSession(session);
  }
  // Start file watchers for recent sessions to power sidebar sparklines
  startSessionFileWatchers(cachedAllProjects);
});

} // end if (_detachedSessionId) else block

// Live-reload sidebar when filesystem changes are detected
let projectsChangedTimer = null;
let projectsChangedWhileAway = false;
window.api.onProjectsChanged(() => {
  // Debounce to avoid rapid re-renders during bulk changes
  if (projectsChangedTimer) clearTimeout(projectsChangedTimer);
  if (activeTab !== 'sessions') {
    projectsChangedWhileAway = true;
    return;
  }
  projectsChangedTimer = setTimeout(() => {
    projectsChangedTimer = null;
    loadProjects();
    // Refresh caches so new sessions get cost + loop data
    window.api.getAllSessionTokens().then(data => { if (data) tokenCache = data; });
    window.api.getAllSessionLoops().then(data => { if (data) loopCache = data; });
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
  parts.push(`${totalProjects} projects`);
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

// --- Initialize file panel (MCP bridge UI) ---
if (typeof initFilePanel === 'function') initFilePanel();

// ========== COMMAND SCHEDULER (bridge to scheduler.js) ==========
// openScheduler, updateSchedulerBtnState, schedulerOnTerminalData,
// schedulerToggleBroadcast, schedulerGetBroadcastTargets, recordMacroInput
// are all defined in scheduler.js (loaded after app.js)

