# T1 Connect

Opt-in, self-hosted access to tasks on computers you own. Independent of T3 Tools and T1OS.

Experimental. See [upstream research](docs/upstream.md) and the [private-first design](docs/design.md).

Licensed under Apache-2.0.

## Try the disposable lab

Use an unprivileged Linux account with Node 24 LTS (24.15 or newer) and OpenSSL 3.
There are no npm dependencies. OpenSSL is used only by the synthetic fixture.

```sh
npm test
npm run demo
npm run bench -- baseline 3 4
```

The lab starts a child daemon on a random loopback port, creates temporary test
identities, and removes them on exit. It cannot listen on LAN or public addresses.
The desktop-owner and viewer CLIs are exercised as separate processes in the test
suite. There is no installation, agent execution, user data, or external relay.
