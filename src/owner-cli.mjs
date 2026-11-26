import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ownerRequest } from './client.mjs';
import { isFingerprint, isId, privateDirectory } from './protocol.mjs';

const [state, command, a, b, ...more] = process.argv.slice(2);
let method = 'POST';
let path;
if (!more.length && state) {
  if (command === 'new-id' && a === undefined) console.log(randomUUID());
  if (command === 'health' && a === undefined) [method, path] = ['GET', '/health'];
  if (command === 'approve' && isFingerprint(a) && isId(b)) path = '/approve/' + a + '/' + b;
  if (command === 'revoke' && isFingerprint(a) && b === undefined) path = '/revoke/' + a;
  if (command === 'start' && isId(a) && b === undefined) path = '/start/' + a;
}
if (path) {
  try {
    privateDirectory(state);
    const { status, data } = await ownerRequest(join(state, 'owner.sock'), method, path);
    if (status !== 200) {
      console.error('Owner request was rejected (HTTP ' + status + ').');
      process.exitCode = 1;
    } else {
      console.log(data.status);
    }
  } catch {
    console.error('Owner socket unavailable.');
    process.exitCode = 1;
  }
} else if (command !== 'new-id' || a !== undefined || !state) {
  console.error('Usage: node src/owner-cli.mjs STATE new-id|health|approve FINGERPRINT TASK|start TASK|revoke FINGERPRINT');
  process.exitCode = 2;
}
