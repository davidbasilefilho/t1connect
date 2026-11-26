import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  createProjection,
  deviceTransport,
  isRetryable,
  ownerRequest,
  viewer,
} from '../src/client.mjs';
import { STEPS } from '../src/protocol.mjs';
import { daemon, fixture, waitUntil } from './fixture.mjs';

const RESUME_AFTER = 5;
const EVENT_COUNT = STEPS + 2;
const signalFor = { graceful: 'SIGTERM', abrupt: 'SIGKILL' };

export async function restartScenario(mode) {
  if (!Object.hasOwn(signalFor, mode)) throw new Error('unknown restart mode');
  const f = fixture();
  let host, client, projection;
  try {
    host = await daemon(f, 0, f.path('first-runtime'));
    const port = host.port;
    const hostPin = f.fp('host');
    const deviceId = f.fp('viewer');
    const task = randomUUID();
    const eventPath = '/v1/tasks/' + task + '/events?after=0';
    const owner = (method, path) => ownerRequest(host.ownerPath, method, path);
    client = deviceTransport({ port, tls: f.tls('viewer'), hostPin });
    projection = createProjection(f.path('reader'), hostPin, task);
    const following = viewer({ transport: client, projection, task });
    const approve = await owner('POST', '/approve/' + deviceId + '/' + task);
    assert.equal(approve.status, 200);
    assert.equal((await owner('POST', '/start/' + task)).data.status, 'started');

    await waitUntil(async () => {
      await following.poll();
      return projection.cursor() >= RESUME_AFTER;
    });
    const committed = projection.all();
    assert.ok(committed.length < EVENT_COUNT);
    const { data, status } = await client.request('POST', '/v1/session');
    assert.equal(status, 201);
    assert.equal((await client.request('GET', eventPath, data.token)).status, 200);

    async function endHost() {
      assert.equal(host.child.kill(signalFor[mode]), true);
      const { code, signal } = await host.done();
      if (mode === 'abrupt') {
        assert.equal(signal, 'SIGKILL');
      } else {
        assert.equal(code, 0);
        assert.equal(signal, null);
      }
    }

    const interrupted = performance.now();
    await endHost();
    await assert.rejects(() => client.request('GET', eventPath, data.token), isRetryable);
    host = await daemon(f, port, f.path('replacement-runtime'));
    const ready = performance.now();
    assert.equal(host.port, port);
    assert.equal((await client.request('GET', eventPath, data.token)).status, 401);
    assert.equal((await owner('POST', '/start/' + task)).data.status, 'existing');
    await waitUntil(async () => {
      await following.poll();
      return projection.cursor() > committed.length;
    });
    const resumed = performance.now();
    assert.deepEqual(projection.all().slice(0, committed.length), committed);

    await waitUntil(async () => {
      await following.poll();
      return projection.cursor() === EVENT_COUNT;
    });
    const all = projection.all();
    assert.deepEqual(
      all.map(({ seq }) => seq),
      Array.from({ length: EVENT_COUNT }, (_, i) => i + 1),
    );
    assert.equal(all.filter(({ kind }) => kind === 'started').length, 1);
    assert.equal(all.filter(({ kind }) => kind === 'completed').length, 1);

    assert.equal((await owner('POST', '/revoke/' + deviceId)).status, 200);
    assert.equal((await client.request('POST', '/v1/session')).status, 403);
    await endHost();
    host = await daemon(f, port, f.path('revocation-runtime'));
    assert.equal((await client.request('POST', '/v1/session')).status, 403);
    assert.equal((await client.request('GET', eventPath, data.token)).status, 403);
    return {
      mode,
      events: all.length,
      interruptionToReadyMs: ready - interrupted,
      readyToResumeMs: resumed - ready,
      interruptionToResumeMs: resumed - interrupted,
    };
  } finally {
    projection?.close();
    client?.close();
    await host?.stop();
    f.close();
  }
}
