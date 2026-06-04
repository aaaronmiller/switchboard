const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  getGitInfo, listBranches, checkoutBranch, getProjectLastModified, pullFastForward,
} = require('../git-utils');

function git(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-git-'));
  git(['init', '-q', '-b', 'main'], dir);
  git(['config', 'user.email', 't@t.t'], dir);
  git(['config', 'user.name', 'T'], dir);
  git(['config', 'commit.gpgsign', 'false'], dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(['add', '.'], dir);
  git(['commit', '-q', '-m', 'init'], dir);
  return dir;
}

test('getGitInfo: clean repo on main, no upstream', async () => {
  const dir = makeRepo();
  try {
    const info = await getGitInfo(dir);
    assert.equal(info.isRepo, true);
    assert.equal(info.branch, 'main');
    assert.equal(info.dirty, false);
    assert.equal(info.status, 'current');
    assert.equal(info.hasUpstream, false);
    assert.equal(info.behind, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('getGitInfo: dirty tree reports dirty', async () => {
  const dir = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'changed\n');
    const info = await getGitInfo(dir);
    assert.equal(info.dirty, true);
    assert.equal(info.status, 'dirty');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('getGitInfo: non-repo returns isRepo=false without error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-nogit-'));
  try {
    const info = await getGitInfo(dir);
    assert.equal(info.isRepo, false);
    assert.equal(info.error, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ahead/behind: clone behind its origin shows behind>0 (pull-available)', async () => {
  const origin = makeRepo();
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-clone-'));
  try {
    git(['clone', '-q', origin, clone], path.dirname(clone));
    // advance origin by one commit
    fs.writeFileSync(path.join(origin, 'b.txt'), 'two\n');
    git(['add', '.'], origin);
    git(['commit', '-q', '-m', 'second'], origin);
    // clone fetches → now behind by 1
    git(['fetch', '-q'], clone);
    const info = await getGitInfo(clone);
    assert.equal(info.hasUpstream, true);
    assert.equal(info.behind, 1, 'clone should be 1 behind origin');
    assert.equal(info.ahead, 0);
    assert.equal(info.status, 'behind');
    // pull --ff-only brings it current
    const pulled = await pullFastForward(clone);
    assert.equal(pulled.ok, true);
    const after = await getGitInfo(clone);
    assert.equal(after.behind, 0);
  } finally {
    fs.rmSync(origin, { recursive: true, force: true });
    fs.rmSync(clone, { recursive: true, force: true });
  }
});

test('listBranches + checkoutBranch (guarded)', async () => {
  const dir = makeRepo();
  try {
    git(['branch', 'feature'], dir);
    const list = await listBranches(dir);
    assert.equal(list.current, 'main');
    assert.deepEqual([...list.branches].sort(), ['feature', 'main']);

    const ok = await checkoutBranch(dir, 'feature');
    assert.equal(ok.ok, true);
    assert.equal((await listBranches(dir)).current, 'feature');

    // unknown branch rejected
    const bad = await checkoutBranch(dir, 'does-not-exist');
    assert.equal(bad.ok, false);

    // dirty tree blocks checkout unless forced
    fs.writeFileSync(path.join(dir, 'a.txt'), 'dirty\n');
    const blocked = await checkoutBranch(dir, 'main');
    assert.equal(blocked.ok, false);
    assert.equal(blocked.dirty, true);
    const forced = await checkoutBranch(dir, 'main', { force: true });
    assert.equal(forced.ok, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('getProjectLastModified returns the newest file mtime and skips .git', async () => {
  const dir = makeRepo();
  try {
    const newFile = path.join(dir, 'fresh.txt');
    fs.writeFileSync(newFile, 'hi\n');
    const want = fs.statSync(newFile).mtimeMs;
    const got = getProjectLastModified(dir);
    assert.ok(got >= want - 5, `expected ~${want}, got ${got}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
