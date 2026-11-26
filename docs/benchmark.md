# Benchmark contract

Fixed scenario: T1 loopback v1, one viewer, four tasks per host, three fresh hosts per variant. Node 24 and OpenSSL 3, Linux x64, no real third-party network. Each task appends a start, 32 progress events and a completion, polling every 15 ms. At cursor 5, a raw TCP loopback proxy drops established sessions and withholds new transport for 160 ms. The viewer sees a timed-out request, reopens its local database, and resumes. Retrying the owner's start ID during loss returns the existing task.

Pairing latency starts when the owner submits approval and ends with the device's first authorized read (an expected 404 before task start), excluding human time, PKI and daemon startup. Online event latency is host timestamp to committed client batch, excluding the first recovered backlog. Reconnection runs from synthetic link restoration to the first committed backlog. Revocation latency runs from the owner's acknowledged revocation to rejection of the next event read. Quantiles are nearest-rank. Small samples make per-run pairing and reconnect p95 equal to max (four samples) and revocation a spot check (one). CPU is the child host user + system CPU delta. Peak RSS and final RSS are host only. No energy, mobile, bandwidth or human usability claim follows.

Baseline commit: `49bb318`. [Raw fresh TLS baseline](evidence/fresh-tls.ndjson), Node v24.22.3. Median host CPU 677.19 ms over four tasks, range 650.39–731.20 ms. Peak RSS 55,732–56,728 KiB. Online event p95 20–21 ms, reconnect p95 10.64–14.65 ms. All 12 tasks paired and recovered, 408 total events, three revocations enforced.

## Acceptance before changing the transport

Required every run: 100% approval and reconnect, precisely one start/finish and 34 sequential events per task, and no post-revocation request authorized, including on an existing connection. Baseline lab targets: online event p95 ≤ 30 ms, reconnect p95 ≤ 100 ms after restoration, pairing p95 ≤ 50 ms and revocation next-request ≤ 50 ms. Candidate must reduce median host CPU by at least 20%, not add more than 5 ms to online event p95 or 8 MiB to peak host RSS, and pass the negative tests. If inconclusive, retain the baseline. This is a local optimization gate, not a production SLO.

## Hypothesis and result

One private HTTPS agent per exact endpoint and identity can reduce repeated TLS
handshakes without retaining authorization. Keep the immutable host pin on that
agent, limit it to one socket, and disable TLS session caching. Continue checking
device identity, token and task on each read.

The [initial attempt](evidence/keepalive-initial.ndjson) was rejected. Node v24.22.3
marks request-specific server-identity callbacks as unpoolable. Its default
one-second agent timeout buffer also consumes the host's one-second keep-alive
hint. The correction moved the same pin check to the per-device agent and set
a 250 ms buffer. The controlled run asserts zero reuse in the baseline and
actual reuse in every candidate process. See [Node HTTPS source](https://github.com/nodejs/node/blob/v24.22.3/lib/https.js)
and [HTTP agent options](https://nodejs.org/docs/latest-v24.x/api/http.html#new-agentoptions).

[Raw interleaved results](evidence/keepalive-comparison.ndjson) use alternating order.
Ranges describe the three four-task runs on each side, not confidence intervals.

| Local metric | Fresh TLS | Reuse |
| --- | ---: | ---: |
| Median host CPU per four tasks | 713.46 ms | 331.64 ms (−53.5%) |
| Peak host RSS, full range | 55,984–56,488 KiB | 48,116–48,212 KiB |
| Online event p50 / p95 ranges | 10–12 / 20–22 ms | 8–9 / 16–17 ms |
| Pairing p50 / p95 ranges | 9.20–10.42 / 12.28–22.37 ms | 2.98–3.32 / 7.97–14.56 ms |
| Reconnect p50 / p95 ranges | 10.04–11.50 / 10.89–12.34 ms | 7.18–7.54 / 7.23–11.00 ms |
| Next request after revocation | 3.35–5.90 ms | 0.49–0.89 ms |

Both variants passed all 12 approvals and reconnects, recorded 408 ordered events
and denied acquisition and continued use after all three revocations. The socket
reuse test explicitly verifies that a revoked device is denied on the already
established TLS connection. Keep the corrected candidate. Reproduce with
npm run bench -- compare 3 4. The harness can still select baseline, and transport
can revert to a fresh TLS request by setting keepAlive false. No schema change.
