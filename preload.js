const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Invoke (request-response)
  getPlans: () => ipcRenderer.invoke('get-plans'),
  readPlan: (filename) => ipcRenderer.invoke('read-plan', filename),
  savePlan: (filePath, content) => ipcRenderer.invoke('save-plan', filePath, content),
  getStats: () => ipcRenderer.invoke('get-stats'),
  refreshStats: () => ipcRenderer.invoke('refresh-stats'),
  getUsage: () => ipcRenderer.invoke('get-usage'),
  getMemories: () => ipcRenderer.invoke('get-memories'),
  readMemory: (filePath) => ipcRenderer.invoke('read-memory', filePath),
  saveMemory: (filePath, content) => ipcRenderer.invoke('save-memory', filePath, content),
  getProjects: (showArchived) => ipcRenderer.invoke('get-projects', showArchived),
  getAgentSessions: (agentId) => ipcRenderer.invoke('get-agent-sessions', agentId),
  getGitStatus: (projectPath) => ipcRenderer.invoke('get-git-status', projectPath),
  getActiveSessions: () => ipcRenderer.invoke('get-active-sessions'),
  getActiveTerminals: () => ipcRenderer.invoke('get-active-terminals'),
  stopSession: (id) => ipcRenderer.invoke('stop-session', id),
  toggleStar: (id) => ipcRenderer.invoke('toggle-star', id),
  renameSession: (id, name) => ipcRenderer.invoke('rename-session', id, name),
  archiveSession: (id, archived) => ipcRenderer.invoke('archive-session', id, archived),
  openTerminal: (id, projectPath, isNew, sessionOptions) => ipcRenderer.invoke('open-terminal', id, projectPath, isNew, sessionOptions),
  search: (type, query) => ipcRenderer.invoke('search', type, query),
  readSessionJsonl: (sessionId) => ipcRenderer.invoke('read-session-jsonl', sessionId),
  readSessionConversation: (sessionId, filePath, agentId) => ipcRenderer.invoke('read-session-conversation', sessionId, filePath, agentId),
  getSessionTokens: (sessionId) => ipcRenderer.invoke('get-session-tokens', sessionId),
  getAllSessionTokens: () => ipcRenderer.invoke('get-all-session-tokens'),
  getSessionLoops: (sessionId) => ipcRenderer.invoke('get-session-loops', sessionId),
  getAllSessionLoops: () => ipcRenderer.invoke('get-all-session-loops'),

  // Templates
  saveTemplate: (data) => ipcRenderer.invoke('save-template', data),
  getTemplates: () => ipcRenderer.invoke('get-templates'),
  deleteTemplate: (id) => ipcRenderer.invoke('delete-template', id),
  useTemplate: (id) => ipcRenderer.invoke('use-template', id),

  // Window management
  reattachSession: (sessionId) => ipcRenderer.invoke('reattach-session', sessionId),
  toggleWindowPin: () => ipcRenderer.invoke('toggle-window-pin'),

  // Settings
  getSetting: (key) => ipcRenderer.invoke('get-setting', key),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
  deleteSetting: (key) => ipcRenderer.invoke('delete-setting', key),
  getEffectiveSettings: (projectPath) => ipcRenderer.invoke('get-effective-settings', projectPath),
  getShellProfiles: () => ipcRenderer.invoke('get-shell-profiles'),
  detectAgents: () => ipcRenderer.invoke('detect-agents'),
  getAgentStats: () => ipcRenderer.invoke('get-agent-stats'),
  launchHeadless: (sessionId, projectPath, prompt, sessionOptions) =>
    ipcRenderer.invoke('launch-headless', sessionId, projectPath, prompt, sessionOptions),
  onHeadlessEvent: (callback) => {
    ipcRenderer.on('headless-event', (_event, sessionId, eventData) => callback(sessionId, eventData));
  },
  onSessionActivity: (callback) => {
    ipcRenderer.on('session-activity', (_event, sessionId, eventData) => callback(sessionId, eventData));
  },
  watchSessionFile: (sessionId, filePath, agentId) =>
    ipcRenderer.invoke('watch-session-file', sessionId, filePath, agentId),
  unwatchSessionFile: (sessionId) =>
    ipcRenderer.invoke('unwatch-session-file', sessionId),
  installActivityHook: () => ipcRenderer.invoke('install-activity-hook'),
  checkActivityHook: () => ipcRenderer.invoke('check-activity-hook'),

  browseFolder: () => ipcRenderer.invoke('browse-folder'),
  addProject: (projectPath) => ipcRenderer.invoke('add-project', projectPath),
  removeProject: (projectPath) => ipcRenderer.invoke('remove-project', projectPath),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Send (fire-and-forget)
  sendInput: (id, data) => ipcRenderer.send('terminal-input', id, data),
  resizeTerminal: (id, cols, rows) => ipcRenderer.send('terminal-resize', id, cols, rows),
  closeTerminal: (id) => ipcRenderer.send('close-terminal', id),

  // Listeners (main → renderer)
  onTerminalData: (callback) => {
    ipcRenderer.on('terminal-data', (_event, sessionId, data) => callback(sessionId, data));
  },
  onSessionDetected: (callback) => {
    ipcRenderer.on('session-detected', (_event, tempId, realId) => callback(tempId, realId));
  },
  onProcessExited: (callback) => {
    ipcRenderer.on('process-exited', (_event, sessionId, exitCode) => callback(sessionId, exitCode));
  },
  onTerminalNotification: (callback) => {
    ipcRenderer.on('terminal-notification', (_event, sessionId, message) => callback(sessionId, message));
  },
  onCliBusyState: (callback) => {
    ipcRenderer.on('cli-busy-state', (_event, sessionId, busy) => callback(sessionId, busy));
  },
  onSessionForked: (callback) => {
    ipcRenderer.on('session-forked', (_event, oldId, newId) => callback(oldId, newId));
  },
  onProjectsChanged: (callback) => {
    ipcRenderer.on('projects-changed', () => callback());
  },
  onStatusUpdate: (callback) => {
    ipcRenderer.on('status-update', (_event, text, type) => callback(text, type));
  },

  // Scheduler
  schedulerSave: (jsonData) => ipcRenderer.invoke('scheduler-save', jsonData),
  schedulerLoad: () => ipcRenderer.invoke('scheduler-load'),
  schedulerListPatterns: () => ipcRenderer.invoke('scheduler-list-patterns'),
  schedulerSaveToLibrary: (name, jsonData) => ipcRenderer.invoke('scheduler-save-to-library', name, jsonData),
  schedulerDeletePattern: (filename) => ipcRenderer.invoke('scheduler-delete-pattern', filename),

  // File drag-and-drop
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // Multi-window
  detachSession: (sessionId) => ipcRenderer.invoke('detach-session', sessionId),
  getWindowSessions: () => ipcRenderer.invoke('get-window-sessions'),
  broadcastInput: (text) => ipcRenderer.invoke('broadcast-input', text),
  broadcastInputTargeted: (text, agentFilter, projectFilter) => ipcRenderer.invoke('broadcast-input-targeted', text, agentFilter, projectFilter),
  getWindows: () => ipcRenderer.invoke('get-windows'),
  focusWindow: (windowId) => ipcRenderer.invoke('focus-window', windowId),
  onSessionDetached: (callback) => {
    ipcRenderer.on('session-detached', (_event, sessionId, windowId) => callback(sessionId, windowId));
  },
  onSessionReattached: (callback) => {
    ipcRenderer.on('session-reattached', (_event, sessionId) => callback(sessionId));
  },

  // LAN peers
  getLanStatus: () => ipcRenderer.invoke('get-lan-status'),
  onLanPeerDiscovered: (callback) => {
    ipcRenderer.on('lan-peer-discovered', (_event, broker) => callback(broker));
  },

  // Platform
  platform: process.platform,

  // App version
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Auto-updater
  updaterCheck: () => ipcRenderer.invoke('updater-check'),
  updaterDownload: () => ipcRenderer.invoke('updater-download'),
  updaterInstall: () => ipcRenderer.invoke('updater-install'),
  onUpdaterEvent: (callback) => {
    ipcRenderer.on('updater-event', (_event, type, data) => callback(type, data));
  },

  // MCP bridge (main → renderer)
  onMcpOpenDiff: (callback) => {
    ipcRenderer.on('mcp-open-diff', (_event, sessionId, diffId, data) => callback(sessionId, diffId, data));
  },
  onMcpOpenFile: (callback) => {
    ipcRenderer.on('mcp-open-file', (_event, sessionId, data) => callback(sessionId, data));
  },
  onMcpCloseAllDiffs: (callback) => {
    ipcRenderer.on('mcp-close-all-diffs', (_event, sessionId) => callback(sessionId));
  },
  onMcpCloseTab: (callback) => {
    ipcRenderer.on('mcp-close-tab', (_event, sessionId, diffId) => callback(sessionId, diffId));
  },

  // MCP bridge (renderer → main)
  mcpDiffResponse: (sessionId, diffId, action, editedContent) => {
    ipcRenderer.send('mcp-diff-response', sessionId, diffId, action, editedContent);
  },
  readFileForPanel: (filePath) => ipcRenderer.invoke('read-file-for-panel', filePath),

  // Peers broker
  peerList: (scope, cwd, gitRoot, excludeId) => ipcRenderer.invoke('peer-list', scope, cwd, gitRoot, excludeId),
  peerSendMessage: (fromId, toId, text) => ipcRenderer.invoke('peer-send-message', fromId, toId, text),
  peerSetSummary: (peerId, summary) => ipcRenderer.invoke('peer-set-summary', peerId, summary),
  peerGetSessionPeer: (sessionId) => ipcRenderer.invoke('peer-get-session-peer', sessionId),
  onPeerMessage: (callback) => {
    ipcRenderer.on('peer-message', (_event, msg) => callback(msg));
  },
  onPeersChanged: (callback) => {
    ipcRenderer.on('peers-changed', () => callback());
  },
  onPanelZoom: (callback) => {
    ipcRenderer.on('panel-zoom', (_event, direction) => callback(direction));
  },
});
