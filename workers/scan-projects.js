const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { getFolderIndexMtimeMs } = require('../folder-index-state');

const PROJECTS_DIR = workerData.projectsDir;

const { deriveProjectPath } = require('../derive-project-path');

function readFolderFromFilesystem(folder) {
  const folderPath = path.join(PROJECTS_DIR, folder);
  const projectPath = deriveProjectPath(folderPath, folder);
  if (!projectPath) return null;
  const sessions = [];
  const indexMtimeMs = getFolderIndexMtimeMs(folderPath);

  try {
    const jsonlFiles = fs.readdirSync(folderPath).filter(f => f.endsWith('.jsonl'));
    for (const file of jsonlFiles) {
      const filePath = path.join(folderPath, file);
      const sessionId = path.basename(file, '.jsonl');
      const stat = fs.statSync(filePath);
      let summary = '';
      let messageCount = 0;
      let textContent = '';
      let slug = null;
      let customTitle = null;
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens = 0;
      let cacheWriteTokens = 0;
      let lastModel = null;
      let loopCount = 0;
      let lastLoopAt = null;
      let lastLoopTool = null;
      let lastLoopReason = null;
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').filter(Boolean);
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
          // Token accumulation from assistant messages (Claude JSONL format)
          // Loop detection: Claude emits system messages with subtype 'loop' or 'loop_tool_call'
          if (entry.type === 'assistant' && entry.message?.usage) {
            const u = entry.message.usage;
            inputTokens += u.input_tokens || 0;
            outputTokens += u.output_tokens || 0;
            cacheReadTokens += u.cache_read_input_tokens || 0;
            cacheWriteTokens += u.cache_creation_input_tokens || 0;
            if (entry.message.model) lastModel = entry.message.model;
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
          // Loop detection: Claude emits system messages with subtype 'loop' or 'loop_tool_call'
          if (entry.type === 'system' && (entry.subtype === 'loop' || entry.subtype === 'loop_tool_call')) {
            loopCount++;
            lastLoopAt = entry.timestamp || null;
            // Extract tool name from the system message
            if (entry.system && typeof entry.system === 'object') {
              const s = entry.system;
              if (s.loop_tool) lastLoopTool = s.loop_tool;
              else if (s.tool) lastLoopTool = s.tool;
              if (s.loop_reason || s.reason) lastLoopReason = s.loop_reason || s.reason;
            } else if (typeof entry.system === 'string') {
              // Fallback: extract tool name from text
              const m = entry.system.match(/\b(Bash|Read|Search|Write|Edit|Glob|MCP|Task|Browse)\b/);
              if (m) lastLoopTool = m[1];
              const rm = entry.system.match(/reason[:\s]+([^.\n]{1,100})/i);
              if (rm) lastLoopReason = rm[1].trim();
            }
          }
        }
      } catch {}
      if (!summary || messageCount < 1) continue;
      sessions.push({
        sessionId, folder, projectPath,
        summary, firstPrompt: summary,
        created: stat.birthtime.toISOString(),
        modified: stat.mtime.toISOString(),
        messageCount, textContent, slug, customTitle,
        inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, model: lastModel,
        loopCount, lastLoopAt, lastLoopTool, lastLoopReason,
      });
    }
  } catch {}

  return { folder, projectPath, sessions, indexMtimeMs };
}

// Scan all folders
try {
  const folders = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== '.git')
    .map(d => d.name);

  const results = [];
  for (let i = 0; i < folders.length; i++) {
    if (i % 5 === 0 || i === folders.length - 1) {
      parentPort.postMessage({ type: 'progress', text: `Scanning projects (${i + 1}/${folders.length})\u2026` });
    }
    const result = readFolderFromFilesystem(folders[i]);
    if (result) results.push(result);
  }
  parentPort.postMessage({ ok: true, results });
} catch (err) {
  parentPort.postMessage({ ok: false, error: err.message });
}
