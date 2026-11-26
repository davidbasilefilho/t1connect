import { X509Certificate } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync } from 'node:fs';

export const LOOPBACK = '127.0.0.1';
export const TTL_MS = 60_000;
export const STEP_MS = 45;
export const STEPS = 32;
export const PAGE = 16;
export const MAX_TASKS = 128;
export const MAX_DEVICES = 32;

export const isId = (value) =>
  typeof value === 'string' &&
  value.length === 36 &&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export const isFingerprint = (value) =>
  typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
export const fingerprint = (cert) =>
  new X509Certificate(cert).fingerprint256.replaceAll(':', '').toLowerCase();

export function currentUid() {
  if (typeof process.getuid !== 'function') throw new Error('a Unix user is required');
  return process.getuid();
}

/** @param {unknown} value */
export function sqlInteger(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new Error('invalid stored integer');
  return value;
}

export function privateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.uid !== currentUid() || (stat.mode & 0o777) !== 0o700) {
    throw new Error('state directory must belong to the current user and use mode 0700');
  }
}

export function readKey(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.uid !== currentUid() || (stat.mode & 0o077) !== 0) {
    throw new Error('private key must be a regular file accessible only by the current user');
  }
  return readFileSync(path);
}

export function tlsFiles(ca, cert, key) {
  return { ca: readFileSync(ca), cert: readFileSync(cert), key: readKey(key) };
}

export function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
