import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { MAX_DEVICES, MAX_TASKS, PAGE, STEPS, STEP_MS, transaction } from './protocol.mjs';

export function hostStore(path) {
  const db = new DatabaseSync(path);
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const q = Object.fromEntries(Object.entries({
    device: 'SELECT revoked FROM devices WHERE fingerprint = ?',
    deviceCount: 'SELECT count(*) AS total FROM devices',
    addDevice: 'INSERT INTO devices (fingerprint) VALUES (?)',
    grantCount: 'SELECT count(*) AS total FROM grants WHERE fingerprint = ?',
    grant: 'SELECT 1 FROM grants WHERE fingerprint = ? AND task = ?',
    allow: 'INSERT INTO grants (fingerprint, task) VALUES (?, ?)',
    revoke: 'UPDATE devices SET revoked = 1 WHERE fingerprint = ? AND revoked = 0',
    task: 'SELECT 1 FROM tasks WHERE id = ?',
    countTasks: 'SELECT count(*) AS total FROM tasks',
    addTask: 'INSERT INTO tasks (id, last_seq, due_at) VALUES (?, 1, ?)',
    writeEvent: 'INSERT INTO events (task, seq, kind, at) VALUES (?, ?, ?, ?)',
    due: 'SELECT id, last_seq FROM tasks WHERE last_seq < ? AND due_at <= ? ORDER BY due_at, id',
    advance: 'UPDATE tasks SET last_seq = ?, due_at = ? WHERE id = ?',
    events: 'SELECT seq, kind, at FROM events WHERE task = ? AND seq > ? ORDER BY seq LIMIT ?',
  }).map(([name, sql]) => [name, db.prepare(sql)]));

  return {
    active(device) {
      return q.device.get(device)?.revoked === 0;
    },
    approved(device, task) {
      return q.device.get(device)?.revoked === 0 && Boolean(q.grant.get(device, task));
    },
    approve(device, task) {
      return transaction(db, () => {
        const current = q.device.get(device);
        if (current?.revoked) return 'revoked';
        if (!current && q.deviceCount.get().total >= MAX_DEVICES) return 'capacity';
        if (q.grant.get(device, task)) return 'approved';
        if (q.grantCount.get(device).total >= MAX_TASKS) return 'capacity';
        if (!current) q.addDevice.run(device);
        q.allow.run(device, task);
        return 'approved';
      });
    },
    revoke(device) {
      return q.revoke.run(device).changes === 1;
    },
    start(task, now) {
      return transaction(db, () => {
        if (q.task.get(task)) return 'existing';
        if (q.countTasks.get().total >= MAX_TASKS) return 'capacity';
        q.addTask.run(task, now + STEP_MS);
        q.writeEvent.run(task, 1, 'started', now);
        return 'started';
      });
    },
    tick(now) {
      if (!q.due.get(STEPS + 2, now)) return;
      transaction(db, () => {
        for (const { id, last_seq } of q.due.all(STEPS + 2, now)) {
          const seq = last_seq + 1;
          q.writeEvent.run(id, seq, seq === STEPS + 2 ? 'completed' : 'progress', now);
          q.advance.run(seq, now + STEP_MS, id);
        }
      });
    },
    events(task, after) {
      return q.task.get(task) ? q.events.all(task, after, PAGE) : null;
    },
    close() { db.close(); },
  };
}
