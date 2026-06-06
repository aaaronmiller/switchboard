const test = require('node:test');
const assert = require('node:assert/strict');

// Regression test for the "ReferenceError: safeSend is not defined" crash in the
// main process. safeSend was defined inside init() in session-cache.js and
// session-transitions.js, so module-level functions that referenced it
// (notifyRendererProjectsChanged, sendStatus) threw a ReferenceError when the
// debounced flushChanges timer fired. The fix hoists safeSend to module scope.

function makeFakeWindow() {
  const sent = [];
  return {
    win: {
      isDestroyed: () => false,
      webContents: { send: (channel, ...args) => sent.push({ channel, args }) },
    },
    sent,
  };
}

function makeStubDb() {
  // session-cache.init destructures a large set of db functions; supply no-op stubs.
  const noop = () => {};
  return {
    deleteCachedFolder: noop, getCachedByFolder: () => [], upsertCachedSessions: noop,
    deleteCachedSession: noop, deleteSearchFolder: noop, deleteSearchSession: noop,
    upsertSearchEntries: noop, setFolderMeta: noop, getAllFolderMeta: () => new Map(),
    getAllMeta: () => new Map(), getAllCached: () => [], getSetting: () => ({}),
    getMeta: () => null, setName: noop,
  };
}

const silentLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

test('session-cache.notifyRendererProjectsChanged does not throw ReferenceError and sends IPC', () => {
  const sessionCache = require('../session-cache');
  const { win, sent } = makeFakeWindow();

  sessionCache.init({
    PROJECTS_DIR: '/tmp/does-not-exist',
    activeSessions: new Map(),
    getMainWindow: () => win,
    log: silentLog,
    db: makeStubDb(),
  });

  assert.doesNotThrow(() => sessionCache.notifyRendererProjectsChanged());
  assert.ok(
    sent.some(m => m.channel === 'projects-changed'),
    'expected projects-changed IPC to be sent via safeSend',
  );
});

test('session-cache.sendStatus does not throw ReferenceError and sends IPC', () => {
  const sessionCache = require('../session-cache');
  const { win, sent } = makeFakeWindow();

  sessionCache.init({
    PROJECTS_DIR: '/tmp/does-not-exist',
    activeSessions: new Map(),
    getMainWindow: () => win,
    log: silentLog,
    db: makeStubDb(),
  });

  assert.doesNotThrow(() => sessionCache.sendStatus('hello', 'info'));
  assert.ok(
    sent.some(m => m.channel === 'status-update'),
    'expected status-update IPC to be sent via safeSend',
  );
});

test('session-transitions module loads and init does not throw (safeSend hoisted to module scope)', () => {
  const sessionTransitions = require('../session-transitions');
  assert.doesNotThrow(() => sessionTransitions.init({
    PROJECTS_DIR: '/tmp/does-not-exist',
    activeSessions: new Map(),
    getMainWindow: () => makeFakeWindow().win,
    log: silentLog,
    rekeyMcpServer: () => {},
  }));
  // safeSend is referenced inside detectSessionTransitions; a module-scope
  // definition is required for that reference to resolve. The source is checked
  // structurally below.
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'session-transitions.js'), 'utf8');
  const initIdx = src.indexOf('function init(');
  const safeSendIdx = src.indexOf('function safeSend(');
  assert.ok(safeSendIdx >= 0, 'safeSend must be defined');
  assert.ok(safeSendIdx < initIdx, 'safeSend must be defined at module scope before init()');
});
