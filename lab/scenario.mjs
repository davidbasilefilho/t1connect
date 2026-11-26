import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { createProjection, deviceTransport, isRetryable, ownerRequest, viewer } from '../src/client.mjs';
import { STEPS } from '../src/protocol.mjs';
import { daemon, fixture, impairment } from './fixture.mjs';

export async function scenario({ trials, keepAlive = true, progress = () => {} }) {
  const f = fixture();
  let host, link, device, reusedRequests = 0;
  try {
    host = await daemon(f);
    link = await impairment(host.port);
    const hostPin = f.fp('host');
    const deviceId = f.fp('viewer');
    device = deviceTransport({ port: link.port, tls: f.tls('viewer'), hostPin, timeoutMs: 85, keepAlive });
    const counted = {
      async request(...args) {
        const response = await device.request(...args);
        if (response.reusedSocket) reusedRequests++;
        return response;
      },
    };
    const owner = (method, path) => ownerRequest(host.ownerPath, method, path);
    const first = (await owner('GET', '/metrics')).data;
    const timing = { pairing: [], onlineEvent: [], reconnection: [], revocation: [] };
    let events = 0;
    for (let index = 0; index < trials; index++) {
      const task = randomUUID();
      const readerPath = f.path('reader-' + index);
      let projection = createProjection(readerPath, hostPin, task);
      try {
        const eventPath = '/v1/tasks/' + task + '/events?after=0';
        const pairStart = performance.now();
        assert.equal((await owner('POST', '/approve/' + deviceId + '/' + task)).status, 200);
        const session = await counted.request('POST', '/v1/session');
        assert.equal(session.status, 201);
        assert.equal((await counted.request('GET', eventPath, session.data.token)).status, 404);
        timing.pairing.push(performance.now() - pairStart);
        assert.equal((await owner('POST', '/start/' + task)).data.status, 'started');
        progress('Task started on desktop.');
        let follow = viewer({ transport: counted, projection, task });
        const recorded = [];
        const deadline = performance.now() + 5_000;
        while (projection.cursor() < 5) {
          if (performance.now() > deadline) throw new Error('No initial events.');
          const page = await follow.poll();
          for (const { at } of page) timing.onlineEvent.push(Date.now() - at);
          recorded.push(...page);
          await sleep(15);
        }
        link.loss();
        const lostAt = performance.now();
        await assert.rejects(() => follow.poll(), isRetryable);
        progress('Connection interrupted.');
        assert.equal((await owner('POST', '/start/' + task)).data.status, 'existing');
        projection.close();
        projection = undefined;
        projection = createProjection(readerPath, hostPin, task);
        assert.equal(projection.cursor(), recorded.length);
        follow = viewer({ transport: counted, projection, task });
        await sleep(Math.max(0, 160 - (performance.now() - lostAt)));
        const restored = performance.now();
        link.restore();
        const backlog = await follow.poll();
        assert.ok(backlog.length > 0);
        timing.reconnection.push(performance.now() - restored);
        progress('Reconnected from the saved position.');
        recorded.push(...backlog);
        while (projection.cursor() < STEPS + 2) {
          if (performance.now() > deadline) throw new Error('No completion event.');
          const page = await follow.poll();
          for (const { at } of page) timing.onlineEvent.push(Date.now() - at);
          recorded.push(...page);
          await sleep(15);
        }
        assert.deepEqual(recorded.map(({ seq }) => seq), Array.from({ length: STEPS + 2 }, (_, i) => i + 1));
        assert.equal(recorded.filter(({ kind }) => kind === 'started').length, 1);
        assert.equal(recorded.at(-1).kind, 'completed');
        assert.equal(projection.all().length, STEPS + 2);
        events += recorded.length;
        progress('Completed. Recorded ' + recorded.length + ' ordered events with one start.');
        if (index + 1 === trials) {
          const current = await counted.request('POST', '/v1/session');
          assert.equal(current.status, 201);
          assert.equal((await counted.request('GET', eventPath, current.data.token)).status, 200);
          assert.equal((await owner('POST', '/revoke/' + deviceId)).status, 200);
          const revoked = performance.now();
          assert.equal((await counted.request('GET', eventPath, current.data.token)).status, 403);
          timing.revocation.push(performance.now() - revoked);
          assert.equal((await counted.request('POST', '/v1/session')).status, 403);
          progress('Device revoked. Existing session and new sign-in both denied.');
        }
      } finally {
        projection?.close();
      }
    }
    const last = (await owner('GET', '/metrics')).data;
    assert.equal(reusedRequests > 0, keepAlive, 'socket reuse must match the variant');
    return {
      trials, events, timing, reusedRequests,
      hostCpuMs: (last.userCPUTime + last.systemCPUTime - first.userCPUTime - first.systemCPUTime) / 1000,
      hostPeakRssKiB: last.maxRSS,
      hostLastRssKiB: Math.round(last.rss / 1024),
    };
  } finally {
    device?.close();
    await link?.close();
    await host?.stop();
    f.close();
  }
}
