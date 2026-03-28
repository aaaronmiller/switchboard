const { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell } = require('electron');
const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const os = require('os');
const pty = require('node-pty');
const log = require('electron-log');
const { getFolderIndexMtimeMs } = require('./folder-index-state');
const { startMcpServer, shutdownMcpServer, shutdownAll: shutdownAllMcp, resolvePendingDiff, rekeyMcpServer, cleanStaleLockFiles } = require('./mcp-bridge');
const { fetchAndTransformUsage } = require('./claude-auth');
log.transports.file.level = app.isPackaged ? 'info' : 'debug';
log.transports.console.level = app.isPackaged ? 'info' : 'debug';

try { require('electron-reloader')(module, { watchRenderer: true }); } catch {};

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

// --- Cross-platform shell resolution ---
const isWindows = process.platform === 'win32';

// Discover available shell profiles on this system.
// Returns an array of { id, name, path, args? } objects.
function discoverShellProfiles() {
  const profiles = [];

  if (isWindows) {
    const { execSync } = require('child_process');

    // CMD
    const comspec = process.env.COMSPEC || 'C:\\WINDOWS\\system32\\cmd.exe';
    if (fs.existsSync(comspec)) {
      profiles.push({ id: 'cmd', name: 'Command Prompt', path: comspec });
    }

    // PowerShell 7+ (pwsh)
    const pwshCandidates = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7-preview', 'pwsh.exe'),
    ];
    for (const p of pwshCandidates) {
      if (fs.existsSync(p)) {
        profiles.push({ id: 'pwsh', name: 'PowerShell 7', path: p });
        break;
      }
    }

    // Windows PowerShell 5.x
    const ps5 = path.join(process.env.SystemRoot || 'C:\\WINDOWS', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (fs.existsSync(ps5)) {
      profiles.push({ id: 'powershell', name: 'Windows PowerShell', path: ps5 });
    }

    // Git Bash
    const gitBashCandidates = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
    ];
    for (const p of gitBashCandidates) {
      if (p && fs.existsSync(p)) {
        profiles.push({ id: 'git-bash', name: 'Git Bash', path: p });
        break;
      }
    }

    // MSYS2
    if (fs.existsSync('C:\\msys64\\usr\\bin\\bash.exe')) {
      profiles.push({ id: 'msys2', name: 'MSYS2', path: 'C:\\msys64\\usr\\bin\\bash.exe' });
    }

    // WSL distributions
    try {
      const raw = execSync('wsl.exe --list --quiet', { timeout: 5000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      const distros = raw.replace(/\0/g, '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      for (const distro of distros) {
        profiles.push({ id: 'wsl:' + distro, name: 'WSL — ' + distro, path: 'wsl.exe', args: ['-d', distro] });
      }
    } catch {}
  } else {
    // macOS / Linux: read /etc/shells for the canonical list
    const seen = new Set();
    const shellNames = {
      'zsh': 'Zsh', 'bash': 'Bash', 'sh': 'POSIX Shell',
      'fish': 'Fish', 'nu': 'Nushell', 'pwsh': 'PowerShell',
      'dash': 'Dash', 'ksh': 'Korn Shell', 'tcsh': 'tcsh', 'csh': 'C Shell',
    };
    try {
      const lines = fs.readFileSync('/etc/shells', 'utf8').split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'));
      for (const shellPath of lines) {
        if (!fs.existsSync(shellPath)) continue;
        const base = path.basename(shellPath);
        // Deduplicate by basename (e.g. /bin/bash and /usr/bin/bash)
        if (seen.has(base)) continue;
        seen.add(base);
        const name = shellNames[base] || base;
        profiles.push({ id: base, name, path: shellPath });
      }
    } catch {
      // Fallback if /etc/shells is unreadable
      for (const [id, name, p] of [
        ['zsh', 'Zsh', '/bin/zsh'],
        ['bash', 'Bash', '/bin/bash'],
        ['sh', 'POSIX Shell', '/bin/sh'],
      ]) {
        if (fs.existsSync(p)) {
          profiles.push({ id, name, path: p });
        }
      }
    }
  }

  return profiles;
}

// Cache profiles (discovered once on startup, refreshed via IPC if needed)
let _shellProfiles = null;
function getShellProfiles() {
  if (!_shellProfiles) _shellProfiles = discoverShellProfiles();
  return _shellProfiles;
}

function resolveShell(profileId) {
  // If a profile is selected, use it
  if (profileId && profileId !== 'auto') {
    const profiles = getShellProfiles();
    const profile = profiles.find(p => p.id === profileId);
    if (profile && (profile.path === 'wsl.exe' || fs.existsSync(profile.path))) {
      return profile;
    }
  }

  // Auto: original detection logic
  // 1. Respect explicit SHELL env (set by Git Bash, MSYS2, WSL, etc.)
  if (process.env.SHELL && fs.existsSync(process.env.SHELL)) {
    return { id: 'auto', name: 'Auto', path: process.env.SHELL };
  }

  if (isWindows) {
    // 2. Look for Git Bash in common locations
    const candidates = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
      'C:\\msys64\\usr\\bin\\bash.exe',
    ];
    for (const c of candidates) {
      if (c && fs.existsSync(c)) return { id: 'auto', name: 'Auto', path: c };
    }
    // 3. Fall back to PowerShell / cmd
    return { id: 'auto', name: 'Auto', path: process.env.COMSPEC || 'powershell.exe' };
  }

  // Unix fallback chain
  for (const s of ['/bin/zsh', '/bin/bash', '/bin/sh']) {
    if (fs.existsSync(s)) return { id: 'auto', name: 'Auto', path: s };
  }
  return { id: 'auto', name: 'Auto', path: '/bin/sh' };
}

// Convert a Windows path to a WSL /mnt/ path
function windowsToWslPath(winPath) {
  if (!winPath) return winPath;
  // C:\Users\foo → /mnt/c/Users/foo
  const normalized = winPath.replace(/\\/g, '/');
  const match = normalized.match(/^([A-Za-z]):(\/.*)/);
  if (match) return '/mnt/' + match[1].toLowerCase() + match[2];
  return normalized;
}

function isWslShell(shellPath) {
  const base = path.basename(shellPath).toLowerCase();
  return base === 'wsl.exe' || base === 'wsl';
}

// Returns spawn args appropriate for the resolved shell
function shellArgs(shellPath, cmd, extraArgs) {
  const base = path.basename(shellPath).toLowerCase();
  const isBashLike = base.includes('bash') || base.includes('zsh') || base === 'sh';

  // WSL: pass command via -- to the distribution shell
  // cwd is handled separately via --cd in the spawn call
  if (isWslShell(shellPath)) {
    if (cmd) return [...(extraArgs || []), '--', 'bash', '-l', '-i', '-c', cmd];
    return [...(extraArgs || []), '--', 'bash', '-l', '-i'];
  }

  if (cmd) {
    if (isBashLike) return ['-l', '-i', '-c', cmd];
    if (base.includes('powershell') || base.includes('pwsh')) return ['-NoLogo', '-Command', cmd];
    return ['/C', cmd];
  }
  if (isBashLike) return ['-l', '-i'];
  if (base.includes('powershell') || base.includes('pwsh')) return ['-NoLogo', '-NoExit'];
  return [];
}


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
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater-event', type, data);
    }
  }
  autoUpdater.on('checking-for-update', () => sendUpdaterEvent('checking'));
  autoUpdater.on('update-available', (info) => sendUpdaterEvent('update-available', info));
  autoUpdater.on('update-not-available', (info) => sendUpdaterEvent('update-not-available', info));
  autoUpdater.on('download-progress', (progress) => sendUpdaterEvent('download-progress', progress));
  autoUpdater.on('update-downloaded', (info) => sendUpdaterEvent('update-downloaded', info));
  autoUpdater.on('error', (err) => {
    log.error('[updater] Error:', err?.message || String(err));
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater-event', 'error', { message: err?.message || String(err) });
    }
  });
}
const {
  getAllMeta, toggleStar, setName, setArchived,
  isCachePopulated, getAllCached, getCachedByFolder, getCachedFolder, getCachedSession, upsertCachedSessions,
  deleteCachedSession, deleteCachedFolder,
  getFolderMeta, getAllFolderMeta, setFolderMeta,
  upsertSearchEntries, updateSearchTitle, deleteSearchSession, deleteSearchFolder, deleteSearchType,
  searchByType, isSearchIndexPopulated,
  getSetting, setSetting, deleteSetting,
  closeDb,
  // Peers broker
  peerRegister, peerHeartbeat, peerSetSummary, peerUnregister, peerUnregisterBySession,
  peerListAll, peerListByDir, peerListByRepo, peerGetById,
  peerSendMessage, peerPollMessages, peerCleanStale,
} = require('./db');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const PLANS_DIR = path.join(os.homedir(), '.claude', 'plans');
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const STATS_CACHE_PATH = path.join(CLAUDE_DIR, 'stats-cache.json');
const MAX_BUFFER_SIZE = 256 * 1024;

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

/** Derive the real project path by reading cwd from the first JSONL entry in the folder */
function deriveProjectPath(folderPath, folder) {
  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    // Check direct .jsonl files first
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.jsonl')) {
        const firstLine = fs.readFileSync(path.join(folderPath, e.name), 'utf8').split('\n')[0];
        if (firstLine) {
          const parsed = JSON.parse(firstLine);
          if (parsed.cwd) return parsed.cwd;
        }
      }
    }
    // Check session subdirectories (UUID folders with subagent .jsonl files)
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const subDir = path.join(folderPath, e.name);
      try {
        // Look for .jsonl directly in session dir or in subagents/
        const subFiles = fs.readdirSync(subDir, { withFileTypes: true });
        for (const sf of subFiles) {
          let jsonlPath;
          if (sf.isFile() && sf.name.endsWith('.jsonl')) {
            jsonlPath = path.join(subDir, sf.name);
          } else if (sf.isDirectory() && sf.name === 'subagents') {
            const agentFiles = fs.readdirSync(path.join(subDir, 'subagents')).filter(f => f.endsWith('.jsonl'));
            if (agentFiles.length > 0) jsonlPath = path.join(subDir, 'subagents', agentFiles[0]);
          }
          if (jsonlPath) {
            const firstLine = fs.readFileSync(jsonlPath, 'utf8').split('\n')[0];
            if (firstLine) {
              const parsed = JSON.parse(firstLine);
              if (parsed.cwd) return parsed.cwd;
            }
          }
        }
      } catch {}
    }
  } catch {}
  // No cwd found — return null so callers can skip this folder
  return null;
}

/** Parse a single .jsonl file into a session object (or null if invalid) */
function readSessionFile(filePath, folder, projectPath) {
  const sessionId = path.basename(filePath, '.jsonl');
  try {
    const stat = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    let summary = '';
    let messageCount = 0;
    let textContent = '';
    let slug = null;
    let customTitle = null;
    for (const line of lines) {
      const entry = JSON.parse(line);
      if (entry.slug && !slug) slug = entry.slug;
      if (entry.type === 'custom-title' && entry.customTitle) {
        customTitle = entry.customTitle;
      }
      if (entry.type === 'user' || entry.type === 'assistant' ||
          (entry.type === 'message' && (entry.role === 'user' || entry.role === 'assistant'))) {
        messageCount++;
      }
      const msg = entry.message;
      const text = typeof msg === 'string' ? msg :
        (typeof msg?.content === 'string' ? msg.content :
        (msg?.content?.[0]?.text || ''));
      if (!summary && (entry.type === 'user' || (entry.type === 'message' && entry.role === 'user'))) {
        if (text) summary = text.slice(0, 120);
      }
      if (text && textContent.length < 8000) {
        textContent += text.slice(0, 500) + '\n';
      }
    }
    if (!summary || messageCount < 1) return null;
    return {
      sessionId, folder, projectPath,
      summary, firstPrompt: summary,
      created: stat.birthtime.toISOString(),
      modified: stat.mtime.toISOString(),
      messageCount, textContent, slug, customTitle,
    };
  } catch {
    return null;
  }
}

/** Read one folder from filesystem by scanning .jsonl files directly */
function readFolderFromFilesystem(folder) {
  const folderPath = path.join(PROJECTS_DIR, folder);
  const projectPath = deriveProjectPath(folderPath, folder);
  if (!projectPath) return { projectPath: null, sessions: [] };
  const sessions = [];

  try {
    const jsonlFiles = fs.readdirSync(folderPath).filter(f => f.endsWith('.jsonl'));
    for (const file of jsonlFiles) {
      const s = readSessionFile(path.join(folderPath, file), folder, projectPath);
      if (s) sessions.push(s);
    }
  } catch {}

  return { projectPath, sessions };
}

/** Refresh a single folder incrementally: only re-read changed/new .jsonl files */
function refreshFolder(folder) {
  const folderPath = path.join(PROJECTS_DIR, folder);
  if (!fs.existsSync(folderPath)) {
    deleteCachedFolder(folder);
    return;
  }

  const projectPath = deriveProjectPath(folderPath, folder);
  if (!projectPath) {
    setFolderMeta(folder, null, getFolderIndexMtimeMs(folderPath));
    return;
  }

  // Get what's currently cached for this folder
  const cachedSessions = getCachedByFolder(folder);
  const cachedMap = new Map(); // sessionId → modified ISO string
  for (const row of cachedSessions) {
    cachedMap.set(row.sessionId, row.modified);
  }

  // Scan current .jsonl files
  let jsonlFiles;
  try {
    jsonlFiles = fs.readdirSync(folderPath).filter(f => f.endsWith('.jsonl'));
  } catch { return; }

  const currentIds = new Set();
  let changed = false;

  // Collect all changes first, then batch DB writes to minimize lock duration
  const sessionsToUpsert = [];
  const searchEntriesToUpsert = [];
  const namesToSet = [];
  const sessionsToDelete = [];

  for (const file of jsonlFiles) {
    const filePath = path.join(folderPath, file);
    const sessionId = path.basename(file, '.jsonl');
    currentIds.add(sessionId);

    // Check if file mtime changed
    let fileMtime;
    try { fileMtime = fs.statSync(filePath).mtime.toISOString(); } catch { continue; }

    if (cachedMap.has(sessionId) && cachedMap.get(sessionId) === fileMtime) {
      continue; // unchanged, skip
    }

    // File is new or modified — re-read it
    const s = readSessionFile(filePath, folder, projectPath);
    if (s) {
      sessionsToUpsert.push(s);
      searchEntriesToUpsert.push({
        id: s.sessionId, type: 'session', folder: s.folder,
        title: s.summary, body: s.textContent,
      });
      if (s.customTitle) namesToSet.push({ id: s.sessionId, name: s.customTitle });
    }
    changed = true;
  }

  // Remove sessions whose .jsonl files were deleted
  for (const sessionId of cachedMap.keys()) {
    if (!currentIds.has(sessionId)) {
      sessionsToDelete.push(sessionId);
      changed = true;
    }
  }

  // Batch all DB writes to reduce lock contention
  if (sessionsToUpsert.length > 0) {
    upsertCachedSessions(sessionsToUpsert);
  }
  for (const entry of searchEntriesToUpsert) {
    deleteSearchSession(entry.id);
  }
  if (searchEntriesToUpsert.length > 0) {
    upsertSearchEntries(searchEntriesToUpsert);
  }
  for (const { id, name } of namesToSet) {
    setName(id, name);
  }
  for (const sessionId of sessionsToDelete) {
    deleteCachedSession(sessionId);
    deleteSearchSession(sessionId);
  }

  // Update folder mtime
  setFolderMeta(folder, projectPath, getFolderIndexMtimeMs(folderPath));
}

/** Populate entire cache from filesystem (cold start) */
function populateCacheFromFilesystem() {
  try {
    const folders = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== '.git')
      .map(d => d.name);

    for (const folder of folders) {
      refreshFolder(folder);
    }
  } catch (err) {
    console.error('Error populating cache:', err);
  }
}

/** Build projects response from cached data */
function buildProjectsFromCache(showArchived) {
  const metaMap = getAllMeta();
  const cachedRows = getAllCached();
  const global = getSetting('global') || {};
  const hiddenProjects = new Set(global.hiddenProjects || []);

  // Group by folder
  const folderMap = new Map();
  for (const row of cachedRows) {
    if (hiddenProjects.has(row.projectPath)) continue;
    if (!folderMap.has(row.folder)) {
      folderMap.set(row.folder, { folder: row.folder, projectPath: row.projectPath, sessions: [] });
    }
    const meta = metaMap.get(row.sessionId);
    const s = {
      sessionId: row.sessionId,
      summary: row.summary,
      firstPrompt: row.firstPrompt,
      created: row.created,
      modified: row.modified,
      messageCount: row.messageCount,
      projectPath: row.projectPath,
      slug: row.slug || null,
      name: meta?.name || null,
      starred: meta?.starred || 0,
      archived: meta?.archived || 0,
    };
    if (!showArchived && s.archived) continue;
    folderMap.get(row.folder).sessions.push(s);
  }

  // Include empty project directories (no sessions yet)
  try {
    const dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== '.git');
    for (const d of dirs) {
      if (!folderMap.has(d.name)) {
        const projectPath = deriveProjectPath(path.join(PROJECTS_DIR, d.name), d.name);
        if (projectPath && !hiddenProjects.has(projectPath)) {
          folderMap.set(d.name, { folder: d.name, projectPath, sessions: [] });
        }
      }
    }
  } catch {}

  // Inject active plain terminal sessions so they participate in sorting
  for (const [sessionId, session] of activeSessions) {
    if (session.exited || !session.isPlainTerminal) continue;
    const folder = session.projectPath.replace(/[/_]/g, '-').replace(/^-/, '-');
    if (hiddenProjects.has(session.projectPath)) continue;
    if (!folderMap.has(folder)) {
      folderMap.set(folder, { folder, projectPath: session.projectPath, sessions: [] });
    }
    const proj = folderMap.get(folder);
    if (!proj.sessions.some(s => s.sessionId === sessionId)) {
      proj.sessions.push({
        sessionId, summary: 'Terminal', firstPrompt: '', projectPath: session.projectPath,
        name: null, starred: 0, archived: 0, messageCount: 0,
        modified: new Date(session._openedAt).toISOString(),
        created: new Date(session._openedAt).toISOString(),
        type: 'terminal',
      });
    }
  }

  const projects = [];
  for (const proj of folderMap.values()) {
    proj.sessions.sort((a, b) => new Date(b.modified) - new Date(a.modified));
    projects.push(proj);
  }

  projects.sort((a, b) => {
    // Empty projects go to the bottom
    if (a.sessions.length === 0 && b.sessions.length > 0) return 1;
    if (b.sessions.length === 0 && a.sessions.length > 0) return -1;
    const aDate = a.sessions[0]?.modified || '';
    const bDate = b.sessions[0]?.modified || '';
    return new Date(bDate) - new Date(aDate);
  });

  return projects;
}


function notifyRendererProjectsChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('projects-changed');
  }
}

function sendStatus(text, type) {
  if (text) log.info(`[status] (${type || 'info'}) ${text}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status-update', text, type || 'info');
  }
}

// --- Worker-based cache population (non-blocking) ---
let populatingCache = false;

function populateCacheViaWorker() {
  if (populatingCache) return;
  populatingCache = true;
  sendStatus('Scanning projects\u2026', 'active');

  const worker = new Worker(path.join(__dirname, 'workers', 'scan-projects.js'), {
    workerData: { projectsDir: PROJECTS_DIR },
  });

  worker.on('message', (msg) => {
    // Progress updates from worker
    if (msg.type === 'progress') {
      sendStatus(msg.text, 'active');
      return;
    }

    if (!msg.ok) {
      console.error('Worker scan error:', msg.error);
      sendStatus('Scan failed: ' + msg.error, 'error');
      populatingCache = false;
      return;
    }

    sendStatus(`Indexing ${msg.results.length} projects\u2026`, 'active');

    // Write results to DB on main thread (fast)
    let sessionCount = 0;
    for (const { folder, projectPath, sessions, indexMtimeMs } of msg.results) {
      deleteCachedFolder(folder);
      deleteSearchFolder(folder);
      if (sessions.length > 0) {
        sessionCount += sessions.length;
        upsertCachedSessions(sessions);
        for (const s of sessions) {
          if (s.customTitle) setName(s.sessionId, s.customTitle);
        }
        upsertSearchEntries(sessions.map(s => ({
          id: s.sessionId, type: 'session', folder: s.folder,
          title: (s.customTitle ? s.customTitle + ' ' : '') + s.summary,
          body: s.textContent,
        })));
      }
      setFolderMeta(folder, projectPath, indexMtimeMs);
    }

    populatingCache = false;
    sendStatus(`Indexed ${sessionCount} sessions across ${msg.results.length} projects`, 'done');
    // Clear status after a few seconds
    setTimeout(() => sendStatus(''), 5000);
    notifyRendererProjectsChanged();
  });

  worker.on('error', (err) => {
    console.error('Worker error:', err);
    sendStatus('Worker error: ' + err.message, 'error');
    populatingCache = false;
  });

  // If the worker exits abnormally (SIGSEGV, OOM, uncaught exception) without
  // sending a message, neither the 'message' nor 'error' handler will fire.
  // Reset the flag here to prevent a permanent lockout where the session list
  // stays empty because populateCacheViaWorker() returns immediately.
  worker.on('exit', (code) => {
    if (populatingCache) {
      populatingCache = false;
      if (code !== 0) {
        sendStatus('Scan worker exited unexpectedly', 'error');
      }
    }
  });
}

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
    const folder = projectPath.replace(/[/_]/g, '-').replace(/^-/, '-');
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
    const folder = projectPath.replace(/[/_]/g, '-').replace(/^-/, '-');
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
ipcMain.handle('search', (_event, type, query) => {
  return searchByType(type, query, 50);
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
  cliAgent: 'claude',
};

// --- CLI Agent Definitions ---
const CLI_AGENTS = {
  claude:   { name: 'Claude Code',  cmd: 'claude',   color: '#d97757', sessionFlag: '--session-id', resumeFlag: '--resume', forkFlag: '--fork-session', supportsPermissions: true,  supportsMcp: true  },
  codex:    { name: 'Codex',        cmd: 'codex',    color: '#4ade80', sessionFlag: null,           resumeFlag: null,       forkFlag: null,             supportsPermissions: false, supportsMcp: false },
  qwen:     { name: 'Qwen Code',    cmd: 'qwen',     color: '#60a5fa', sessionFlag: null,           resumeFlag: '--resume', forkFlag: null,             supportsPermissions: false, supportsMcp: false },
  gemini:   { name: 'Gemini CLI',   cmd: 'gemini',   color: '#22d3ee', sessionFlag: null,           resumeFlag: '--resume', forkFlag: null,             supportsPermissions: false, supportsMcp: false },
  kimi:     { name: 'Kimi Code',    cmd: 'kimi',     color: '#fb923c', sessionFlag: null,           resumeFlag: null,       forkFlag: null,             supportsPermissions: false, supportsMcp: false },
  aider:    { name: 'Aider',        cmd: 'aider',    color: '#a78bfa', sessionFlag: null,           resumeFlag: null,       forkFlag: null,             supportsPermissions: false, supportsMcp: false },
  opencode: { name: 'OpenCode',     cmd: 'opencode', color: '#f472b6', sessionFlag: null,           resumeFlag: null,       forkFlag: null,             supportsPermissions: false, supportsMcp: false },
  hermes:   { name: 'Hermes Agent', cmd: 'hermes',   color: '#fbbf24', sessionFlag: null,           resumeFlag: '--resume', forkFlag: null,             supportsPermissions: false, supportsMcp: false },
  letta:    { name: 'Letta Code',   cmd: 'letta',    color: '#34d399', sessionFlag: null,           resumeFlag: null,       forkFlag: null,             supportsPermissions: false, supportsMcp: false },
};

// Session history discovery per agent
// Each returns { sessions: [...], stats: { totalSessions, totalMessages, ... } }
const AGENT_HISTORY = {
  // Claude Code: ~/.claude/projects/{project-hash}/{uuid}.jsonl + ~/.claude/history.jsonl
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

  // Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl + ~/.codex/history.jsonl
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

  // Qwen Code: ~/.qwen/projects/{project-hash}/chats/{uuid}.jsonl (same structure as Claude)
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

  // Gemini CLI: ~/.gemini/tmp/{project-hash}/chats/session-*.json or .jsonl
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

  // Kimi Code: ~/.kimi/sessions/{dir-hash}/{session-id}/context.jsonl
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
              // Check for context.jsonl inside
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
                walk(fp); // recurse into dir-hash level
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

  // Aider: project-level .aider.chat.history.md files (no centralized store)
  aider: {
    historyDir: () => null,
    getSessions: () => {
      // Aider uses per-project markdown files — scan known project directories
      const sessions = [];
      // Check all known Switchboard project paths for .aider files
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
        // Count #### headings as user messages (aider uses h4 for user turns)
        const userMsgs = (content.match(/^####\s/gm) || []).length;
        // Rough estimate: assistant blocks between user turns
        const assistantMsgs = userMsgs; // approximate 1:1 ratio
        const totalLines = content.split('\n').length;
        return { userMessages: userMsgs, assistantMessages: assistantMsgs, toolUses: 0, totalLines };
      } catch { return null; }
    },
  },

  // OpenCode: ~/.local/share/opencode/opencode.db (SQLite)
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

  // Hermes Agent: ~/.hermes/sessions/YYYYMMDD_HHMMSS_*.jsonl
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

      // Parse a sample of recent sessions for message counts (limit to avoid slow reads)
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

ipcMain.handle('get-shell-profiles', () => {
  _shellProfiles = null; // refresh on each request
  return getShellProfiles();
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

// --- IPC: get-active-sessions ---
ipcMain.handle('get-active-sessions', () => {
  const active = [];
  for (const [sessionId, session] of activeSessions) {
    if (!session.exited) active.push({ sessionId, cliAgent: session.cliAgent || 'claude' });
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
  if (session.isHeadless && session.childProcess) {
    session.childProcess.kill('SIGTERM');
  } else if (session.pty) {
    session.pty.kill();
  }
  return { ok: true };
});

// --- IPC: launch-headless --- (Claude -p with stream-json output, no terminal UI)
ipcMain.handle('launch-headless', async (_event, sessionId, projectPath, prompt, sessionOptions) => {
  const { spawn } = require('child_process');
  const readline = require('readline');

  const agentId = sessionOptions?.cliAgent || 'claude';
  const agent = CLI_AGENTS[agentId] || CLI_AGENTS.claude;

  // Build command args
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
  if (agent.sessionFlag) args.push(agent.sessionFlag, sessionId);

  // Permission flags (claude-specific)
  if (agent.supportsPermissions) {
    if (sessionOptions?.dangerouslySkipPermissions) {
      args.push('--dangerously-skip-permissions');
    } else if (sessionOptions?.permissionMode) {
      args.push('--permission-mode', sessionOptions.permissionMode);
    }
  }

  log.info(`[headless] Launching: ${agent.cmd} ${args.join(' ')} in ${projectPath}`);

  const env = { ...process.env, TERM: 'dumb', FORCE_COLOR: '0' };
  if (sessionOptions?.envOverrides) Object.assign(env, sessionOptions.envOverrides);

  const child = spawn(agent.cmd, args, {
    cwd: projectPath,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const session = {
    childProcess: child,
    isHeadless: true,
    isPlainTerminal: false,
    exited: false,
    rendererAttached: true,
    projectPath,
    prompt,
    cliAgent: agentId,
    events: [],
    _openedAt: Date.now(),
  };
  activeSessions.set(sessionId, session);

  // Register headless session as a peer
  if (child.pid) {
    try {
      session.peerId = registerSessionAsPeer(sessionId, child.pid, projectPath, agentId);
    } catch (err) {
      log.warn(`[peers] Failed to register headless session ${sessionId}: ${err.message}`);
    }
  }

  // Parse stdout line-by-line for stream-json events
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      // Classify event for the sparkline
      const classified = classifyHeadlessEvent(event);
      if (classified) {
        session.events.push(classified);
        // Keep buffer bounded
        if (session.events.length > 100) session.events.shift();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('headless-event', sessionId, classified);
        }
      }
    } catch {
      // Non-JSON line (progress indicators, warnings) — skip
    }
  });

  // Capture stderr as error events
  child.stderr.on('data', (data) => {
    const text = data.toString().trim();
    if (!text) return;
    const errEvent = { type: 'error', text, ts: Date.now() };
    session.events.push(errEvent);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('headless-event', sessionId, errEvent);
    }
  });

  // On exit, send process-exited (reuses existing renderer handler)
  child.on('close', (code) => {
    session.exited = true;
    // Unregister from peers broker
    if (session.peerId) {
      try { peerUnregister(session.peerId); peerSessionMap.delete(session.peerId); } catch {}
      notifyPeersChanged();
    }
    log.info(`[headless] Session ${sessionId} exited with code ${code}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('process-exited', sessionId, code);
      // Send final completion event
      mainWindow.webContents.send('headless-event', sessionId, {
        type: 'complete', exitCode: code, ts: Date.now(),
      });
    }
  });

  child.on('error', (err) => {
    session.exited = true;
    // Unregister from peers broker
    if (session.peerId) {
      try { peerUnregister(session.peerId); peerSessionMap.delete(session.peerId); } catch {}
      notifyPeersChanged();
    }
    log.error(`[headless] Spawn error for ${sessionId}: ${err.message}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('process-exited', sessionId, 1);
      mainWindow.webContents.send('headless-event', sessionId, {
        type: 'error', text: err.message, ts: Date.now(),
      });
    }
  });

  return { ok: true, sessionId };
});

// Classify a stream-json event into a sparkline-friendly format
function classifyHeadlessEvent(event) {
  const ts = Date.now();

  // Assistant message with tool_use
  if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
    for (const block of event.message.content) {
      if (block.type === 'tool_use') {
        return { type: 'tool_use', name: block.name, id: block.id, ts };
      }
    }
    // Text content
    for (const block of event.message.content) {
      if (block.type === 'text' && block.text) {
        return { type: 'text', text: block.text.slice(0, 120), ts };
      }
    }
  }

  // Content block delta (streaming text)
  if (event.type === 'content_block_delta') {
    return null; // Skip deltas, too noisy
  }

  // Content block start (tool_use start)
  if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
    return { type: 'tool_start', name: event.content_block.name, id: event.content_block.id, ts };
  }

  // Tool result
  if (event.type === 'result') {
    return { type: 'result', text: (event.result || '').slice(0, 200), ts };
  }

  // System/error
  if (event.type === 'error') {
    return { type: 'error', text: event.error?.message || 'unknown error', ts };
  }

  // Message start/stop
  if (event.type === 'message_start') {
    return { type: 'message_start', ts };
  }
  if (event.type === 'message_stop') {
    return { type: 'message_stop', ts };
  }

  return null;
}

// ============================================================
// PEERS BROKER — HTTP server + IPC handlers for cross-session messaging
// ============================================================

const PEERS_PORT = parseInt(process.env.SWITCHBOARD_PEERS_PORT || '7899', 10);
let peersHttpServer = null;
let peersCleanupTimer = null;

// Map peerId -> sessionId for delivering messages via IPC
const peerSessionMap = new Map();

function startPeersBroker() {
  const http = require('http');

  peersHttpServer = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'GET') {
      if (req.url === '/health') {
        const peers = peerListAll();
        res.end(JSON.stringify({ status: 'ok', peers: peers.length }));
        return;
      }
      res.end(JSON.stringify({ name: 'switchboard-peers-broker' }));
      return;
    }

    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'method not allowed' }));
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const url = new URL(req.url, `http://localhost:${PEERS_PORT}`);

        switch (url.pathname) {
          case '/register': {
            const result = peerRegister(data);
            if (data.sessionId) peerSessionMap.set(result.id, data.sessionId);
            res.end(JSON.stringify(result));
            notifyPeersChanged();
            break;
          }
          case '/heartbeat':
            peerHeartbeat(data.id);
            res.end(JSON.stringify({ ok: true }));
            break;
          case '/set-summary':
            peerSetSummary(data.id, data.summary);
            res.end(JSON.stringify({ ok: true }));
            notifyPeersChanged();
            break;
          case '/list-peers': {
            let peers;
            switch (data.scope) {
              case 'directory': peers = peerListByDir(data.cwd, data.exclude_id); break;
              case 'repo': peers = data.git_root ? peerListByRepo(data.git_root, data.exclude_id) : peerListByDir(data.cwd, data.exclude_id); break;
              default: peers = peerListAll(data.exclude_id);
            }
            // Verify PIDs are alive
            peers = peers.filter(p => {
              try { process.kill(p.pid, 0); return true; } catch { peerUnregister(p.id); return false; }
            });
            res.end(JSON.stringify(peers));
            break;
          }
          case '/send-message': {
            const result = peerSendMessage(data.from_id, data.to_id, data.text);
            res.end(JSON.stringify(result));
            if (result.ok) deliverPeerMessage(data.to_id, data.from_id, data.text);
            break;
          }
          case '/poll-messages': {
            const messages = peerPollMessages(data.id);
            res.end(JSON.stringify({ messages }));
            break;
          }
          case '/unregister':
            peerSessionMap.delete(data.id);
            peerUnregister(data.id);
            res.end(JSON.stringify({ ok: true }));
            notifyPeersChanged();
            break;
          default:
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'not found' }));
        }
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  });

  peersHttpServer.listen(PEERS_PORT, '127.0.0.1', () => {
    log.info(`[peers-broker] Listening on 127.0.0.1:${PEERS_PORT}`);
  });

  peersHttpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log.warn(`[peers-broker] Port ${PEERS_PORT} in use — external broker may be running, skipping embedded broker`);
      peersHttpServer = null;
    } else {
      log.error('[peers-broker] Server error:', err.message);
    }
  });

  // Clean stale peers every 30s
  peersCleanupTimer = setInterval(() => {
    const activePids = new Set();
    // Our own managed sessions
    for (const [, session] of activeSessions) {
      if (session.pty?.pid) activePids.add(session.pty.pid);
      if (session.childProcess?.pid) activePids.add(session.childProcess.pid);
    }
    // Also check OS-level
    const allPeers = peerListAll();
    for (const peer of allPeers) {
      try { process.kill(peer.pid, 0); activePids.add(peer.pid); } catch {}
    }
    peerCleanStale(activePids);
  }, 30000);
}

function stopPeersBroker() {
  if (peersCleanupTimer) { clearInterval(peersCleanupTimer); peersCleanupTimer = null; }
  if (peersHttpServer) { peersHttpServer.close(); peersHttpServer = null; }
}

function deliverPeerMessage(toPeerId, fromPeerId, text) {
  // Try to deliver via IPC to the renderer (for UI notification)
  if (mainWindow && !mainWindow.isDestroyed()) {
    const sender = peerGetById(fromPeerId);
    mainWindow.webContents.send('peer-message', {
      toPeerId,
      fromPeerId,
      fromAgent: sender?.agent || 'unknown',
      fromSummary: sender?.summary || '',
      fromCwd: sender?.cwd || '',
      text,
      sentAt: new Date().toISOString(),
    });
  }

  // For Claude sessions with the MCP channel: the MCP server handles this via polling
  // For non-Claude sessions managed by Switchboard: inject via terminal if active
  const toSessionId = peerSessionMap.get(toPeerId);
  if (toSessionId) {
    const session = activeSessions.get(toSessionId);
    if (session && !session.isHeadless && !session.exited) {
      const agent = CLI_AGENTS[session.cliAgent || 'claude'];
      // For non-MCP agents, we can inject a notification comment via terminal
      if (!agent?.supportsMcp && session.pty) {
        // Don't auto-inject — let the UI handle it. User decides when to paste.
      }
    }
  }
}

function notifyPeersChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('peers-changed');
  }
}

// Auto-register sessions as peers when they spawn
function registerSessionAsPeer(sessionId, pid, projectPath, agentId) {
  const { execSync } = require('child_process');
  let gitRoot = null;
  try {
    gitRoot = execSync('git rev-parse --show-toplevel', { cwd: projectPath, encoding: 'utf-8', timeout: 3000 }).trim();
  } catch {}

  const result = peerRegister({
    sessionId,
    pid,
    cwd: projectPath,
    gitRoot,
    agent: agentId || 'claude',
    summary: '',
  });
  peerSessionMap.set(result.id, sessionId);
  log.info(`[peers] Registered session ${sessionId} as peer ${result.id} (${agentId})`);
  return result.id;
}

// --- IPC: peers ---

ipcMain.handle('peer-list', (_event, scope, cwd, gitRoot, excludeId) => {
  switch (scope) {
    case 'directory': return peerListByDir(cwd, excludeId);
    case 'repo': return gitRoot ? peerListByRepo(gitRoot, excludeId) : peerListByDir(cwd, excludeId);
    default: return peerListAll(excludeId);
  }
});

ipcMain.handle('peer-send-message', (_event, fromPeerId, toPeerId, text) => {
  const result = peerSendMessage(fromPeerId, toPeerId, text);
  if (result.ok) deliverPeerMessage(toPeerId, fromPeerId, text);
  return result;
});

ipcMain.handle('peer-set-summary', (_event, peerId, summary) => {
  peerSetSummary(peerId, summary);
  notifyPeersChanged();
  return { ok: true };
});

ipcMain.handle('peer-get-session-peer', (_event, sessionId) => {
  // Find the peer ID for a given session
  for (const [peerId, sid] of peerSessionMap) {
    if (sid === sessionId) return peerGetById(peerId);
  }
  return null;
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
      mainWindow.webContents.send('terminal-data', sessionId, '\x1b[?1049h');
    }

    // Send buffered output for reattach
    for (const chunk of session.outputBuffer) {
      mainWindow.webContents.send('terminal-data', sessionId, chunk);
    }

    if (!session.isPlainTerminal) {
      // Hide cursor after buffer replay — the live PTY stream or resize nudge
      // will re-show it at the correct position, avoiding a stale cursor artifact
      mainWindow.webContents.send('terminal-data', sessionId, '\x1b[?25l');
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
    projectFolder = projectPath.replace(/[/_]/g, '-').replace(/^-/, '-');
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
      // Build CLI command with session options
      const agentId = sessionOptions?.cliAgent || 'claude';
      const agent = CLI_AGENTS[agentId] || CLI_AGENTS.claude;
      let cliCmd;

      if (sessionOptions?.forkFrom && agent.forkFlag) {
        cliCmd = `${agent.cmd} ${agent.resumeFlag} "${sessionOptions.forkFrom}" ${agent.forkFlag}`;
      } else if (isNew && agent.sessionFlag) {
        cliCmd = `${agent.cmd} ${agent.sessionFlag} "${sessionId}"`;
      } else if (!isNew && agent.resumeFlag) {
        cliCmd = `${agent.cmd} ${agent.resumeFlag} "${sessionId}"`;
      } else {
        // Agent doesn't support session management — just launch it
        cliCmd = agent.cmd;
      }

      if (sessionOptions && agent.supportsPermissions) {
        if (sessionOptions.dangerouslySkipPermissions) {
          cliCmd += ' --dangerously-skip-permissions';
        } else if (sessionOptions.permissionMode) {
          cliCmd += ` --permission-mode "${sessionOptions.permissionMode}"`;
        }
        if (sessionOptions.worktree) {
          cliCmd += ' --worktree';
          if (sessionOptions.worktreeName) {
            cliCmd += ` "${sessionOptions.worktreeName}"`;
          }
        }
        if (sessionOptions.chrome) {
          cliCmd += ' --chrome';
        }
        if (sessionOptions.addDirs) {
          const dirs = sessionOptions.addDirs.split(',').map(d => d.trim()).filter(Boolean);
          for (const dir of dirs) {
            cliCmd += ` --add-dir "${dir}"`;
          }
        }
      }

      if (sessionOptions?.preLaunchCmd) {
        cliCmd = sessionOptions.preLaunchCmd + ' ' + cliCmd;
      }

      // Start MCP server for this session so Claude CLI sends diffs/file opens to Switchboard
      // (skip if user disabled IDE emulation in global settings)
      if (sessionOptions?.mcpEmulation !== false && agent.supportsMcp) {
        try {
          mcpServer = await startMcpServer(sessionId, [projectPath], mainWindow, log);
          cliCmd += ' --ide';
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
      // Proxy env overrides (e.g. for ccproxy routing)
      if (sessionOptions?.envOverrides) {
        Object.assign(ptyEnv, sessionOptions.envOverrides);
      }

      log.info(`[agent] Launching ${agent.name} (${agentId}): ${cliCmd}`);

      ptyProcess = pty.spawn(shell, shellArgs(shell, cliCmd, shellExtraArgs), {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: isWsl ? os.homedir() : projectPath,
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
    cliAgent: sessionOptions?.cliAgent || 'claude',
    mcpServer, _openedAt: Date.now(),
  };
  activeSessions.set(sessionId, session);

  // Register this session as a peer for cross-session messaging
  if (ptyProcess.pid) {
    try {
      session.peerId = registerSessionAsPeer(sessionId, ptyProcess.pid, projectPath, session.cliAgent);
    } catch (err) {
      log.warn(`[peers] Failed to register session ${sessionId}: ${err.message}`);
    }
  }

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
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('cli-busy-state', currentId, true);
            }
          } else if (isIdle && session._cliBusy) {
            session._cliBusy = false;
            session._oscIdle = true;
            log.debug(`[OSC 0] session=${currentId} → IDLE`);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('cli-busy-state', currentId, false);
            }
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
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('cli-busy-state', currentId, true);
            }
          }
        } else {
          // Regular notification (attention, permission, etc.)
          log.info(`[OSC 9] session=${currentId} message="${payload}"`);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('terminal-notification', currentId, payload);
          }
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
      mainWindow.webContents.send('terminal-data', currentId, data);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    session.exited = true;
    // Unregister from peers broker
    if (session.peerId) {
      try { peerUnregister(session.peerId); peerSessionMap.delete(session.peerId); } catch {}
      notifyPeersChanged();
    }
    // Clean up MCP server
    const mcpId = session.realSessionId || sessionId;
    shutdownMcpServer(mcpId);
    session.mcpServer = null;

    const realId = session.realSessionId || sessionId;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('process-exited', realId, exitCode);
      // If a fork/plan-accept transition re-keyed this session under realId
      // but the PTY exited before transition detection ran, also notify the
      // renderer for the original sessionId so it doesn't stay stuck as "Running".
      if (realId !== sessionId && activeSessions.has(sessionId)) {
        mainWindow.webContents.send('process-exited', sessionId, exitCode);
      }
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

// --- Fork / plan-accept detection ---

/** Read first few lines of a new .jsonl to extract signals.
 *  Skips file-history-snapshot lines which can be very large (tens of KB)
 *  and reads up to 512KB to find the first user/assistant entry. */
function readNewSessionSignals(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(524288);
    const bytesRead = fs.readSync(fd, buf, 0, 524288, 0);
    fs.closeSync(fd);
    const head = buf.toString('utf8', 0, bytesRead);
    const lines = head.split('\n').filter(Boolean);
    let forkedFrom = null;
    let planContent = false;
    let slug = null;
    let parentSessionId = null;
    let hasSnapshots = false;
    for (const line of lines) {
      const entry = JSON.parse(line);
      // Skip snapshot lines — they carry no fork/session signals
      if (entry.type === 'file-history-snapshot') { hasSnapshots = true; continue; }
      if (entry.forkedFrom) forkedFrom = entry.forkedFrom.sessionId;
      if (entry.planContent) planContent = true;
      if (entry.slug && !slug) slug = entry.slug;
      // --fork-session copies messages with original sessionId
      if (entry.sessionId && !parentSessionId) parentSessionId = entry.sessionId;
      // Stop after finding a user or assistant message
      if (entry.type === 'user' || entry.type === 'assistant') break;
    }
    return { forkedFrom, planContent, slug, parentSessionId, hasSnapshots };
  } catch {
    return { forkedFrom: null, planContent: false, slug: null, parentSessionId: null, hasSnapshots: false };
  }
}

/** Read tail of old session file for ExitPlanMode and slug */
function readOldSessionTail(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const size = stat.size;
    const readSize = Math.min(size, 8192);
    const buf = Buffer.alloc(readSize);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, readSize, size - readSize);
    fs.closeSync(fd);
    const tail = buf.toString('utf8');
    const hasExitPlanMode = tail.includes('ExitPlanMode');
    // Extract slug from tail (last occurrence)
    let slug = null;
    const slugMatches = tail.match(/"slug"\s*:\s*"([^"]+)"/g);
    if (slugMatches) {
      const last = slugMatches[slugMatches.length - 1].match(/"slug"\s*:\s*"([^"]+)"/);
      if (last) slug = last[1];
    }
    return { hasExitPlanMode, slug };
  } catch {
    return { hasExitPlanMode: false, slug: null };
  }
}

/** Detect fork or plan-accept transitions for active PTY sessions in a folder */
function detectSessionTransitions(folder) {
  const folderPath = path.join(PROJECTS_DIR, folder);
  let currentFiles;
  try {
    currentFiles = fs.readdirSync(folderPath).filter(f => f.endsWith('.jsonl'));
  } catch { return; }

  for (const [sessionId, session] of [...activeSessions]) {
    if (session.exited || session.isPlainTerminal || !session.knownJsonlFiles || session.projectFolder !== folder) {
      if (!session.exited && !session.isPlainTerminal && session.forkFrom) {
        log.info(`[fork-detect] skipped session=${sessionId} forkFrom=${session.forkFrom||'none'} reason=${session.exited ? 'exited' : session.isPlainTerminal ? 'terminal' : !session.knownJsonlFiles ? 'noKnown' : 'folderMismatch('+session.projectFolder+' vs '+folder+')'}`);
      }
      continue;
    }

    const newFiles = currentFiles.filter(f => !session.knownJsonlFiles.has(f));

    if (newFiles.length > 0) log.debug(`[detect] session=${sessionId} forkFrom=${session.forkFrom||'none'} folder=${folder} newFiles=${newFiles.length} knownCount=${session.knownJsonlFiles.size} currentCount=${currentFiles.length}`);

    if (newFiles.length === 0) continue;

    const emptyFiles = new Set(); // files with no signals yet (still being written)

    for (const newFile of newFiles) {
      const newFilePath = path.join(folderPath, newFile);
      const newId = path.basename(newFile, '.jsonl');
      const signals = readNewSessionSignals(newFilePath);

      // File exists but has no parseable content yet — skip and retry next cycle
      // But if the file's mtime is older than 1 hour, treat it as stale and archive it
      if (!signals.forkedFrom && !signals.parentSessionId && !signals.slug && !signals.planContent) {
        // Fork file with only snapshots (no user turn yet) — match immediately
        if (signals.hasSnapshots && session.forkFrom && !session.realSessionId) {
          log.info(`[detect] session=${sessionId} matching snapshot-only fork file=${newId}`);
          // Fall through to matching logic — will match via the fork-snapshot path below
        } else {
          let stale = false;
          try {
            const mtime = fs.statSync(path.join(folderPath, newFile)).mtimeMs;
            if (Date.now() - mtime > 3600000) stale = true;
          } catch {}
          if (stale) {
            log.info(`[detect] session=${sessionId} archiving stale empty file=${newId}`);
          } else {
            emptyFiles.add(newFile);
          }
          continue;
        }
      }

      if (session.forkFrom) {
        log.info(`[detect] session=${sessionId} checking newFile=${newId} signals=${JSON.stringify({forkedFrom: signals.forkedFrom||null, parentSessionId: signals.parentSessionId||null, slug: signals.slug||null})} forkFrom=${session.forkFrom}`);
      } else {
        log.debug(`[detect] session=${sessionId} checking newFile=${newId} signals=${JSON.stringify({forkedFrom: signals.forkedFrom||null, parentSessionId: signals.parentSessionId||null, slug: signals.slug||null})} forkFrom=none`);
      }

      let matched = false;

      // Fork: forkedFrom.sessionId matches this active PTY or the session it was forked from
      if (signals.forkedFrom === sessionId || (session.forkFrom && signals.forkedFrom === session.forkFrom)) {
        matched = true;
      }
      // --fork-session: new file's parentSessionId matches the forkFrom source,
      // and the new file's name (newId) differs from both our PTY id and the source
      if (!matched && session.forkFrom && signals.parentSessionId === session.forkFrom && newId !== session.forkFrom) {
        matched = true;
      }
      // Fork file with only snapshots — no user turn yet, but this session is waiting for a fork
      if (!matched && signals.hasSnapshots && session.forkFrom && !session.realSessionId) {
        matched = true;
      }

      if (session.forkFrom && !matched) {
        log.info(`[detect] session=${sessionId} NO MATCH for newFile=${newId} forkFrom=${session.forkFrom} parentSessionId=${signals.parentSessionId||'null'} forkedFrom=${signals.forkedFrom||'null'}`);
      }

      // Plan-accept: shared slug + planContent + old session has ExitPlanMode
      if (!matched && signals.planContent && signals.slug) {
        const oldFilePath = path.join(folderPath, sessionId + '.jsonl');
        const oldTail = readOldSessionTail(oldFilePath);
        if (oldTail.hasExitPlanMode && oldTail.slug === signals.slug) {
          // Temporal check: new file created within 30s of old file's last modification
          try {
            const oldMtime = fs.statSync(oldFilePath).mtimeMs;
            const newMtime = fs.statSync(newFilePath).mtimeMs;
            if (Math.abs(newMtime - oldMtime) < 30000) {
              matched = true;
            }
          } catch {}
        }
      }

      if (matched) {
        log.info(`[session-transition] ${sessionId} → ${newId} (${signals.forkedFrom || session.forkFrom ? 'fork' : 'plan-accept'})`);
        session.knownJsonlFiles = new Set(currentFiles);
        session.realSessionId = newId;
        // Update slug from new session
        if (signals.slug) session.sessionSlug = signals.slug;
        activeSessions.delete(sessionId);
        activeSessions.set(newId, session);
        // Re-key MCP server to match new session ID
        rekeyMcpServer(sessionId, newId);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('session-forked', sessionId, newId);
        }
        break; // Only one transition per session per flush
      }
    }

    // Update known files, but exclude empty ones so they get rechecked next cycle
    const updated = new Set(currentFiles);
    for (const f of emptyFiles) updated.delete(f);
    session.knownJsonlFiles = updated;
  }
}

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
  startPeersBroker();

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
  // Shut down peers broker
  stopPeersBroker();

  // Shut down all MCP servers
  shutdownAllMcp();

  // Close filesystem watcher
  if (projectsWatcher) {
    projectsWatcher.close();
    projectsWatcher = null;
  }

  // Unregister all peers and kill all processes on quit
  for (const [, session] of activeSessions) {
    if (session.peerId) {
      try { peerUnregister(session.peerId); } catch {}
    }
    if (!session.exited) {
      try {
        if (session.isHeadless && session.childProcess) session.childProcess.kill('SIGTERM');
        else if (session.pty) session.pty.kill();
      } catch {}
    }
  }
});

// --- IPC: scheduler-save (save scheduler pattern to JSON file) ---
ipcMain.handle('scheduler-save', async (_event, jsonData) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Scheduler Pattern',
    defaultPath: `scheduler-pattern.json`,
    filters: [
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePath) return { ok: false };
  try {
    fs.writeFileSync(result.filePath, JSON.stringify(JSON.parse(jsonData), null, 2), 'utf-8');
    return { ok: true, filePath: result.filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// --- IPC: scheduler-load (load scheduler pattern from JSON file) ---
ipcMain.handle('scheduler-load', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Load Scheduler Pattern',
    filters: [
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return { ok: false };
  try {
    const data = fs.readFileSync(result.filePaths[0], 'utf-8');
    const parsed = JSON.parse(data);
    return { ok: true, data: parsed, filePath: result.filePaths[0] };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// --- IPC: scheduler-list-patterns (list user pattern files from ~/.switchboard/patterns/) ---
ipcMain.handle('scheduler-list-patterns', async () => {
  const dir = path.join(os.homedir(), '.switchboard', 'patterns');
  try {
    if (!fs.existsSync(dir)) return { ok: true, patterns: [] };
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const patterns = [];
    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
        patterns.push({ filename: f, ...data });
      } catch {}
    }
    return { ok: true, patterns };
  } catch (err) { return { ok: false, error: err.message }; }
});

// --- IPC: scheduler-save-to-library (save pattern to user library) ---
ipcMain.handle('scheduler-save-to-library', async (_event, name, jsonData) => {
  const dir = path.join(os.homedir(), '.switchboard', 'patterns');
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filename = name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase() + '.json';
    fs.writeFileSync(path.join(dir, filename), JSON.stringify(JSON.parse(jsonData), null, 2), 'utf-8');
    return { ok: true, filename };
  } catch (err) { return { ok: false, error: err.message }; }
});

// --- IPC: scheduler-delete-pattern (delete pattern from user library) ---
ipcMain.handle('scheduler-delete-pattern', async (_event, filename) => {
  const dir = path.join(os.homedir(), '.switchboard', 'patterns');
  try {
    const filepath = path.join(dir, path.basename(filename));
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});

// Close SQLite after all windows are closed to avoid "connection is not open" errors
app.on('will-quit', () => {
  closeDb();
});
