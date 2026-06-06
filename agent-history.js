/**
 * agent-history.js — Per-CLI session-history discovery and parsing.
 *
 * Each entry maps an agent id → { historyDir(), getSessions(), parseSession() }.
 * getSessions() mines that CLI's on-disk session store to find sessions (and the
 * project folder they belong to); parseSession() extracts message/turn counts.
 *
 * Exposed as a factory so the one main-process dependency (getAllCached, used by
 * the aider adapter to locate project paths) can be injected, keeping this module
 * free of Electron imports and therefore unit-testable in plain Node.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

function createAgentHistory({ getAllCached = () => [] } = {}) {
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
    // --- Focus agents -------------------------------------------------------
    // Antigravity CLI (`antigravity` / `agy`). Conversation transcripts live at
    // ~/.gemini/antigravity-cli/brain/<conversation-id>/.system_generated/logs/*.jsonl
    antigravity: {
      historyDir: () => path.join(os.homedir(), '.gemini', 'antigravity-cli'),
      getSessions: () => {
        const brainDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
        const sessions = [];
        if (!fs.existsSync(brainDir)) return sessions;
        try {
          for (const convo of fs.readdirSync(brainDir, { withFileTypes: true })) {
            if (!convo.isDirectory()) continue;
            const logsDir = path.join(brainDir, convo.name, '.system_generated', 'logs');
            let files = [];
            try { files = fs.readdirSync(logsDir).filter(f => f.endsWith('.jsonl')); } catch { continue; }
            if (files.length === 0) continue;
            // Pick the most recently modified transcript as the session representative.
            let best = null;
            for (const f of files) {
              const fp = path.join(logsDir, f);
              try {
                const fstat = fs.statSync(fp);
                if (!best || fstat.mtimeMs > best.mtimeMs) best = { fp, mtimeMs: fstat.mtimeMs, size: fstat.size, mtime: fstat.mtime };
              } catch {}
            }
            if (!best) continue;
            sessions.push({
              id: convo.name,
              file: best.fp,
              modified: best.mtime,
              size: best.size,
              agent: 'antigravity',
            });
          }
        } catch {}
        return sessions;
      },
      parseSession: (filePath) => {
        try {
          const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
          let userMsgs = 0, assistantMsgs = 0, toolUses = 0, cwd = null;
          for (const line of lines) {
            try {
              const obj = JSON.parse(line);
              const role = obj.role || obj.type || obj.author;
              if (role === 'user' || role === 'human' || role === 'user_request') userMsgs++;
              else if (role === 'assistant' || role === 'agent' || role === 'model' || role === 'ai') assistantMsgs++;
              if (obj.type === 'tool_call' || obj.type === 'tool_use' || obj.type === 'tool_result' || obj.tool_calls) toolUses++;
              if (!cwd) cwd = obj.cwd || obj.workingDirectory || obj.working_directory || obj.payload?.cwd || null;
            } catch {}
          }
          return { userMessages: userMsgs, assistantMessages: assistantMsgs, toolUses, cwd, totalLines: lines.length };
        } catch { return null; }
      },
    },
    // Pi coding agent (`pi`). Sessions auto-save to ~/.pi/agent/sessions/,
    // organized by working directory, as JSONL files with a tree structure.
    pi: {
      historyDir: () => path.join(os.homedir(), '.pi'),
      getSessions: () => {
        const baseDir = path.join(os.homedir(), '.pi', 'agent', 'sessions');
        const sessions = [];
        if (!fs.existsSync(baseDir)) return sessions;
        function walk(dir) {
          try {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const fp = path.join(dir, entry.name);
              if (entry.isDirectory()) walk(fp);
              else if (entry.name.endsWith('.jsonl')) {
                const fstat = fs.statSync(fp);
                sessions.push({
                  id: entry.name.replace(/\.jsonl$/, ''),
                  file: fp,
                  project: path.basename(path.dirname(fp)),
                  modified: fstat.mtime,
                  size: fstat.size,
                  agent: 'pi',
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
          let userMsgs = 0, assistantMsgs = 0, toolUses = 0, cwd = null;
          for (const line of lines) {
            try {
              const obj = JSON.parse(line);
              const role = obj.role || obj.type;
              if (role === 'user' || role === 'human') userMsgs++;
              else if (role === 'assistant' || role === 'ai') assistantMsgs++;
              if (obj.type === 'tool_use' || obj.type === 'tool_result' || obj.tool_calls || obj.toolCall) toolUses++;
              if (!cwd) cwd = obj.cwd || obj.directory || obj.workingDirectory || null;
            } catch {}
          }
          return { userMessages: userMsgs, assistantMessages: assistantMsgs, toolUses, cwd, totalLines: lines.length };
        } catch { return null; }
      },
    },
    // Kilo Code CLI (`kilo`). Per-task conversation history under
    // ~/.kilocode/cli/tasks/<id>/ (api_conversation_history.json / ui_messages.json).
    kilo: {
      historyDir: () => path.join(os.homedir(), '.kilocode'),
      getSessions: () => {
        const tasksDir = path.join(os.homedir(), '.kilocode', 'cli', 'tasks');
        const sessions = [];
        if (!fs.existsSync(tasksDir)) return sessions;
        try {
          for (const task of fs.readdirSync(tasksDir, { withFileTypes: true })) {
            if (!task.isDirectory()) continue;
            const taskDir = path.join(tasksDir, task.name);
            // Prefer the API conversation history; fall back to ui_messages or any json/jsonl.
            const candidates = ['api_conversation_history.json', 'ui_messages.json'];
            let chosen = null;
            for (const c of candidates) {
              const fp = path.join(taskDir, c);
              if (fs.existsSync(fp)) { chosen = fp; break; }
            }
            if (!chosen) {
              try {
                const f = fs.readdirSync(taskDir).find(x => x.endsWith('.json') || x.endsWith('.jsonl'));
                if (f) chosen = path.join(taskDir, f);
              } catch {}
            }
            if (!chosen) continue;
            try {
              const fstat = fs.statSync(chosen);
              sessions.push({
                id: task.name,
                file: chosen,
                modified: fstat.mtime,
                size: fstat.size,
                agent: 'kilo',
              });
            } catch {}
          }
        } catch {}
        return sessions;
      },
      parseSession: (filePath) => {
        try {
          const raw = fs.readFileSync(filePath, 'utf8');
          let userMsgs = 0, assistantMsgs = 0, toolUses = 0, cwd = null, totalLines = 0;
          const countMsg = (m) => {
            if (!m) return;
            const role = m.role || m.type || m.say || m.ask;
            if (role === 'user' || role === 'human' || m.ask) userMsgs++;
            else if (role === 'assistant' || role === 'ai' || m.say) assistantMsgs++;
            if (m.type === 'tool_use' || m.tool_calls || (Array.isArray(m.content) && m.content.some(c => c.type === 'tool_use' || c.type === 'tool_result'))) toolUses++;
            if (!cwd) cwd = m.cwd || m.workspace || null;
          };
          if (filePath.endsWith('.jsonl')) {
            const lines = raw.split('\n').filter(Boolean);
            totalLines = lines.length;
            for (const line of lines) { try { countMsg(JSON.parse(line)); } catch {} }
          } else {
            const data = JSON.parse(raw);
            const arr = Array.isArray(data) ? data : (data.messages || data.history || []);
            totalLines = arr.length;
            for (const m of arr) countMsg(m);
          }
          return { userMessages: userMsgs, assistantMessages: assistantMsgs, toolUses, cwd, totalLines };
        } catch { return null; }
      },
    },
  };

  return AGENT_HISTORY;
}

module.exports = { createAgentHistory };
