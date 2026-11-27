import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ownerRequest } from '../src/client.mjs';
import { fixture, waitUntil } from './fixture.mjs';
import { assertComplete, events, jsDaemon, rustDaemon } from './rust-owner-fixture.mjs';

const baseline = process.env.T1_RUST_BASELINE_BIN;
const runs = Number(process.argv.at(2) ?? '6');
assert.ok(Number.isInteger(runs) && runs > 0 && runs <= 12);
const hz = Number(execFileSync('/usr/bin/getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
assert.ok(Number.isFinite(hz) && hz > 0);

function sample(pid) {
  const stat = readFileSync('/proc/' + pid + '/stat', 'utf8');
  const fields = stat
    .slice(stat.lastIndexOf(')') + 2)
    .trim()
    .split(/\s+/);
  const cpuTicks = Number(fields.at(11)) + Number(fields.at(12));
  const status = readFileSync('/proc/' + pid + '/status', 'utf8');
  const rss = Number(/^VmHWM:\s+(\d+)\s+kB/m.exec(status)?.at(1));
  assert.ok(Number.isFinite(cpuTicks) && rss > 0);
  return { cpuTicks, rss };
}

function measures(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const quantile = (q) => Number(sorted.at(Math.ceil(sorted.length * q) - 1)?.toFixed(3));
  return { p50: quantile(0.5), p95: quantile(0.95) };
}

async function run(variant, pair) {
  const f = fixture();
  let host;
  try {
    const starting = performance.now();
    host = await (variant === 'js'
      ? jsDaemon(f)
      : rustDaemon(f, undefined, variant === 'sleep' ? baseline : undefined));
    const readyMs = performance.now() - starting;
    const pid = host.child.pid;
    assert.ok(pid);
    const before = sample(pid);
    const health = /** @type {number[]} */ ([]);
    const tasks = Array.from({ length: 4 }, () => randomUUID());
    for (const task of tasks) {
      assert.equal(
        (await ownerRequest(host.ownerPath, 'POST', '/start/' + task)).data.status,
        'started',
      );
      assert.equal(
        (await ownerRequest(host.ownerPath, 'POST', '/start/' + task)).data.status,
        'existing',
      );
    }
    for (let i = 0; i < 48; i++) {
      const start = performance.now();
      assert.equal((await ownerRequest(host.ownerPath, 'GET', '/health')).data.status, 'ready');
      health.push(performance.now() - start);
    }
    const journal = host.journal;
    await waitUntil(() => tasks.every((task) => events(journal, task).length === 34));
    for (const task of tasks) assertComplete(events(journal, task));
    const after = sample(pid);
    console.log(
      JSON.stringify({
        pair,
        variant,
        readyMs: Number(readyMs.toFixed(3)),
        health: measures(health),
        cpuMs: ((after.cpuTicks - before.cpuTicks) * 1000) / hz,
        peakRssKiB: after.rss,
        events: 136,
      }),
    );
  } finally {
    await host?.stop();
    f.close();
  }
}
console.log(
  JSON.stringify({
    fixture: 'owner-contract-v1',
    node: process.version,
    runs,
    hz,
    platform: process.platform + '/' + process.arch,
  }),
);
for (let pair = 1; pair <= runs; pair++) {
  const variants = [baseline ? 'sleep' : 'js', 'rust'];
  if (pair % 2 === 0) variants.reverse();
  for (const variant of variants) await run(variant, pair);
}
