const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, screen, shell } = require('electron');
const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const os = require('os');
const pty = require('node-pty');
const log = require('electron-log');
// getFolderIndexMtimeMs moved to session-cache.js
const { startMcpServer, shutdownMcpServer, shutdownAll: shutdownAllMcp, resolvePendingDiff, rekeyMcpServer, cleanStaleLockFiles } = require('./mcp-bridge');
const { fetchAndTransformUsage } = require('./claude-auth');

// SWITCHBOARD_DATA_DIR isolates a dev/test instance from the installed app:
// db.js puts switchboard.db under it, and pointing userData there gives the
// instance its own single-instance lock (requestSingleInstanceLock keys on
// userData), so both can run side by side.
if (process.env.SWITCHBOARD_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.SWITCHBOARD_DATA_DIR, 'electron'));
}

log.transports.file.level = app.isPackaged ? 'info' : 'debug';
log.transports.console.level = app.isPackaged ? 'info' : 'debug';

try { require('electron-reloader')(module, { watchRenderer: true }); } catch {};

// Guard against "Render frame was disposed" crashes during reload/navigation
function safeSend(channel, ...args) {
  try {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
      mainWindow.webContents.send(channel, ...args);
    }
  } catch (err) {
    if (err.message?.includes('disposed')) return; // Suppress render frame disposed errors
    log.warn('[safeSend] error:', err.message);
  }
}

function safeSendToSession(sessionId, channel, ...args) {
  try {
    const session = sessionMap.get(sessionId);
    if (!session?.window || session.window.isDestroyed()) return;
    session.window.webContents.send(channel, ...args);
  } catch (err) {
    if (err.message?.includes('disposed')) return;
    log.warn('[safeSendToSession] error:', err.message);
  }
}

// --- Fork feature: extract session summary from any agent format ---
function extractSessionSummary(sessionPath) {
  try {
    if (!fs.existsSync(sessionPath)) return null;
    const fd = fs.openSync(sessionPath, 'r');
    const buffer = Buffer.alloc(8192);
    const bytesRead = fs.readSync(fd, buffer, 0, 8192, 0);
    fs.closeSync(fd);
    if (bytesRead === 0) return null;
    const content = buffer.toString('utf8', 0, bytesRead);
    
    // Claude JSONL format: look for first user message
    const claudeMatch = content.match(/"role"\s*:\s*"user"[^}]*"content"\s*:\s*"([^"]{1,200})"/);
    if (claudeMatch) return claudeMatch[1].replace(/\\n/g, ' ').substring(0, 120);
    
    // Generic/Codex format: look for human: or user: prefix
    const genericMatch = content.match(/(?:human|user)[\s:]+([^\n]{1,120})/i);
    if (genericMatch) return genericMatch[1].trim().substring(0, 120);
    
    return 'Untitled session';
  } catch (err) {
    log.warn('[extractSessionSummary] error:', err.message);
    return null;
  }
}

// Clean env for child processes — strip Electron internals that cause nested
// Electron apps (or node-pty inside them) to malfunction.
const cleanPtyEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) =>
    !k.startsWith('ELECTRON_') &&
    !k.startsWith('GOOGLE_API_KEY') &&
    k !== 'NODE_OPTIONS' &&
    k !== 'ORIGINAL_XDG_CURRENT_DESKTOP' &&
    k !== 'WT_SESSION'
  )
);

// Shell profiles → shell-profiles.js
const { discoverShellProfiles, getShellProfiles, resolveShell, isWindows, isWslShell, windowsToWslPath, shellArgs, quoteArgvForShell } = require('./shell-profiles');
const { startScheduler } = require('./schedule-runner');
const { encodeProjectPath } = require('./encode-project-path');
const gitUtils = require('./git-utils');

// --- Git status cache — avoids repeated `git status` calls across the same project ---
const gitStatusCache = new Map(); // projectPath -> { data, timestamp }
const GIT_CACHE_TTL = 60_000; // 60 seconds

// --- Auto-updater (only in packaged builds) ---
let autoUpdater = null;
if (app.isPackaged || process.env.FORCE_UPDATER) {
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  if (!app.isPackaged) autoUpdater.forceDevUpdateConfig = true;

  function sendUpdaterEvent(type, data) {
    log.info(`[updater] ${type}`, data || '');
    safeSend('updater-event', type, data);
  }
  autoUpdater.on('checking-for-update', () => sendUpdaterEvent('checking'));
  autoUpdater.on('update-available', (info) => sendUpdaterEvent('update-available', info));
  autoUpdater.on('update-not-available', (info) => sendUpdaterEvent('update-not-available', info));
  autoUpdater.on('download-progress', (progress) => sendUpdaterEvent('download-progress', progress));
  autoUpdater.on('update-downloaded', (info) => sendUpdaterEvent('update-downloaded', info));
  autoUpdater.on('error', (err) => {
    log.error('[updater] Error:', err?.message || String(err));
    safeSend('updater-event', 'error', { message: err?.message || String(err) });
  });
}
const {
  getMeta, getAllMeta, toggleStar, setName, setArchived,
  isCachePopulated, getAllCached, getCachedByFolder, getCachedFolder, getCachedSession, upsertCachedSessions,
  deleteCachedSession, deleteCachedFolder,
  getFolderMeta, getAllFolderMeta, setFolderMeta,
  upsertSearchEntries, updateSearchTitle, deleteSearchSession, deleteSearchFolder, deleteSearchType,
  searchByType, isSearchIndexPopulated, searchFtsRecreated,
  getSetting, setSetting, deleteSetting,
  closeDb,
  // Token tracking
  getSessionTokens, getAllSessionTokens,
  // Loop detection
  getSessionLoops, getAllSessionLoops,
  // Session templates
  saveTemplate, getAllTemplates, deleteTemplate,
} = require('./db');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const PLANS_DIR = path.join(os.homedir(), '.claude', 'plans');
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const STATS_CACHE_PATH = path.join(CLAUDE_DIR, 'stats-cache.json');

// --- Path sandbox for viewer file reads (FULL-AUDIT #4/#32, IMPROVEMENTS B6) ---
// Resolves symlinks (realpath) before checking, so a symlink inside an allowed
// root can't be used to escape it. Allowed roots: the Claude data dirs and any
// active session's project path (plus the project dirs of cached sessions).
function isPathAllowed(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  let resolved;
  try {
    resolved = fs.realpathSync(path.resolve(filePath));
  } catch {
    // File may not exist yet — fall back to the lexical resolve.
    resolved = path.resolve(filePath);
  }
  const roots = [PROJECTS_DIR, PLANS_DIR, CLAUDE_DIR];
  for (const [, session] of activeSessions) {
    if (session.projectPath) roots.push(session.projectPath);
  }
  return roots.some((root) => {
    let r;
    try { r = fs.realpathSync(root); } catch { r = path.resolve(root); }
    return resolved === r || resolved.startsWith(r + path.sep);
  });
}
const MAX_BUFFER_SIZE = 256 * 1024;

// --- Git status discovery (async) with cache eviction ---
// Async (non-blocking) git status via git-utils. Returns the enriched shape
// { status, branch, dirty, ahead, behind, hasUpstream, error } and caches it.
// `status`/`branch` are kept for backward compatibility with existing callers.
async function getCachedGitStatus(projectPath, forceRefresh = false) {
  if (!projectPath || typeof projectPath !== 'string') return { status: null, branch: null, error: true };
  const now = Date.now();
  const cached = gitStatusCache.get(projectPath);
  if (cached && !forceRefresh && (now - cached.timestamp) < GIT_CACHE_TTL) {
    return cached.data;
  }
  try {
    const info = await gitUtils.getGitInfo(projectPath);
    const data = info.isRepo
      ? { status: info.status, branch: info.branch, dirty: info.dirty, ahead: info.ahead, behind: info.behind, hasUpstream: info.hasUpstream, error: false }
      : { status: null, branch: null, error: false };
    gitStatusCache.set(projectPath, { data, timestamp: now });
    return data;
  } catch {
    const data = { status: null, branch: null, error: true };
    gitStatusCache.set(projectPath, { data, timestamp: now });
    return data;
  }
}

// --- Project metadata (last-modified file) cache ---
const projectMetaCache = new Map(); // projectPath -> { mtimeMs, timestamp }
const PROJECT_META_TTL = 60_000;
function getCachedProjectLastModified(projectPath) {
  if (!projectPath || typeof projectPath !== 'string') return null;
  const now = Date.now();
  const cached = projectMetaCache.get(projectPath);
  if (cached && (now - cached.timestamp) < PROJECT_META_TTL) return cached.mtimeMs;
  const mtimeMs = gitUtils.getProjectLastModified(projectPath);
  projectMetaCache.set(projectPath, { mtimeMs, timestamp: now });
  return mtimeMs;
}

// Throttle remote fetches so the "pull available" check never spams the network.
const lastFetchAt = new Map(); // projectPath -> ms
const FETCH_THROTTLE_MS = 5 * 60_000;

// Periodic git status cache eviction (run every 2 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [path, entry] of gitStatusCache) {
    if (now - entry.timestamp > GIT_CACHE_TTL * 2) {
      gitStatusCache.delete(path);
    }
  }
  // Also evict stale agent scan cache entries
  for (const [agentId, entry] of agentScanCache) {
    if (now - entry.timestamp > AGENT_SCAN_CACHE_TTL * 2) {
      agentScanCache.delete(agentId);
    }
  }
  // And stale project-meta entries
  for (const [p, entry] of projectMetaCache) {
    if (now - entry.timestamp > PROJECT_META_TTL * 2) projectMetaCache.delete(p);
  }
}, 120_000);

// Active PTY sessions
const activeSessions = new Map();
let mainWindow = null;

function createWindow() {
  // Restore saved window bounds
  const savedBounds = getSetting('global')?.windowBounds;
  let bounds = { width: 1400, height: 900 };

  let restorePosition = null;
  if (savedBounds && savedBounds.width && savedBounds.height) {
    bounds.width = savedBounds.width;
    bounds.height = savedBounds.height;

    // Only restore position if it's on a visible display
    if (savedBounds.x != null && savedBounds.y != null) {
      const displays = screen.getAllDisplays();
      const onScreen = displays.some(d => {
        const b = d.bounds;
        return savedBounds.x >= b.x - 100 && savedBounds.x < b.x + b.width &&
               savedBounds.y >= b.y - 100 && savedBounds.y < b.y + b.height;
      });
      if (onScreen) {
        restorePosition = { x: savedBounds.x, y: savedBounds.y };
      }
    }
  }

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 800,
    minHeight: 500,
    title: 'Switchboard',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Set position after creation to prevent macOS from clamping size
  if (restorePosition) {
    mainWindow.setBounds({ ...restorePosition, width: bounds.width, height: bounds.height });
  }

  mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'));

  // Open external links in the system browser instead of a child BrowserWindow
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    }
  });
  // Override window.open so xterm WebLinksAddon's default handler (which does
  // window.open() then sets location.href) routes through our IPC instead of
  // creating a child BrowserWindow.
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`
      window.open = function(url) {
        if (url && /^https?:\\/\\//i.test(url)) { window.api.openExternal(url); return null; }
        const proxy = {};
        Object.defineProperty(proxy, 'location', { get() {
          const loc = {};
          Object.defineProperty(loc, 'href', {
            set(u) { if (/^https?:\\/\\//i.test(u)) window.api.openExternal(u); }
          });
          return loc;
        }});
        return proxy;
      };
      void 0;
    `);
  });

  // Prevent Cmd+R / Ctrl+Shift+R from reloading the page (Chromium built-in).
  // Ctrl+R alone on macOS is NOT a reload shortcut and must pass through to xterm
  // for reverse-i-search.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    if (key === 'r' && input.meta) event.preventDefault();
    if (key === 'r' && input.control && input.shift) event.preventDefault();
  });

  // Save window bounds on move/resize (debounced)
  let boundsTimer = null;
  const saveBounds = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
      const b = mainWindow.getBounds();
      const global = getSetting('global') || {};
      global.windowBounds = { x: b.x, y: b.y, width: b.width, height: b.height };
      setSetting('global', global);
    }, 500);
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);

  // Also save immediately before close (debounce may not have flushed)
  mainWindow.on('close', () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    if (!mainWindow.isMinimized()) {
      const b = mainWindow.getBounds();
      const global = getSetting('global') || {};
      global.windowBounds = { x: b.x, y: b.y, width: b.width, height: b.height };
      setSetting('global', global);
    }
  });

  mainWindow.on('closed', () => {
    // On macOS the app stays alive in the dock after the last window closes.
    // Kill all running PTY processes so orphaned `claude` processes don't
    // accumulate in the background with no way for the user to interact.
    for (const [id, session] of activeSessions) {
      if (!session.exited) {
        try { session.pty.kill(); } catch {}
      }
      activeSessions.delete(id);
    }
    mainWindow = null;
  });
}

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- Session cache helpers ---

const { deriveProjectPath } = require('./derive-project-path');

// Session cache → session-cache.js
const sessionCache = require('./session-cache');
sessionCache.init({
  PROJECTS_DIR,
  activeSessions,
  getMainWindow: () => mainWindow,
  log,
  db: {
    deleteCachedFolder, getCachedByFolder, upsertCachedSessions, deleteCachedSession,
    deleteSearchFolder, deleteSearchSession, upsertSearchEntries,
    setFolderMeta, getAllFolderMeta, getAllMeta, getAllCached, getSetting, getMeta, setName,
  },
});
const { readSessionFile, readFolderFromFilesystem, refreshFolder, reconcileCacheFromFilesystem,
        buildProjectsFromCache, notifyRendererProjectsChanged, sendStatus, populateCacheViaWorker } = sessionCache;

// --- IPC: browse-folder ---
ipcMain.handle('browse-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Project Folder',
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// --- IPC: add-project ---
ipcMain.handle('add-project', (_event, projectPath) => {
  try {
    // Validate the path exists and is a directory
    const stat = fs.statSync(projectPath);
    if (!stat.isDirectory()) return { error: 'Path is not a directory' };

    // Unhide if previously hidden
    const global = getSetting('global') || {};
    if (global.hiddenProjects && global.hiddenProjects.includes(projectPath)) {
      global.hiddenProjects = global.hiddenProjects.filter(p => p !== projectPath);
      setSetting('global', global);
    }

    // Create the corresponding folder in ~/.claude/projects/ so it persists
    const folder = encodeProjectPath(projectPath);
    const folderPath = path.join(PROJECTS_DIR, folder);
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    // Seed a minimal .jsonl so deriveProjectPath can read the cwd
    if (!fs.readdirSync(folderPath).some(f => f.endsWith('.jsonl'))) {
      const seedId = require('crypto').randomUUID();
      const seedFile = path.join(folderPath, seedId + '.jsonl');
      const now = new Date().toISOString();
      const line = JSON.stringify({ type: 'user', cwd: projectPath, sessionId: seedId, uuid: require('crypto').randomUUID(), timestamp: now, message: { role: 'user', content: 'New project' } });
      fs.writeFileSync(seedFile, line + '\n');
    }

    // Immediately index the new folder so it's in cache before frontend renders
    refreshFolder(folder);
    notifyRendererProjectsChanged();

    return { ok: true, folder, projectPath };
  } catch (err) {
    return { error: err.message };
  }
});

// --- IPC: remove-project ---
ipcMain.handle('remove-project', (_event, projectPath) => {
  try {
    // Add to hidden projects list
    const global = getSetting('global') || {};
    const hidden = global.hiddenProjects || [];
    if (!hidden.includes(projectPath)) hidden.push(projectPath);
    global.hiddenProjects = hidden;
    setSetting('global', global);

    // Clean up DB cache and search index for this folder
    const folder = encodeProjectPath(projectPath);
    deleteCachedFolder(folder);
    deleteSearchFolder(folder);
    deleteSetting('project:' + projectPath);

    notifyRendererProjectsChanged();
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

// --- IPC: get-projects ---
ipcMain.handle('open-external', (_event, url) => {
  log.info('[open-external IPC]', url);
  if (/^https?:\/\//i.test(url)) return shell.openExternal(url);
});

// --- IPC: clipboard write ---
// The renderer's navigator.clipboard.writeText is gated on focus/user-activation and
// is flaky-to-dead on Linux/Wayland (Ozone). The main-process clipboard has no such
// strings attached, so all terminal copies go through here.
ipcMain.handle('clipboard-write-text', (_event, text) => {
  if (typeof text === 'string') clipboard.writeText(text);
});

// --- IPC: MCP bridge ---
ipcMain.on('mcp-diff-response', (_event, sessionId, diffId, action, editedContent) => {
  resolvePendingDiff(sessionId, diffId, action, editedContent);
});

ipcMain.handle('read-file-for-panel', async (_event, filePath) => {
  try {
    if (!isPathAllowed(filePath)) {
      log.warn('[read-file-for-panel] blocked path outside sandbox:', filePath);
      return { ok: false, error: 'Access denied: path outside allowed directories' };
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return { ok: true, content };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('save-file-for-panel', async (_event, filePath, content) => {
  try {
    if (!isPathAllowed(filePath)) {
      log.warn('[save-file-for-panel] blocked path outside sandbox:', filePath);
      return { ok: false, error: 'Access denied: path outside allowed directories' };
    }
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) return { ok: false, error: 'File does not exist' };
    fs.writeFileSync(resolved, content, 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── File Watching (for viewer panels) ────────────────────────────────
const fileWatchers = new Map(); // filePath → FSWatcher

ipcMain.handle('watch-file', (_event, filePath) => {
  const resolved = path.resolve(filePath);
  if (fileWatchers.has(resolved)) return { ok: true };
  try {
    let debounce = null;
    const watcher = fs.watch(resolved, (eventType) => {
      if (eventType !== 'change') return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        safeSend('file-changed', resolved);
      }, 300);
    });
    fileWatchers.set(resolved, watcher);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('unwatch-file', (_event, filePath) => {
  const resolved = path.resolve(filePath);
  const watcher = fileWatchers.get(resolved);
  if (watcher) {
    watcher.close();
    fileWatchers.delete(resolved);
  }
  return { ok: true };
});

// ── Session JSONL activity watchers (sparklines for all CLIs) ─────────
// Tails a session's JSONL file and emits `session-activity` events as new
// lines are appended. Restores the cross-CLI sparkline feature whose IPC
// handlers were dropped during module refactoring; cleaned up on PTY exit (B4).
const sessionFileWatchers = new Map(); // sessionId → { watcher, debounce, offset }

function classifyActivityLine(obj) {
  // Tool activity across the various agent JSONL shapes.
  const t = obj.type;
  const role = obj.role || obj.message?.role || obj.payload?.role;
  if (t === 'tool_use' || t === 'tool_result' || t === 'tool') {
    return { type: 'tool_use', name: obj.name || obj.tool || obj.tool_name || 'tool', ts: Date.now() };
  }
  // Claude-style assistant message carrying tool_use blocks
  const content = obj.message?.content;
  if (Array.isArray(content)) {
    const tu = content.find(c => c && c.type === 'tool_use');
    if (tu) return { type: 'tool_use', name: tu.name || 'tool', ts: Date.now() };
  }
  // Gemini/Qwen functionCall parts
  const parts = obj.message?.parts || obj.parts;
  if (Array.isArray(parts) && parts.some(p => p && p.functionCall)) {
    const fc = parts.find(p => p.functionCall).functionCall;
    return { type: 'tool_use', name: fc?.name || 'tool', ts: Date.now() };
  }
  if (t === 'error' || obj.error || obj.level === 'error') {
    return { type: 'error', text: String(obj.error || obj.message || 'error').slice(0, 60), ts: Date.now() };
  }
  if (role === 'assistant' || t === 'assistant' || t === 'response_item') {
    return { type: 'text', ts: Date.now() };
  }
  return null;
}

function stopSessionFileWatcher(sessionId) {
  const entry = sessionFileWatchers.get(sessionId);
  if (entry) {
    try { entry.watcher.close(); } catch {}
    if (entry.debounce) clearTimeout(entry.debounce);
    sessionFileWatchers.delete(sessionId);
  }
}

ipcMain.handle('watch-session-file', (_event, sessionId, filePath, _agentId) => {
  if (!sessionId || !filePath) return { ok: false, error: 'missing args' };
  if (sessionFileWatchers.has(sessionId)) return { ok: true };
  let resolved;
  try { resolved = path.resolve(filePath); } catch { return { ok: false, error: 'bad path' }; }
  if (!resolved.endsWith('.jsonl') || !fs.existsSync(resolved)) return { ok: false, error: 'not a jsonl file' };
  try {
    // Start from current EOF so we only report NEW activity.
    const entry = { watcher: null, debounce: null, offset: fs.statSync(resolved).size };
    entry.watcher = fs.watch(resolved, (eventType) => {
      if (eventType !== 'change') return;
      if (entry.debounce) clearTimeout(entry.debounce);
      entry.debounce = setTimeout(() => {
        try {
          const size = fs.statSync(resolved).size;
          if (size <= entry.offset) { entry.offset = size; return; } // truncated/rotated
          const start = Math.max(entry.offset, size - 262144); // cap delta at 256KB
          const fd = fs.openSync(resolved, 'r');
          const buf = Buffer.alloc(size - start);
          fs.readSync(fd, buf, 0, buf.length, start);
          fs.closeSync(fd);
          entry.offset = size;
          for (const line of buf.toString('utf8').split('\n')) {
            if (!line.trim()) continue;
            let obj; try { obj = JSON.parse(line); } catch { continue; }
            const ev = classifyActivityLine(obj);
            if (ev) safeSend('session-activity', sessionId, ev);
          }
        } catch {}
      }, 150);
    });
    sessionFileWatchers.set(sessionId, entry);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('unwatch-session-file', (_event, sessionId) => {
  stopSessionFileWatcher(sessionId);
  return { ok: true };
});

ipcMain.handle('get-projects', (_event, showArchived) => {
  try {
    const needsPopulate = !isCachePopulated() || !isSearchIndexPopulated();

    if (needsPopulate) {
      populateCacheViaWorker();
      return [];
    }

    // Pick up folders changed while the app was closed, or never indexed by an
    // older build, so sessions/worktrees don't silently go missing. Stat-gated,
    // so it's cheap when nothing has changed.
    reconcileCacheFromFilesystem();
    return buildProjectsFromCache(showArchived);
  } catch (err) {
    console.error('Error listing projects:', err);
    return [];
  }
});

// --- IPC: get-plans ---
ipcMain.handle('get-plans', () => {
  try {
    if (!fs.existsSync(PLANS_DIR)) return [];
    const files = fs.readdirSync(PLANS_DIR).filter(f => f.endsWith('.md'));
    const plans = [];
    for (const file of files) {
      const filePath = path.join(PLANS_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, 'utf8');
        const firstLine = content.split('\n').find(l => l.trim());
        const title = firstLine && firstLine.startsWith('# ')
          ? firstLine.slice(2).trim()
          : file.replace(/\.md$/, '');
        plans.push({ filename: file, title, modified: stat.mtime.toISOString() });
      } catch {}
    }
    plans.sort((a, b) => new Date(b.modified) - new Date(a.modified));

    // Index plans for FTS
    try {
      deleteSearchType('plan');
      upsertSearchEntries(plans.map(p => ({
        id: p.filename, type: 'plan', folder: null,
        title: p.title,
        body: fs.readFileSync(path.join(PLANS_DIR, p.filename), 'utf8'),
      })));
    } catch {}

    return plans;
  } catch (err) {
    console.error('Error reading plans:', err);
    return [];
  }
});

// --- IPC: read-plan ---
ipcMain.handle('read-plan', (_event, filename) => {
  try {
    const filePath = path.join(PLANS_DIR, path.basename(filename));
    const content = fs.readFileSync(filePath, 'utf8');
    return { content, filePath };
  } catch (err) {
    console.error('Error reading plan:', err);
    return { content: '', filePath: '' };
  }
});

// --- IPC: save-plan ---
ipcMain.handle('save-plan', (_event, filePath, content) => {
  try {
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(PLANS_DIR)) {
      return { ok: false, error: 'path outside plans directory' };
    }
    fs.writeFileSync(resolved, content, 'utf8');
    return { ok: true };
  } catch (err) {
    console.error('Error saving plan:', err);
    return { ok: false, error: err.message };
  }
});

// --- IPC: get-stats ---
ipcMain.handle('get-stats', () => {
  try {
    if (!fs.existsSync(STATS_CACHE_PATH)) return null;
    const raw = fs.readFileSync(STATS_CACHE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading stats cache:', err);
    return null;
  }
});

// --- IPC: refresh-stats (run /stats + /usage via PTY) ---
ipcMain.handle('refresh-stats', async () => {
  // For stats, use the configured shell profile
  const globalSettings = getSetting('global') || {};
  const statsProfileId = globalSettings.shellProfile || SETTING_DEFAULTS.shellProfile;
  const statsShellProfile = resolveShell(statsProfileId);
  const statsShell = statsShellProfile.path;
  const statsShellExtraArgs = statsShellProfile.args || [];
  const ptyEnv = {
    ...cleanPtyEnv,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'iTerm.app',
    TERM_PROGRAM_VERSION: '3.6.6',
    FORCE_COLOR: '3',
    ITERM_SESSION_ID: '1',
  };

  // Helper: spawn claude with args, collect output, auto-accept trust, kill when idle
  // waitFor: optional regex tested against stripped output — finish only when matched
  function runClaude(args, { timeoutMs = 15000, waitFor = null } = {}) {
    return new Promise((resolve) => {
      let output = '';
      let settled = false;
      let trustAccepted = false;
      // Track idle: ✳ in OSC title means Claude is idle and waiting for input
      let sawActivity = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        try { p.kill(); } catch {}
        resolve(output);
      };

      const claudeCmd = `claude ${args}`;
      const p = pty.spawn(statsShell, shellArgs(statsShell, claudeCmd, statsShellExtraArgs), {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        cwd: os.homedir(),
        env: ptyEnv,
      });

      const strip = (s) => s
        .replace(/\x1b\[[^@-~]*[@-~]/g, '')
        .replace(/\x1b\][^\x07]*\x07/g, '')
        .replace(/\x1b[^[\]].?/g, '');

      p.onData((data) => {
        output += data;

        // Auto-accept trust directory prompt (Enter selects "1. Yes")
        if (!trustAccepted) {
          if (/trust\s*this\s*folder/i.test(strip(output))) {
            trustAccepted = true;
            try { p.write('\r'); } catch {}
            return;
          }
        }

        // If waitFor is set, finish when that pattern appears in stripped output
        if (waitFor) {
          if (waitFor.test(strip(output))) {
            finish();
          }
          return;
        }

        // Default: detect busy→idle transition via OSC title containing ✳
        if (!sawActivity) {
          const oscTitle = data.match(/\x1b\]0;([^\x07\x1b]*)/);
          if (oscTitle) {
            const first = oscTitle[1].charAt(0);
            if (first.charCodeAt(0) >= 0x2800 && first.charCodeAt(0) <= 0x28FF) {
              sawActivity = true;
            }
          }
        } else if (data.includes('\u2733')) {
          finish();
        }
      });

      p.onExit(() => finish());
      setTimeout(finish, timeoutMs);
    });
  }

  try {
    // Run /stats via PTY (for heatmap/chart data) and fetch usage via API in parallel
    const [, usage] = await Promise.all([
      runClaude('"/stats"', { waitFor: /streak/i, timeoutMs: 10000 }),
      fetchAndTransformUsage().catch(() => ({})),
    ]);

    // Read refreshed stats cache
    let stats = null;
    try {
      if (fs.existsSync(STATS_CACHE_PATH)) {
        stats = JSON.parse(fs.readFileSync(STATS_CACHE_PATH, 'utf8'));
      }
    } catch {}

    return { stats, usage: usage || {} };
  } catch (err) {
    log.error('Error refreshing stats:', err);
    return { stats: null, usage: {} };
  }
});

// --- IPC: get-usage (lightweight, API-only, no PTY) ---
ipcMain.handle('get-usage', async () => {
  try {
    return await fetchAndTransformUsage() || {};
  } catch (err) {
    log.error('Error fetching usage:', err);
    return {};
  }
});

// --- IPC: get-memories ---
function folderToShortPath(folder) {
  // Convert "-Users-home-dev-MyClaude" → "dev/MyClaude"
  const parts = folder.replace(/^-/, '').split('-');
  const meaningful = parts.filter(Boolean);
  return meaningful.slice(-2).join('/');
}

/** Scan a directory for .md files (non-recursive). Returns array of { filename, filePath, modified }. */
function scanMdFiles(dir) {
  const results = [];
  try {
    if (!fs.existsSync(dir)) return results;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.md')) {
        const fp = path.join(dir, e.name);
        const content = fs.readFileSync(fp, 'utf8').trim();
        if (content) {
          const stat = fs.statSync(fp);
          results.push({ filename: e.name, filePath: fp, modified: stat.mtime.toISOString() });
        }
      }
    }
  } catch {}
  return results;
}

ipcMain.handle('get-memories', () => {
  const global = getSetting('global') || {};
  const hiddenProjects = new Set(global.hiddenProjects || []);

  // --- Global files ---
  const globalFiles = scanMdFiles(CLAUDE_DIR).map(f => ({ ...f, displayPath: '~/.claude' }));

  // --- Per-project files ---
  const projects = [];
  try {
    if (fs.existsSync(PROJECTS_DIR)) {
      const folders = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name !== '.git')
        .map(d => d.name);

      for (const folder of folders) {
        const folderPath = path.join(PROJECTS_DIR, folder);
        const projectPath = deriveProjectPath(folderPath, folder);
        if (projectPath && hiddenProjects.has(projectPath)) continue;

        // Use same 2-deep short path as Sessions tab (e.g. "dev/MyClaude")
        // Splits on both separators — `cwd` is backslash-separated on Windows,
        // where splitting on '/' alone left the whole path as one segment.
        const shortName = projectPath
          ? projectPath.split(/[\\/]/).filter(Boolean).slice(-2).join('/')
          : folderToShortPath(folder);
        const files = [];
        const seenPaths = new Set();

        // 1. ~/.claude/projects/{folder}/ — claude-home .md files
        const claudeHomeFiles = scanMdFiles(folderPath);
        for (const f of claudeHomeFiles) {
          files.push({ ...f, displayPath: '~/.claude', source: 'claude-home' });
          seenPaths.add(f.filePath);
        }
        // memory/MEMORY.md
        const memoryDir = path.join(folderPath, 'memory');
        const memoryFiles = scanMdFiles(memoryDir);
        for (const f of memoryFiles) {
          files.push({ ...f, displayPath: '~/.claude', source: 'claude-home' });
          seenPaths.add(f.filePath);
        }

        // 2. {projectPath}/ — project root CLAUDE.md, agents.md
        if (projectPath) {
          for (const name of ['CLAUDE.md', 'GEMINI.md', 'agents.md']) {
            const fp = path.join(projectPath, name);
            try {
              if (fs.existsSync(fp)) {
                const content = fs.readFileSync(fp, 'utf8').trim();
                if (content && !seenPaths.has(fp)) {
                  const stat = fs.statSync(fp);
                  files.push({ filename: name, filePath: fp, modified: stat.mtime.toISOString(), displayPath: shortName + '/', source: 'project' });
                  seenPaths.add(fp);
                }
              }
            } catch {}
          }

          // 3. {projectPath}/.claude/ — commands/*.md and other .md files
          const dotClaudeDir = path.join(projectPath, '.claude');
          const dotClaudeFiles = scanMdFiles(dotClaudeDir);
          for (const f of dotClaudeFiles) {
            if (!seenPaths.has(f.filePath)) {
              files.push({ ...f, displayPath: shortName + '/.claude/', source: 'project' });
              seenPaths.add(f.filePath);
            }
          }
          // commands/*.md
          const commandsDir = path.join(dotClaudeDir, 'commands');
          const commandFiles = scanMdFiles(commandsDir);
          for (const f of commandFiles) {
            if (!seenPaths.has(f.filePath)) {
              files.push({ ...f, displayPath: shortName + '/.claude/commands/', source: 'project' });
              seenPaths.add(f.filePath);
            }
          }
        }

        if (files.length > 0) {
          projects.push({ folder, projectPath: projectPath || '', shortName, files });
        }
      }
    }
  } catch (err) {
    console.error('Error scanning memories:', err);
  }

  // Sort projects by most recent file modified date
  projects.sort((a, b) => {
    const aMax = Math.max(...a.files.map(f => new Date(f.modified).getTime()));
    const bMax = Math.max(...b.files.map(f => new Date(f.modified).getTime()));
    return bMax - aMax;
  });

  const result = { global: { files: globalFiles }, projects };

  // Index all files for FTS
  try {
    deleteSearchType('memory');
    const allFiles = [
      ...globalFiles.map(f => ({ ...f, label: 'Global' })),
      ...projects.flatMap(p => p.files.map(f => ({ ...f, label: p.shortName }))),
    ];
    upsertSearchEntries(allFiles.map(f => ({
      id: f.filePath, type: 'memory', folder: null,
      title: f.label + ' ' + f.filename,
      body: fs.readFileSync(f.filePath, 'utf8'),
    })));
  } catch {}

  return result;
});

// --- IPC: read-memory ---
ipcMain.handle('read-memory', (_event, filePath) => {
  try {
    const resolved = path.resolve(filePath);
    // Allow paths under ~/.claude/ or any .md file that exists
    if (!resolved.endsWith('.md')) return '';
    if (!resolved.startsWith(CLAUDE_DIR) && !fs.existsSync(resolved)) return '';
    return fs.readFileSync(resolved, 'utf8');
  } catch (err) {
    console.error('Error reading memory file:', err);
    return '';
  }
});

// --- IPC: save-memory ---
ipcMain.handle('save-memory', (_event, filePath, content) => {
  try {
    const resolved = path.resolve(filePath);
    if (!resolved.endsWith('.md')) return { ok: false, error: 'not a .md file' };
    if (!fs.existsSync(resolved)) return { ok: false, error: 'file does not exist' };
    fs.writeFileSync(resolved, content, 'utf8');
    return { ok: true };
  } catch (err) {
    console.error('Error saving memory file:', err);
    return { ok: false, error: err.message };
  }
});

// --- IPC: search ---
ipcMain.handle('search', (_event, type, query, titleOnly) => {
  return searchByType(type, query, 50, !!titleOnly);
});

// --- IPC: settings ---
ipcMain.handle('get-setting', (_event, key) => {
  return getSetting(key);
});

// Settings keys are 'global', 'project:<path>', or other short scope strings.
// Validate to stop arbitrary/oversized blobs (FULL-AUDIT #35).
const MAX_SETTING_BYTES = 256 * 1024;
ipcMain.handle('set-setting', (_event, key, value) => {
  if (typeof key !== 'string' || key.length === 0 || key.length > 512) {
    return { ok: false, error: 'Invalid setting key' };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'Setting value must be a JSON object' };
  }
  try {
    if (JSON.stringify(value).length > MAX_SETTING_BYTES) {
      return { ok: false, error: 'Setting value too large' };
    }
  } catch {
    return { ok: false, error: 'Setting value is not serializable' };
  }
  setSetting(key, value);
  return { ok: true };
});

ipcMain.handle('delete-setting', (_event, key) => {
  deleteSetting(key);
  return { ok: true };
});

// --- Scheduled tasks ---
const scheduleIpc = require('./schedule-ipc');

const SETTING_DEFAULTS = {
  permissionMode: null,
  dangerouslySkipPermissions: false,
  worktree: false,
  worktreeName: '',
  chrome: false,
  preLaunchCmd: '',
  addDirs: '',
  visibleSessionCount: 5,
  sidebarWidth: 340,
  terminalTheme: 'switchboard',
  mcpEmulation: false,
  shellProfile: 'auto',
};

// --- CLI agent definitions ---
const CLI_AGENTS = {
  claude:    { name: 'Claude Code',   cmd: 'claude',    color: '#d97757', sessionFlag: '--session-id', resumeFlag: '--resume', forkFlag: '--fork-session', supportsPermissions: true,  supportsMcp: true  },
  codex:     { name: 'Codex',         cmd: 'codex',     color: '#4ade80', sessionFlag: null,           resumeFlag: null,       forkFlag: null,             supportsPermissions: false, supportsMcp: false },
  qwen:      { name: 'Qwen Code',     cmd: 'qwen',      color: '#60a5fa', sessionFlag: null,           resumeFlag: '--resume', forkFlag: null,             supportsPermissions: false, supportsMcp: false },
  gemini:    { name: 'Gemini CLI',    cmd: 'gemini',    color: '#22d3ee', sessionFlag: null,           resumeFlag: '--resume', forkFlag: null,             supportsPermissions: false, supportsMcp: false },
  kimi:      { name: 'Kimi Code',     cmd: 'kimi',      color: '#fb923c', sessionFlag: null,           resumeFlag: null,       forkFlag: null,             supportsPermissions: false, supportsMcp: false },
  aider:     { name: 'Aider',         cmd: 'aider',     color: '#a78bfa', sessionFlag: null,           resumeFlag: null,       forkFlag: null,             supportsPermissions: false, supportsMcp: false },
  opencode:  { name: 'OpenCode',      cmd: 'opencode',  color: '#f472b6', sessionFlag: null,           resumeFlag: null,       forkFlag: null,             supportsPermissions: false, supportsMcp: false },
  hermes:    { name: 'Hermes Agent',  cmd: 'hermes',    color: '#fbbf24', sessionFlag: null,           resumeFlag: '--resume', forkFlag: null,             supportsPermissions: false, supportsMcp: false },
  letta:     { name: 'Letta Code',    cmd: 'letta',     color: '#34d399', sessionFlag: null,           resumeFlag: null,       forkFlag: null,             supportsPermissions: false, supportsMcp: false },
  // New agents
  amp:       { name: 'Amp',           cmd: 'amp',       color: '#e879f9', sessionFlag: null,           resumeFlag: '--resume', forkFlag: null,             supportsPermissions: false, supportsMcp: false },
  goose:     { name: 'Goose',         cmd: 'goose',     color: '#fb7185', sessionFlag: null,           resumeFlag: null,       forkFlag: null,             supportsPermissions: false, supportsMcp: true  },
  continue:  { name: 'Continue',      cmd: 'continue',  color: '#06b6d4', sessionFlag: null,           resumeFlag: null,       forkFlag: null,             supportsPermissions: false, supportsMcp: false },
  cursor:    { name: 'Cursor CLI',    cmd: 'cursor',    color: '#8b5cf6', sessionFlag: null,           resumeFlag: null,       forkFlag: null,             supportsPermissions: false, supportsMcp: false },
  cline:     { name: 'Cline',         cmd: 'cline',     color: '#f97316', sessionFlag: null,           resumeFlag: null,       forkFlag: null,             supportsPermissions: false, supportsMcp: false },
  // Focus agents (multi-CLI session history)
  antigravity: { name: 'Antigravity', cmd: 'antigravity', altCmds: ['agy'], color: '#2dd4bf', sessionFlag: null, resumeFlag: '--resume', forkFlag: null, supportsPermissions: false, supportsMcp: false },
  pi:        { name: 'Pi Agent',      cmd: 'pi',        color: '#c084fc', sessionFlag: null,           resumeFlag: '-r',       forkFlag: null,             supportsPermissions: false, supportsMcp: false },
  kilo:      { name: 'Kilo Code',     cmd: 'kilo',      color: '#facc15', sessionFlag: null,           resumeFlag: null,       forkFlag: null,             supportsPermissions: false, supportsMcp: false },
};

// Session history discovery per agent
// AGENT_HISTORY: per-CLI session-history adapters (see agent-history.js).
const { createAgentHistory } = require('./agent-history');
const AGENT_HISTORY = createAgentHistory({ getAllCached });

// IPC: get-agent-stats — aggregate session history across all agents
ipcMain.handle('get-agent-stats', () => {
  const stats = {};
  for (const [agentId, history] of Object.entries(AGENT_HISTORY)) {
    try {
      const sessions = history.getSessions();
      const now = Date.now();
      const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

      const recentSessions = sessions.filter(s => s.modified.getTime() > thirtyDaysAgo);
      const weekSessions = sessions.filter(s => s.modified.getTime() > sevenDaysAgo);

      let totalMessages = 0, totalToolUses = 0;
      const sampled = recentSessions.slice(-10);
      for (const s of sampled) {
        const parsed = history.parseSession(s.file, s.id);
        if (parsed) {
          totalMessages += (parsed.userMessages || 0) + (parsed.assistantMessages || 0);
          totalToolUses += parsed.toolUses || 0;
        }
      }

      stats[agentId] = {
        name: CLI_AGENTS[agentId]?.name || agentId,
        color: CLI_AGENTS[agentId]?.color || '#888',
        totalSessions: sessions.length,
        last30Days: recentSessions.length,
        last7Days: weekSessions.length,
        estimatedMessages: totalMessages,
        estimatedToolUses: totalToolUses,
        lastUsed: sessions.length ? sessions.sort((a, b) => b.modified - a.modified)[0].modified.toISOString() : null,
        totalSizeBytes: sessions.reduce((sum, s) => sum + s.size, 0),
      };
    } catch (err) {
      // Surface the reason (IMPROVEMENTS B10) instead of a silent flag.
      log.warn(`[get-agent-stats] ${agentId} failed:`, err.message);
      stats[agentId] = { name: CLI_AGENTS[agentId]?.name || agentId, error: true, errorMessage: err.message };
    }
  }
  return stats;
});

ipcMain.handle('detect-agents', () => {
  const { execFileSync } = require('child_process');
  const results = {};
  for (const [id, agent] of Object.entries(CLI_AGENTS)) {
    let installed = false;
    const candidates = [agent.cmd, ...(agent.altCmds || [])];
    for (const cmd of candidates) {
      try {
        execFileSync('which', [cmd], { timeout: 2000, stdio: 'pipe' });
        installed = true;
        break;
      } catch {}
    }
    // A non-Claude agent with discoverable on-disk session history should also
    // surface in the sidebar even when its binary isn't on PATH (e.g. installed
    // in a non-login shell, or run via npx), so users can still browse old work.
    let hasHistory = false;
    if (!installed && AGENT_HISTORY[id]) {
      try { hasHistory = (AGENT_HISTORY[id].getSessions() || []).length > 0; } catch {}
    }
    results[id] = { ...agent, id, installed: installed || hasHistory, onPath: installed };
  }
  return results;
});

// --- IPC: project card metadata + git controls ---

// Project metadata: last-modified file mtime + (cached) git status, for cards.
ipcMain.handle('get-project-meta', async (_event, projectPath) => {
  try {
    const lastModifiedMs = getCachedProjectLastModified(projectPath);
    const git = await getCachedGitStatus(projectPath);
    return { ok: true, lastModifiedMs, git };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('git-list-branches', async (_event, projectPath) => {
  try { return { ok: true, ...(await gitUtils.listBranches(projectPath)) }; }
  catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('git-checkout-branch', async (_event, projectPath, branch, opts) => {
  try {
    const res = await gitUtils.checkoutBranch(projectPath, branch, opts || {});
    if (res.ok) gitStatusCache.delete(projectPath); // force fresh status next read
    return res;
  } catch (err) { return { ok: false, error: err.message }; }
});

// Throttled remote fetch so "pull available" reflects the real cloud state.
ipcMain.handle('git-fetch-remote', async (_event, projectPath, opts) => {
  try {
    const now = Date.now();
    const last = lastFetchAt.get(projectPath) || 0;
    if (!opts?.force && (now - last) < FETCH_THROTTLE_MS) {
      // Skip the network call; just return the (cached) current state.
      return { ok: true, throttled: true, git: await getCachedGitStatus(projectPath) };
    }
    const res = await gitUtils.fetchRemote(projectPath);
    lastFetchAt.set(projectPath, now);
    gitStatusCache.delete(projectPath);
    return { ...res, git: await getCachedGitStatus(projectPath, true) };
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('git-pull', async (_event, projectPath) => {
  try {
    const res = await gitUtils.pullFastForward(projectPath);
    gitStatusCache.delete(projectPath);
    projectMetaCache.delete(projectPath);
    return { ...res, git: await getCachedGitStatus(projectPath, true) };
  } catch (err) { return { ok: false, error: err.message }; }
});

// --- IPC: get-session-tokens ---
const { estimateCostCents } = require('./tokens');

ipcMain.handle('get-session-tokens', (_event, sessionId) => {
  try {
    const row = getSessionTokens(sessionId);
    if (!row) return null;
    const costCents = estimateCostCents(row);
    return { ...row, costCents };
  } catch { return null; }
});

ipcMain.handle('get-all-session-tokens', () => {
  try {
    const map = getAllSessionTokens();
    const result = {};
    for (const [sessionId, row] of map) {
      result[sessionId] = { ...row, costCents: estimateCostCents(row) };
    }
    return result;
  } catch { return {}; }
});

// --- IPC: loop detection ---
ipcMain.handle('get-session-loops', (_event, sessionId) => {
  try { return getSessionLoops(sessionId); } catch { return []; }
});

ipcMain.handle('get-all-session-loops', () => {
  try {
    const map = getAllSessionLoops();
    const result = {};
    for (const [sessionId, row] of map) result[sessionId] = row;
    return result;
  } catch { return {}; }
});

// --- IPC: session templates ---
ipcMain.handle('save-template', (_event, data) => {
  try {
    const id = saveTemplate(data);
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('get-templates', () => {
  try { return { ok: true, templates: getAllTemplates() }; } catch (err) { return { ok: false, templates: [], error: err.message }; }
});

ipcMain.handle('delete-template', (_event, id) => {
  try { deleteTemplate(id); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
});

// --- IPC: read-session-conversation ---
ipcMain.handle('read-session-conversation', (_event, sessionId, filePath, agentId) => {
  try {
    const history = AGENT_HISTORY[agentId];
    if (!history) return { ok: false, error: `Unknown agent: ${agentId}` };

    const sessions = history.getSessions();
    const session = sessions.find(s => s.id === sessionId || s.file === filePath);
    if (!session) return { ok: false, error: 'Session not found' };

    // Read and parse the session file using the agent's parser
    const parsed = history.parseSession(session.file, session.id);
    if (!parsed) return { ok: false, error: 'Failed to parse session' };

    return { ok: true, data: parsed };
  } catch (err) {
    log.error(`[read-session-conversation] Error:`, err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('get-shell-profiles', () => {
  _shellProfiles = null; // refresh on each request
  return getShellProfiles();
});

ipcMain.handle('get-effective-settings', (_event, projectPath) => {
  const global = getSetting('global') || {};
  const project = projectPath ? (getSetting('project:' + projectPath) || {}) : {};
  const effective = { ...SETTING_DEFAULTS };
  for (const key of Object.keys(SETTING_DEFAULTS)) {
    if (global[key] !== undefined && global[key] !== null) {
      effective[key] = global[key];
    }
    if (project[key] !== undefined && project[key] !== null) {
      effective[key] = project[key];
    }
  }
  return effective;
});

// --- IPC: get-agent-sessions ---
// Returns sessions for non-Claude agents using AGENT_HISTORY discovery.
ipcMain.handle('get-agent-sessions', async (_event, agentId) => {
  try {
    const history = AGENT_HISTORY[agentId];
    if (!history) return [];

    const cached = agentScanCache.get(agentId);
    if (cached && (Date.now() - cached.timestamp) < AGENT_SCAN_CACHE_TTL) {
      return cached.sessions;
    }

    const rawSessions = history.getSessions();
    if (!rawSessions || rawSessions.length === 0) return [];

    const metaMap = getAllMeta();
    const folderMap = new Map();

    for (const raw of rawSessions) {
      let projectPath = raw.project || path.dirname(raw.file);
      let folder = raw.project || path.basename(path.dirname(raw.file));

      if (history.parseSession) {
        try {
          const parsed = history.parseSession(raw.file);
          if (parsed?.cwd) {
            projectPath = parsed.cwd;
            folder = parsed.cwd.split('/').filter(Boolean).slice(-2).join('/');
          }
        } catch {}
      }

      if (projectPath === raw.project || !projectPath.startsWith('/')) {
        try {
          const firstLine = fs.readFileSync(raw.file, 'utf8').split('\n')[0];
          if (firstLine) {
            const obj = JSON.parse(firstLine);
            if (obj.cwd) {
              projectPath = obj.cwd;
              folder = obj.cwd.split('/').filter(Boolean).slice(-2).join('/');
            } else if (obj.payload?.cwd) {
              projectPath = obj.payload.cwd;
              folder = obj.payload.cwd.split('/').filter(Boolean).slice(-2).join('/');
            }
          }
        } catch {}
      }

      if (!folderMap.has(projectPath)) {
        folderMap.set(projectPath, { folder, projectPath, sessions: [] });
      }

      const meta = metaMap.get(raw.id);
      const summary = extractSessionSummary(raw.file);

      let messageCount = 0;
      let turnCount = 0;
      let startTime = '';
      let endTime = '';
      try {
        const parsed = history.parseSession(raw.file);
        if (parsed) {
          messageCount = (parsed.userMessages || 0) + (parsed.assistantMessages || 0);
          turnCount = Math.min(parsed.userMessages || 0, parsed.assistantMessages || 0);
        }
      } catch {}

      if (messageCount === 0 && raw.size) {
        messageCount = Math.max(1, Math.round(raw.size / 500));
      }

      const mtime = raw.modified ? new Date(raw.modified) : new Date();
      endTime = mtime.toISOString();

      try {
        const fd = fs.openSync(raw.file, 'r');
        const buf = Buffer.alloc(8192);
        const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
        fs.closeSync(fd);
        const firstChunk = buf.toString('utf8', 0, bytesRead);
        const firstLine = firstChunk.split('\n').filter(Boolean)[0];
        if (firstLine) {
          const obj = JSON.parse(firstLine);
          const ts = obj.timestamp || obj.created_at || obj.createdAt || obj.time || obj.created;
          if (ts) {
            startTime = new Date(ts).toISOString();
          }
        }
      } catch {}

      if (!startTime) {
        try {
          const stat = fs.statSync(raw.file);
          startTime = stat.birthtime ? stat.birthtime.toISOString() : new Date(stat.ctime).toISOString();
        } catch {
          startTime = endTime;
        }
      }

      let status = 'completed';
      if (raw.modified) {
        const age = Date.now() - raw.modified.getTime();
        if (age < 60_000) status = 'running';
        else if (age < 300_000) status = 'recent';
      }

      folderMap.get(projectPath).sessions.push({
        sessionId: raw.id,
        summary,
        firstPrompt: summary,
        startTime,
        endTime,
        created: startTime,
        modified: endTime,
        messageCount,
        turnCount,
        size: raw.size || 0,
        status,
        projectPath,
        slug: null,
        name: meta?.name || null,
        starred: meta?.starred || 0,
        archived: meta?.archived || 0,
        agent: agentId,
        file: raw.file,
      });
    }

    // Build projects and sort
    const projects = [];
    for (const proj of folderMap.values()) {
      proj.sessions.sort((a, b) => new Date(b.modified) - new Date(a.modified));
      projects.push(proj);
    }
    projects.sort((a, b) => {
      const aDate = a.sessions[0]?.modified || '';
      const bDate = b.sessions[0]?.modified || '';
      return new Date(bDate) - new Date(aDate);
    });

    // Batch-resolve git statuses
    const gitPromises = new Map();
    for (const proj of projects) {
      for (const session of proj.sessions) {
        if (session.projectPath && !gitPromises.has(session.projectPath)) {
          gitPromises.set(session.projectPath, getCachedGitStatus(session.projectPath));
        }
      }
    }
    const gitResults = await Promise.all(
      Array.from(gitPromises.entries()).map(async ([projPath, promise]) => {
        const data = await promise;
        return { projPath, data };
      })
    );
    const gitResultMap = new Map(gitResults.map(r => [r.projPath, r.data]));
    for (const proj of projects) {
      for (const session of proj.sessions) {
        if (session.projectPath && gitResultMap.has(session.projectPath)) {
          const gd = gitResultMap.get(session.projectPath);
          session.gitStatus = gd.status;
          session.gitBranch = gd.branch;
        }
      }
    }

    // Evict oldest entry if over cap
    if (agentScanCache.size >= AGENT_SCAN_CACHE_MAX) {
      const oldest = Array.from(agentScanCache.entries()).reduce((a, b) =>
        a[1].timestamp < b[1].timestamp ? a : b
      );
      agentScanCache.delete(oldest[0]);
    }
    agentScanCache.set(agentId, { sessions: projects, timestamp: Date.now() });

    return projects;
  } catch (err) {
    log.error(`Error getting ${agentId} sessions:`, err);
    return [];
  }
});

// --- IPC: get-active-sessions ---
ipcMain.handle('get-active-sessions', () => {
  const active = [];
  for (const [sessionId, session] of activeSessions) {
    if (!session.exited) active.push(sessionId);
  }
  return active;
});

// --- IPC: get-active-terminals --- (plain terminal sessions for renderer restore)
ipcMain.handle('get-active-terminals', () => {
  const terminals = [];
  for (const [sessionId, session] of activeSessions) {
    if (!session.exited && session.isPlainTerminal) {
      terminals.push({ sessionId, projectPath: session.projectPath });
    }
  }
  return terminals;
});

// --- IPC: stop-session ---
ipcMain.handle('stop-session', (_event, sessionId) => {
  const session = activeSessions.get(sessionId);
  if (!session || session.exited) return { ok: false, error: 'not running' };
  session.pty.kill();
  return { ok: true };
});

// --- IPC: toggle-star ---
ipcMain.handle('toggle-star', (_event, sessionId) => {
  const starred = toggleStar(sessionId);
  return { starred };
});

// --- IPC: rename-session ---
ipcMain.handle('rename-session', (_event, sessionId, name) => {
  setName(sessionId, name || null);
  // Update search index title to include the new name
  const cached = getCachedSession(sessionId);
  const summary = cached?.summary || '';
  updateSearchTitle(sessionId, 'session', (name ? name + ' ' : '') + summary);
  return { name: name || null };
});

// --- IPC: archive-session ---
ipcMain.handle('read-session-jsonl', (_event, sessionId) => {
  const folder = getCachedFolder(sessionId);
  if (!folder) return { error: 'Session not found in cache' };
  const jsonlPath = path.join(PROJECTS_DIR, folder, sessionId + '.jsonl');
  try {
    const content = fs.readFileSync(jsonlPath, 'utf-8');
    const entries = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try { entries.push(JSON.parse(line)); } catch {}
    }
    return { entries };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('archive-session', (_event, sessionId, archived) => {
  const val = archived ? 1 : 0;
  setArchived(sessionId, val);
  return { archived: val };
});

// --- IPC: open-terminal ---
ipcMain.handle('open-terminal', async (_event, sessionId, projectPath, isNew, sessionOptions) => {
  if (!mainWindow) return { ok: false, error: 'no window' };

  // Reattach to existing session
  if (activeSessions.has(sessionId)) {
    const session = activeSessions.get(sessionId);
    session.rendererAttached = true;
    session.firstResize = !session.isPlainTerminal;

    // If TUI is in alternate screen mode, send escape to switch into it
    if (session.altScreen && !session.isPlainTerminal) {
safeSendToSession(sessionId, 'terminal-data', '\x1b[?1049h');
      safeSendToSession(sessionId, 'terminal-data', chunk);
      safeSendToSession(sessionId, 'terminal-data', '\x1b[?25l');
    }

    return { ok: true, reattached: true, mcpActive: !!session.mcpServer };
  }

  // Spawn new PTY
  if (!fs.existsSync(projectPath)) {
    return { ok: false, error: `project directory no longer exists: ${projectPath}` };
  }

  const isPlainTerminal = sessionOptions?.type === 'terminal';

  // Resolve shell profile from effective settings
  const effectiveProfileId = (() => {
    const global = getSetting('global') || {};
    const project = projectPath ? (getSetting('project:' + projectPath) || {}) : {};
    let profileId = SETTING_DEFAULTS.shellProfile;
    if (global.shellProfile !== undefined && global.shellProfile !== null) profileId = global.shellProfile;
    if (project.shellProfile !== undefined && project.shellProfile !== null) profileId = project.shellProfile;
    return profileId;
  })();
  // WSL profiles only work for plain terminals — Claude CLI sessions need the
  // Windows shell because session data lives on the Windows filesystem.
  const requestedProfile = resolveShell(effectiveProfileId);
  const useWslProfile = isWslShell(requestedProfile.path) && isPlainTerminal;
  const shellProfile = (isWslShell(requestedProfile.path) && !isPlainTerminal)
    ? resolveShell('auto')
    : requestedProfile;
  const shell = shellProfile.path;
  const shellExtraArgs = [...(shellProfile.args || [])];
  const isWsl = isWslShell(shell);
  // For WSL, convert Windows path to /mnt/ path and pass via --cd;
  // the spawn cwd must remain a valid Windows path for wsl.exe itself.
  if (isWsl) {
    const wslCwd = windowsToWslPath(projectPath);
    shellExtraArgs.unshift('--cd', wslCwd);
  }
  log.info(`[shell] profile=${shellProfile.id} shell=${shell} args=${JSON.stringify(shellExtraArgs)}`);

  let knownJsonlFiles = new Set();
  let sessionSlug = null;
  let projectFolder = null;

  if (!isPlainTerminal) {
    // Snapshot existing .jsonl files before spawning (for new session + fork/plan detection)
    projectFolder = encodeProjectPath(projectPath);
    const claudeProjectDir = path.join(PROJECTS_DIR, projectFolder);
    if (fs.existsSync(claudeProjectDir)) {
      try {
        knownJsonlFiles = new Set(
          fs.readdirSync(claudeProjectDir).filter(f => f.endsWith('.jsonl'))
        );
      } catch {}
    }

    // Read slug from the session's jsonl file (for plan-accept detection)
    if (!isNew) {
      try {
        const jsonlPath = path.join(claudeProjectDir, sessionId + '.jsonl');
        const head = fs.readFileSync(jsonlPath, 'utf8').slice(0, 8000);
        const firstLines = head.split('\n').filter(Boolean);
        for (const line of firstLines) {
          const entry = JSON.parse(line);
          if (entry.slug) { sessionSlug = entry.slug; break; }
        }
      } catch {}
    }
  }

  let ptyProcess;
  let mcpServer = null;
  try {
    if (isPlainTerminal) {
      // Plain terminal: interactive login shell, no claude command
      // Inject a shell function to override `claude` with a helpful message
      const claudeShim = 'claude() { echo "\\033[33mTo start a Claude session, use the + button in the sidebar.\\033[0m"; return 1; }; export -f claude 2>/dev/null;';
      ptyProcess = pty.spawn(shell, shellArgs(shell, undefined, shellExtraArgs), {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: isWsl ? os.homedir() : projectPath,
        env: {
          ...cleanPtyEnv,
          TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.6.6', FORCE_COLOR: '3', ITERM_SESSION_ID: '1',
          CLAUDECODE: '1',
          // ZDOTDIR trick won't work reliably; instead inject via ENV (sh/bash) or precmd
          ENV: claudeShim,
          BASH_ENV: claudeShim,
        },
      });
      // For zsh, ENV/BASH_ENV don't apply — write the function after shell starts
      setTimeout(() => {
        if (!ptyProcess._isDisposed) {
          try {
            ptyProcess.write(claudeShim + ' clear\n');
          } catch {}
        }
      }, 300);
    } else {
      // Build claude command, using array to prevent accidental shell injection
      const claudeArgs = [];
      if (sessionOptions?.forkFrom) {
        claudeArgs.push('--resume', String(sessionOptions.forkFrom), '--fork-session');
      } else if (isNew) {
        claudeArgs.push('--session-id', String(sessionId));
      } else {
        claudeArgs.push('--resume', String(sessionId));
      }

      if (sessionOptions) {
        if (sessionOptions.dangerouslySkipPermissions) {
          claudeArgs.push('--dangerously-skip-permissions');
        } else if (sessionOptions.permissionMode) {
          claudeArgs.push('--permission-mode', String(sessionOptions.permissionMode));
        }
        // --worktree only applies when STARTING a session — it creates a fresh
        // isolated git worktree. Resuming (isNew === false) must reuse the
        // session's existing directory, so ignore the worktree option on resume
        // regardless of which call site supplied it (sidebar click, schedule
        // creator, fork, …). Otherwise a resume tries to spin up a new worktree
        // and fails to attach.
        if (isNew && sessionOptions.worktree) {
          claudeArgs.push('--worktree');
          if (sessionOptions.worktreeName) {
            claudeArgs.push(String(sessionOptions.worktreeName));
          }
        }
        if (sessionOptions.chrome) {
          claudeArgs.push('--chrome');
        }
        if (sessionOptions.addDirs) {
          const dirs = String(sessionOptions.addDirs).split(',').map(d => d.trim()).filter(Boolean);
          for (const dir of dirs) {
            claudeArgs.push('--add-dir', dir);
          }
        }
      }

      if (sessionOptions?.appendSystemPrompt) {
        claudeArgs.push('--append-system-prompt', String(sessionOptions.appendSystemPrompt));
      }

      let claudeCmd = 'claude ' + quoteArgvForShell(shell, claudeArgs);

      // preLaunchCmd is raw shell by design (e.g. "aws-vault exec profile --") — block newlines only
      if (sessionOptions?.preLaunchCmd) {
        const pre = String(sessionOptions.preLaunchCmd);
        if (/[\r\n]/.test(pre)) {
          return { ok: false, error: 'preLaunchCmd must not contain newlines' };
        }
        claudeCmd = pre + ' ' + claudeCmd;
      }

      // Start MCP server for this session so Claude CLI sends diffs/file opens to Switchboard
      // (skip if user disabled IDE emulation in global settings)
      if (sessionOptions?.mcpEmulation !== false) {
        try {
          mcpServer = await startMcpServer(sessionId, [projectPath], mainWindow, log);
          claudeCmd += ' --ide';
        } catch (err) {
          log.error(`[mcp] Failed to start MCP server for ${sessionId}: ${err.message}`);
        }
      }

      const ptyEnv = {
        ...cleanPtyEnv,
        TERM: 'xterm-256color', COLORTERM: 'truecolor',
        TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.6.6', FORCE_COLOR: '3', ITERM_SESSION_ID: '1',
      };
      if (mcpServer) {
        ptyEnv.CLAUDE_CODE_SSE_PORT = String(mcpServer.port);
      }

      ptyProcess = pty.spawn(shell, shellArgs(shell, claudeCmd, shellExtraArgs), {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: isWsl ? os.homedir() : projectPath,
        // TERM_PROGRAM=iTerm.app: Claude Code checks this to decide whether to emit
        // OSC 9 notifications (e.g. "needs your attention"). Without it, the packaged
        // app's minimal Electron environment won't trigger those sequences.
        env: ptyEnv,
      });

    }
  } catch (err) {
    return { ok: false, error: `Error spawning PTY: ${err.message}` };
  }

  const session = {
    pty: ptyProcess, rendererAttached: true, exited: false,
    outputBuffer: [], outputBufferSize: 0, altScreen: false,
    projectPath, firstResize: true,
    projectFolder, knownJsonlFiles, sessionSlug,
    isPlainTerminal, forkFrom: sessionOptions?.forkFrom || null,
    mcpServer, _openedAt: Date.now(),
  };
  activeSessions.set(sessionId, session);

  ptyProcess.onData(data => {
    const currentId = session.realSessionId || sessionId;

    // Parse OSC sequences (title changes, progress, notifications, etc.)
    if (data.includes('\x1b]')) {
      const oscMatches = data.matchAll(/\x1b\](\d+);([^\x07\x1b]*)(?:\x07|\x1b\\)/g);
      for (const m of oscMatches) {
        const code = m[1];
        const payload = m[2].slice(0, 120);
        // Detect Claude CLI busy state from OSC 0 title (spinner chars = busy, ✳ = idle)
        if (code === '0') {
          const firstChar = payload.charAt(0);
          const isBusy = firstChar.charCodeAt(0) >= 0x2800 && firstChar.charCodeAt(0) <= 0x28FF;
          const isIdle = firstChar === '\u2733'; // ✳
          log.debug(`[OSC 0] session=${currentId} char=U+${firstChar.charCodeAt(0).toString(16).toUpperCase()} busy=${isBusy} idle=${isIdle} wasBusy=${!!session._cliBusy}`);
          if (isBusy && !session._cliBusy) {
            session._cliBusy = true;
            session._oscIdle = false;
            log.debug(`[OSC 0] session=${currentId} → BUSY`);
            safeSend('cli-busy-state', currentId, true);
          } else if (isIdle && session._cliBusy) {
            session._cliBusy = false;
            session._oscIdle = true;
            log.debug(`[OSC 0] session=${currentId} → IDLE`);
            safeSend('cli-busy-state', currentId, false);
          }
        }
      }
      // Parse iTerm2 OSC 9 sequences (terminated by BEL \x07 or ST \x1b\\)
      const osc9Matches = data.matchAll(/\x1b\]9;([^\x07\x1b]*)(?:\x07|\x1b\\)/g);
      for (const osc9 of osc9Matches) {
        const payload = osc9[1];
        // OSC 9;4 progress: 4;0; = clear/done, 4;1;N = running at N%, 4;2;N = error, 4;3; = indeterminate
        if (payload.startsWith('4;')) {
          const level = payload.split(';')[1];
          if (level === '0') continue; // 4;0 is also used for clearing, making it unreliable as an idle signal
          log.debug(`[OSC 9;4] session=${currentId} level=${level} payload="${payload}" wasBusy=${!!session._cliBusy}`);
          if ((level === '1' || level === '2' || level === '3') && !session._cliBusy) {
            session._cliBusy = true;
            session._oscIdle = false;
            log.debug(`[OSC 9;4] session=${currentId} → BUSY`);
            safeSend('cli-busy-state', currentId, true);
          }
        } else {
          // Regular notification (attention, permission, etc.)
          log.info(`[OSC 9] session=${currentId} message="${payload}"`);
          safeSend('terminal-notification', currentId, payload);
        }
      }
    }

    // Standalone BEL (not part of an OSC sequence)
    if (data.includes('\x07') && !data.includes('\x1b]')) {
      log.info(`[BEL] session=${currentId}`);
    }

    // Track alternate screen mode (only if data contains the marker)
    if (data.includes('\x1b[?')) {
      if (data.includes('\x1b[?1049h') || data.includes('\x1b[?47h')) {
        session.altScreen = true;
        log.info(`[altscreen] session=${currentId} ON`);
      }
      if (data.includes('\x1b[?1049l') || data.includes('\x1b[?47l')) {
        session.altScreen = false;
        log.info(`[altscreen] session=${currentId} OFF`);
      }
    }

    // Buffer output (skip resize-triggered redraws for plain terminals)
    if (!session._suppressBuffer) {
      session.outputBuffer.push(data);
      session.outputBufferSize += data.length;
      while (session.outputBufferSize > MAX_BUFFER_SIZE && session.outputBuffer.length > 1) {
        session.outputBufferSize -= session.outputBuffer.shift().length;
      }
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      safeSendToSession(currentId, 'terminal-data', data);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    session.exited = true;
    // Clean up MCP server
    const mcpId = session.realSessionId || sessionId;
    shutdownMcpServer(mcpId);
    session.mcpServer = null;

    const realId = session.realSessionId || sessionId;
    safeSend('process-exited', realId, exitCode);
    if (realId !== sessionId && activeSessions.has(sessionId)) {
      safeSend('process-exited', sessionId, exitCode);
    }
    // Clean up any session JSONL activity watchers (B4: no watcher leak on exit).
    stopSessionFileWatcher(realId);
    stopSessionFileWatcher(sessionId);
    activeSessions.delete(realId);
    // Clean up the original key too in case transition detection hasn't run yet
    activeSessions.delete(sessionId);
  });

  if (sessionOptions?.forkFrom) {
    log.info(`[fork-spawn] tempId=${sessionId} forkFrom=${sessionOptions.forkFrom} folder=${projectFolder} knownFiles=${knownJsonlFiles.size}`);
  }

  return { ok: true, reattached: false, mcpActive: !!mcpServer };
});

// --- IPC: terminal-input (fire-and-forget) ---
ipcMain.on('terminal-input', (_event, sessionId, data) => {
  const session = activeSessions.get(sessionId);
  if (session && !session.exited) {
    session.pty.write(data);
  }
});

// --- IPC: terminal-resize (fire-and-forget) ---
ipcMain.on('terminal-resize', (_event, sessionId, cols, rows) => {
  const session = activeSessions.get(sessionId);
  if (session && !session.exited) {
    // For plain terminals, suppress buffering during resize to avoid
    // accumulating prompt redraws that pollute reattach replay
    if (session.isPlainTerminal) session._suppressBuffer = true;

    session.pty.resize(cols, rows);

    if (session.isPlainTerminal) {
      setTimeout(() => { session._suppressBuffer = false; }, 200);
    }

    // First resize: nudge to force TUI redraw on reattach (skip for plain terminals — causes duplicate prompts)
    if (session.firstResize && !session.isPlainTerminal) {
      session.firstResize = false;
      setTimeout(() => {
        try {
          session.pty.resize(cols + 1, rows);
          setTimeout(() => {
            try { session.pty.resize(cols, rows); } catch {}
          }, 50);
        } catch {}
      }, 50);
    }
  }
});

// --- IPC: close-terminal ---
ipcMain.on('close-terminal', (_event, sessionId) => {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.rendererAttached = false;
    if (session.exited) {
      activeSessions.delete(sessionId);
    }
  }
});

// Session transitions → session-transitions.js
const sessionTransitions = require('./session-transitions');
sessionTransitions.init({ PROJECTS_DIR, activeSessions, getMainWindow: () => mainWindow, log, rekeyMcpServer });
const { detectSessionTransitions } = sessionTransitions;

// --- fs.watch on projects directory ---
let projectsWatcher = null;

function startProjectsWatcher() {
  if (!fs.existsSync(PROJECTS_DIR)) return;

  const pendingFolders = new Set();
  let debounceTimer = null;

  function flushChanges() {
    debounceTimer = null;
    const folders = new Set(pendingFolders);
    pendingFolders.clear();

    let changed = false;
    for (const folder of folders) {
      const folderPath = path.join(PROJECTS_DIR, folder);
      if (fs.existsSync(folderPath)) {
        detectSessionTransitions(folder);
        refreshFolder(folder);
      } else {
        deleteCachedFolder(folder);
      }
      changed = true;
    }

    if (changed) {
      notifyRendererProjectsChanged();
    }
  }

  try {
    projectsWatcher = fs.watch(PROJECTS_DIR, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;

      // filename is relative, e.g. "folder-name/sessions-index.json" or "folder-name/abc.jsonl"
      const parts = filename.split(path.sep);
      const folder = parts[0];
      if (!folder || folder === '.git') return;

      // Only care about .jsonl changes or top-level folder add/remove
      const basename = parts[parts.length - 1];
      if (parts.length === 1) {
        pendingFolders.add(folder);
      } else if (basename.endsWith('.jsonl')) {
        pendingFolders.add(folder);
      } else {
        return;
      }

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(flushChanges, 500);
    });

    projectsWatcher.on('error', (err) => {
      console.error('Projects watcher error:', err);
    });
  } catch (err) {
    console.error('Failed to start projects watcher:', err);
  }
}

// --- IPC: app version ---
ipcMain.handle('get-app-version', () => app.getVersion());

// --- IPC: auto-updater ---
ipcMain.handle('updater-check', () => {
  if (!autoUpdater) return { available: false, dev: true };
  return autoUpdater.checkForUpdates();
});
ipcMain.handle('updater-download', () => {
  if (!autoUpdater) return;
  return autoUpdater.downloadUpdate();
});
ipcMain.handle('updater-install', () => {
  if (!autoUpdater) return;
  autoUpdater.quitAndInstall();
});

// --- App lifecycle ---
// Prevent a second Electron instance from killing active PTY sessions.
// This happens when the user replaces the AppImage while Switchboard is running:
// the OS spawns the new binary, which would otherwise initialise a second process
// and leave the first one's node-pty sessions orphaned or killed.
// requestSingleInstanceLock ensures only one instance runs at a time. The second
// launch quits immediately; the first brings its window to the front.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  // Focus the existing window when a second launch is attempted.
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    buildMenu();
    createWindow();
    startProjectsWatcher();
    scheduleIpc.ensureScheduleCreatorCommand();

    // Shared runCommand for cron scheduler and "run now" — takes argv, not a shell string
    const { spawn: cpSpawn } = require('child_process');
    function runScheduleCommand(claudeArgv, cwd, name, onDone) {
      const globalSettings = getSetting('global') || {};
      const profileId = globalSettings.shellProfile || SETTING_DEFAULTS.shellProfile;
      const profile = resolveShell(profileId);
      const shell = profile.path;
      const cmd = 'claude ' + quoteArgvForShell(shell, claudeArgv);
      const args = shellArgs(shell, cmd, profile.args || []);

      log.info(`[schedule] Running: ${shell} ${args.join(' ')}`);
      const child = cpSpawn(shell, args, {
        cwd,
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...cleanPtyEnv, FORCE_COLOR: '0' },
      });

      let stderr = '';
      child.stderr.on('data', (data) => { stderr += data.toString(); });

      child.on('exit', (code) => {
        if (stderr.trim()) log.error(`[schedule] ${name} stderr:\n${stderr.trim()}`);
        log.info(`[schedule] ${name} finished (exit ${code})`);
        if (onDone) onDone();
      });

      child.on('error', (err) => {
        log.error(`[schedule] ${name} error:`, err.message);
        if (onDone) onDone();
      });
    }

    scheduleIpc.init(log, runScheduleCommand);
    startScheduler(log, runScheduleCommand);

    // Re-index search if FTS table was recreated (e.g. tokenizer config change)
    if (searchFtsRecreated) populateCacheViaWorker();

    // Check for updates after launch
    if (autoUpdater) {
      setTimeout(() => autoUpdater.checkForUpdates().catch(e => log.error('[updater] check failed:', e?.message || String(e))), 5000);
      // Re-check every 4 hours for long-running sessions
      setInterval(() => autoUpdater.checkForUpdates().catch(e => log.error('[updater] check failed:', e?.message || String(e))), 4 * 60 * 60 * 1000);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }); // end app.whenReady
} // end gotSingleInstanceLock else-branch

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // Shut down all MCP servers
  shutdownAllMcp();

  // Close filesystem watcher
  if (projectsWatcher) {
    projectsWatcher.close();
    projectsWatcher = null;
  }

  // Kill all PTY processes on quit
  for (const [, session] of activeSessions) {
    if (!session.exited) {
      try { session.pty.kill(); } catch {}
    }
  }
});

// Close SQLite after all windows are closed to avoid "connection is not open" errors
app.on('will-quit', () => {
  closeDb();
});
