import { restartScenario } from './restart-scenario.mjs';

const [count = '6', ...rest] = process.argv.slice(2);
const pairs = Number(count);
if (!Number.isInteger(pairs) || pairs < 1 || pairs > 12 || rest.length) {
  throw new Error('Usage: npm run bench:restart -- [PAIRS 1-12]');
}
const round = (n) => Math.round(n * 100) / 100;
/** @type {Record<'graceful' | 'abrupt', Awaited<ReturnType<typeof restartScenario>>[]>} */
const samples = { graceful: [], abrupt: [] };
const keys = ['interruptionToReadyMs', 'readyToResumeMs', 'interruptionToResumeMs'];
console.log(
  JSON.stringify({
    scenario: 't1-daemon-restart-v1',
    node: process.version,
    platform: process.platform + '/' + process.arch,
    pairs,
    unit: 'ms',
  }),
);
for (let pair = 1; pair <= pairs; pair++) {
  const order = pair % 2 ? ['graceful', 'abrupt'] : ['abrupt', 'graceful'];
  for (const mode of order) {
    const result = await restartScenario(mode);
    samples[mode].push(result);
    console.log(
      JSON.stringify({
        pair,
        mode,
        events: result.events,
        ...Object.fromEntries(keys.map((key) => [key, round(result[key])])),
      }),
    );
  }
}
const nearestRank = (ordered, rank) => round(ordered[Math.ceil(ordered.length * rank) - 1]);
for (const [mode, runs] of Object.entries(samples)) {
  const metrics = Object.fromEntries(
    keys.map((key) => {
      const values = runs.map((run) => run[key]).sort((a, b) => a - b);
      return [key, { p50: nearestRank(values, 0.5), p95: nearestRank(values, 0.95) }];
    }),
  );
  console.log(
    JSON.stringify({
      summary: mode,
      successful: runs.length,
      events: runs.reduce((n, run) => n + run.events, 0),
      ...metrics,
    }),
  );
}
