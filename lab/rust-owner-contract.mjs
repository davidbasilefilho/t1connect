import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { connect } from 'node:net';
import { once } from 'node:events';
import { ownerRequest } from '../src/client.mjs';
import { command, fixture, localProcess, waitUntil } from './fixture.mjs';
import { assertComplete, events, jsDaemon, rustBin, rustDaemon } from './rust-owner-fixture.mjs';

const f = fixture();
const task = randomUUID();
let js;
let rust;
try {
  js = await jsDaemon(f);
  rust = await rustDaemon(f);
  const rustCli = async (owner, ...args) =>
    localProcess(rustBin('t1-hostctl'), [owner.runtime, ...args]).done();
  const jsCli = async (owner, ...args) =>
    (await command('src/owner-cli.mjs', dirname(owner.ownerPath), ...args)).done();

  assert.equal((await rustCli(js, 'health')).output.trim(), 'ready');
  assert.equal((await jsCli(rust, 'health')).output.trim(), 'ready');
  assert.equal((await rustCli(js, 'start', task)).output.trim(), 'started');
  assert.equal((await jsCli(rust, 'start', task)).output.trim(), 'started');
  assert.equal((await rustCli(rust, 'start', task)).output.trim(), 'existing');
  assert.equal((await jsCli(js, 'start', task)).output.trim(), 'existing');

  const refused = await localProcess(rustBin('t1-hostd'), [
    f.path('rust-state'),
    f.path('other-runtime'),
  ]).done();
  assert.equal(refused.code, 1);
  assert.equal(refused.output, '');
  assert.match(refused.errors, /another daemon owns/);

  await waitUntil(() => (rust ? events(rust.journal, task).length >= 5 : false));
  const prefix = events(rust.journal, task);
  assert.ok(prefix.length < 34);
  assert.equal(rust.child.kill('SIGKILL'), true);
  assert.equal((await rust.done()).signal, 'SIGKILL');
  const stale = rust.ownerPath;
  assert.equal(existsSync(stale), true);
  rust = await rustDaemon(f, f.path('replacement-runtime'));
  assert.equal((await rustCli(rust, 'start', task)).output.trim(), 'existing');
  assert.deepEqual(events(rust.journal, task).slice(0, prefix.length), prefix);

  const slow = connect(rust.ownerPath);
  try {
    await once(slow, 'connect', { signal: AbortSignal.timeout(1_500) });
    slow.write('GET /health HTTP/1.1\r\n');
    await once(slow, 'close', { signal: AbortSignal.timeout(1_500) });
  } finally {
    slow.destroy();
  }
  assert.equal((await rustCli(rust, 'health')).output.trim(), 'ready');
  assert.equal(
    (await ownerRequest(rust.ownerPath, 'POST', '/approve/' + 'a'.repeat(64) + '/' + task)).status,
    404,
  );

  await waitUntil(
    () =>
      rust &&
      js &&
      events(rust.journal, task).length === 34 &&
      events(js.journal, task).length === 34,
  );
  assertComplete(events(js.journal, task));
  assertComplete(events(rust.journal, task));
  assert.deepEqual(events(rust.journal, task), events(js.journal, task));
  await rust.stop();
  assert.equal((await rust.done()).code, 0);
  assert.equal(existsSync(rust.ownerPath), false);
  assert.equal(existsSync(stale), true);

  mkdirSync(f.path('blocked-state/rust-host.sqlite'), { mode: 0o700, recursive: true });
  const blocked = await localProcess(rustBin('t1-hostd'), [
    f.path('blocked-state'),
    f.path('blocked-runtime'),
  ]).done();
  assert.equal(blocked.code, 1);
  assert.equal(blocked.output, '');
  assert.equal(existsSync(f.path('blocked-runtime/owner.sock')), false);
  console.log(
    'JS/Rust local contract passed: owner CLI, ordered journal, crash/reentry, timeout and fail-closed startup.',
  );
} finally {
  await rust?.stop();
  await js?.stop();
  f.close();
}
