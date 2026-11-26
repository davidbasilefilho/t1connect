# Upstream evidence · 2026-11-26

| Project | Inspected version |
| --- | --- |
| T3 Code | [Latest stable v0.1.12](https://github.com/pingdotgg/t3code/releases/tag/v0.1.12), published 2026-11-25 07:36 UTC, source `ca81b7b97a1c4b91e5ac25768d0f6629f37732fd`. Main observed at [e56b8d9](https://github.com/pingdotgg/t3code/commit/e56b8d9cfcc868d8fc9a1c7808fe74f4842c7675). Main and release are not interchangeable. |
| T1OS | [ba0c04c, main](https://github.com/davidbasilefilho/t1os/tree/ba0c04cec2891117a4cd3027c85f541a691a38bf). Latest release endpoint returned 404. Its overlay pins T3 Code **v0.1.10**. |
| HolyAgent | [56d8b87, holyagent-0.3.4](https://github.com/davidbasilefilho/holyagent/tree/56d8b8758b001c4eb0599ee9276aa02607310795). The pinned release documents T3 Code/Pi as its only supported user-facing workflow. |

The isolated probe used the pinned public HolyAgent launcher and Bun 1.4.5 with no
inherited credentials. The official setup dry run exited 1, reporting that T3
settings were not initialized and Pi was absent from PATH. The legacy wrapper's
dry run could only propose Claude configuration, which was not written. No runtime
or editor was installed and the active harness was unchanged.

## What T3 Connect actually does

- [Control plane and infra](https://github.com/pingdotgg/t3code/blob/v0.1.12/infra/relay/README.md). Alchemy deploys a Cloudflare Worker, DNS/tunnel resources, queues and monitoring, using PlanetScale Postgres for control-plane state. Clerk provides cloud identity. APNs/FCM notifications and Live Activities are optional separate client capabilities. The Worker links hosts, lists environments, brokers bootstrap credentials and allocates managed tunnels. The relay is separately versioned from the apps.
- [Host and transport](https://github.com/pingdotgg/t3code/blob/v0.1.12/docs/internals/06_t3-connect.md). Host `apps/server/src/cloud` accepts signed, nonce-bound broker requests. The client obtains a short-lived, single-use, DPoP-bound bootstrap via the relay and exchanges it directly with the host. The Worker is **not** on the ordinary HTTP/WebSocket data path, although the managed tunnel provider is. The documented forwarded exception is automation webhooks. Trust in the broker signing key remains meaningful. Host device approval pins proof keys and revocation removes their sessions.
- [Session protocol](https://github.com/pingdotgg/t3code/blob/v0.1.12/docs/internals/04_environment-auth.md). Host issues separate environment credentials and WebSocket tickets, validates scope per RPC, and has its own persistent state. Signed asset URLs, external MCP, terminal, filesystem, and providers each bring additional boundaries. There is no reason to inherit those powers for a read-only viewer.
- [Desktop, web and mobile](https://github.com/pingdotgg/t3code/blob/v0.1.12/docs/internals/09_connection-runtime.md). `apps/desktop`, `apps/web` and `apps/mobile` use `packages/client-runtime` for one connection supervisor per host, with platform-specific credentials, storage and wakeups. Relay wire schemas are in [contracts](https://github.com/pingdotgg/t3code/blob/v0.1.12/packages/contracts/src/relay.ts). Cached state and its replay cursor advance together. Reconnection does not replay mutations. Adopt these invariants without importing the runtime or its authenticated RPC surface.
- [Own endpoint limitations](https://github.com/pingdotgg/t3code/blob/v0.1.12/docs/operations/02_connect-setup.md). Upstream documents injecting `T3CODE_RELAY_URL` and Clerk public config into client and bundled server builds. A new relay URL alone does not remove Clerk, Cloudflare tunnel provisioning, DNS, or build/signing configuration. Shared web credentials, EAS configuration, store signing, notifications and platform trust stores need independent work. Direct pairing already runs without managed WAN discovery on a reachable LAN/private network. By default cloud device approval is optional upstream and broad direct pairing grants are possible. [User guide](https://github.com/pingdotgg/t3code/blob/v0.1.12/docs/user/remote-access.md).
- [T1OS host boundary](https://github.com/davidbasilefilho/t1os/blob/ba0c04cec2891117a4cd3027c85f541a691a38bf/runtime/agent/README.md). It starts T3 on loopback port 3773 and explicitly disables its hosted Connect, telemetry and automatic updates. The separate, opt-in restricted SSH forward allows only T3 and WayVNC. T1OS checkpoints are references, not exports of turn content or process state. Do not loosen T3 policy, use an operator shell as the app transport, or mistake a checkpoint for a turn feed. No T1OS code was imported.

## Decision

| Option | Fit now | Cost / revisit trigger |
| --- | --- | --- |
| Reuse upstream direct T3 pairing and clients | Useful compatibility experiment, but not an independent minimal service | Requires T3 daemon and scoped pairing. Test against both pinned T1OS and current stable before committing to an adapter. |
| Adapt the upstream relay and clients | Mature route choice, account discovery and mobile UX | Replaces/operates multiple infrastructure dependencies and inherits the broader host contract. Reconsider only with measured need, separate client builds and review. |
| Implement a small private protocol | **Chosen for M1.** Loopback TLS, local approval, read-only task events and durable cursors | No claim of T3 wire compatibility, WAN reachability, browser or mobile support. Keep the adapter narrow to avoid rebuilding the T3 editor or agent runtime. |

## Source and license inventory

Original T1 Connect code is Apache-2.0. No source files, tests, images, or text were copied from T3 Code or T1OS. The links above are research pins, not bundled dependencies. T3 Code's [MIT license](https://github.com/pingdotgg/t3code/blob/v0.1.12/LICENSE) names T3 Tools Inc. If a later change copies or adapts any file, record its path, immutable revision, upstream license, modification and retained notice here, and retain the applicable MIT/copyright in the delivered files. Do not reuse upstream logos or trade dress.
