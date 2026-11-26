import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { fingerprint, LOOPBACK, tlsFiles } from '../src/protocol.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

export function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 't1-lab-'));
  const path = (name) => join(dir, name);
  function openssl(...args) {
    const result = spawnSync('openssl', args, {
      cwd: dir, env: { PATH: '/usr/bin:/bin' }, stdio: 'ignore', timeout: 10_000,
    });
    if (result.status !== 0) throw new Error('Disposable PKI setup needs OpenSSL 3.');
  }
  function makeCA(name) {
    openssl('req', '-new', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256',
      '-nodes', '-days', '1', '-subj', '/CN=' + name, '-keyout', name + '.key',
      '-out', name + '.pem', '-addext', 'basicConstraints=critical,CA:TRUE',
      '-addext', 'keyUsage=critical,keyCertSign,cRLSign');
  }
  function makeLeaf(name, ca, server = false) {
    openssl('req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256',
      '-nodes', '-subj', '/CN=' + name, '-keyout', name + '.key', '-out', name + '.csr',
      '-addext', 'basicConstraints=critical,CA:FALSE',
      '-addext', 'keyUsage=critical,digitalSignature',
      '-addext', 'extendedKeyUsage=' + (server ? 'serverAuth' : 'clientAuth'),
      ...(server ? ['-addext', 'subjectAltName=DNS:localhost'] : []));
    openssl('x509', '-req', '-days', '1', '-sha256', '-in', name + '.csr', '-CA', ca + '.pem',
      '-CAkey', ca + '.key', '-set_serial', '0x' + randomUUID().replaceAll('-', ''),
      '-copy_extensions', 'copy', '-out', name + '.pem');
    chmodSync(path(name + '.key'), 0o600);
  }
  try {
    makeCA('ca');
    makeCA('other-ca');
    makeLeaf('host', 'ca', true);
    makeLeaf('viewer', 'ca');
    makeLeaf('second', 'ca');
    makeLeaf('untrusted', 'other-ca');
    for (const name of ['ca', 'other-ca']) rmSync(path(name + '.key'));
    return {
      dir, path,
      fp: (name) => fingerprint(readFileSync(path(name + '.pem'))),
      tls: (name) => tlsFiles(path('ca.pem'), path(name + '.pem'), path(name + '.key')),
      close: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

export async function command(path, ...args) {
  const child = spawn(process.execPath, [path, ...args], { cwd: root, env: {}, stdio: ['ignore', 'pipe', 'pipe'] });
  const exit = once(child, 'exit');
  const closed = once(child, 'close');
  let output = '', errors = '';
  child.stdout.setEncoding('utf8').on('data', (s) => { output += s; });
  child.stderr.setEncoding('utf8').on('data', (s) => { errors += s; });
  return {
    child, exit,
    stdout: () => output, stderr: () => errors,
    async done() {
      const [code, signal] = await closed;
      return { code, signal, output, errors };
    },
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
        try { await exit; } finally { clearTimeout(timer); }
      }
    },
  };
}

export async function waitUntil(predicate, duration = 5_000) {
  const start = performance.now();
  while (performance.now() - start < duration) {
    const result = await predicate();
    if (result) return result;
    await sleep(5);
  }
  throw new Error('Timed out waiting for the lab condition.');
}

export async function daemon(f, port = 0, ownerDirectory = f.path('host-state')) {
  const process = await command('src/host-cli.mjs', f.path('host-state'), f.path('ca.pem'),
    f.path('host.pem'), f.path('host.key'), String(port), ownerDirectory);
  try {
    const address = await waitUntil(() => {
      if (process.child.exitCode !== null) throw new Error('Disposable host exited before readiness.');
      if (!process.stdout().includes('\n')) return;
      return JSON.parse(process.stdout().trim());
    });
    return { ...process, port: address.port, ownerPath: join(ownerDirectory, 'owner.sock') };
  } catch (error) {
    await process.stop();
    throw error;
  }
}

// A loopback-only synthetic blackhole. Stops forwarding existing and new connections.
export async function impairment(port) {
  let offline = false;
  const peers = new Set();
  const track = (socket) => {
    peers.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => peers.delete(socket));
    return socket;
  };
  const proxy = createServer((client) => {
    track(client);
    if (offline) return;
    const upstream = track(connect(port, LOOPBACK));
    client.once('close', () => upstream.destroy());
    upstream.once('close', () => client.destroy());
    client.pipe(upstream).pipe(client);
  });
  proxy.listen(0, LOOPBACK);
  await once(proxy, 'listening');
  const reset = () => { for (const socket of peers) socket.destroy(); };
  return {
    port: proxy.address().port,
    loss() { offline = true; reset(); },
    restore() { offline = false; reset(); },
    async close() { reset(); await new Promise((resolve) => proxy.close(resolve)); },
  };
}
