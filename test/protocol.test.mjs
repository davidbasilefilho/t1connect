import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { isFingerprint, isId, sqlInteger, transaction } from '../src/protocol.mjs';

void test('identifier and fingerprint validators use canonical lowercase forms', () => {
  assert.equal(isId('12345678-1234-1234-1234-123456789abc'), true);
  assert.equal(isId('12345678-1234-1234-1234-123456789ABC'), false);
  assert.equal(isId('12345678-1234-1234-1234-123456789abc\n'), false);
  assert.equal(isFingerprint('a'.repeat(64)), true);
  assert.equal(isFingerprint('a'.repeat(63)), false);
  assert.equal(isFingerprint('g'.repeat(64)), false);
});

void test('stored integer conversion refuses absent or lossy values', () => {
  assert.equal(sqlInteger(0), 0);
  assert.equal(sqlInteger(32), 32);
  for (const value of ['32', undefined, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => sqlInteger(value), /stored integer/);
  }
});

void test('transaction rolls back writes on error and commits on success', () => {
  using db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE state (id INTEGER PRIMARY KEY) STRICT');
  const insert = db.prepare('INSERT INTO state VALUES (?)');
  const count = db.prepare('SELECT count(*) AS total FROM state');
  assert.throws(
    () =>
      transaction(db, () => {
        insert.run(1);
        throw new Error('synthetic interruption');
      }),
    /synthetic interruption/,
  );
  assert.equal(count.get()?.total, 0);
  transaction(db, () => insert.run(2));
  assert.equal(count.get()?.total, 1);
});
