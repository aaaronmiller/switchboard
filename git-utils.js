/**
 * git-utils.js — async git helpers for project cards.
 *
 * Electron-free and dependency-injection friendly so it can be unit-tested with
 * plain `node --test`. All commands use execFile (no shell) → no injection risk;
 * branch names are still validated against the real branch list before checkout.
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(args, cwd, timeout = 5000) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: (stdout || '').trim(), stderr: (stderr || '').trim(), code: err?.code });
    });
  });
}

/** Rich git state for a project: branch, dirty flag, ahead/behind vs upstream. */
async function getGitInfo(projectPath) {
  if (!projectPath || typeof projectPath !== 'string') {
    return { isRepo: false, branch: null, status: null, error: true };
  }
  const top = await run(['rev-parse', '--is-inside-work-tree'], projectPath);
  if (!top.ok || top.stdout !== 'true') {
    return { isRepo: false, branch: null, status: null, error: false };
  }

  const branchRes = await run(['rev-parse', '--abbrev-ref', 'HEAD'], projectPath);
  const branch = branchRes.ok ? branchRes.stdout : null;

  const porcelain = await run(['status', '--porcelain'], projectPath);
  const dirtyLines = porcelain.ok ? porcelain.stdout.split('\n').filter(Boolean) : [];
  const dirty = dirtyLines.length > 0;

  // Ahead/behind vs the (last-fetched) upstream. left = upstream-only (behind),
  // right = local-only (ahead). No network — reflects the last fetch.
  let ahead = 0, behind = 0, hasUpstream = false;
  const counts = await run(['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], projectPath);
  if (counts.ok && /^\d+\s+\d+$/.test(counts.stdout)) {
    const [b, a] = counts.stdout.split(/\s+/).map(Number);
    behind = b; ahead = a; hasUpstream = true;
  }

  // Roll up into a single coarse status for color coding (matches existing CSS).
  let status;
  if (ahead > 0 && behind > 0) status = 'diverged';
  else if (behind > 0) status = 'behind';
  else if (ahead > 0) status = 'ahead';
  else if (dirty) status = 'dirty';
  else status = 'current';

  return {
    isRepo: true,
    branch,
    status,
    dirty,
    ahead,
    behind,            // > 0 ⇒ "git pull would add changes" (the cloud-ahead signifier)
    hasUpstream,
    error: false,
  };
}

/** List local branches + the current one. */
async function listBranches(projectPath) {
  const res = await run(['branch', '--format=%(refname:short)'], projectPath);
  if (!res.ok) return { current: null, branches: [], error: true };
  const branches = res.stdout.split('\n').map(s => s.trim()).filter(Boolean);
  const cur = await run(['rev-parse', '--abbrev-ref', 'HEAD'], projectPath);
  return { current: cur.ok ? cur.stdout : null, branches, error: false };
}

/** Check out an existing local branch. Guards against a dirty tree unless force. */
async function checkoutBranch(projectPath, branch, { force = false } = {}) {
  const { branches } = await listBranches(projectPath);
  if (!branches.includes(branch)) {
    return { ok: false, error: `Unknown branch: ${branch}` };
  }
  if (!force) {
    const porcelain = await run(['status', '--porcelain'], projectPath);
    if (porcelain.ok && porcelain.stdout.length > 0) {
      return { ok: false, error: 'Working tree has uncommitted changes', dirty: true };
    }
  }
  const res = await run(['checkout', branch], projectPath);
  return res.ok ? { ok: true, branch } : { ok: false, error: res.stderr || 'checkout failed' };
}

/** Fetch from the default remote (network). Caller is responsible for throttling. */
async function fetchRemote(projectPath, timeout = 20000) {
  const res = await run(['fetch', '--quiet'], projectPath, timeout);
  return res.ok ? { ok: true } : { ok: false, error: res.stderr || 'fetch failed' };
}

/** Fast-forward-only pull. Safe: never creates a merge commit. */
async function pullFastForward(projectPath, timeout = 30000) {
  const res = await run(['pull', '--ff-only'], projectPath, timeout);
  return res.ok ? { ok: true, output: res.stdout } : { ok: false, error: res.stderr || 'pull failed' };
}

/**
 * mtime (ms) of the most-recently-modified file in a project tree.
 * Bounded walk: skips heavy/generated dirs, caps total entries and depth so a
 * huge repo can't stall the scan.
 */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.cache', 'target', 'venv', '.venv', '__pycache__', '.turbo']);
function getProjectLastModified(projectPath, { maxEntries = 4000, maxDepth = 6 } = {}) {
  let latest = 0;
  let seen = 0;
  function walk(dir, depth) {
    if (depth > maxDepth || seen >= maxEntries) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (seen >= maxEntries) return;
      seen++;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        walk(path.join(dir, e.name), depth + 1);
      } else if (e.isFile()) {
        try {
          const m = fs.statSync(path.join(dir, e.name)).mtimeMs;
          if (m > latest) latest = m;
        } catch {}
      }
    }
  }
  try {
    if (!fs.existsSync(projectPath)) return null;
    walk(projectPath, 0);
  } catch { return null; }
  return latest || null;
}

module.exports = {
  getGitInfo,
  listBranches,
  checkoutBranch,
  fetchRemote,
  pullFastForward,
  getProjectLastModified,
};
