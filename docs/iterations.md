# Iteration ledger

This ledger separates runtime behavior, development workflow, and planning.
Results apply only to their pinned fixture. A failed control, inconclusive
difference, or untested environment is not a gain.

| Iteration | Hypothesis and reproducible baseline | Isolated change and guardrails | Evidence and decision |
| --- | --- | --- | --- |
| Transport, initial | Pooling pinned TLS should reduce CPU. Fresh-TLS baseline is in the benchmark report, 3 hosts × 4 tasks. | Add an HTTPS agent. Require observed reuse, same TLS pin and scope, exact journal replay, revocation on an existing socket and no resource regressions. | Rejected: no actual reuse because the request-level verifier disabled pooling and the timeout hint left no margin. Do not compare it as a pooling gain. |
| Transport, corrected | Keep the pin fixed per agent. Same baseline and order-alternated comparison. | Change agent callback placement and idle margin; pinning, expiry, replay, task scope and revocation stay verified. Require ≥20% median CPU gain, within +5 ms event p95 and +8 MiB RSS. | Kept: 713.46 → 331.64 ms median host CPU (−53.5%), online event p95 ranges 20–22 → 16–17 ms. Peak RSS ranges 55,984–56,488 → 48,116–48,212 KiB, with all 12 paired trials per variant passing. Three observations are ranges, not confidence intervals. |
| Daemon restart | Abrupt termination should preserve the committed prefix and revocation as graceful termination does. | Terminate the fixture child only, rebind loopback and reuse state/device identity. Reject old sessions, duplicate starts and renewed access after revocation. Compare 6 trials per mode, alternating order. Require p95 ≤500 ms and abrupt within +100 ms of graceful. | Kept as a test guardrail, not a speedup. All 12 runs passed; p95 119.99 ms graceful and 120.57 ms abrupt. No VM manager, storage failure while writing, or power loss test. |
| Merge verification and failure hygiene | A clean diff and a secret scan alone miss static errors, checkout health and missing tooling. The six-test baseline is 08585fb, with only the GitGuardian check. | Lock dev tools, share check/verify across npm/hk/CI, add JS unit and synthetic storage-startup cases. Require a valid commit/push, three negative probes (typed lint, checkJs and format), real remote run at the final head, no runtime dependencies, and all prior replay/auth guards. | Kept as verification and defensive hardening. All 10 tests pass. Installed hk hooks accepted a valid commit and updates to existing and new branches in a local bare fixture, and rejected the deliberate floating Promise before changing HEAD. Separate bad JS types and formatting probes failed as expected. See below for runtime measurements. |

### Scoped runtime comparison for the verification change

Use before/after source archives from 08585fb and 63cce11, Node 24.22.3,
no test or package installation runs concurrently, and the same workload with
the retained TLS reuse mode. Run npm run bench -- candidate 1 4 once per
revision in order before/after, after/before, before/after, creating a fresh
host each time. Compare three four-task runs per revision. First finish the
pipeline check, then measure. Guardrails are unchanged correctness, median
host CPU ≤120% of the baseline, peak host RSS no higher than 8 MiB over
baseline, median online event p95 no more than +5 ms and each run within the
existing local latency envelope. The purpose is no material regression, not
to claim a gain from linting or formatting. For failure coverage run
npm run bench:restart -- 6 again and assert restart recovery and revocation.

Measured [interleaved comparison](evidence/merge-verification-comparison.ndjson)
and [restart repeat](evidence/merge-verification-restart.ndjson), Node 24.22.3
and OpenSSL 3, Linux x64. All 12 tasks per revision paired and recovered,
408 ordered events each, with three successful revocations per revision.

| Measure | Before | After |
| --- | ---: | ---: |
| Host CPU median per four tasks | 381.02 ms | 389.29 ms (+2.17%) |
| Host CPU range | 319.77–384.42 ms | 313.57–430.84 ms |
| Peak host RSS range | 48,036–48,464 KiB | 47,752–48,252 KiB |
| Online event p95 range | 17–18 ms | 17–19 ms |
| Pairing p95 range | 15.17–17.13 ms | 16.96–20.05 ms |
| Reconnect p95 range | 8.22–12.05 ms | 8.56–9.98 ms |

The variable CPU samples overlap. The predeclared no-regression bounds pass;
there is no performance win claimed. The restart repeat recovered 408 events
in 12 trials with revocation lasting through the second restart. Interruption
to first newly committed event was 107.00/112.38 ms p50/p95 graceful and
96.90/111.03 ms abrupt. The startup failure fixture makes the expected journal
path unavailable and verifies no readiness or owner socket is advertised. It
does not simulate a full filesystem during a transaction. Abrupt and clean
shutdown cases, timeout and reentry remain loopback checks, not VM or mobile
certification. No changes to user-facing runtime scope.

### Agent harness and cost accounting

The native session was not started or coordinated by HolyAgent. An isolated,
registry-integrity-checked probe resolved npm dist-tag dev to
0.4.0-dev.2026-11-26.15-00-30.ge66866c and confirmed the reported version.
Its supported setup dry run exited 1: T3 Code had not been initialized and
Pi was absent. No settings, project files, credentials or other session
were changed. This is compatibility evidence, not active harness use. The
pinned [supported workflow](https://github.com/davidbasilefilho/holyagent/blob/e66866c833bba74a292da3b33d93f0ddb185b07f/docs/requirements.md)
requires a T3 Code conversation using its Pi provider and the chosen checkout.
Starting another turn in the same native Codex runtime does not attach it.

The team measured product CPU, RSS, and latency on loopback only. No verified
per-turn model latency, token counts, cache hits, or call counts are exposed
to this native session, so none are reported. Toolchain durations and workflow
wall time do not substitute for the product or for agent telemetry.
