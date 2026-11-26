import assert from 'node:assert/strict';
import test from 'node:test';
import { restartScenario } from '../lab/restart-scenario.mjs';
import { STEPS } from '../src/protocol.mjs';

void test('an abruptly terminated daemon resumes durable events and keeps device revocation', async () => {
  const result = await restartScenario('abrupt');
  assert.equal(result.events, STEPS + 2);
});
