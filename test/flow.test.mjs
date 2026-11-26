import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, statSync } from 'node:fs';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  createProjection,
  deviceTransport,
  isRetryable,
  ownerRequest,
  viewer,
} from '../src/client.mjs';
import { startHost } from '../src/host.mjs';
import { STEPS, TTL_MS } from '../src/protocol.mjs';
import { command, daemon, fixture, impairment, waitUntil } from '../lab/fixture.mjs';

const eventsPath = (task, after = 0) => '/v1/tasks/' + task + '/events?after=' + after;
const approve = (host, f, name, task) =>
  ownerRequest(host.ownerPath, 'POST', '/approve/' + f.fp(name) + '/' + task);

void test('approval and task scope, TLS pin, expiry, binding, revocation, and durable restart', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  let mono = 100;
  let host = await startHost({ state: f.path('host'), tls: f.tls('host'), monotonic: () => mono });
  t.after(() => host.close());
  assert.equal(statSync(host.ownerPath).mode & 0o777, 0o600);
  assert.equal(statSync(f.path('host')).mode & 0o777, 0o700);
  /** @param {string} name @param {string} [hostPin] @param {import('node:https').RequestOptions} [tls] */
  const use = (name, hostPin = f.fp('host'), tls = f.tls(name)) =>
    deviceTransport({ port: host.port, tls, hostPin });
  const a = use('viewer'),
    b = use('second');
  const task = randomUUID(),
    other = randomUUID();
  const issue = (transport) => transport.request('POST', '/v1/session');
  assert.equal((await issue(a)).status, 403);
  await assert.rejects(() => issue(use('viewer', f.fp('second'))), /pin mismatch/);
  const wrongPin = deviceTransport({
    port: host.port,
    tls: f.tls('viewer'),
    hostPin: f.fp('second'),
    keepAlive: true,
  });
  t.after(() => wrongPin.close());
  await assert.rejects(() => issue(wrongPin), /pin mismatch/);
  await assert.rejects(() => issue(use('untrusted')));
  await assert.rejects(() => issue(use('viewer', f.fp('host'), { ca: f.tls('viewer').ca })));

  assert.equal((await approve(host, f, 'viewer', task)).status, 200);
  assert.equal((await approve(host, f, 'second', other)).status, 200);
  assert.equal((await approve(host, f, 'viewer', task)).status, 200);
  const session = await issue(a);
  const token = session.data.token;
  assert.equal(session.status, 201);
  assert.equal(session.data.expiresInMs, TTL_MS);
  assert.equal((await issue(b)).status, 201);
  assert.equal((await b.request('GET', eventsPath(task), token)).status, 401);
  assert.equal((await a.request('GET', eventsPath(other), token)).status, 403);
  assert.equal((await a.request('GET', eventsPath(task))).status, 401);
  assert.equal((await a.request('GET', eventsPath(task), token)).status, 404);
  assert.equal((await a.request('POST', '/start/' + task, token)).status, 404);
  assert.equal((await a.request('POST', eventsPath(task), token)).status, 404);
  assert.equal((await a.request('POST', '/revoke/' + f.fp('viewer'), token)).status, 404);
  assert.equal(
    (await ownerRequest(host.ownerPath, 'POST', '/start/' + task)).data.status,
    'started',
  );
  assert.equal(
    (await ownerRequest(host.ownerPath, 'POST', '/start/' + task)).data.status,
    'existing',
  );
  assert.equal((await a.request('GET', eventsPath(task), token)).data.events[0].kind, 'started');
  mono += TTL_MS;
  assert.equal((await a.request('GET', eventsPath(task), token)).status, 401);

  let p = createProjection(f.path('viewer-state'), f.fp('host'), task);
  try {
    await viewer({ transport: a, projection: p, task }).poll();
    assert.ok(p.cursor() > 0);
    await host.close();
    host = await startHost({ state: f.path('host'), tls: f.tls('host') });
    const reopened = deviceTransport({
      port: host.port,
      tls: f.tls('viewer'),
      hostPin: f.fp('host'),
      keepAlive: true,
    });
    t.after(() => reopened.close());
    const following = viewer({ transport: reopened, projection: p, task });
    await waitUntil(async () => {
      await following.poll();
      return p.cursor() === STEPS + 2;
    });
    const complete = p.all();
    assert.deepEqual(
      complete.map((event) => event.seq),
      Array.from({ length: STEPS + 2 }, (_, i) => i + 1),
    );
    assert.equal(complete.filter((event) => event.kind === 'started').length, 1);
    assert.equal(complete.at(-1)?.kind, 'completed');
    assert.equal((await following.poll()).length, 0);
    const activeToken = (await issue(reopened)).data.token;
    assert.equal((await reopened.request('GET', eventsPath(task), activeToken)).status, 200);
    assert.equal(
      (await ownerRequest(host.ownerPath, 'POST', '/revoke/' + f.fp('viewer'))).status,
      200,
    );
    const revokedRead = await reopened.request('GET', eventsPath(task), activeToken);
    assert.equal(revokedRead.status, 403);
    assert.equal(revokedRead.reusedSocket, true);
    assert.equal((await issue(reopened)).status, 403);
    assert.equal((await approve(host, f, 'viewer', task)).status, 409);
    await host.close();
    host = await startHost({ state: f.path('host'), tls: f.tls('host') });
    assert.equal((await issue(use('viewer'))).status, 403);
    assert.equal((await issue(use('second'))).status, 201);
  } finally {
    p.close();
  }
});

void test('private storage rejects public directory and key; projection rolls back invalid page', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const p = createProjection(f.path('p'), f.fp('host'), randomUUID());
  t.after(() => p.close());
  assert.throws(
    () =>
      p.apply(0, [
        { seq: 1, kind: 'started', at: 123 },
        { seq: 3, kind: 'progress', at: 124 },
      ]),
    /non-contiguous/,
  );
  assert.equal(p.cursor(), 0);
  p.apply(0, [{ seq: 1, kind: 'started', at: 123 }]);
  assert.throws(() => p.apply(0, [{ seq: 1, kind: 'started', at: 123 }]), /concurrent/);
  assert.equal(p.all().length, 1);
  chmodSync(f.path('p'), 0o755);
  await assert.rejects(() => startHost({ state: f.path('p'), tls: f.tls('host') }), /0700/);
  chmodSync(f.path('viewer.key'), 0o644);
  assert.throws(() => f.tls('viewer'), /private key/);
});

void test('separate desktop CLI and viewer CLI recover from TCP loss with no repeated action', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const host = await daemon(f);
  t.after(() => host.stop());
  const proxy = await impairment(host.port);
  t.after(() => proxy.close());
  const cli = async (...args) =>
    (await command('src/owner-cli.mjs', f.path('host-state'), ...args)).done();
  assert.equal((await cli('health')).output.trim(), 'ready');
  const task = (await cli('new-id')).output.trim();
  assert.equal((await cli('approve', f.fp('viewer'), task)).output.trim(), 'approved');
  assert.equal((await cli('start', task)).output.trim(), 'started');
  const follower = await command(
    'src/viewer-cli.mjs',
    f.path('observer'),
    String(proxy.port),
    f.path('ca.pem'),
    f.path('host.pem'),
    f.path('viewer.pem'),
    f.path('viewer.key'),
    task,
  );
  t.after(() => follower.stop());
  await waitUntil(() => follower.stdout().includes('started'));
  proxy.loss();
  await waitUntil(() => follower.stderr().includes('Connection interrupted'));
  await sleep(350);
  assert.equal((await cli('start', task)).output.trim(), 'existing');
  proxy.restore();
  const { output, errors, code } = await follower.done();
  assert.equal(code, 0);
  assert.match(errors, /Saved position restored/);
  assert.deepEqual(
    output
      .trim()
      .split('\n')
      .map((line) => Number(line.split(' ')[0])),
    Array.from({ length: STEPS + 2 }, (_, i) => i + 1),
  );
  const reconnect = deviceTransport({
    port: host.port,
    tls: f.tls('viewer'),
    hostPin: f.fp('host'),
  });
  const token = (await reconnect.request('POST', '/v1/session')).data.token;
  assert.equal((await cli('revoke', f.fp('viewer'))).output.trim(), 'revoked');
  assert.equal((await reconnect.request('GET', eventsPath(task), token)).status, 403);
});

void test('down transport is identified separately from authentication rejection', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const host = await daemon(f);
  t.after(() => host.stop());
  const proxy = await impairment(host.port);
  t.after(() => proxy.close());
  const client = deviceTransport({
    port: proxy.port,
    tls: f.tls('viewer'),
    hostPin: f.fp('host'),
    timeoutMs: 150,
  });
  assert.equal((await client.request('POST', '/v1/session')).status, 403);
  proxy.loss();
  await assert.rejects(() => client.request('POST', '/v1/session'), isRetryable);
});

void test('separate owner runtime directory preserves state and does not expose owner routes to TLS', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const path = f.path('runtime');
  const host = await daemon(f, 0, path);
  t.after(() => host.stop());
  const ready = await (await command('src/owner-cli.mjs', path, 'health')).done();
  assert.equal(ready.code, 0);
  assert.equal(ready.output.trim(), 'ready');
  const wrong = await (await command('src/owner-cli.mjs', f.path('host-state'), 'health')).done();
  assert.equal(wrong.code, 1);
  assert.equal(statSync(path).mode & 0o777, 0o700);
  assert.equal(statSync(f.path('host-state/host.sqlite')).isFile(), true);
  const client = deviceTransport({ port: host.port, tls: f.tls('viewer'), hostPin: f.fp('host') });
  t.after(() => client.close());
  assert.equal((await client.request('GET', '/health')).status, 403);
});

void test('a host with unavailable journal storage does not advertise readiness', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  mkdirSync(f.path('blocked-state/host.sqlite'), { recursive: true, mode: 0o700 });
  const child = await command(
    'src/host-cli.mjs',
    f.path('blocked-state'),
    f.path('ca.pem'),
    f.path('host.pem'),
    f.path('host.key'),
  );
  t.after(() => child.stop());
  const exit = await child.done();
  assert.equal(exit.code, 1);
  assert.equal(exit.output, '');
  assert.match(exit.errors, /^Host did not start\./);
  assert.throws(() => statSync(f.path('blocked-state/owner.sock')), { code: 'ENOENT' });
});
