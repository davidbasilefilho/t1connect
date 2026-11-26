import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer as createHttp } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { join } from 'node:path';
import { chmodSync } from 'node:fs';
import {
  fingerprint, isFingerprint, isId, LOOPBACK, privateDirectory, TTL_MS,
} from './protocol.mjs';
import { hostStore } from './store.mjs';

const digest = (value) => createHash('sha256').update(value).digest();
const options = { maxHeaderSize: 4096, headersTimeout: 2000, requestTimeout: 2000 };

function reply(res, status, payload) {
  const data = JSON.stringify(payload);
  res.writeHead(status, {
    'Cache-Control': 'no-store', 'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data), 'X-Content-Type-Options': 'nosniff',
  });
  res.end(data);
}
const error = (res, status, code) => reply(res, status, { error: code });

function listen(server, address) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(address, () => {
      server.off('error', reject);
      resolve();
    });
  });
}
function stop(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
    // TLS handshakes are not HTTP connections yet.
    for (const socket of server.openSockets) socket.destroy();
  });
}
function bounded(server) {
  server.maxConnections = 32;
  server.keepAliveTimeout = 1_000;
  server.setTimeout(2_000, (socket) => socket.destroy());
  server.openSockets = new Set();
  server.on('connection', (socket) => {
    server.openSockets.add(socket);
    socket.once('close', () => server.openSockets.delete(socket));
  });
  server.on('checkContinue', (_req, res) => error(res, 400, 'unexpected-body'));
  return server;
}
function permittedShape(req) {
  return !req.headers.origin && !req.headers['transfer-encoding'] &&
    (!req.headers['content-length'] || req.headers['content-length'] === '0');
}

export async function startHost({
  state, tls, port = 0, now = Date.now, monotonic = () => performance.now(),
}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535 || process.getuid() === 0) {
    throw new Error('run unprivileged and use a valid loopback port');
  }
  privateDirectory(state);
  const ownerPath = join(state, 'owner.sock');
  const store = hostStore(join(state, 'host.sqlite'));
  const tokens = new Map();

  const handle = (operation) => (req, res) => {
    try {
      if (!permittedShape(req)) return error(res, 400, 'unexpected-request');
      operation(req, res);
    } catch {
      if (!res.headersSent) error(res, 500, 'host-error');
      else res.destroy();
    }
  };

  const owner = bounded(createHttp(options, handle((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      return reply(res, 200, { status: 'ready', protocol: 1 });
    }
    if (req.method === 'GET' && req.url === '/metrics') {
      const { userCPUTime, systemCPUTime, maxRSS } = process.resourceUsage();
      return reply(res, 200, { userCPUTime, systemCPUTime, maxRSS, rss: process.memoryUsage.rss() });
    }
    if (req.method !== 'POST') return error(res, 404, 'not-found');
    const [, action, id, task, ...rest] = req.url.split('/');
    if (rest.length) return error(res, 404, 'not-found');
    if (action === 'approve' && isFingerprint(id) && isId(task)) {
      const status = store.approve(id, task);
      return reply(res, status === 'approved' ? 200 : 409, { status });
    }
    if (action === 'revoke' && isFingerprint(id) && task === undefined) {
      if (!store.revoke(id)) return error(res, 404, 'not-active');
      tokens.delete(id);
      return reply(res, 200, { status: 'revoked' });
    }
    if (action === 'start' && isId(id) && task === undefined) {
      const status = store.start(id, now());
      return reply(res, status === 'capacity' ? 409 : 200, { status });
    }
    return error(res, 404, 'not-found');
  })));

  const device = bounded(createHttps({
    ...options, ...tls, requestCert: true, rejectUnauthorized: true,
    minVersion: 'TLSv1.3', handshakeTimeout: 2000,
  }, handle((req, res) => {
    const peer = req.socket.getPeerCertificate();
    if (!req.socket.authorized || !peer.raw || Date.parse(peer.valid_to) <= now()) {
      return error(res, 401, 'invalid-device');
    }
    const id = fingerprint(peer.raw);
    if (!store.active(id)) return error(res, 403, 'device-not-approved');
    if (req.method === 'POST' && req.url === '/v1/session') {
      const token = randomBytes(32).toString('base64url');
      tokens.set(id, { hash: digest(token), expiry: monotonic() + TTL_MS });
      return reply(res, 201, { token, expiresInMs: TTL_MS, scope: 'events:read' });
    }
    if (req.method !== 'GET') return error(res, 404, 'not-found');
    const path = /^\/v1\/tasks\/([a-f0-9-]+)\/events\?after=(0|[1-9][0-9]{0,2})$/.exec(req.url);
    if (!path || !isId(path[1])) return error(res, 404, 'not-found');
    const access = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '');
    const session = tokens.get(id);
    if (!access || !session || session.expiry <= monotonic() ||
        !timingSafeEqual(session.hash, digest(access[1]))) {
      return error(res, 401, 'invalid-session');
    }
    if (!store.approved(id, path[1])) return error(res, 403, 'task-not-approved');
    const events = store.events(path[1], Number(path[2]));
    if (!events) return error(res, 404, 'not-found');
    return reply(res, 200, { events });
  })));

  try {
    await listen(owner, ownerPath);
    chmodSync(ownerPath, 0o600);
    await listen(device, { host: LOOPBACK, port, exclusive: true });
  } catch (reason) {
    await Promise.all([stop(owner), stop(device)]);
    store.close();
    throw reason;
  }
  let fatal = false;
  const tick = setInterval(() => {
    try {
      store.tick(now());
    } catch {
      fatal = true;
      clearInterval(tick);
      void stop(device);
      void stop(owner);
    }
  }, 15);
  let closing;
  return {
    port: device.address().port,
    ownerPath,
    failed: () => fatal,
    close() {
      return closing ??= (async () => {
        clearInterval(tick);
        await Promise.all([stop(device), stop(owner)]);
        store.close();
      })();
    },
  };
}
