import { startHost } from './host.mjs';
import { tlsFiles } from './protocol.mjs';

const [state, ca, cert, key, port = '0', ownerDirectory = state, ...rest] = process.argv.slice(2);
if (!state || !ca || !cert || !key || rest.length) {
  console.error(
    'Usage: node src/host-cli.mjs STATE CA.pem HOST.pem HOST.key [PORT [OWNER_DIRECTORY]]',
  );
  process.exitCode = 2;
} else {
  process.umask(0o077);
  try {
    const host = await startHost({
      state,
      ownerDirectory,
      tls: tlsFiles(ca, cert, key),
      port: Number(port),
    });
    for (const signal of ['SIGTERM', 'SIGINT']) {
      process.once(signal, () => void host.close());
    }
    console.log(JSON.stringify({ status: 'ready', port: host.port }));
    // A failed worker stops its listeners. A signal-initiated close keeps exit zero.
    process.once('beforeExit', () => {
      if (host.failed()) {
        process.exitCode = 1;
        void host.close();
      }
    });
  } catch {
    console.error('Host did not start. Check the lab identity files, state path, and port.');
    process.exitCode = 1;
  }
}
