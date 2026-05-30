const { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell } = require('electron');
const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const os = require('os');
const pty = require('node-pty');
const log = require('electron-log');
// getFolderIndexMtimeMs moved to session-cache.js
const { startMcpServer, shutdownMcpServer, shutdownAll: shutdownAllMcp, resolvePendingDiff, rekeyMcpServer, cleanStaleLockFiles } = require('./mcp-bridge');
const { fetchAndTransformUsage } = require('./claude-auth');
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
const { discoverShellProfiles, getShellProfiles, resolveShell, isWindows, isWslShell, windowsToWslPath, shellArgs } = require('./shell-profiles');
const { startScheduler } = require('./schedule-runner');
const { encodeProjectPath } = require('./encode-project-path');

// --- Git status cache — avoids repeated `git status` calls across the same project ---
const gitStatusCache = new Map(); // projectPath -> { data, timestamp }
const GIT_CACHE_TTL = 60_000; // 60 seconds

// Agent history scan cache — avoids full filesystem walks on every IPC call
const agentScanCache = new Map(); // agentId -> { sessions, timestamp }
const AGENT_SCAN_CACHE_TTL = 30_000; // 30 seconds
const AGENT_SCAN_CACHE_MAX = 50; // cap total entries

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
const MAX_BUFFER_SIZE = 256 * 1024;

// --- Git status discovery (async) with cache eviction ---
async function getCachedGitStatus(projectPath, forceRefresh = false) {
  if (!projectPath || typeof projectPath !== 'string') return { status: null, branch: null, error: true };
  const now = Date.now();
  const cached = gitStatusCache.get(projectPath);
  if (cached && !forceRefresh && (now - cached.timestamp) < GIT_CACHE_TTL) {
    return cached.data;
  }
  try {
    const { execFileSync } = require('child_process');
    const branch = execFileSync('git', ['branch', '--show-current'], { cwd: projectPath, timeout: 5000, encoding: 'utf8' }).trim();
    let status = null;
    try {
      const porcelain = execFileSync('git', ['status', '--porcelain'], { cwd: projectPath, timeout: 5000, encoding: 'utf8' });
      if (porcelain.length > 0) {
        // Check for staged/unstaged changes
        const lines = porcelain.split('\n').filter(Boolean);
        const hasStaged = lines.some(l => l.startsWith('M') || l.startsWith('A') || l.startsWith('D') || l.startsWith('R'));
        const hasUnstaged = lines.some(l => l[1] === 'M' || l[1] === 'D' || porcelain.includes('??'));
        // Check for ahead/behind
        try {
          const branchStatus = execFileSync('git', ['status', '--short', '-b'], { cwd: projectPath, timeout: 5000, encoding: 'utf8' });
          if (branchStatus.includes('ahead') && (branchStatus.includes('behind') || branchStatus.includes('ahead') && !branchStatus.includes('up-to-date'))) {
            status = branchStatus.includes('behind') ? 'diverged' : 'ahead';
          } else if (branchStatus.includes('behind')) {
            status = 'behind';
          } else if (hasStaged || hasUnstaged) {
            status = 'dirty';
          } else {
            status = 'current';
          }
        } catch {
          status = hasStaged ? 'dirty' : 'uncommitted';
        }
      } else {
        status = 'current';
      }
    } catch {
      status = null;
    }
    const data = { status, branch, error: false };
    gitStatusCache.set(projectPath, { data, timestamp: now });
    return data;
  } catch (err) {
    // Not a git repo or git not available
    const data = { status: null, branch: null, error: true };
    gitStatusCache.set(projectPath, { data, timestamp: now });
    return data;
  }
}

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
const { readSessionFile, readFolderFromFilesystem, refreshFolder, populateCacheFromFilesystem,
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

// --- IPC: MCP bridge ---
ipcMain.on('mcp-diff-response', (_event, sessionId, diffId, action, editedContent) => {
  resolvePendingDiff(sessionId, diffId, action, editedContent);
});

ipcMain.handle('read-file-for-panel', async (_event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return { ok: true, content };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('save-file-for-panel', async (_event, filePath, content) => {
  try {
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

ipcMain.handle('get-projects', (_event, showArchived) => {
  try {
    const needsPopulate = !isCachePopulated() || !isSearchIndexPopulated();

    if (needsPopulate) {
      populateCacheViaWorker();
      return [];
    }

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
        const shortName = projectPath
          ? projectPath.split('/').filter(Boolean).slice(-2).join('/')
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

ipcMain.handle('set-setting', (_event, key, value) => {
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
};

// Session history discovery per agent
const AGENT_HISTORY = {
  claude: {
    historyDir: () => path.join(os.homedir(), '.claude'),
    getSessions: () => {
      const baseDir = path.join(os.homedir(), '.claude', 'projects');
      const sessions = [];
      if (!fs.existsSync(baseDir)) return sessions;
      for (const projectDir of fs.readdirSync(baseDir)) {
        const projPath = path.join(baseDir, projectDir);
        try {
          const stat = fs.statSync(projPath);
          if (!stat.isDirectory()) continue;
          for (const file of fs.readdirSync(projPath)) {
            if (!file.endsWith('.jsonl')) continue;
            const fp = path.join(projPath, file);
            const fstat = fs.statSync(fp);
            sessions.push({
              id: file.replace('.jsonl', ''),
              file: fp,
              project: projectDir,
              modified: fstat.mtime,
              size: fstat.size,
              agent: 'claude',
            });
          }
        } catch {}
      }
      return sessions;
    },
    parseSession: (filePath) => {
      try {
        const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
        let userMsgs = 0, assistantMsgs = 0, toolUses = 0;
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.type === 'human' || obj.role === 'user') userMsgs++;
            else if (obj.type === 'assistant' || obj.role === 'assistant') assistantMsgs++;
            if (obj.type === 'tool_use' || obj.type === 'tool_result') toolUses++;
          } catch {}
        }
        return { userMessages: userMsgs, assistantMessages: assistantMsgs, toolUses, totalLines: lines.length };
      } catch { return null; }
    },
  },
  codex: {
    historyDir: () => path.join(os.homedir(), '.codex'),
    getSessions: () => {
      const baseDir = path.join(os.homedir(), '.codex', 'sessions');
      const sessions = [];
      if (!fs.existsSync(baseDir)) return sessions;
      function walk(dir) {
        try {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fp = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(fp);
            else if (entry.name.endsWith('.jsonl')) {
              const fstat = fs.statSync(fp);
              const idMatch = entry.name.match(/([0-9a-f-]{36})/);
              sessions.push({
                id: idMatch ? idMatch[1] : entry.name.replace('.jsonl', ''),
                file: fp,
                modified: fstat.mtime,
                size: fstat.size,
                agent: 'codex',
              });
            }
          }
        } catch {}
      }
      walk(baseDir);
      return sessions;
    },
    parseSession: (filePath) => {
      try {
        const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
        let userMsgs = 0, assistantMsgs = 0, model = null, cwd = null;
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.type === 'session_meta' && obj.payload) {
              model = obj.payload.model_provider;
              cwd = obj.payload.cwd;
            }
            if (obj.type === 'response_item' && obj.payload?.role === 'developer') userMsgs++;
            if (obj.type === 'response_item' && obj.payload?.role === 'assistant') assistantMsgs++;
          } catch {}
        }
        return { userMessages: userMsgs, assistantMessages: assistantMsgs, model, cwd, totalLines: lines.length };
      } catch { return null; }
    },
  },
  qwen: {
    historyDir: () => path.join(os.homedir(), '.qwen'),
    getSessions: () => {
      const baseDir = path.join(os.homedir(), '.qwen', 'projects');
      const sessions = [];
      if (!fs.existsSync(baseDir)) return sessions;
      for (const projectDir of fs.readdirSync(baseDir)) {
        const chatsDir = path.join(baseDir, projectDir, 'chats');
        try {
          if (!fs.existsSync(chatsDir) || !fs.statSync(chatsDir).isDirectory()) continue;
          for (const file of fs.readdirSync(chatsDir)) {
            if (!file.endsWith('.jsonl')) continue;
            const fp = path.join(chatsDir, file);
            const fstat = fs.statSync(fp);
            sessions.push({
              id: file.replace('.jsonl', ''),
              file: fp,
              project: projectDir,
              modified: fstat.mtime,
              size: fstat.size,
              agent: 'qwen',
            });
          }
        } catch {}
      }
      return sessions;
    },
    parseSession: (filePath) => {
      try {
        const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
        let userMsgs = 0, assistantMsgs = 0, toolUses = 0;
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.type === 'user') userMsgs++;
            else if (obj.type === 'assistant') assistantMsgs++;
            if (obj.message?.parts) {
              for (const part of obj.message.parts) {
                if (part.functionCall) toolUses++;
              }
            }
          } catch {}
        }
        return { userMessages: userMsgs, assistantMessages: assistantMsgs, toolUses, totalLines: lines.length };
      } catch { return null; }
    },
  },
  gemini: {
    historyDir: () => path.join(os.homedir(), '.gemini'),
    getSessions: () => {
      const baseDir = path.join(os.homedir(), '.gemini', 'tmp');
      const sessions = [];
      if (!fs.existsSync(baseDir)) return sessions;
      for (const projectDir of fs.readdirSync(baseDir)) {
        const chatsDir = path.join(baseDir, projectDir, 'chats');
        try {
          if (!fs.existsSync(chatsDir) || !fs.statSync(chatsDir).isDirectory()) continue;
          for (const file of fs.readdirSync(chatsDir)) {
            if (!file.startsWith('session-')) continue;
            if (!file.endsWith('.json') && !file.endsWith('.jsonl')) continue;
            const fp = path.join(chatsDir, file);
            const fstat = fs.statSync(fp);
            const idMatch = file.match(/session-([0-9a-f-]{36})/);
            sessions.push({
              id: idMatch ? idMatch[1] : file.replace(/\.(json|jsonl)$/, ''),
              file: fp,
              project: projectDir,
              modified: fstat.mtime,
              size: fstat.size,
              agent: 'gemini',
              format: file.endsWith('.jsonl') ? 'jsonl' : 'json',
            });
          }
        } catch {}
      }
      return sessions;
    },
    parseSession: (filePath) => {
      try {
        const isJsonl = filePath.endsWith('.jsonl');
        let userMsgs = 0, assistantMsgs = 0, toolUses = 0, totalLines = 0;
        if (isJsonl) {
          const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
          totalLines = lines.length;
          for (const line of lines) {
            try {
              const obj = JSON.parse(line);
              if (obj.type === 'user') userMsgs++;
              else if (obj.type === 'gemini' || obj.type === 'assistant') assistantMsgs++;
            } catch {}
          }
        } else {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          const messages = data.messages || data.history || (Array.isArray(data) ? data : []);
          totalLines = messages.length;
          for (const msg of messages) {
            if (msg.role === 'user') userMsgs++;
            else if (msg.role === 'model' || msg.role === 'assistant') assistantMsgs++;
            if (msg.parts) {
              for (const part of msg.parts) {
                if (part.functionCall) toolUses++;
              }
            }
          }
        }
        return { userMessages: userMsgs, assistantMessages: assistantMsgs, toolUses, totalLines };
      } catch { return null; }
    },
  },
  kimi: {
    historyDir: () => path.join(os.homedir(), '.kimi'),
    getSessions: () => {
      const baseDir = path.join(os.homedir(), '.kimi', 'sessions');
      const sessions = [];
      if (!fs.existsSync(baseDir)) return sessions;
      function walk(dir) {
        try {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fp = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              const ctxFile = path.join(fp, 'context.jsonl');
              if (fs.existsSync(ctxFile)) {
                const fstat = fs.statSync(ctxFile);
                sessions.push({
                  id: entry.name,
                  file: ctxFile,
                  modified: fstat.mtime,
                  size: fstat.size,
                  agent: 'kimi',
                });
              } else {
                walk(fp);
              }
            }
          }
        } catch {}
      }
      walk(baseDir);
      return sessions;
    },
    parseSession: (filePath) => {
      try {
        const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
        let userMsgs = 0, assistantMsgs = 0, toolUses = 0;
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.role === 'user') userMsgs++;
            else if (obj.role === 'assistant') assistantMsgs++;
            else if (obj.role === 'tool') toolUses++;
          } catch {}
        }
        return { userMessages: userMsgs, assistantMessages: assistantMsgs, toolUses, totalLines: lines.length };
      } catch { return null; }
    },
  },
  aider: {
    historyDir: () => null,
    getSessions: () => {
      const sessions = [];
      try {
        const allCached = getAllCached();
        const projectPaths = new Set();
        for (const s of allCached) {
          if (s.projectPath) projectPaths.add(s.projectPath);
        }
        for (const projPath of projectPaths) {
          const histFile = path.join(projPath, '.aider.chat.history.md');
          if (fs.existsSync(histFile)) {
            const fstat = fs.statSync(histFile);
            sessions.push({
              id: projPath.replace(/[/\\]/g, '-'),
              file: histFile,
              project: path.basename(projPath),
              modified: fstat.mtime,
              size: fstat.size,
              agent: 'aider',
            });
          }
        }
      } catch {}
      return sessions;
    },
    parseSession: (filePath) => {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const userMsgs = (content.match(/^####\s/gm) || []).length;
        const assistantMsgs = userMsgs;
        const totalLines = content.split('\n').length;
        return { userMessages: userMsgs, assistantMessages: assistantMsgs, toolUses: 0, totalLines };
      } catch { return null; }
    },
  },
  opencode: {
    historyDir: () => path.join(os.homedir(), '.local', 'share', 'opencode'),
    getSessions: () => {
      const dbPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
      const sessions = [];
      if (!fs.existsSync(dbPath)) return sessions;
      try {
        const Database = require('better-sqlite3');
        const ocDb = new Database(dbPath, { readonly: true });
        const rows = ocDb.prepare('SELECT id, title, directory, time_created, time_updated FROM session ORDER BY time_updated DESC').all();
        for (const row of rows) {
          sessions.push({
            id: row.id,
            file: dbPath,
            project: row.directory ? path.basename(row.directory) : '',
            modified: new Date(row.time_updated),
            size: 0,
            agent: 'opencode',
            title: row.title,
          });
        }
        ocDb.close();
      } catch {}
      return sessions;
    },
    parseSession: (filePath, sessionId) => {
      try {
        const Database = require('better-sqlite3');
        const ocDb = new Database(filePath, { readonly: true });
        const msgs = ocDb.prepare("SELECT json_extract(data, '$.role') as role FROM message WHERE session_id = ?").all(sessionId);
        let userMsgs = 0, assistantMsgs = 0;
        for (const m of msgs) {
          if (m.role === 'user') userMsgs++;
          else if (m.role === 'assistant') assistantMsgs++;
        }
        const toolParts = ocDb.prepare("SELECT count(*) as cnt FROM part WHERE session_id = ? AND json_extract(data, '$.type') IN ('tool-call', 'tool-result')").get(sessionId);
        ocDb.close();
        return { userMessages: userMsgs, assistantMessages: assistantMsgs, toolUses: toolParts?.cnt || 0, totalLines: msgs.length };
      } catch { return null; }
    },
  },
  hermes: {
    historyDir: () => path.join(os.homedir(), '.hermes'),
    getSessions: () => {
      const baseDir = path.join(os.homedir(), '.hermes', 'sessions');
      const sessions = [];
      if (!fs.existsSync(baseDir)) return sessions;
      try {
        for (const file of fs.readdirSync(baseDir)) {
          if (!file.endsWith('.jsonl')) continue;
          const fp = path.join(baseDir, file);
          const fstat = fs.statSync(fp);
          const dateMatch = file.match(/^(\d{8})_(\d{6})/);
          sessions.push({
            id: file.replace('.jsonl', ''),
            file: fp,
            modified: fstat.mtime,
            size: fstat.size,
            agent: 'hermes',
            date: dateMatch ? `${dateMatch[1].slice(0,4)}-${dateMatch[1].slice(4,6)}-${dateMatch[1].slice(6,8)}` : null,
          });
        }
      } catch {}
      return sessions;
    },
    parseSession: (filePath) => {
      try {
        const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
        let userMsgs = 0, assistantMsgs = 0, toolUses = 0;
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.role === 'user') userMsgs++;
            else if (obj.role === 'assistant') assistantMsgs++;
            else if (obj.role === 'tool') toolUses++;
          } catch {}
        }
        return { userMessages: userMsgs, assistantMessages: assistantMsgs, toolUses, totalLines: lines.length };
      } catch { return null; }
    },
  },
  amp: {
    historyDir: () => path.join(os.homedir(), '.amp'),
    getSessions: () => {
      const baseDir = path.join(os.homedir(), '.amp', 'sessions');
      const sessions = [];
      if (!fs.existsSync(baseDir)) return sessions;
      try {
        for (const file of fs.readdirSync(baseDir)) {
          if (!file.endsWith('.jsonl')) continue;
          const fp = path.join(baseDir, file);
          const fstat = fs.statSync(fp);
          sessions.push({
            id: file.replace('.jsonl', ''),
            file: fp,
            modified: fstat.mtime,
            size: fstat.size,
            agent: 'amp',
          });
        }
      } catch {}
      return sessions;
    },
    parseSession: (filePath) => {
      try {
        const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
        let userMsgs = 0, assistantMsgs = 0, toolUses = 0;
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.role === 'user' || obj.type === 'human') userMsgs++;
            else if (obj.role === 'assistant' || obj.type === 'ai') assistantMsgs++;
            if (obj.type === 'tool_use' || obj.type === 'tool') toolUses++;
          } catch {}
        }
        return { userMessages: userMsgs, assistantMessages: assistantMsgs, toolUses, totalLines: lines.length };
      } catch { return null; }
    },
  },
  goose: {
    historyDir: () => path.join(os.homedir(), '.goose'),
    getSessions: () => {
      const baseDir = path.join(os.homedir(), '.goose', 'sessions');
      const sessions = [];
      if (!fs.existsSync(baseDir)) return sessions;
      try {
        for (const file of fs.readdirSync(baseDir)) {
          if (!file.endsWith('.jsonl')) continue;
          const fp = path.join(baseDir, file);
          const fstat = fs.statSync(fp);
          sessions.push({
            id: file.replace('.jsonl', ''),
            file: fp,
            modified: fstat.mtime,
            size: fstat.size,
            agent: 'goose',
          });
        }
      } catch {}
      return sessions;
    },
    parseSession: (filePath) => {
      try {
        const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
        let userMsgs = 0, assistantMsgs = 0, toolUses = 0;
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.role === 'user') userMsgs++;
            else if (obj.role === 'assistant') assistantMsgs++;
            if (obj.tools || obj.tool_calls) toolUses++;
          } catch {}
        }
        return { userMessages: userMsgs, assistantMessages: assistantMsgs, toolUses, totalLines: lines.length };
      } catch { return null; }
    },
  },
  continue: {
    historyDir: () => path.join(os.homedir(), '.continue'),
    getSessions: () => {
      const baseDir = path.join(os.homedir(), '.continue', 'sessions');
      const sessions = [];
      if (!fs.existsSync(baseDir)) return sessions;
      try {
        for (const file of fs.readdirSync(baseDir)) {
          if (!file.endsWith('.jsonl')) continue;
          const fp = path.join(baseDir, file);
          const fstat = fs.statSync(fp);
          sessions.push({
            id: file.replace('.jsonl', ''),
            file: fp,
            modified: fstat.mtime,
            size: fstat.size,
            agent: 'continue',
          });
        }
      } catch {}
      return sessions;
    },
    parseSession: (filePath) => {
      try {
        const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
        let userMsgs = 0, assistantMsgs = 0, toolUses = 0;
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.role === 'user' || obj.role === 'human') userMsgs++;
            else if (obj.role === 'assistant' || obj.role === 'ai') assistantMsgs++;
            if (obj.tools || obj.tool_calls) toolUses++;
          } catch {}
        }
        return { userMessages: userMsgs, assistantMessages: assistantMsgs, toolUses, totalLines: lines.length };
      } catch { return null; }
    },
  },
  cursor: {
    historyDir: () => path.join(os.homedir(), '.cursor'),
    getSessions: () => {
      const baseDir = path.join(os.homedir(), '.cursor', 'cli-sessions');
      const sessions = [];
      if (!fs.existsSync(baseDir)) return sessions;
      try {
        for (const file of fs.readdirSync(baseDir)) {
          if (!file.endsWith('.jsonl')) continue;
          const fp = path.join(baseDir, file);
          const fstat = fs.statSync(fp);
          sessions.push({
            id: file.replace('.jsonl', ''),
            file: fp,
            modified: fstat.mtime,
            size: fstat.size,
            agent: 'cursor',
          });
        }
      } catch {}
      return sessions;
    },
    parseSession: (filePath) => {
      try {
        const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
        let userMsgs = 0, assistantMsgs = 0, toolUses = 0;
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.role === 'user') userMsgs++;
            else if (obj.role === 'assistant') assistantMsgs++;
            if (obj.type === 'tool_use') toolUses++;
          } catch {}
        }
        return { userMessages: userMsgs, assistantMessages: assistantMsgs, toolUses, totalLines: lines.length };
      } catch { return null; }
    },
  },
  cline: {
    historyDir: () => path.join(os.homedir(), '.cline'),
    getSessions: () => {
      const baseDir = path.join(os.homedir(), '.cline', 'history');
      const sessions = [];
      if (!fs.existsSync(baseDir)) return sessions;
      try {
        for (const file of fs.readdirSync(baseDir)) {
          if (!file.endsWith('.jsonl')) continue;
          const fp = path.join(baseDir, file);
          const fstat = fs.statSync(fp);
          sessions.push({
            id: file.replace('.jsonl', ''),
            file: fp,
            modified: fstat.mtime,
            size: fstat.size,
            agent: 'cline',
          });
        }
      } catch {}
      return sessions;
    },
    parseSession: (filePath) => {
      try {
        const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
        let userMsgs = 0, assistantMsgs = 0, toolUses = 0;
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.role === 'user' || obj.author === 'user') userMsgs++;
            else if (obj.role === 'assistant' || obj.author === 'assistant') assistantMsgs++;
            if (obj.tool_calls || obj.tools) toolUses++;
          } catch {}
        }
        return { userMessages: userMsgs, assistantMessages: assistantMsgs, toolUses, totalLines: lines.length };
      } catch { return null; }
    },
  },
};

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
    } catch {
      stats[agentId] = { name: CLI_AGENTS[agentId]?.name || agentId, error: true };
    }
  }
  return stats;
});

ipcMain.handle('detect-agents', () => {
  const { execFileSync } = require('child_process');
  const results = {};
  for (const [id, agent] of Object.entries(CLI_AGENTS)) {
    let installed = false;
    try {
      execFileSync('which', [agent.cmd], { timeout: 2000, stdio: 'pipe' });
      installed = true;
    } catch {}
    results[id] = { ...agent, id, installed };
  }
  return results;
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
      // Build claude command with session options
      let claudeCmd;
      if (sessionOptions?.forkFrom) {
        claudeCmd = `claude --resume "${sessionOptions.forkFrom}" --fork-session`;
      } else if (isNew) {
        claudeCmd = `claude --session-id "${sessionId}"`;
      } else {
        claudeCmd = `claude --resume "${sessionId}"`;
      }

      if (sessionOptions) {
        if (sessionOptions.dangerouslySkipPermissions) {
          claudeCmd += ' --dangerously-skip-permissions';
        } else if (sessionOptions.permissionMode) {
          claudeCmd += ` --permission-mode "${sessionOptions.permissionMode}"`;
        }
        if (sessionOptions.worktree) {
          claudeCmd += ' --worktree';
          if (sessionOptions.worktreeName) {
            claudeCmd += ` "${sessionOptions.worktreeName}"`;
          }
        }
        if (sessionOptions.chrome) {
          claudeCmd += ' --chrome';
        }
        if (sessionOptions.addDirs) {
          const dirs = sessionOptions.addDirs.split(',').map(d => d.trim()).filter(Boolean);
          for (const dir of dirs) {
            claudeCmd += ` --add-dir "${dir}"`;
          }
        }
      }

      if (sessionOptions?.appendSystemPrompt) {
        // Write to a temp file and use shell substitution to avoid quoting issues
        const tmpPrompt = path.join(os.tmpdir(), `switchboard-prompt-${sessionId}.md`);
        fs.writeFileSync(tmpPrompt, sessionOptions.appendSystemPrompt);
        claudeCmd += ` --append-system-prompt "$(cat '${tmpPrompt}')"`;
      }

      if (sessionOptions?.preLaunchCmd) {
        claudeCmd = sessionOptions.preLaunchCmd + ' ' + claudeCmd;
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
app.whenReady().then(() => {
  buildMenu();
  createWindow();
  startProjectsWatcher();
  scheduleIpc.ensureScheduleCreatorCommand();

  // Shared runCommand for both cron scheduler and manual "run now"
  const { spawn: cpSpawn } = require('child_process');
  function runScheduleCommand(cmd, cwd, name, onDone) {
    const globalSettings = getSetting('global') || {};
    const profileId = globalSettings.shellProfile || SETTING_DEFAULTS.shellProfile;
    const profile = resolveShell(profileId);
    const shell = profile.path;
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
});

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
