import assert from 'node:assert/strict';
import { accessSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { daemon, localProcess, waitUntil } from './fixture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = process.env.CARGO_TARGET_DIR || join(root, 'target');

export const rustBin = (name) => join(target, 'release', name);

/** @param {ReturnType<import('./fixture.mjs').fixture>} f */
export async function rustDaemon(f, runtime = f.path('rust-runtime'), bin = rustBin('t1-hostd')) {
  accessSync(bin);
  const state = f.path('rust-state');
  const process = localProcess(bin, [state, runtime]);
  try {
    await waitUntil(() => {
      if (process.child.exitCode !== null) throw new Error('Rust daemon exited before readiness.');
      if (!process.stdout().includes('\n')) return;
      return JSON.parse(process.stdout().trim()).status === 'ready';
    });
    const ownerPath = join(runtime, 'owner.sock');
    assert.equal(statSync(ownerPath).mode & 0o777, 0o600);
    return { ...process, ownerPath, runtime, journal: join(state, 'rust-host.sqlite') };
  } catch (error) {
    await process.stop();
    throw error;
  }
}

/** @param {ReturnType<import('./fixture.mjs').fixture>} f */
export async function jsDaemon(f) {
  const runtime = f.path('js-runtime');
  const process = await daemon(f, 0, runtime);
  return { ...process, runtime, journal: f.path('host-state/host.sqlite') };
}

export function events(path, task) {
  using db = new DatabaseSync(path, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 1000');
  return db.prepare('SELECT seq, kind FROM events WHERE task = ? ORDER BY seq').all(task);
}

export function assertComplete(rows) {
  assert.deepEqual(
    rows.map(({ seq, kind }) => [seq, kind]),
    Array.from({ length: 34 }, (_, i) => [
      i + 1,
      i === 0 ? 'started' : i === 33 ? 'completed' : 'progress',
    ]),
  );
}
