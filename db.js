const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(os.homedir(), '.switchboard');
const fs = require('fs');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'switchboard.db');

// Migrate from old locations if needed
const OLD_LOCATIONS = [
  path.join(os.homedir(), '.claude', 'browser', 'switchboard.db'),
  path.join(os.homedir(), '.claude', 'browser', 'session-browser.db'),
  path.join(os.homedir(), '.claude', 'session-browser.db'),
];
if (!fs.existsSync(DB_PATH)) {
  for (const oldPath of OLD_LOCATIONS) {
    if (fs.existsSync(oldPath)) {
      fs.renameSync(oldPath, DB_PATH);
      try { fs.renameSync(oldPath + '-wal', DB_PATH + '-wal'); } catch {}
      try { fs.renameSync(oldPath + '-shm', DB_PATH + '-shm'); } catch {}
      break;
    }
  }
}
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS session_meta (
    sessionId TEXT PRIMARY KEY,
    name TEXT,
    starred INTEGER DEFAULT 0,
    archived INTEGER DEFAULT 0
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS session_cache (
    sessionId TEXT PRIMARY KEY,
    folder TEXT NOT NULL,
    projectPath TEXT,
    summary TEXT,
    firstPrompt TEXT,
    created TEXT,
    modified TEXT,
    messageCount INTEGER DEFAULT 0,
    slug TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS cache_meta (
    folder TEXT PRIMARY KEY,
    projectPath TEXT,
    indexMtimeMs REAL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);

// Index for fast folder lookups
db.exec('CREATE INDEX IF NOT EXISTS idx_session_cache_folder ON session_cache(folder)');
db.exec('CREATE INDEX IF NOT EXISTS idx_session_cache_slug ON session_cache(slug)');

// --- FTS5 full-text search ---
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
    title, body, tokenize='trigram'
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS search_map (
    rowid INTEGER PRIMARY KEY,
    id TEXT NOT NULL,
    type TEXT NOT NULL,
    folder TEXT
  )
`);

db.exec('CREATE INDEX IF NOT EXISTS idx_search_map_type_id ON search_map(type, id)');

const stmts = {
  get: db.prepare('SELECT * FROM session_meta WHERE sessionId = ?'),
  getAll: db.prepare('SELECT * FROM session_meta'),
  upsertName: db.prepare(`
    INSERT INTO session_meta (sessionId, name) VALUES (?, ?)
    ON CONFLICT(sessionId) DO UPDATE SET name = excluded.name
  `),
  upsertStar: db.prepare(`
    INSERT INTO session_meta (sessionId, starred) VALUES (?, 1)
    ON CONFLICT(sessionId) DO UPDATE SET starred = CASE WHEN starred = 1 THEN 0 ELSE 1 END
  `),
  upsertArchived: db.prepare(`
    INSERT INTO session_meta (sessionId, archived) VALUES (?, ?)
    ON CONFLICT(sessionId) DO UPDATE SET archived = excluded.archived
  `),
  // Session cache statements
  cacheCount: db.prepare('SELECT COUNT(*) as cnt FROM session_cache'),
  cacheGetAll: db.prepare('SELECT * FROM session_cache'),
  cacheUpsert: db.prepare(`
    INSERT INTO session_cache (sessionId, folder, projectPath, summary, firstPrompt, created, modified, messageCount, slug)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(sessionId) DO UPDATE SET
      folder = excluded.folder, projectPath = excluded.projectPath,
      summary = excluded.summary, firstPrompt = excluded.firstPrompt,
      created = excluded.created, modified = excluded.modified,
      messageCount = excluded.messageCount, slug = excluded.slug
  `),
  cacheGetByFolder: db.prepare('SELECT sessionId, modified FROM session_cache WHERE folder = ?'),
  cacheGetFolder: db.prepare('SELECT folder FROM session_cache WHERE sessionId = ?'),
  cacheGetSession: db.prepare('SELECT * FROM session_cache WHERE sessionId = ?'),
  cacheDeleteSession: db.prepare('DELETE FROM session_cache WHERE sessionId = ?'),
  cacheDeleteFolder: db.prepare('DELETE FROM session_cache WHERE folder = ?'),
  // Cache meta statements
  metaGet: db.prepare('SELECT * FROM cache_meta WHERE folder = ?'),
  metaGetAll: db.prepare('SELECT * FROM cache_meta'),
  metaUpsert: db.prepare(`
    INSERT INTO cache_meta (folder, projectPath, indexMtimeMs)
    VALUES (?, ?, ?)
    ON CONFLICT(folder) DO UPDATE SET
      projectPath = excluded.projectPath, indexMtimeMs = excluded.indexMtimeMs
  `),
  metaDelete: db.prepare('DELETE FROM cache_meta WHERE folder = ?'),
  // FTS search statements
  searchDeleteBySession: db.prepare('DELETE FROM search_fts WHERE rowid IN (SELECT rowid FROM search_map WHERE type = \'session\' AND id = ?)'),
  searchMapDeleteBySession: db.prepare('DELETE FROM search_map WHERE type = \'session\' AND id = ?'),
  searchDeleteByFolder: db.prepare('DELETE FROM search_fts WHERE rowid IN (SELECT rowid FROM search_map WHERE type = \'session\' AND folder = ?)'),
  searchMapDeleteByFolder: db.prepare('DELETE FROM search_map WHERE type = \'session\' AND folder = ?'),
  searchDeleteByType: db.prepare('DELETE FROM search_fts WHERE rowid IN (SELECT rowid FROM search_map WHERE type = ?)'),
  searchMapDeleteByType: db.prepare('DELETE FROM search_map WHERE type = ?'),
  searchInsertFts: db.prepare('INSERT OR REPLACE INTO search_fts(rowid, title, body) VALUES (?, ?, ?)'),
  searchInsertMap: db.prepare('INSERT OR REPLACE INTO search_map(id, type, folder) VALUES (?, ?, ?)'),
  searchMapLookup: db.prepare('SELECT rowid FROM search_map WHERE id = ? AND type = ?'),
  searchUpdateTitle: db.prepare('UPDATE search_fts SET title = ? WHERE rowid = (SELECT rowid FROM search_map WHERE id = ? AND type = ?)'),
  searchDeleteByRowid: db.prepare('DELETE FROM search_fts WHERE rowid = ?'),
  searchMapDeleteByRowid: db.prepare('DELETE FROM search_map WHERE rowid = ?'),
  // Settings statements
  settingsGet: db.prepare('SELECT value FROM settings WHERE key = ?'),
  settingsUpsert: db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `),
  settingsDelete: db.prepare('DELETE FROM settings WHERE key = ?'),
  searchQuery: db.prepare(`
    SELECT search_map.id, snippet(search_fts, 1, '<mark>', '</mark>', '...', 40) as snippet
    FROM search_fts
    JOIN search_map ON search_fts.rowid = search_map.rowid
    WHERE search_map.type = ? AND search_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `),
};

function getMeta(sessionId) {
  return stmts.get.get(sessionId) || null;
}

function getAllMeta() {
  const rows = stmts.getAll.all();
  const map = new Map();
  for (const row of rows) map.set(row.sessionId, row);
  return map;
}

function setName(sessionId, name) {
  stmts.upsertName.run(sessionId, name);
}

function toggleStar(sessionId) {
  stmts.upsertStar.run(sessionId);
  const row = stmts.get.get(sessionId);
  return row.starred;
}

function setArchived(sessionId, archived) {
  stmts.upsertArchived.run(sessionId, archived ? 1 : 0);
}

// --- Session cache functions ---

function isCachePopulated() {
  return stmts.cacheCount.get().cnt > 0;
}

function getAllCached() {
  return stmts.cacheGetAll.all();
}

const upsertCachedSessionsBatch = db.transaction((sessions) => {
  for (const s of sessions) {
    stmts.cacheUpsert.run(
      s.sessionId, s.folder, s.projectPath, s.summary,
      s.firstPrompt, s.created, s.modified, s.messageCount || 0,
      s.slug || null
    );
  }
});

function upsertCachedSessions(sessions) {
  upsertCachedSessionsBatch(sessions);
}

function getCachedByFolder(folder) {
  return stmts.cacheGetByFolder.all(folder);
}

function getCachedFolder(sessionId) {
  const row = stmts.cacheGetFolder.get(sessionId);
  return row ? row.folder : null;
}

function getCachedSession(sessionId) {
  return stmts.cacheGetSession.get(sessionId) || null;
}

function deleteCachedSession(sessionId) {
  stmts.cacheDeleteSession.run(sessionId);
}

function deleteCachedFolder(folder) {
  stmts.cacheDeleteFolder.run(folder);
  stmts.metaDelete.run(folder);
}

function getFolderMeta(folder) {
  return stmts.metaGet.get(folder) || null;
}

function getAllFolderMeta() {
  const rows = stmts.metaGetAll.all();
  const map = new Map();
  for (const row of rows) map.set(row.folder, row);
  return map;
}

function setFolderMeta(folder, projectPath, indexMtimeMs) {
  stmts.metaUpsert.run(folder, projectPath, indexMtimeMs);
}

// --- FTS search functions ---

const upsertSearchEntriesBatch = db.transaction((entries) => {
  for (const e of entries) {
    // Delete any existing FTS row for this (id, type) pair before inserting.
    // search_map uses INSERT OR REPLACE which deletes the old row and creates
    // a new one with a new rowid, but the orphaned FTS5 row keyed to the old
    // rowid would never be cleaned up — causing duplicate search results and
    // unbounded FTS table growth.
    const existing = stmts.searchMapLookup.get(e.id, e.type);
    if (existing) {
      stmts.searchDeleteByRowid.run(existing.rowid);
      stmts.searchMapDeleteByRowid.run(existing.rowid);
    }
    const result = stmts.searchInsertMap.run(e.id, e.type, e.folder || null);
    stmts.searchInsertFts.run(result.lastInsertRowid, e.title || '', e.body || '');
  }
});

function deleteSearchSession(sessionId) {
  stmts.searchDeleteBySession.run(sessionId);
  stmts.searchMapDeleteBySession.run(sessionId);
}

function deleteSearchFolder(folder) {
  stmts.searchDeleteByFolder.run(folder);
  stmts.searchMapDeleteByFolder.run(folder);
}

function deleteSearchType(type) {
  stmts.searchDeleteByType.run(type);
  stmts.searchMapDeleteByType.run(type);
}

function upsertSearchEntries(entries) {
  upsertSearchEntriesBatch(entries);
}

function updateSearchTitle(id, type, title) {
  try {
    stmts.searchUpdateTitle.run(title, id, type);
  } catch {}
}

function searchByType(type, query, limit = 50) {
  try {
    // Wrap in double quotes for exact substring matching with trigram tokenizer.
    // This prevents FTS5 from splitting on punctuation (e.g. "spec.md" → "spec" + "md")
    const escaped = '"' + query.replace(/"/g, '""') + '"';
    return stmts.searchQuery.all(type, escaped, limit);
  } catch {
    return [];
  }
}

function isSearchIndexPopulated() {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM search_map WHERE type = ?').get('session');
  return row.cnt > 0;
}

// --- Settings functions ---

function getSetting(key) {
  const row = stmts.settingsGet.get(key);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

function setSetting(key, value) {
  stmts.settingsUpsert.run(key, JSON.stringify(value));
}

function deleteSetting(key) {
  stmts.settingsDelete.run(key);
}

// --- Token tracking ---

db.exec(`
  CREATE TABLE IF NOT EXISTS session_tokens (
    sessionId TEXT PRIMARY KEY,
    inputTokens INTEGER DEFAULT 0,
    outputTokens INTEGER DEFAULT 0,
    cacheReadTokens INTEGER DEFAULT 0,
    cacheWriteTokens INTEGER DEFAULT 0,
    model TEXT,
    updatedAt TEXT
  )
`);

db.exec('CREATE INDEX IF NOT EXISTS idx_session_tokens_model ON session_tokens(model)');

// --- Session templates ---
db.exec(`
  CREATE TABLE IF NOT EXISTS session_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    projectPath TEXT,
    prompt TEXT,
    options TEXT,
    createdAt TEXT,
    useCount INTEGER DEFAULT 0
  )
`);

db.exec('CREATE INDEX IF NOT EXISTS idx_session_templates_name ON session_templates(name)');

const tmplStmts = {
  insert: db.prepare(`INSERT INTO session_templates (id, name, description, projectPath, prompt, options, createdAt, useCount) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`),
  update: db.prepare(`UPDATE session_templates SET name = ?, description = ?, projectPath = ?, prompt = ?, options = ? WHERE id = ?`),
  upsert: db.prepare(`INSERT INTO session_templates (id, name, description, projectPath, prompt, options, createdAt, useCount) VALUES (?, ?, ?, ?, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, projectPath = excluded.projectPath, prompt = excluded.prompt, options = excluded.options`),
  get: db.prepare('SELECT * FROM session_templates WHERE id = ?'),
  getAll: db.prepare('SELECT * FROM session_templates ORDER BY useCount DESC, createdAt DESC'),
  delete: db.prepare('DELETE FROM session_templates WHERE id = ?'),
  incUse: db.prepare('UPDATE session_templates SET useCount = useCount + 1 WHERE id = ?'),
};

function generateTemplateId() {
  return 'tmpl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

function saveTemplate({ id, name, description, projectPath, prompt, options }) {
  const tid = id || generateTemplateId();
  const now = new Date().toISOString();
  const opts = typeof options === 'string' ? options : JSON.stringify(options || {});
  tmplStmts.upsert.run(tid, name, description || '', projectPath || '', prompt || '', opts, now);
  return tid;
}

function getTemplate(id) {
  const row = tmplStmts.get.get(id);
  if (!row) return null;
  try { row.options = JSON.parse(row.options); } catch { row.options = {}; }
  return row;
}

function getAllTemplates() {
  return tmplStmts.getAll.all().map(row => {
    try { row.options = JSON.parse(row.options); } catch { row.options = {}; }
    return row;
  });
}

function deleteTemplate(id) {
  tmplStmts.delete.run(id);
}

function incrementTemplateUse(id) {
  tmplStmts.incUse.run(id);
}

// --- Loop detection ---

db.exec(`
  CREATE TABLE IF NOT EXISTS session_loops (
    sessionId TEXT PRIMARY KEY,
    loopCount INTEGER DEFAULT 0,
    lastLoopAt TEXT,
    lastLoopTool TEXT,
    lastLoopReason TEXT,
    updatedAt TEXT
  )
`);

const loopStmts = {
  upsert: db.prepare(`
    INSERT INTO session_loops (sessionId, loopCount, lastLoopAt, lastLoopTool, lastLoopReason, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(sessionId) DO UPDATE SET
      loopCount = excluded.loopCount,
      lastLoopAt = excluded.lastLoopAt,
      lastLoopTool = excluded.lastLoopTool,
      lastLoopReason = excluded.lastLoopReason,
      updatedAt = excluded.updatedAt
  `),
  get: db.prepare('SELECT * FROM session_loops WHERE sessionId = ?'),
  getAll: db.prepare('SELECT * FROM session_loops'),
  delete: db.prepare('DELETE FROM session_loops WHERE sessionId = ?'),
};

const upsertLoopsBatch = db.transaction((entries) => {
  for (const e of entries) {
    loopStmts.upsert.run(
      e.sessionId, e.loopCount || 0,
      e.lastLoopAt || null, e.lastLoopTool || null,
      e.lastLoopReason || null, e.updatedAt || new Date().toISOString()
    );
  }
});

function upsertSessionLoops(entries) {
  upsertLoopsBatch(entries);
}

function getSessionLoops(sessionId) {
  return loopStmts.get.get(sessionId) || null;
}

function getAllSessionLoops() {
  const rows = loopStmts.getAll.all();
  const map = new Map();
  for (const row of rows) map.set(row.sessionId, row);
  return map;
}

function deleteSessionLoops(sessionId) {
  loopStmts.delete.run(sessionId);
}

const tokenStmts = {
  upsert: db.prepare(`
    INSERT INTO session_tokens (sessionId, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, model, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(sessionId) DO UPDATE SET
      inputTokens = excluded.inputTokens,
      outputTokens = excluded.outputTokens,
      cacheReadTokens = excluded.cacheReadTokens,
      cacheWriteTokens = excluded.cacheWriteTokens,
      model = excluded.model,
      updatedAt = excluded.updatedAt
  `),
  get: db.prepare('SELECT * FROM session_tokens WHERE sessionId = ?'),
  getAll: db.prepare('SELECT * FROM session_tokens'),
  delete: db.prepare('DELETE FROM session_tokens WHERE sessionId = ?'),
};

const upsertTokensBatch = db.transaction((entries) => {
  for (const e of entries) {
    tokenStmts.upsert.run(
      e.sessionId, e.inputTokens || 0, e.outputTokens || 0,
      e.cacheReadTokens || 0, e.cacheWriteTokens || 0,
      e.model || null, e.updatedAt || new Date().toISOString()
    );
  }
});

function upsertSessionTokens(entries) {
  upsertTokensBatch(entries);
}

function getSessionTokens(sessionId) {
  return tokenStmts.get.get(sessionId) || null;
}

function getAllSessionTokens() {
  const rows = tokenStmts.getAll.all();
  const map = new Map();
  for (const row of rows) map.set(row.sessionId, row);
  return map;
}

function deleteSessionTokens(sessionId) {
  tokenStmts.delete.run(sessionId);
}

// --- Peers broker tables ---

db.exec(`
  CREATE TABLE IF NOT EXISTS peers (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    pid INTEGER NOT NULL,
    cwd TEXT NOT NULL,
    git_root TEXT,
    agent TEXT NOT NULL DEFAULT 'claude',
    summary TEXT NOT NULL DEFAULT '',
    registered_at TEXT NOT NULL,
    last_seen TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS peer_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    text TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    delivered INTEGER NOT NULL DEFAULT 0
  )
`);

const peerStmts = {
  insertPeer: db.prepare(`INSERT OR REPLACE INTO peers (id, session_id, pid, cwd, git_root, agent, summary, registered_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  updateLastSeen: db.prepare(`UPDATE peers SET last_seen = ? WHERE id = ?`),
  updateSummary: db.prepare(`UPDATE peers SET summary = ? WHERE id = ?`),
  deletePeer: db.prepare(`DELETE FROM peers WHERE id = ?`),
  deletePeerBySession: db.prepare(`DELETE FROM peers WHERE session_id = ?`),
  selectAllPeers: db.prepare(`SELECT * FROM peers`),
  selectPeersByDir: db.prepare(`SELECT * FROM peers WHERE cwd = ?`),
  selectPeersByGitRoot: db.prepare(`SELECT * FROM peers WHERE git_root = ?`),
  selectPeerById: db.prepare(`SELECT * FROM peers WHERE id = ?`),
  insertMessage: db.prepare(`INSERT INTO peer_messages (from_id, to_id, text, sent_at, delivered) VALUES (?, ?, ?, ?, 0)`),
  selectUndelivered: db.prepare(`SELECT * FROM peer_messages WHERE to_id = ? AND delivered = 0 ORDER BY sent_at ASC`),
  markDelivered: db.prepare(`UPDATE peer_messages SET delivered = 1 WHERE id = ?`),
  cleanMessages: db.prepare(`DELETE FROM peer_messages WHERE to_id = ? AND delivered = 0`),
};

function generatePeerId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function peerRegister({ sessionId, pid, cwd, gitRoot, agent, summary }) {
  const id = generatePeerId();
  const now = new Date().toISOString();
  // Remove existing registration for this session (clean messages too)
  if (sessionId) {
    const existing = peerStmts.selectAllPeers.all().filter(p => p.session_id === sessionId);
    for (const p of existing) peerStmts.cleanMessages.run(p.id);
    peerStmts.deletePeerBySession.run(sessionId);
  }
  peerStmts.insertPeer.run(id, sessionId || null, pid, cwd, gitRoot || null, agent || 'claude', summary || '', now, now);
  return { id };
}

function peerHeartbeat(peerId) {
  peerStmts.updateLastSeen.run(new Date().toISOString(), peerId);
}

function peerSetSummary(peerId, summary) {
  peerStmts.updateSummary.run(summary, peerId);
}

function peerUnregister(peerId) {
  peerStmts.cleanMessages.run(peerId);
  peerStmts.deletePeer.run(peerId);
}

function peerUnregisterBySession(sessionId) {
  // Clean up messages for the peer before deleting
  const peers = peerStmts.selectAllPeers.all().filter(p => p.session_id === sessionId);
  for (const peer of peers) peerStmts.cleanMessages.run(peer.id);
  peerStmts.deletePeerBySession.run(sessionId);
}

function peerListAll(excludeId) {
  const peers = peerStmts.selectAllPeers.all();
  return excludeId ? peers.filter(p => p.id !== excludeId) : peers;
}

function peerListByDir(cwd, excludeId) {
  const peers = peerStmts.selectPeersByDir.all(cwd);
  return excludeId ? peers.filter(p => p.id !== excludeId) : peers;
}

function peerListByRepo(gitRoot, excludeId) {
  if (!gitRoot) return [];
  const peers = peerStmts.selectPeersByGitRoot.all(gitRoot);
  return excludeId ? peers.filter(p => p.id !== excludeId) : peers;
}

function peerGetById(peerId) {
  return peerStmts.selectPeerById.get(peerId) || null;
}

function peerSendMessage(fromId, toId, text) {
  const target = peerStmts.selectPeerById.get(toId);
  if (!target) return { ok: false, error: `Peer ${toId} not found` };
  peerStmts.insertMessage.run(fromId, toId, text, new Date().toISOString());
  return { ok: true };
}

function peerPollMessages(peerId) {
  const messages = peerStmts.selectUndelivered.all(peerId);
  for (const msg of messages) peerStmts.markDelivered.run(msg.id);
  return messages;
}

function peerCleanStale(activePids) {
  const all = peerStmts.selectAllPeers.all();
  let cleaned = 0;
  for (const peer of all) {
    if (!activePids.has(peer.pid)) {
      peerStmts.cleanMessages.run(peer.id);
      peerStmts.deletePeer.run(peer.id);
      cleaned++;
    }
  }
  return cleaned;
}

function closeDb() {
  try { db.close(); } catch {}
}

module.exports = {
  getMeta, getAllMeta, setName, toggleStar, setArchived,
  isCachePopulated, getAllCached, getCachedByFolder, getCachedFolder, getCachedSession, upsertCachedSessions,
  deleteCachedSession, deleteCachedFolder,
  getFolderMeta, getAllFolderMeta, setFolderMeta,
  upsertSearchEntries, updateSearchTitle, deleteSearchSession, deleteSearchFolder, deleteSearchType,
  searchByType, isSearchIndexPopulated,
  getSetting, setSetting, deleteSetting,
  closeDb,
  // Token tracking
  upsertSessionTokens, getSessionTokens, getAllSessionTokens, deleteSessionTokens,
  // Loop detection
  upsertSessionLoops, getSessionLoops, getAllSessionLoops, deleteSessionLoops,
  // Peers broker
  peerRegister, peerHeartbeat, peerSetSummary, peerUnregister, peerUnregisterBySession,
  peerListAll, peerListByDir, peerListByRepo, peerGetById,
  peerSendMessage, peerPollMessages, peerCleanStale,
};
