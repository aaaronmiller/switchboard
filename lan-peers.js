'use strict';

// LAN peer federation — UDP multicast discovery + remote broker proxy
// Uses only Node built-ins (dgram, http, crypto, os) — no extra packages.
//
// Protocol:
//   Announce: UDP multicast 239.255.255.250:7898, 30s interval
//   Packet: JSON { type, host, ip, port, thash }
//   thash: first 16 chars of sha256(token). Used to match brokers sharing the
//          same shared secret. Empty string = no auth (open LAN mode).
//
// Auth:
//   If lanPeersToken is set, HTTP requests from non-loopback sources must
//   include "Authorization: Bearer <token>". Local processes (127.x) bypass.

const dgram = require('dgram');
const crypto = require('crypto');
const http = require('http');
const os = require('os');

const MCAST_ADDR = '239.255.255.250';
const MCAST_PORT = 7898;
const ANNOUNCE_INTERVAL_MS = 30_000;
const STALE_TTL_MS = 90_000;
const FETCH_TIMEOUT_MS = 3_000;

let socket = null;
let announceTimer = null;
// ip:port → { ip, port, host, lastSeen }
const remoteBrokers = new Map();

// ─── Helpers ────────────────────────────────────────────────────────────────

function getLocalIp() {
  const ifaces = os.networkInterfaces();
  for (const iface of Object.values(ifaces)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return '127.0.0.1';
}

function tokenHash(token) {
  if (!token) return '';
  return crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 16);
}

// ─── Discovery ──────────────────────────────────────────────────────────────

function startLanDiscovery({ brokerPort, token, onDiscover, log }) {
  const localIp = getLocalIp();
  const hostname = os.hostname();
  const thash = tokenHash(token);
  const key = (ip, port) => `${ip}:${port}`;

  socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('error', (err) => {
    if (log) log.warn('[lan-peers] UDP error:', err.message);
  });

  socket.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type !== 'switchboard-announce') return;
      if (data.thash !== thash) return;               // token mismatch
      if (data.ip === localIp && data.port === brokerPort) return; // self

      const k = key(data.ip, data.port);
      const isNew = !remoteBrokers.has(k);
      remoteBrokers.set(k, { ip: data.ip, port: data.port, host: data.host, lastSeen: Date.now() });
      if (isNew && onDiscover) onDiscover({ ip: data.ip, port: data.port, host: data.host });
    } catch {}
  });

  socket.bind(MCAST_PORT, () => {
    try {
      socket.addMembership(MCAST_ADDR);
      socket.setMulticastTTL(4);
      socket.setMulticastLoopback(false);
    } catch (e) {
      if (log) log.warn('[lan-peers] Multicast join error:', e.message);
    }
  });

  function announce() {
    // Prune stale brokers
    const now = Date.now();
    for (const [k, b] of remoteBrokers) {
      if (now - b.lastSeen > STALE_TTL_MS) remoteBrokers.delete(k);
    }
    const buf = Buffer.from(JSON.stringify({
      type: 'switchboard-announce',
      host: hostname,
      ip: localIp,
      port: brokerPort,
      thash,
    }));
    socket.send(buf, 0, buf.length, MCAST_PORT, MCAST_ADDR, (err) => {
      if (err && log) log.warn('[lan-peers] Announce send error:', err.message);
    });
  }

  announce(); // immediate first beacon
  announceTimer = setInterval(announce, ANNOUNCE_INTERVAL_MS);

  if (log) log.info(`[lan-peers] Discovery started — ${localIp}, token=${thash || 'none'}`);
}

function stopLanDiscovery() {
  if (announceTimer) { clearInterval(announceTimer); announceTimer = null; }
  if (socket) { try { socket.close(); } catch {} socket = null; }
  remoteBrokers.clear();
}

function getRemoteBrokers() {
  return [...remoteBrokers.values()];
}

// ─── Remote HTTP helpers ─────────────────────────────────────────────────────

function postToBroker(broker, token, path, body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = http.request({
      hostname: broker.ip,
      port: broker.port,
      path,
      method: 'POST',
      headers,
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve({ ok: true, data: JSON.parse(data), status: res.statusCode }); }
        catch { resolve({ ok: false }); }
      });
    });
    req.setTimeout(FETCH_TIMEOUT_MS, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.end(payload);
  });
}

// Fetch peers from a single remote broker
async function fetchBrokerPeers(broker, token, opts) {
  const r = await postToBroker(broker, token, '/list-peers', {
    scope: opts.scope || 'all',
    cwd: opts.cwd,
    git_root: opts.gitRoot,
    exclude_id: opts.excludeId,
  });
  if (!r.ok || !Array.isArray(r.data)) return [];
  return r.data.map(p => ({
    ...p,
    _remote: true,
    _brokerIp: broker.ip,
    _brokerPort: broker.port,
    _machine: broker.host,
  }));
}

// Fetch all remote peers in parallel
async function fetchRemotePeers(token, opts) {
  const brokers = getRemoteBrokers();
  if (brokers.length === 0) return [];
  const results = await Promise.all(brokers.map(b => fetchBrokerPeers(b, token, opts)));
  return results.flat();
}

// Try to deliver a message to a remote broker that knows the target peer
async function proxySendMessage(token, { fromId, toId, text }) {
  for (const broker of getRemoteBrokers()) {
    const r = await postToBroker(broker, token, '/send-message', { from_id: fromId, to_id: toId, text });
    if (r.ok && r.data?.ok) return { ok: true };
  }
  return { ok: false, error: 'peer not found on any remote broker' };
}

// ─── Auth helper (used by main.js) ──────────────────────────────────────────

// Returns true if request should be allowed through
function checkAuth(req, token) {
  if (!token) return true; // no token configured — open mode
  const remote = req.socket?.remoteAddress || '';
  // Loopback always allowed (local CLI agents)
  if (remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1') return true;
  const auth = req.headers['authorization'] || '';
  return auth === `Bearer ${token}`;
}

module.exports = {
  startLanDiscovery,
  stopLanDiscovery,
  getRemoteBrokers,
  fetchRemotePeers,
  proxySendMessage,
  checkAuth,
  getLocalIp,
};
