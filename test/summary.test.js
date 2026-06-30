import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateSummary } from '../src/summary.js';

test('evaluateSummary marks runs as passing when limits are respected', () => {
  const result = evaluateSummary(
    {
      requested_rps: 50,
      achieved_rps: 49,
      overall: {
        error_rate: 0,
        dropped_iterations: 0
      },
      endpoints: [
        { name: 'primary', error_rate: 0, p95_ms: 100, p99_ms: 200 },
        { name: 'secondary', error_rate: 0, p95_ms: 120, p99_ms: 210 }
      ]
    },
    {
      sla: {
        maxErrorRate: 0.01,
        p95Ms: 500,
        p99Ms: 2000,
        minAchievedRatio: 0.95
      }
    }
  );

  assert.equal(result.passed, true);
  assert.equal(result.reasons.length, 0);
});

test('evaluateSummary explains failures', () => {
  const result = evaluateSummary(
    {
      requested_rps: 50,
      achieved_rps: 40,
      overall: {
        error_rate: 0.02,
        dropped_iterations: 3
      },
      endpoints: [
        { name: 'primary', error_rate: 0.02, p95_ms: 600, p99_ms: 2500 },
        { name: 'secondary', error_rate: 0, p95_ms: 120, p99_ms: 210 }
      ]
    },
    {
      sla: {
        maxErrorRate: 0.01,
        p95Ms: 500,
        p99Ms: 2000,
        minAchievedRatio: 0.95
      }
    }
  );

  assert.equal(result.passed, false);
  assert.match(result.reasons.join(' | '), /achieved RPS/);
  assert.match(result.reasons.join(' | '), /dropped iterations/);
  assert.match(result.reasons.join(' | '), /primary p95/);
});
