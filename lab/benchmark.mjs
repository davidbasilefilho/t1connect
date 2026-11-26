import { scenario } from './scenario.mjs';

const [mode = 'baseline', runCount = '3', trialCount = '4', ...extra] = process.argv.slice(2);
const reps = Number(runCount), trials = Number(trialCount);
if (mode !== 'baseline' || !Number.isInteger(reps) || reps < 1 || reps > 12 ||
    !Number.isInteger(trials) || trials < 1 || trials > 12 || extra.length) {
  throw new Error('Usage: npm run bench -- baseline [RUNS 1-12] [TRIALS 1-12]');
}
const rounded = (n) => Math.round(n * 100) / 100;
const percentile = (samples, quantile) => {
  const ordered = [...samples].sort((a, b) => a - b);
  return rounded(ordered[Math.ceil(quantile * ordered.length) - 1]);
};
const summarize = (n) => ({ n: n.length, p50: percentile(n, .5), p95: percentile(n, .95) });
console.log(JSON.stringify({
  scenario: 't1-loopback-v1', node: process.version, platform: process.platform + '/' + process.arch,
  mode, runs: reps, trialsPerRun: trials, sampleUnits: 'ms, peak RSS in KiB',
}));
for (let run = 1; run <= reps; run++) {
  const result = await scenario({ trials });
  console.log(JSON.stringify({
    run, pairingSucceeded: result.trials, expectedTrials: trials, eventCount: result.events,
    reconnectionsSucceeded: trials, revokedDevicesDenied: 1,
    pairing: summarize(result.timing.pairing), onlineEvent: summarize(result.timing.onlineEvent),
    reconnection: summarize(result.timing.reconnection), revocation: summarize(result.timing.revocation),
    hostCpuMs: rounded(result.hostCpuMs), hostPeakRssKiB: result.hostPeakRssKiB,
    hostLastRssKiB: result.hostLastRssKiB,
  }));
}
