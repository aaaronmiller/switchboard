const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createAgentHistory } = require('../agent-history');

// Run each agent's discovery against a fake HOME so we exercise the real
// filesystem-mining logic without touching the developer's actual CLI history.
function withFakeHome(fn) {
  const realHome = os.homedir;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-home-'));
  os.homedir = () => tmp;
  try {
    return fn(tmp);
  } finally {
    os.homedir = realHome;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function mkfile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

test('antigravity: discovers conversation transcripts and counts messages', () => {
  withFakeHome((home) => {
    const logsDir = path.join(home, '.gemini', 'antigravity-cli', 'brain', 'conv-123', '.system_generated', 'logs');
    mkfile(path.join(logsDir, 'transcript.jsonl'),
      '{"role":"user","cwd":"/work/proj"}\n{"role":"assistant"}\n{"type":"tool_call"}\n');

    const ah = createAgentHistory();
    const sessions = ah.antigravity.getSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, 'conv-123');
    assert.equal(sessions[0].agent, 'antigravity');

    const parsed = ah.antigravity.parseSession(sessions[0].file);
    assert.equal(parsed.userMessages, 1);
    assert.equal(parsed.assistantMessages, 1);
    assert.equal(parsed.toolUses, 1);
    assert.equal(parsed.cwd, '/work/proj');
  });
});

test('pi: discovers sessions organized by working directory', () => {
  withFakeHome((home) => {
    const base = path.join(home, '.pi', 'agent', 'sessions', 'my-project');
    mkfile(path.join(base, 'sess-a.jsonl'),
      '{"role":"user","cwd":"/home/me/my-project"}\n{"role":"assistant"}\n{"role":"user"}\n{"role":"assistant"}\n');

    const ah = createAgentHistory();
    const sessions = ah.pi.getSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, 'sess-a');
    assert.equal(sessions[0].agent, 'pi');
    assert.equal(sessions[0].project, 'my-project');

    const parsed = ah.pi.parseSession(sessions[0].file);
    assert.equal(parsed.userMessages, 2);
    assert.equal(parsed.assistantMessages, 2);
    assert.equal(parsed.cwd, '/home/me/my-project');
  });
});

test('kilo: discovers per-task conversation history (json array)', () => {
  withFakeHome((home) => {
    const taskDir = path.join(home, '.kilocode', 'cli', 'tasks', 'task-7');
    mkfile(path.join(taskDir, 'api_conversation_history.json'),
      JSON.stringify([
        { role: 'user', cwd: '/repo' },
        { role: 'assistant', content: [{ type: 'tool_use' }] },
        { role: 'user' },
      ]));

    const ah = createAgentHistory();
    const sessions = ah.kilo.getSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, 'task-7');
    assert.equal(sessions[0].agent, 'kilo');
    assert.ok(sessions[0].file.endsWith('api_conversation_history.json'));

    const parsed = ah.kilo.parseSession(sessions[0].file);
    assert.equal(parsed.userMessages, 2);
    assert.equal(parsed.assistantMessages, 1);
    assert.equal(parsed.toolUses, 1);
  });
});

test('agents return empty arrays (not throw) when history dirs are absent', () => {
  withFakeHome(() => {
    const ah = createAgentHistory();
    for (const id of ['antigravity', 'pi', 'kilo', 'codex', 'opencode']) {
      assert.deepEqual(ah[id].getSessions(), [], `${id} should return [] with no history`);
    }
  });
});

test('all focus agents are registered with the expected adapter shape', () => {
  const ah = createAgentHistory();
  for (const id of ['codex', 'opencode', 'antigravity', 'pi', 'kilo']) {
    assert.equal(typeof ah[id], 'object', `${id} adapter missing`);
    assert.equal(typeof ah[id].getSessions, 'function');
    assert.equal(typeof ah[id].parseSession, 'function');
    assert.equal(typeof ah[id].historyDir, 'function');
  }
});
