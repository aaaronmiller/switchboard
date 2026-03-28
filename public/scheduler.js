// ========== COMMAND SCHEDULER — Full Module ==========
// Provides: openScheduler, updateSchedulerBtnState, schedulerToggleBroadcast,
//           schedulerGetBroadcastTargets

// --- State ---
const schedulerInstances = new Map(); // sessionId → SchedulerState
let schedulerOverlayEl = null;
let schedulerActiveSessionId = null;
const sessionRoles = new Map(); // sessionId → Set<string>
const schedulerOutputBuffers = new Map(); // sessionId → { buffer, listeners[] }
const schedulerHistory = []; // [{ pattern, startTime, endTime, outcome, cycles }]
let broadcastEnabled = false;
let broadcastTargets = new Set();
let macroRecording = null; // null or { sessionId, steps[], lastTimestamp }

// --- SVG Icons (reusable) ---
const SCHED_ICONS = {
  clock: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  plus: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  x: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  up: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>',
  down: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>',
  play: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>',
  stop: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  save: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
  load: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  eye: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  broadcast: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.4"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.4"/><path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>',
  record: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg>',
  folder: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  breakpoint: '<svg width="10" height="10" viewBox="0 0 16 16" fill="#e05070"><circle cx="8" cy="8" r="6"/></svg>',
  gate: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  branch: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>',
  parallel: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  speed: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  comment: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="14" y2="15"/></svg>',
};

// Step type config for badges/colors
const STEP_TYPES = {
  command:          { badge: 'CMD',    cls: 'is-command',    color: '#8088ff' },
  wait:             { badge: 'WAIT',   cls: 'is-wait',       color: '#eab308' },
  'wait-for-output':{ badge: 'WATCH',  cls: 'is-watch',      color: '#3ecf5a' },
  gate:             { badge: 'GATE',   cls: 'is-gate',       color: '#c084fc' },
  parallel:         { badge: 'PAR',    cls: 'is-parallel',   color: '#22d3ee' },
  comment:          { badge: '—',      cls: 'is-comment',    color: '#555' },
  condition:        { badge: 'IF',     cls: 'is-condition',  color: '#fb923c' },
  'peer-message':   { badge: 'MSG',    cls: 'is-peer-msg',   color: '#60a5fa' },
  'launch-headless':{ badge: 'LAUNCH', cls: 'is-launch',     color: '#f472b6' },
};

// --- Helpers ---
function getSchedulerState(sessionId) {
  if (!schedulerInstances.has(sessionId)) {
    schedulerInstances.set(sessionId, {
      steps: [],
      targets: new Set([sessionId]),
      repeat: { enabled: false, interval: 60, count: 0, unit: 's' },
      variables: {},
      running: false,
      dryRun: false,
      speed: 1,
      currentStep: -1,
      abortController: null,
      cycleCount: 0,
    });
  }
  return schedulerInstances.get(sessionId);
}

function updateSchedulerBtnState(sessionId, btn) {
  const state = schedulerInstances.get(sessionId);
  const existing = btn.querySelector('.scheduler-running-dot');
  if (state && state.running) {
    if (!existing) { const d = document.createElement('span'); d.className = 'scheduler-running-dot'; btn.appendChild(d); }
    btn.classList.add('active');
  } else {
    if (existing) existing.remove();
    btn.classList.remove('active');
  }
}

function formatCountdown(ms) {
  if (ms <= 0) return '';
  const t = Math.ceil(ms / 1000);
  const m = Math.floor(t / 60), s = t % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
}

function schedulerWait(ms, signal, speed) {
  const actual = speed === Infinity ? 0 : Math.round(ms / (speed || 1));
  if (actual <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, actual);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
  });
}

function resolveVariables(text, vars) {
  if (!text) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (vars.hasOwnProperty(key)) return vars[key];
    return `{{${key}}}`;
  });
}

function buildRuntimeVars(state, stepIndex, targetSessionId) {
  const session = typeof sessionMap !== 'undefined' ? sessionMap.get(targetSessionId) : null;
  const builtins = {
    CYCLE: String(state.cycleCount + 1),
    STEP: String(stepIndex + 1),
    TIMESTAMP: new Date().toISOString(),
    TIME: new Date().toLocaleTimeString('en-US', { hour12: false }),
    DATE: new Date().toISOString().split('T')[0],
    SESSION_NAME: session ? (session.name || session.summary || targetSessionId) : targetSessionId,
    SESSION_ID: targetSessionId,
    PROJECT: session?.projectPath || '',
    RANDOM: Math.random().toString(16).slice(2, 10),
  };
  return { ...builtins, ...(state.variables || {}) };
}

function resolveStepTargets(step, state) {
  const targets = step.targets || null;
  if (!targets) return [...state.targets];
  const result = [];
  for (const t of targets) {
    if (t.startsWith('@')) {
      // Role-based targeting
      const role = t.slice(1);
      for (const [sid, roles] of sessionRoles) {
        if (roles.has(role) && openSessions.has(sid)) result.push(sid);
      }
    } else if (t === 'all') {
      for (const [sid, entry] of openSessions) {
        if (!entry.closed) result.push(sid);
      }
    } else if (openSessions.has(t)) {
      result.push(t);
    }
  }
  return result.length > 0 ? result : [...state.targets];
}

// --- Terminal Output Monitoring (for wait-for-output) ---
function initOutputBuffer(sessionId) {
  if (!schedulerOutputBuffers.has(sessionId)) {
    schedulerOutputBuffers.set(sessionId, { buffer: '', listeners: [] });
  }
}

function feedOutputBuffer(sessionId, data) {
  const buf = schedulerOutputBuffers.get(sessionId);
  if (!buf) return;
  buf.buffer += data;
  // Keep buffer manageable (last 50KB)
  if (buf.buffer.length > 50000) buf.buffer = buf.buffer.slice(-40000);
  // Notify listeners
  for (const listener of buf.listeners) {
    try { listener(data, buf.buffer); } catch {}
  }
}

function waitForOutput(sessionId, pattern, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    initOutputBuffer(sessionId);
    const buf = schedulerOutputBuffers.get(sessionId);
    let regex;
    try { regex = new RegExp(pattern); } catch { regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); }

    // Check existing buffer first
    if (regex.test(buf.buffer)) { resolve(); return; }

    let timer = null;
    const listener = (newData, fullBuffer) => {
      if (regex.test(fullBuffer)) {
        cleanup();
        resolve();
      }
    };

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      const idx = buf.listeners.indexOf(listener);
      if (idx >= 0) buf.listeners.splice(idx, 1);
    };

    buf.listeners.push(listener);

    if (timeoutMs > 0) {
      timer = setTimeout(() => { cleanup(); resolve(); }, timeoutMs); // resolve on timeout (don't fail)
    }

    if (signal) {
      signal.addEventListener('abort', () => { cleanup(); reject(new Error('aborted')); }, { once: true });
    }
  });
}

// Hook into terminal data — call this from app.js's onTerminalData handler
function schedulerOnTerminalData(sessionId, data) {
  feedOutputBuffer(sessionId, data);
}

// --- Session Roles ---
function getSessionRoles(sessionId) {
  if (!sessionRoles.has(sessionId)) sessionRoles.set(sessionId, new Set());
  return sessionRoles.get(sessionId);
}

function toggleSessionRole(sessionId, role) {
  const roles = getSessionRoles(sessionId);
  if (roles.has(role)) roles.delete(role); else roles.add(role);
}

const PRESET_ROLES = ['builder', 'tester', 'reviewer', 'deployer', 'monitor', 'architect'];

// --- Broadcast Mode ---
function schedulerToggleBroadcast(sessionId) {
  if (broadcastEnabled) {
    broadcastEnabled = false;
    broadcastTargets.clear();
    return false;
  }
  broadcastEnabled = true;
  broadcastTargets = new Set();
  for (const [sid, entry] of openSessions) {
    if (!entry.closed && sid !== sessionId) broadcastTargets.add(sid);
  }
  return true;
}

function schedulerGetBroadcastTargets() {
  if (!broadcastEnabled) return null;
  return broadcastTargets;
}

// --- Macro Recording ---
function startMacroRecording(sessionId) {
  macroRecording = { sessionId, steps: [], lastTimestamp: Date.now() };
}

function stopMacroRecording() {
  if (!macroRecording) return null;
  const result = macroRecording;
  macroRecording = null;
  return result;
}

function recordMacroInput(data) {
  if (!macroRecording) return;
  const now = Date.now();
  const gap = now - macroRecording.lastTimestamp;

  // Insert wait step if gap > 2s
  if (gap > 2000 && macroRecording.steps.length > 0) {
    const secs = Math.round(gap / 1000);
    macroRecording.steps.push({ type: 'wait', minutes: Math.floor(secs / 60), seconds: secs % 60 });
  }
  macroRecording.lastTimestamp = now;

  // If data ends with \r or \n, it's a command submission
  if (data.endsWith('\r') || data.endsWith('\n')) {
    const cmd = data.replace(/[\r\n]+$/, '');
    if (cmd) macroRecording.steps.push({ type: 'command', value: cmd });
  }
}

// --- Approval Gate UI ---
function showApprovalGate(message, signal) {
  return new Promise((resolve, reject) => {
    const overlay = document.createElement('div');
    overlay.className = 'scheduler-overlay';
    overlay.style.zIndex = '950';
    const sidebar = document.getElementById('sidebar');
    if (sidebar) overlay.style.left = sidebar.offsetWidth + 'px';

    const dialog = document.createElement('div');
    dialog.className = 'scheduler-panel';
    dialog.style.width = '420px';
    dialog.innerHTML = `
      <div class="scheduler-header">
        <h3>${SCHED_ICONS.gate} Approval Required</h3>
      </div>
      <div style="padding:20px;color:#b0b0c4;font-size:13px;line-height:1.6">${escapeHtml(message)}</div>
      <div class="scheduler-footer">
        <div class="scheduler-footer-left"></div>
        <div class="scheduler-footer-right">
          <button class="scheduler-cancel-btn sched-gate-abort">Abort</button>
          <button class="scheduler-save-btn sched-gate-skip">Skip</button>
          <button class="scheduler-run-btn sched-gate-continue">${SCHED_ICONS.play} Continue</button>
        </div>
      </div>
    `;

    dialog.querySelector('.sched-gate-continue').onclick = () => { overlay.remove(); resolve('continue'); };
    dialog.querySelector('.sched-gate-skip').onclick = () => { overlay.remove(); resolve('skip'); };
    dialog.querySelector('.sched-gate-abort').onclick = () => { overlay.remove(); resolve('abort'); };

    if (signal) {
      signal.addEventListener('abort', () => { overlay.remove(); reject(new Error('aborted')); }, { once: true });
    }

    overlay.appendChild(dialog);
    overlay.onclick = (e) => { if (e.target === overlay) { /* don't close gates on bg click */ } };
    document.body.appendChild(overlay);
  });
}

// --- Execution Engine ---
function stopScheduler(state) {
  state.running = false;
  state.currentStep = -1;
  state.cycleCount = 0;
  if (state.abortController) { state.abortController.abort(); state.abortController = null; }
  const btn = document.querySelector('.scheduler-btn');
  if (btn) updateSchedulerBtnState(state.sessionId || '', btn);
}

async function executeStep(step, state, signal, progressUI) {
  const speed = state.dryRun ? Infinity : (state.speed || 1);
  const targets = resolveStepTargets(step, state);
  const vars = buildRuntimeVars(state, state.currentStep, targets[0] || '');

  switch (step.type) {
    case 'command': {
      const cmd = resolveVariables(step.value || '', vars);
      if (cmd) {
        if (state.dryRun) {
          console.log(`[DRY RUN] → ${targets.join(', ')}: ${cmd}`);
          if (progressUI.countdown) progressUI.countdown.textContent = '[dry]';
        } else {
          for (const sid of targets) {
            if (openSessions.has(sid) && !openSessions.get(sid).closed) {
              window.api.sendInput(sid, cmd + '\r');
            }
          }
        }
      }
      await schedulerWait(100, signal, speed);
      break;
    }

    case 'wait': {
      const totalMs = ((step.minutes || 0) * 60 + (step.seconds || 0)) * 1000;
      if (totalMs > 0) {
        let remaining = Math.round(totalMs / (speed === Infinity ? 1 : speed));
        if (progressUI.countdown) progressUI.countdown.textContent = formatCountdown(remaining);
        const interval = setInterval(() => {
          remaining -= 1000;
          if (remaining < 0) remaining = 0;
          if (progressUI.countdown) progressUI.countdown.textContent = formatCountdown(remaining);
        }, 1000);
        try { await schedulerWait(totalMs, signal, speed); }
        finally { clearInterval(interval); if (progressUI.countdown) progressUI.countdown.textContent = ''; }
      }
      break;
    }

    case 'wait-for-output': {
      const target = targets[0];
      const timeout = (step.timeout || 300) * 1000;
      if (target) {
        initOutputBuffer(target);
        if (progressUI.countdown) progressUI.countdown.textContent = 'watching…';
        if (!state.dryRun) {
          await waitForOutput(target, step.pattern || '', timeout, signal);
        }
        if (progressUI.countdown) progressUI.countdown.textContent = '';
      }
      break;
    }

    case 'gate': {
      if (!state.dryRun) {
        const result = await showApprovalGate(resolveVariables(step.message || 'Continue?', vars), signal);
        if (result === 'abort') throw new Error('aborted');
        // 'skip' just continues to next step, 'continue' also continues
      }
      break;
    }

    case 'parallel': {
      if (step.steps && step.steps.length > 0) {
        const promises = step.steps.map(async (subStep) => {
          const subTargets = resolveStepTargets(subStep, state);
          const subVars = buildRuntimeVars(state, state.currentStep, subTargets[0] || '');
          if (subStep.type === 'command') {
            const cmd = resolveVariables(subStep.value || '', subVars);
            if (cmd && !state.dryRun) {
              for (const sid of subTargets) {
                if (openSessions.has(sid) && !openSessions.get(sid).closed) {
                  window.api.sendInput(sid, cmd + '\r');
                }
              }
            }
          }
        });
        await Promise.all(promises);
        await schedulerWait(100, signal, speed);
      }
      break;
    }

    case 'condition': {
      const target = targets[0];
      if (target) {
        initOutputBuffer(target);
        const buf = schedulerOutputBuffers.get(target);
        let regex;
        try { regex = new RegExp(step.pattern || ''); } catch { regex = /(?:)/; }
        const matched = regex.test(buf?.buffer || '');
        const branch = matched ? (step.thenSteps || []) : (step.elseSteps || []);
        for (const subStep of branch) {
          if (signal.aborted) throw new Error('aborted');
          await executeStep(subStep, state, signal, progressUI);
        }
      }
      break;
    }

    case 'comment':
      // No execution, just visual
      await schedulerWait(50, signal, Infinity);
      break;

    case 'peer-message': {
      const msg = resolveVariables(step.value || '', vars);
      if (msg && !state.dryRun) {
        for (const sid of targets) {
          try { await window.api.peerSendMessage('scheduler', sid, msg); } catch {}
        }
      }
      break;
    }

    case 'launch-headless': {
      if (!state.dryRun && step.prompt) {
        const prompt = resolveVariables(step.prompt, vars);
        const project = step.project || '';
        // Use the launchHeadless API if available
        try {
          const sid = crypto.randomUUID();
          await window.api.launchHeadless(sid, project, prompt, {});
        } catch (err) { console.error('Scheduler: headless launch failed:', err); }
      }
      break;
    }
  }
}

async function runScheduler(state, originSessionId, renderSteps, progressUI, runBtn) {
  state.running = true;
  state.sessionId = originSessionId;
  state.cycleCount = 0;
  state.abortController = new AbortController();
  const signal = state.abortController.signal;

  const headerBtn = document.querySelector('.scheduler-btn');
  if (headerBtn) updateSchedulerBtnState(originSessionId, headerBtn);

  if (progressUI.section) progressUI.section.style.display = 'flex';

  const totalSteps = state.steps.length;
  const startTime = Date.now();

  try {
    do {
      for (let i = 0; i < totalSteps; i++) {
        if (signal.aborted) throw new Error('aborted');

        const step = state.steps[i];

        // Check breakpoint
        if (step._breakpoint && !state.dryRun) {
          if (progressUI.countdown) progressUI.countdown.textContent = 'breakpoint';
          const gateResult = await showApprovalGate(`Breakpoint at step ${i + 1}: ${step.type}`, signal);
          if (gateResult === 'abort') throw new Error('aborted');
        }

        state.currentStep = i;
        renderSteps();

        const pct = Math.round((i / totalSteps) * 100);
        if (progressUI.fill) progressUI.fill.style.width = pct + '%';
        if (progressUI.text) progressUI.text.textContent = `${i + 1} / ${totalSteps}`;

        // Retry logic
        const maxRetries = step.retry?.count || 0;
        let attempt = 0;
        let success = false;
        while (!success) {
          try {
            await executeStep(step, state, signal, progressUI);
            success = true;

            // Check retry failure pattern
            if (maxRetries > 0 && step.retry?.pattern) {
              const target = resolveStepTargets(step, state)[0];
              if (target) {
                initOutputBuffer(target);
                const buf = schedulerOutputBuffers.get(target);
                let failRegex;
                try { failRegex = new RegExp(step.retry.pattern); } catch { failRegex = null; }
                if (failRegex && failRegex.test(buf?.buffer || '')) {
                  success = false;
                  attempt++;
                  if (attempt > maxRetries) { success = true; break; }
                  const retryDelay = (step.retry.delay || 5) * 1000;
                  if (progressUI.countdown) progressUI.countdown.textContent = `retry ${attempt}/${maxRetries}`;
                  await schedulerWait(retryDelay, signal, state.speed);
                }
              }
            }
          } catch (err) {
            if (err.message === 'aborted') throw err;
            attempt++;
            if (attempt > maxRetries) throw err;
            const retryDelay = (step.retry?.delay || 5) * 1000;
            await schedulerWait(retryDelay, signal, state.speed);
          }
        }
      }

      // Cycle complete
      if (progressUI.fill) progressUI.fill.style.width = '100%';
      state.currentStep = -1;
      state.cycleCount++;
      renderSteps();

      if (state.repeat.enabled) {
        if (state.repeat.count > 0 && state.cycleCount >= state.repeat.count) break;
        const unitMult = state.repeat.unit === 'h' ? 3600000 : state.repeat.unit === 'm' ? 60000 : 1000;
        const waitMs = (state.repeat.interval || 0) * unitMult;
        if (waitMs > 0) {
          let remaining = waitMs;
          if (progressUI.text) progressUI.text.textContent = `Cycle ${state.cycleCount} — repeating…`;
          if (progressUI.countdown) progressUI.countdown.textContent = formatCountdown(remaining);
          const interval = setInterval(() => {
            remaining -= 1000; if (remaining < 0) remaining = 0;
            if (progressUI.countdown) progressUI.countdown.textContent = formatCountdown(remaining);
          }, 1000);
          try { await schedulerWait(waitMs, signal, state.speed); }
          finally { clearInterval(interval); if (progressUI.countdown) progressUI.countdown.textContent = ''; }
        }
      }
    } while (state.repeat.enabled && !signal.aborted);

    schedulerHistory.push({ startTime, endTime: Date.now(), outcome: 'completed', cycles: state.cycleCount });
  } catch (err) {
    if (err.message !== 'aborted') console.error('Scheduler error:', err);
    schedulerHistory.push({ startTime, endTime: Date.now(), outcome: err.message === 'aborted' ? 'aborted' : 'error', cycles: state.cycleCount });
  } finally {
    state.running = false;
    state.currentStep = -1;
    state.abortController = null;
    if (progressUI.section) progressUI.section.style.display = 'none';
    if (progressUI.fill) progressUI.fill.style.width = '0%';
    if (progressUI.countdown) progressUI.countdown.textContent = '';
    renderSteps();
    updateRunBtn(runBtn, state);
    const hBtn = document.querySelector('.scheduler-btn');
    if (hBtn) updateSchedulerBtnState(originSessionId, hBtn);
  }
}

function updateRunBtn(btn, state) {
  if (!btn) return;
  btn.className = state.running ? 'scheduler-stop-run-btn' : 'scheduler-run-btn';
  btn.innerHTML = state.running ? `${SCHED_ICONS.stop} Stop` : `${SCHED_ICONS.play} Run`;
  btn.disabled = !state.running && state.steps.length === 0;
}

// --- JSON Save/Load ---
function stepsToJson(steps) {
  return steps.map(s => {
    const out = { type: s.type };
    if (s.type === 'command') { out.value = s.value || ''; if (s.targets) out.targets = s.targets; }
    else if (s.type === 'wait') { out.duration = (s.minutes || 0) * 60 + (s.seconds || 0); }
    else if (s.type === 'wait-for-output') { out.pattern = s.pattern || ''; out.timeout = s.timeout || 300; if (s.targets) out.targets = s.targets; }
    else if (s.type === 'gate') { out.message = s.message || ''; }
    else if (s.type === 'parallel') { out.steps = stepsToJson(s.steps || []); }
    else if (s.type === 'comment') { out.value = s.value || ''; }
    else if (s.type === 'condition') { out.pattern = s.pattern || ''; out.thenSteps = stepsToJson(s.thenSteps || []); out.elseSteps = stepsToJson(s.elseSteps || []); }
    else if (s.type === 'peer-message') { out.value = s.value || ''; if (s.targets) out.targets = s.targets; }
    else if (s.type === 'launch-headless') { out.prompt = s.prompt || ''; out.project = s.project || ''; }
    if (s.retry) out.retry = s.retry;
    if (s._breakpoint) out.breakpoint = true;
    return out;
  });
}

function jsonToSteps(arr) {
  return (arr || []).map(s => {
    const out = { type: s.type };
    if (s.type === 'command') { out.value = s.value || ''; if (s.targets) out.targets = s.targets; }
    else if (s.type === 'wait') { const d = s.duration || 0; out.minutes = Math.floor(d / 60); out.seconds = d % 60; }
    else if (s.type === 'wait-for-output') { out.pattern = s.pattern || ''; out.timeout = s.timeout || 300; if (s.targets) out.targets = s.targets; }
    else if (s.type === 'gate') { out.message = s.message || ''; }
    else if (s.type === 'parallel') { out.steps = jsonToSteps(s.steps || []); }
    else if (s.type === 'comment') { out.value = s.value || ''; }
    else if (s.type === 'condition') { out.pattern = s.pattern || ''; out.thenSteps = jsonToSteps(s.thenSteps || []); out.elseSteps = jsonToSteps(s.elseSteps || []); }
    else if (s.type === 'peer-message') { out.value = s.value || ''; if (s.targets) out.targets = s.targets; }
    else if (s.type === 'launch-headless') { out.prompt = s.prompt || ''; out.project = s.project || ''; }
    if (s.retry) out.retry = s.retry;
    if (s.breakpoint) out._breakpoint = true;
    return out;
  });
}

async function saveSchedulerPattern(state) {
  const pattern = {
    name: 'Scheduler Pattern',
    version: 2,
    steps: stepsToJson(state.steps),
    repeat: { enabled: state.repeat.enabled, interval: state.repeat.interval, unit: state.repeat.unit || 's', count: state.repeat.count },
    variables: state.variables || {},
  };
  try {
    const result = await window.api.schedulerSave(JSON.stringify(pattern));
    if (result.ok) {
      statusBarActivity.textContent = `Pattern saved to ${result.filePath.split('/').pop()}`;
      setTimeout(() => { statusBarActivity.textContent = ''; }, 3000);
    }
  } catch (err) { console.error('Failed to save scheduler pattern:', err); }
}

async function loadSchedulerPattern() {
  try {
    const result = await window.api.schedulerLoad();
    if (!result.ok) return null;
    const data = result.data;
    const steps = jsonToSteps(data.steps);
    const repeat = data.repeat || { enabled: false, interval: 60, count: 0, unit: 's' };
    const variables = data.variables || {};
    statusBarActivity.textContent = `Pattern loaded from ${result.filePath.split('/').pop()}`;
    setTimeout(() => { statusBarActivity.textContent = ''; }, 3000);
    return { steps, repeat, variables };
  } catch (err) { console.error('Failed to load scheduler pattern:', err); return null; }
}

function parseSimpleText(text) {
  const lines = text.split('\n');
  const steps = [];
  let blankCount = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { blankCount++; continue; }
    if (blankCount > 0 && steps.length > 0) {
      steps.push({ type: 'wait', minutes: 0, seconds: blankCount * 5 });
      blankCount = 0;
    }
    if (trimmed.startsWith('#')) {
      steps.push({ type: 'comment', value: trimmed.slice(1).trim() });
    } else if (trimmed.match(/^wait\s+/i)) {
      const match = trimmed.match(/^wait\s+(\d+)\s*(m|min|s|sec|h|hr)?/i);
      if (match) {
        const n = parseInt(match[1]);
        const u = (match[2] || 's')[0].toLowerCase();
        if (u === 'h') steps.push({ type: 'wait', minutes: n * 60, seconds: 0 });
        else if (u === 'm') steps.push({ type: 'wait', minutes: n, seconds: 0 });
        else steps.push({ type: 'wait', minutes: 0, seconds: n });
      }
    } else if (trimmed.match(/^gate\s+/i)) {
      steps.push({ type: 'gate', message: trimmed.slice(5).trim() });
    } else if (trimmed.match(/^watch\s+/i)) {
      const parts = trimmed.slice(6).trim();
      steps.push({ type: 'wait-for-output', pattern: parts, timeout: 300 });
    } else {
      steps.push({ type: 'command', value: trimmed });
    }
    blankCount = 0;
  }
  return steps;
}

// --- Step Row Rendering ---
function renderStepRow(step, i, state, renderSteps) {
  const info = STEP_TYPES[step.type] || STEP_TYPES.command;
  const row = document.createElement('div');
  row.className = `scheduler-step ${info.cls}`;
  if (state.running && state.currentStep === i) row.classList.add('active-step');

  // Breakpoint dot
  const bpDot = document.createElement('span');
  bpDot.className = 'scheduler-bp-dot' + (step._breakpoint ? ' active' : '');
  bpDot.title = 'Toggle breakpoint';
  bpDot.onclick = () => { step._breakpoint = !step._breakpoint; renderSteps(); };
  row.appendChild(bpDot);

  // Badge
  const badge = document.createElement('span');
  badge.className = 'scheduler-step-badge';
  badge.textContent = info.badge;
  badge.style.borderLeftColor = info.color;
  row.appendChild(badge);

  // Content depends on type
  switch (step.type) {
    case 'command':
    case 'peer-message': {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'scheduler-step-input';
      input.placeholder = step.type === 'peer-message' ? 'Peer message…' : 'Enter command…';
      input.value = step.value || '';
      input.oninput = () => { step.value = input.value; };
      input.disabled = state.running;
      row.appendChild(input);
      break;
    }
    case 'wait': {
      const wd = document.createElement('div');
      wd.className = 'scheduler-wait-inputs';
      const mi = _numInput(step.minutes || 0, 0, 999, v => { step.minutes = v; }, state.running);
      const ml = _label('m');
      const si = _numInput(step.seconds || 0, 0, 59, v => { step.seconds = v; }, state.running);
      const sl = _label('s');
      wd.append(mi, ml, si, sl);
      row.appendChild(wd);
      break;
    }
    case 'wait-for-output': {
      const wd = document.createElement('div');
      wd.className = 'scheduler-wait-inputs';
      wd.style.flex = '1';
      const ri = document.createElement('input');
      ri.type = 'text';
      ri.className = 'scheduler-step-input';
      ri.style.flex = '1';
      ri.placeholder = 'regex pattern…';
      ri.value = step.pattern || '';
      ri.oninput = () => { step.pattern = ri.value; };
      ri.disabled = state.running;
      const ti = _numInput(step.timeout || 300, 0, 9999, v => { step.timeout = v; }, state.running);
      ti.title = 'Timeout (seconds)';
      ti.style.width = '56px';
      const tl = _label('s timeout');
      tl.style.width = 'auto';
      wd.append(ri, ti, tl);
      row.appendChild(wd);
      break;
    }
    case 'gate': {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'scheduler-step-input';
      input.placeholder = 'Approval message…';
      input.value = step.message || '';
      input.oninput = () => { step.message = input.value; };
      input.disabled = state.running;
      row.appendChild(input);
      break;
    }
    case 'comment': {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'scheduler-step-input scheduler-comment-input';
      input.placeholder = 'Comment / label…';
      input.value = step.value || '';
      input.oninput = () => { step.value = input.value; };
      row.appendChild(input);
      break;
    }
    case 'condition': {
      const wd = document.createElement('div');
      wd.style.cssText = 'flex:1;font-size:11px;color:#fb923c';
      wd.textContent = `if /${step.pattern || '…'}/ → ${(step.thenSteps||[]).length} steps, else → ${(step.elseSteps||[]).length} steps`;
      row.appendChild(wd);
      break;
    }
    case 'parallel': {
      const wd = document.createElement('div');
      wd.style.cssText = 'flex:1;font-size:11px;color:#22d3ee';
      wd.textContent = `${(step.steps||[]).length} parallel steps`;
      row.appendChild(wd);
      break;
    }
    case 'launch-headless': {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'scheduler-step-input';
      input.placeholder = 'Headless prompt…';
      input.value = step.prompt || '';
      input.oninput = () => { step.prompt = input.value; };
      input.disabled = state.running;
      row.appendChild(input);
      break;
    }
  }

  // Per-step target indicator
  if (step.targets && step.type !== 'wait' && step.type !== 'comment') {
    const tgt = document.createElement('span');
    tgt.className = 'scheduler-step-target-badge';
    tgt.textContent = step.targets.length === 1 ? step.targets[0].slice(0, 8) : `${step.targets.length} targets`;
    tgt.title = 'Per-step targets: ' + step.targets.join(', ');
    tgt.onclick = () => {
      // Toggle target picker popover (simplified: cycle through current targets, all, default)
      if (!step.targets) { step.targets = ['all']; }
      else if (step.targets[0] === 'all') { step.targets = null; }
      else { step.targets = ['all']; }
      renderSteps();
    };
    row.appendChild(tgt);
  }

  // Actions
  if (!state.running) {
    const actions = document.createElement('div');
    actions.className = 'scheduler-step-actions';
    if (i > 0) { const b = _btn(SCHED_ICONS.up, 'Move up', () => { [state.steps[i-1], state.steps[i]] = [state.steps[i], state.steps[i-1]]; renderSteps(); }); actions.appendChild(b); }
    if (i < state.steps.length - 1) { const b = _btn(SCHED_ICONS.down, 'Move down', () => { [state.steps[i], state.steps[i+1]] = [state.steps[i+1], state.steps[i]]; renderSteps(); }); actions.appendChild(b); }
    const rb = _btn(SCHED_ICONS.x, 'Remove', () => { state.steps.splice(i, 1); renderSteps(); });
    rb.classList.add('remove-btn');
    actions.appendChild(rb);
    row.appendChild(actions);
  }

  return row;
}

function _numInput(val, min, max, onChange, disabled) {
  const i = document.createElement('input');
  i.type = 'number'; i.className = 'scheduler-wait-num';
  i.min = min; i.max = max; i.value = val;
  i.oninput = () => onChange(parseInt(i.value) || 0);
  i.disabled = disabled;
  return i;
}
function _label(text) {
  const s = document.createElement('span');
  s.className = 'scheduler-wait-unit';
  s.textContent = text;
  return s;
}
function _btn(svg, title, onclick) {
  const b = document.createElement('button');
  b.className = 'scheduler-step-btn';
  b.title = title;
  b.innerHTML = svg;
  b.onclick = onclick;
  return b;
}

// --- Main Overlay Builder ---
function openScheduler(sessionId) {
  if (schedulerOverlayEl) schedulerOverlayEl.remove();
  schedulerActiveSessionId = sessionId;
  const state = getSchedulerState(sessionId);

  const overlay = document.createElement('div');
  overlay.className = 'scheduler-overlay';
  schedulerOverlayEl = overlay;
  const sidebar = document.getElementById('sidebar');
  if (sidebar) overlay.style.left = sidebar.offsetWidth + 'px';

  const panel = document.createElement('div');
  panel.className = 'scheduler-panel';
  panel.style.width = '620px';

  // ── Header ──
  const header = document.createElement('div');
  header.className = 'scheduler-header';
  header.innerHTML = `<h3>${SCHED_ICONS.clock} Command Scheduler</h3>`;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'scheduler-close-btn';
  closeBtn.title = 'Close';
  closeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  closeBtn.onclick = () => { overlay.remove(); schedulerOverlayEl = null; };
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // ── Target selector ──
  const targetsSection = document.createElement('div');
  targetsSection.className = 'scheduler-targets';
  const targetsRow = document.createElement('div');
  targetsRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px';
  const targetsLabel = document.createElement('div');
  targetsLabel.className = 'scheduler-targets-label';
  targetsLabel.textContent = 'Send to';
  targetsLabel.style.marginBottom = '0';
  targetsRow.appendChild(targetsLabel);

  // Broadcast toggle
  const bcBtn = document.createElement('button');
  bcBtn.className = 'scheduler-add-btn' + (broadcastEnabled ? ' broadcast-active' : '');
  bcBtn.style.cssText = 'margin-left:auto;padding:3px 8px;font-size:10px';
  bcBtn.innerHTML = `${SCHED_ICONS.broadcast} Broadcast`;
  bcBtn.title = 'Toggle live broadcast mode (type to all sessions)';
  bcBtn.onclick = () => {
    const on = schedulerToggleBroadcast(sessionId);
    bcBtn.classList.toggle('broadcast-active', on);
    bcBtn.style.color = on ? '#3ecf5a' : '';
    bcBtn.style.borderColor = on ? 'rgba(62,207,90,0.4)' : '';
    statusBarActivity.textContent = on ? 'Broadcast mode ON — typing goes to all sessions' : 'Broadcast mode OFF';
    setTimeout(() => { statusBarActivity.textContent = ''; }, 3000);
  };
  targetsRow.appendChild(bcBtn);

  // Macro recording toggle
  const macroBtn = document.createElement('button');
  macroBtn.className = 'scheduler-add-btn' + (macroRecording ? ' macro-active' : '');
  macroBtn.style.cssText = 'padding:3px 8px;font-size:10px';
  macroBtn.innerHTML = `${SCHED_ICONS.record} ${macroRecording ? 'Stop Rec' : 'Record'}`;
  macroBtn.style.color = macroRecording ? '#e05070' : '';
  macroBtn.onclick = () => {
    if (macroRecording) {
      const recorded = stopMacroRecording();
      if (recorded && recorded.steps.length > 0) {
        state.steps.push(...recorded.steps);
        renderSteps();
        statusBarActivity.textContent = `Recorded ${recorded.steps.length} steps`;
      } else {
        statusBarActivity.textContent = 'Nothing recorded';
      }
      macroBtn.innerHTML = `${SCHED_ICONS.record} Record`;
      macroBtn.style.color = '';
      macroBtn.classList.remove('macro-active');
    } else {
      startMacroRecording(sessionId);
      macroBtn.innerHTML = `${SCHED_ICONS.record} Stop Rec`;
      macroBtn.style.color = '#e05070';
      macroBtn.classList.add('macro-active');
      statusBarActivity.textContent = 'Recording... type commands in the terminal';
    }
    setTimeout(() => { statusBarActivity.textContent = ''; }, 3000);
  };
  targetsRow.appendChild(macroBtn);
  targetsSection.appendChild(targetsRow);

  // Target chips
  const targetList = document.createElement('div');
  targetList.className = 'scheduler-target-list';
  targetsSection.appendChild(targetList);

  function refreshTargets() {
    targetList.innerHTML = '';
    for (const [sid, entry] of openSessions) {
      if (entry.closed) continue;
      const session = typeof sessionMap !== 'undefined' ? (sessionMap.get(sid) || entry.session) : entry.session;
      const chip = document.createElement('button');
      chip.className = 'scheduler-target-chip' + (state.targets.has(sid) ? ' selected' : '');
      const dn = (typeof cleanDisplayName !== 'undefined' ? cleanDisplayName(session.name || session.summary) : session.name) || sid.slice(0, 8);
      const roles = getSessionRoles(sid);
      const roleStr = roles.size > 0 ? ` [${[...roles].map(r => '@' + r).join(',')}]` : '';
      chip.innerHTML = `<span class="scheduler-target-dot"></span>${escapeHtml((dn.length > 20 ? dn.slice(0, 20) + '…' : dn) + roleStr)}`;
      chip.onclick = (e) => {
        if (e.shiftKey) {
          // Shift+click to assign role
          showRolePopover(sid, chip, refreshTargets);
          return;
        }
        if (state.targets.has(sid)) { if (state.targets.size > 1) state.targets.delete(sid); }
        else state.targets.add(sid);
        refreshTargets();
      };
      chip.title = 'Click to toggle target. Shift+click to assign roles.';
      targetList.appendChild(chip);
    }
  }
  refreshTargets();
  panel.appendChild(targetsSection);

  // ── Steps list ──
  const stepsContainer = document.createElement('div');
  stepsContainer.className = 'scheduler-steps';
  panel.appendChild(stepsContainer);

  function renderSteps() {
    stepsContainer.innerHTML = '';
    if (state.steps.length === 0) {
      stepsContainer.innerHTML = `<div class="scheduler-empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <div>No steps yet. Add commands, waits, or other steps below.</div>
      </div>`;
      return;
    }
    state.steps.forEach((step, i) => {
      stepsContainer.appendChild(renderStepRow(step, i, state, renderSteps));
    });
    stepsContainer.scrollTop = stepsContainer.scrollHeight;
  }
  renderSteps();

  // ── Add step buttons ──
  const addRow = document.createElement('div');
  addRow.className = 'scheduler-add-row';
  addRow.style.flexWrap = 'wrap';

  const addButtons = [
    { label: 'Command', type: 'command', cls: '', step: () => ({ type: 'command', value: '' }) },
    { label: 'Wait', type: 'wait', cls: 'add-wait', step: () => ({ type: 'wait', minutes: 0, seconds: 5 }) },
    { label: 'Watch Output', type: 'wait-for-output', cls: 'add-watch', step: () => ({ type: 'wait-for-output', pattern: '', timeout: 300 }) },
    { label: 'Gate', type: 'gate', cls: 'add-gate', step: () => ({ type: 'gate', message: 'Continue?' }) },
    { label: 'Comment', type: 'comment', cls: 'add-comment', step: () => ({ type: 'comment', value: '' }) },
    { label: 'Parallel', type: 'parallel', cls: 'add-parallel', step: () => ({ type: 'parallel', steps: [{ type: 'command', value: '' }, { type: 'command', value: '' }] }) },
    { label: 'Condition', type: 'condition', cls: 'add-condition', step: () => ({ type: 'condition', pattern: '', thenSteps: [{ type: 'command', value: '' }], elseSteps: [] }) },
    { label: 'Peer Msg', type: 'peer-message', cls: 'add-peer', step: () => ({ type: 'peer-message', value: '' }) },
    { label: 'Headless', type: 'launch-headless', cls: 'add-launch', step: () => ({ type: 'launch-headless', prompt: '', project: '' }) },
  ];

  for (const ab of addButtons) {
    const btn = document.createElement('button');
    btn.className = `scheduler-add-btn ${ab.cls}`;
    const icon = SCHED_ICONS[{ command: 'plus', wait: 'clock', 'wait-for-output': 'eye', gate: 'gate', comment: 'comment', parallel: 'parallel', condition: 'branch', 'peer-message': 'broadcast', 'launch-headless': 'speed' }[ab.type] || 'plus'];
    btn.innerHTML = `${icon} ${ab.label}`;
    btn.onclick = () => { state.steps.push(ab.step()); renderSteps(); };
    addRow.appendChild(btn);
  }
  panel.appendChild(addRow);

  // ── Paste/import text ──
  const importRow = document.createElement('div');
  importRow.style.cssText = 'padding:4px 20px 0';
  const importBtn = document.createElement('button');
  importBtn.className = 'scheduler-add-btn';
  importBtn.innerHTML = `${SCHED_ICONS.folder} Import text`;
  importBtn.title = 'Paste plain text: one command per line, blank line = wait, # = comment, "wait 5s" = wait';
  importBtn.onclick = () => {
    const ta = document.createElement('textarea');
    ta.className = 'scheduler-step-input';
    ta.style.cssText = 'width:100%;min-height:80px;resize:vertical;margin:8px 0';
    ta.placeholder = 'Paste commands (one per line)\n# comment\nwait 5s\n(blank line = 5s wait)';
    const applyBtn = document.createElement('button');
    applyBtn.className = 'scheduler-run-btn';
    applyBtn.style.cssText = 'margin-top:4px;font-size:11px;padding:4px 12px';
    applyBtn.textContent = 'Import';
    applyBtn.onclick = () => {
      const steps = parseSimpleText(ta.value);
      if (steps.length) { state.steps.push(...steps); renderSteps(); }
      importRow.innerHTML = '';
      importRow.appendChild(importBtn);
    };
    importRow.innerHTML = '';
    importRow.append(ta, applyBtn);
    setTimeout(() => ta.focus(), 50);
  };
  importRow.appendChild(importBtn);
  panel.appendChild(importRow);

  // ── Variables section ──
  const varsSection = document.createElement('div');
  varsSection.className = 'scheduler-repeat';
  varsSection.style.flexDirection = 'column';
  varsSection.style.alignItems = 'stretch';

  const varsHeader = document.createElement('div');
  varsHeader.style.cssText = 'display:flex;align-items:center;gap:8px';
  const varsLabel = document.createElement('span');
  varsLabel.style.cssText = 'font-size:11px;font-weight:600;color:#7a7a90;text-transform:uppercase;letter-spacing:0.05em';
  varsLabel.textContent = 'Variables';
  const addVarBtn = document.createElement('button');
  addVarBtn.className = 'scheduler-step-btn';
  addVarBtn.title = 'Add variable';
  addVarBtn.innerHTML = SCHED_ICONS.plus;
  addVarBtn.style.marginLeft = 'auto';
  addVarBtn.onclick = () => {
    const name = prompt('Variable name (e.g., BRANCH):');
    if (name) { state.variables[name.toUpperCase()] = ''; renderVars(); }
  };
  varsHeader.append(varsLabel, addVarBtn);
  varsSection.appendChild(varsHeader);

  const varsBody = document.createElement('div');
  varsBody.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px';
  varsSection.appendChild(varsBody);

  function renderVars() {
    varsBody.innerHTML = '';
    const keys = Object.keys(state.variables || {});
    if (keys.length === 0) {
      varsBody.innerHTML = '<span style="font-size:10px;color:#555">Use {{VAR}} in commands. Built-ins: CYCLE, TIMESTAMP, SESSION_NAME, PROJECT, DATE, TIME</span>';
      return;
    }
    for (const key of keys) {
      const chip = document.createElement('div');
      chip.style.cssText = 'display:flex;align-items:center;gap:4px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:5px;padding:2px 6px';
      chip.innerHTML = `<span style="font-size:10px;color:#8088ff;font-weight:600">{{${escapeHtml(key)}}}</span>`;
      const vi = document.createElement('input');
      vi.type = 'text';
      vi.value = state.variables[key] || '';
      vi.placeholder = 'value';
      vi.style.cssText = 'background:transparent;border:none;color:#d0d0e0;font-size:11px;width:80px;outline:none;font-family:inherit';
      vi.oninput = () => { state.variables[key] = vi.value; };
      const del = document.createElement('button');
      del.className = 'scheduler-step-btn remove-btn';
      del.innerHTML = SCHED_ICONS.x;
      del.onclick = () => { delete state.variables[key]; renderVars(); };
      chip.append(vi, del);
      varsBody.appendChild(chip);
    }
  }
  renderVars();
  panel.appendChild(varsSection);

  // ── Repeat config ──
  const repeatSection = document.createElement('div');
  repeatSection.className = 'scheduler-repeat';

  const repeatLabel = document.createElement('label');
  const repeatCheck = document.createElement('input');
  repeatCheck.type = 'checkbox';
  repeatCheck.checked = state.repeat.enabled;
  repeatCheck.onchange = () => { state.repeat.enabled = repeatCheck.checked; repeatConfig.style.display = repeatCheck.checked ? 'flex' : 'none'; };
  repeatLabel.append(repeatCheck, document.createTextNode(' Repeat'));
  repeatSection.appendChild(repeatLabel);

  const repeatConfig = document.createElement('div');
  repeatConfig.className = 'scheduler-repeat-config';
  repeatConfig.style.display = state.repeat.enabled ? 'flex' : 'none';
  repeatConfig.innerHTML = '<span>every</span>';
  const rInt = _numInput(state.repeat.interval, 0, 99999, v => { state.repeat.interval = v; }, false);
  rInt.className = 'scheduler-repeat-input';
  const rUnit = document.createElement('select');
  rUnit.className = 'scheduler-repeat-select';
  rUnit.innerHTML = '<option value="s">sec</option><option value="m">min</option><option value="h">hr</option>';
  rUnit.value = state.repeat.unit || 's';
  rUnit.onchange = () => { state.repeat.unit = rUnit.value; };
  const rCountLabel = document.createElement('span');
  rCountLabel.textContent = '×';
  const rCount = _numInput(state.repeat.count, 0, 9999, v => { state.repeat.count = v; }, false);
  rCount.className = 'scheduler-repeat-input';
  rCount.title = '0 = infinite';
  rCount.placeholder = '∞';
  repeatConfig.append(rInt, rUnit, rCountLabel, rCount);
  repeatSection.appendChild(repeatConfig);
  panel.appendChild(repeatSection);

  // ── Speed / Dry Run / History ──
  const controlRow = document.createElement('div');
  controlRow.className = 'scheduler-repeat';
  controlRow.style.gap = '12px';

  // Speed
  const speedLabel = document.createElement('label');
  speedLabel.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:11px;color:#7a7a90';
  speedLabel.innerHTML = `${SCHED_ICONS.speed} Speed`;
  const speedSel = document.createElement('select');
  speedSel.className = 'scheduler-repeat-select';
  speedSel.innerHTML = '<option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="5">5×</option><option value="10">10×</option><option value="Infinity">∞ Skip waits</option>';
  speedSel.value = String(state.speed || 1);
  speedSel.onchange = () => { state.speed = speedSel.value === 'Infinity' ? Infinity : parseFloat(speedSel.value); };
  speedLabel.appendChild(speedSel);
  controlRow.appendChild(speedLabel);

  // Dry Run
  const dryLabel = document.createElement('label');
  dryLabel.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:11px;color:#7a7a90';
  const dryCheck = document.createElement('input');
  dryCheck.type = 'checkbox';
  dryCheck.checked = state.dryRun || false;
  dryCheck.onchange = () => { state.dryRun = dryCheck.checked; };
  dryCheck.style.accentColor = '#eab308';
  dryLabel.append(dryCheck, document.createTextNode('Dry Run'));
  controlRow.appendChild(dryLabel);

  // History
  if (schedulerHistory.length > 0) {
    const last = schedulerHistory[schedulerHistory.length - 1];
    const dur = Math.round((last.endTime - last.startTime) / 1000);
    const histSpan = document.createElement('span');
    histSpan.style.cssText = 'font-size:10px;color:#555;margin-left:auto';
    histSpan.textContent = `Last: ${last.outcome} (${dur}s, ${last.cycles} cycles)`;
    controlRow.appendChild(histSpan);
  }

  panel.appendChild(controlRow);

  // ── Progress ──
  const progressSection = document.createElement('div');
  progressSection.className = 'scheduler-progress';
  progressSection.style.display = state.running ? 'flex' : 'none';
  progressSection.innerHTML = `<div class="scheduler-progress-bar"><div class="scheduler-progress-fill" style="width:0%"></div></div><span class="scheduler-progress-text">0 / 0</span><span class="scheduler-countdown"></span>`;
  panel.appendChild(progressSection);

  const progressUI = {
    section: progressSection,
    fill: progressSection.querySelector('.scheduler-progress-fill'),
    text: progressSection.querySelector('.scheduler-progress-text'),
    countdown: progressSection.querySelector('.scheduler-countdown'),
  };

  // ── Footer ──
  const footer = document.createElement('div');
  footer.className = 'scheduler-footer';

  const footerLeft = document.createElement('div');
  footerLeft.className = 'scheduler-footer-left';

  const saveBtn = _footerBtn(SCHED_ICONS.save + ' Save', 'scheduler-save-btn', () => saveSchedulerPattern(state));
  const loadBtn = _footerBtn(SCHED_ICONS.load + ' Load', 'scheduler-load-btn', async () => {
    const result = await loadSchedulerPattern();
    if (result) {
      state.steps = result.steps || [];
      state.repeat = result.repeat || state.repeat;
      state.variables = result.variables || {};
      repeatCheck.checked = state.repeat.enabled;
      repeatConfig.style.display = state.repeat.enabled ? 'flex' : 'none';
      rInt.value = state.repeat.interval;
      rUnit.value = state.repeat.unit || 's';
      rCount.value = state.repeat.count;
      refreshTargets();
      renderSteps();
      renderVars();
    }
  });

  // Library button
  const libBtn = _footerBtn(SCHED_ICONS.folder + ' Library', 'scheduler-load-btn', () => {
    showPatternLibrary(state, () => { renderSteps(); renderVars(); refreshTargets(); repeatCheck.checked = state.repeat.enabled; repeatConfig.style.display = state.repeat.enabled ? 'flex' : 'none'; });
  });

  footerLeft.append(saveBtn, loadBtn, libBtn);

  const footerRight = document.createElement('div');
  footerRight.className = 'scheduler-footer-right';
  const cancelBtn = _footerBtn('Close', 'scheduler-cancel-btn', () => { overlay.remove(); schedulerOverlayEl = null; });
  const runBtn = document.createElement('button');
  updateRunBtn(runBtn, state);

  runBtn.onclick = () => {
    if (state.running) {
      stopScheduler(state);
    } else {
      // If variables exist and have empty values, show param UI
      const emptyVars = Object.entries(state.variables || {}).filter(([, v]) => !v);
      if (emptyVars.length > 0) {
        // Quick inline prompt for empty vars
        for (const [key] of emptyVars) {
          const val = prompt(`Enter value for {{${key}}}:`, '');
          if (val !== null) state.variables[key] = val;
        }
        renderVars();
      }
      runScheduler(state, sessionId, renderSteps, progressUI, runBtn);
    }
    updateRunBtn(runBtn, state);
  };

  footerRight.append(cancelBtn, runBtn);
  footer.append(footerLeft, footerRight);
  panel.appendChild(footer);

  overlay.appendChild(panel);
  overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); schedulerOverlayEl = null; } };
  document.body.appendChild(overlay);
}

function _footerBtn(html, cls, onclick) {
  const b = document.createElement('button');
  b.className = cls;
  b.innerHTML = html;
  b.onclick = onclick;
  return b;
}

// --- Role Assignment Popover ---
function showRolePopover(sessionId, anchor, onUpdate) {
  document.querySelectorAll('.scheduler-role-popover').forEach(p => p.remove());
  const roles = getSessionRoles(sessionId);
  const pop = document.createElement('div');
  pop.className = 'scheduler-role-popover';
  pop.style.cssText = 'position:fixed;z-index:1100;background:#1e1e2a;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px;box-shadow:0 8px 24px rgba(0,0,0,0.4);min-width:140px';
  const title = document.createElement('div');
  title.style.cssText = 'font-size:10px;color:#7a7a90;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;padding:0 4px';
  title.textContent = 'Assign Roles';
  pop.appendChild(title);

  for (const role of PRESET_ROLES) {
    const btn = document.createElement('button');
    btn.style.cssText = 'display:flex;align-items:center;gap:6px;width:100%;padding:4px 8px;background:none;border:none;color:#b0b0c4;font-size:11px;cursor:pointer;border-radius:4px;font-family:inherit;text-align:left';
    const check = roles.has(role) ? '✓' : '○';
    btn.innerHTML = `<span style="color:${roles.has(role) ? '#8088ff' : '#555'};font-size:13px">${check}</span> @${role}`;
    btn.onmouseenter = () => { btn.style.background = 'rgba(255,255,255,0.05)'; };
    btn.onmouseleave = () => { btn.style.background = 'none'; };
    btn.onclick = () => { toggleSessionRole(sessionId, role); onUpdate(); pop.remove(); };
    pop.appendChild(btn);
  }

  // Custom role input
  const customRow = document.createElement('div');
  customRow.style.cssText = 'margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.06)';
  const ci = document.createElement('input');
  ci.type = 'text';
  ci.placeholder = 'custom role…';
  ci.style.cssText = 'width:100%;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.06);border-radius:4px;color:#d0d0e0;font-size:11px;padding:4px 6px;outline:none;font-family:inherit;box-sizing:border-box';
  ci.onkeydown = (e) => {
    if (e.key === 'Enter' && ci.value.trim()) {
      toggleSessionRole(sessionId, ci.value.trim().toLowerCase());
      onUpdate(); pop.remove();
    }
  };
  customRow.appendChild(ci);
  pop.appendChild(customRow);

  const rect = anchor.getBoundingClientRect();
  pop.style.top = (rect.bottom + 4) + 'px';
  pop.style.left = rect.left + 'px';
  document.body.appendChild(pop);

  const closeHandler = (e) => { if (!pop.contains(e.target) && e.target !== anchor) { pop.remove(); document.removeEventListener('mousedown', closeHandler); } };
  setTimeout(() => document.addEventListener('mousedown', closeHandler), 10);
}

// --- Pattern Library Browser ---
function showPatternLibrary(state, onApply) {
  const overlay = document.createElement('div');
  overlay.className = 'scheduler-overlay';
  overlay.style.zIndex = '960';
  const sidebar = document.getElementById('sidebar');
  if (sidebar) overlay.style.left = sidebar.offsetWidth + 'px';

  const panel = document.createElement('div');
  panel.className = 'scheduler-panel';
  panel.style.width = '560px';
  panel.style.maxHeight = '80vh';

  panel.innerHTML = `
    <div class="scheduler-header"><h3>${SCHED_ICONS.folder} Pattern Library</h3></div>
  `;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'scheduler-close-btn';
  closeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  closeBtn.onclick = () => overlay.remove();
  panel.querySelector('.scheduler-header').appendChild(closeBtn);

  const body = document.createElement('div');
  body.style.cssText = 'overflow-y:auto;max-height:60vh;padding:12px 20px';

  const patterns = typeof SCHEDULER_PATTERNS !== 'undefined' ? SCHEDULER_PATTERNS : [];
  const categories = {};
  for (const p of patterns) {
    const cat = p.category || 'Other';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(p);
  }

  for (const [cat, pats] of Object.entries(categories)) {
    const catDiv = document.createElement('div');
    catDiv.style.marginBottom = '16px';
    const catLabel = document.createElement('div');
    catLabel.style.cssText = 'font-size:11px;font-weight:700;color:#7a7a90;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px';
    catLabel.textContent = cat;
    catDiv.appendChild(catLabel);

    for (const pat of pats) {
      const btn = document.createElement('button');
      btn.style.cssText = 'display:block;width:100%;text-align:left;padding:10px 12px;margin-bottom:6px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:8px;cursor:pointer;transition:all 0.15s;font-family:inherit';
      btn.innerHTML = `<div style="font-size:13px;color:#d0d0e8;font-weight:500;margin-bottom:3px">${escapeHtml(pat.name)}</div><div style="font-size:11px;color:#7a7a90;line-height:1.4">${escapeHtml(pat.description || '')}</div><div style="font-size:10px;color:#555;margin-top:4px">${pat.steps.length} steps${pat.variables ? ' · ' + Object.keys(pat.variables).length + ' variables' : ''}</div>`;
      btn.onmouseenter = () => { btn.style.borderColor = 'rgba(128,136,255,0.3)'; btn.style.background = 'rgba(128,136,255,0.04)'; };
      btn.onmouseleave = () => { btn.style.borderColor = 'rgba(255,255,255,0.06)'; btn.style.background = 'rgba(255,255,255,0.02)'; };
      btn.onclick = () => {
        state.steps = jsonToSteps(pat.steps);
        state.repeat = pat.repeat || { enabled: false, interval: 60, count: 0, unit: 's' };
        state.variables = { ...(pat.variables || {}) };
        onApply();
        overlay.remove();
        statusBarActivity.textContent = `Loaded pattern: ${pat.name}`;
        setTimeout(() => { statusBarActivity.textContent = ''; }, 3000);
      };
      catDiv.appendChild(btn);
    }
    body.appendChild(catDiv);
  }

  if (patterns.length === 0) {
    body.innerHTML = '<div class="scheduler-empty"><div>No patterns available. Save patterns to build your library.</div></div>';
  }

  panel.appendChild(body);
  overlay.appendChild(panel);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}
