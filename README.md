# T1 Connect

Opt-in, self-hosted access to tasks on computers you own. Independent of T3 Tools and T1OS.

Project repository: [davidbasilefilho/t1connect](https://github.com/davidbasilefilho/t1connect).

Experimental. See [upstream research](docs/upstream.md) and the [private-first design](docs/design.md).

Licensed under Apache-2.0.

## Try the disposable lab

Use an unprivileged Linux account with Node 24 LTS (24.15 or newer) and OpenSSL 3.
The lab has no npm runtime dependencies. OpenSSL is used only by the synthetic fixture.

```sh
npm test
npm run demo
npm run bench -- compare 3 4
npm run bench:restart -- 6
```

The lab starts a child daemon on a random loopback port, creates temporary test
identities, and removes them on exit. It cannot listen on LAN or public addresses.
The desktop-owner and viewer CLIs are exercised as separate processes in the test
suite. There is no installation, agent execution, user data, or external relay.

For development setup, shared checks, and Git hooks, see [Development](docs/development.md).

Read the [recorded benchmark](docs/benchmark.md) and the optional
[T1OS companion profile](integrations/t1os/README.md). The latter has not been
executed in a guest. No normal device onboarding, production trust enrollment,
browser/mobile client, discovery, or off-host access is implemented here.
