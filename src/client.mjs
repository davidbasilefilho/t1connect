import { request as http } from 'node:http';
import { Agent, request as https } from 'node:https';
import { checkServerIdentity } from 'node:tls';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import {
  fingerprint,
  isFingerprint,
  isId,
  LOOPBACK,
  PAGE,
  privateDirectory,
  sqlInteger,
  STEPS,
  transaction,
  TTL_MS,
} from './protocol.mjs';

const MAX_RESPONSE = 4096;

export class ResponseError extends Error {
  constructor(status) {
    super('request rejected (HTTP ' + status + ')');
    this.status = status;
  }
}

function jsonRequest(send, options, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = send(
      {
        ...options,
        signal: AbortSignal.timeout(timeoutMs),
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('error', reject);
        res.on('data', (chunk) => {
          data += chunk;
          if (Buffer.byteLength(data) > MAX_RESPONSE) req.destroy(new Error('response too large'));
        });
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode,
              data: JSON.parse(data),
              reusedSocket: req.reusedSocket,
            });
          } catch {
            reject(new Error('invalid response'));
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}
export const ownerRequest = (socketPath, method, path) =>
  jsonRequest(http, { socketPath, method, path, agent: false }, 2_000);

export function deviceTransport({ port, tls, hostPin, timeoutMs = 1_000, keepAlive = true }) {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !isFingerprint(hostPin)) {
    throw new Error('valid loopback port and server certificate fingerprint required');
  }
  // The HTTPS agent is private to this endpoint, mutual TLS identity and immutable pin.
  // A per-request override in recent Node versions deliberately prevents socket reuse.
  const pinnedIdentity = (server, cert) =>
    checkServerIdentity(server, cert) ??
    (fingerprint(cert.raw) === hostPin ? undefined : new Error('server certificate pin mismatch'));
  const agent = keepAlive
    ? new Agent({
        keepAlive: true,
        agentKeepAliveTimeoutBuffer: 250,
        maxSockets: 1,
        maxFreeSockets: 1,
        maxCachedSessions: 0,
        checkServerIdentity: pinnedIdentity,
      })
    : false;
  const request = (method, path, token) =>
    jsonRequest(
      https,
      {
        ...tls,
        host: LOOPBACK,
        servername: 'localhost',
        port,
        minVersion: 'TLSv1.3',
        rejectUnauthorized: true,
        agent,
        ...(agent ? {} : { checkServerIdentity: pinnedIdentity }),
        method,
        path,
        headers: token ? { Authorization: 'Bearer ' + token } : {},
      },
      timeoutMs,
    );
  return {
    request,
    close() {
      if (agent) agent.destroy();
    },
  };
}

export function createProjection(state, hostPin, task) {
  if (!isFingerprint(hostPin) || !isId(task)) throw new Error('invalid projection identity');
  privateDirectory(state);
  const db = new DatabaseSync(join(state, 'viewer.sqlite'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 1000;');
  db.exec(
    'CREATE TABLE IF NOT EXISTS seen (host TEXT, task TEXT, seq INTEGER, kind TEXT, at INTEGER, PRIMARY KEY(host, task, seq)) STRICT;',
  );
  const add = db.prepare('INSERT INTO seen VALUES (?, ?, ?, ?, ?)');
  const readCursor = db.prepare(
    'SELECT coalesce(max(seq), 0) AS cursor FROM seen WHERE host = ? AND task = ?',
  );
  const read = db.prepare(
    'SELECT seq, kind, at FROM seen WHERE host = ? AND task = ? ORDER BY seq',
  );
  const cursor = () => sqlInteger(readCursor.get(hostPin, task)?.cursor);
  return {
    cursor,
    apply(after, events) {
      if (!Array.isArray(events) || events.length > PAGE) throw new Error('invalid event batch');
      return transaction(db, () => {
        if (cursor() !== after) throw new Error('concurrent projection changed');
        for (const [i, event] of events.entries()) {
          const seq = after + i + 1;
          const expected = seq === 1 ? 'started' : seq === STEPS + 2 ? 'completed' : 'progress';
          if (
            !event ||
            event.seq !== seq ||
            seq > STEPS + 2 ||
            event.kind !== expected ||
            !Number.isSafeInteger(event.at) ||
            event.at < 0
          )
            throw new Error('non-contiguous event batch');
          add.run(hostPin, task, seq, event.kind, event.at);
        }
        return events;
      });
    },
    all: () => read.all(hostPin, task),
    close: () => db.close(),
  };
}

export function viewer({ transport, projection, task }) {
  if (!isId(task)) throw new Error('invalid task');
  let token;
  return {
    async poll() {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!token) {
          const { status, data } = await transport.request('POST', '/v1/session');
          if (status !== 201) throw new ResponseError(status);
          if (
            typeof data?.token !== 'string' ||
            !/^[A-Za-z0-9_-]{43}$/.test(data.token) ||
            data.scope !== 'events:read' ||
            data.expiresInMs !== TTL_MS
          )
            throw new Error('invalid session response');
          token = data.token;
        }
        const after = projection.cursor();
        const { status, data } = await transport.request(
          'GET',
          '/v1/tasks/' + task + '/events?after=' + after,
          token,
        );
        if (status === 200) return projection.apply(after, data?.events);
        if (status === 401) {
          token = undefined;
          continue;
        }
        if (status === 403) token = undefined;
        throw new ResponseError(status);
      }
      throw new ResponseError(401);
    },
  };
}

export const isRetryable = (error) =>
  ['ABORT_ERR', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT'].includes(error.code);
