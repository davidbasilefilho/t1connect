import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { createProjection, deviceTransport, isRetryable, viewer } from './client.mjs';
import { fingerprint, STEPS, tlsFiles } from './protocol.mjs';

const [state, port, ca, serverCert, cert, key, task, ...rest] = process.argv.slice(2);
if (!task || rest.length) {
  console.error('Usage: node src/viewer-cli.mjs STATE PORT CA.pem HOST.pem DEVICE.pem DEVICE.key TASK');
  process.exitCode = 2;
} else {
  let transport, projection;
  process.umask(0o077);
  try {
    const hostPin = fingerprint(readFileSync(serverCert));
    transport = deviceTransport({ port: Number(port), tls: tlsFiles(ca, cert, key), hostPin });
    projection = createProjection(state, hostPin, task);
    const follower = viewer({ transport, projection, task });
    const deadline = performance.now() + 60_000;
    let disconnected = false;
    while (projection.cursor() < STEPS + 2) {
      if (performance.now() >= deadline) throw new Error('viewer timed out');
      let events;
      try {
        events = await follower.poll();
      } catch (error) {
        if (!isRetryable(error)) throw error;
        if (!disconnected) console.error('Connection interrupted. Retrying from the saved position.');
        disconnected = true;
        await delay(150);
        continue;
      }
      if (disconnected) console.error('Connected. Saved position restored.');
      disconnected = false;
      for (const { seq, kind } of events) console.log(String(seq) + ' ' + kind);
      await delay(50);
    }
  } catch (error) {
    console.error(error.status === 403 ? 'Access denied or revoked.' : 'Viewer could not continue.');
    process.exitCode = 1;
  } finally {
    projection?.close();
    transport?.close();
  }
}
