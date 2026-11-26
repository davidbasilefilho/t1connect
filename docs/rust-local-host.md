# Rust increment 1 — local owner and journal

This is an implementation milestone of the [parity plan](https://github.com/davidbasilefilho/t1connect/blob/1ef7afb/docs/plans/connect-parity-rust.md), based on the merged JavaScript lab. It does not change T3 Code and does not replace any environment daemon or application. It uses an owned Unix socket only; there is **no network listener**, device API, relay, enrollment, tool execution or deployment.

The new Linux binaries cover a deliberately small subset of the JS owner contract:
GET /health and POST /start/{id} for the fixed synthetic task. The two CLIs work
across implementations for that subset. The Rust state and runtime directories
must be owned by a non-root user, use mode 0700, and reside under a trusted local
parent directory. The owner socket uses mode 0600. Use dedicated Rust directories
rather than pointing binaries at real state. No migration or shared writer is
supported; the Rust journal is called rust-host.sqlite. Both fixtures reuse the
project's schema so their ordered event shapes are comparable.

A single thread handles the local owner and journal. Only one daemon acquires
ownership of a state/runtime path at a time with advisory file locks. The
request deadline and byte/header limits bound an incomplete client. SIGTERM and
SIGINT trigger graceful exit and remove the new socket. SIGKILL can leave a stale
socket. After checking the old daemon is gone, start again with the same state
and a fresh runtime directory. The reused journal cannot repeat a task ID.
This is process recovery, not power-loss or VM validation. A malicious process
running as the same owner UID is outside the Unix directory trust boundary.
No auth gate was relaxed in the JS reference.

## Checks

Use Linux x86-64, the Node version in .node-version, OpenSSL 3 for the fixtures,
and mise with a C compiler for bundled SQLite. Obtain dependencies before offline
use. Toolchain components are defined in mise.toml.

    mise trust
    mise install
    mise exec -- rustc -Vv
    mise exec -- rust-analyzer --version
    npm ci --ignore-scripts --no-audit --no-fund
    npm run verify
    mise run rust:verify

The fmt and Clippy checks above are non-mutating. No runtime Node dependency is
needed by the Rust binaries. Cargo.lock records the complete dependency resolution.
The four direct external Rust crates are httparse, rusqlite (bundled SQLite),
rustix and signal-hook. License metadata is inspected with Cargo; no upstream
T3 Code source or artifacts were copied and no binaries are distributed here.
The lab commands use paths and keys generated from fixtures only, and do not
install a service. Reverting the Rust branch or stopping/discarding its isolated
state leaves the JS reference unchanged.

The Rust workflow records the resolved stable, cargo, rustfmt, Clippy and
rust-analyzer. hk reuses the same mise tasks, complemented by the existing JS
commands. Own production Rust forbids unsafe code and Clippy denies panic,
unwrap/expect, todo/unimplemented, and unchecked indexing. IO, clock and storage
failures use typed contextual results. Checked arithmetic is used for time and
sequence conversion; this is not an absolute claim about dependencies or OOM.

## Iteration contract

1. **Interoperable owner and replay.** Baseline is the merged JS lab plus its
   read-only journal fixture. Use release-mode binaries and run
   node lab/rust-owner-contract.mjs. The acceptance gate is identical owner
   responses and 34 ordered events per task, no duplicate start or lost
   committed prefix after interruption, verified graceful cleanup, single
   writer, timeout recovery, and no readiness on failed journal open.
   Unsupported approval routes must stay closed. Device revocation remains
   in the JS suite and is not claimed for the Rust daemon.
2. **Performance baseline.** Run node lab/rust-owner-bench.mjs 4. Alternate
   JS/Rust order over fresh processes on the same Linux host, start and reenter
   4 synthetic tasks, sample 48 owner health round trips, and wait for 136
   committed events. Capture cold readiness including process launch (same
   readiness polling for both), standalone daemon CPU after readiness and peak
   RSS from the fixture child's Linux proc counters. The CPU tick resolution
   is recorded. JS still initializes its TLS listener, while Rust is local
   only. This is like-for-like owner traffic but not like-for-like host feature
   coverage; it cannot demonstrate an overall Rust rewrite performance gain.
3. **Wait implementation hypothesis.** Replace the fixed 2 ms owner accept sleep
   with an fd wait bounded by the next 15 ms journal check. Keep one thread, the
   same deadline, no protocol change, and the same corruption/recovery guards.
   Save baseline release binary, then use T1_RUST_BASELINE_BIN to run six
   alternating pairs within Rust. Promote only with a median reduction of at
   least 0.5 ms in per-run owner health p95, median CPU no more than one tick
   above baseline, peak RSS no more than 8 MiB above baseline, and all contract
   checks passing. Report ranges, not a confidence interval from six runs.
