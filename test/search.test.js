import test from 'node:test';
import assert from 'node:assert/strict';

import { findBoundary } from '../src/search.js';

test('findBoundary uses exponential search plus binary search', async () => {
  const attemptedRates = [];
  const boundary = 65;

  const result = await findBoundary({
    config: {
      search: {
        startRps: 10,
        maxRps: 100,
        resolutionRps: 1,
        duration: '10s',
        warmupDuration: '0s',
        cooldownSeconds: 0
      }
    },
    runStep: async ({ phase, rate }) => {
      attemptedRates.push({ phase, rate });
      return {
        phase,
        requested_rps: rate,
        achieved_rps: rate,
        overall: { error_rate: 0, dropped_iterations: 0 },
        endpoints: [
          { name: 'primary', error_rate: 0, p95_ms: 100, p99_ms: 200 },
          { name: 'secondary', error_rate: 0, p95_ms: 100, p99_ms: 200 }
        ],
        passed: rate <= boundary,
        reasons: []
      };
    }
  });

  assert.equal(result.highestSustainableRps, 65);
  assert.equal(result.firstFailingRps, 80);
  assert.deepEqual(
    attemptedRates.filter(entry => entry.phase === 'measure').map(entry => entry.rate),
    [10, 20, 40, 80, 60, 70, 65, 67, 66]
  );
});
