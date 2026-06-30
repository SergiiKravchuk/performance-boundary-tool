import fs from 'node:fs/promises';
import path from 'node:path';

import { formatNumber, formatRate } from './summary.js';

export function printRunResult(run) {
  const state = run.passed ? 'PASS' : 'FAIL';
  const endpointText = run.endpoints
    .map(endpoint => `${endpoint.name}: p95=${formatNumber(endpoint.p95_ms)}ms err=${formatRate(endpoint.error_rate)}`)
    .join(' | ');

  console.log(
    `[${run.phase}] ${run.requested_rps} rps -> ${state} | achieved=${formatNumber(run.achieved_rps)} | ${endpointText}`
  );

  if (!run.passed && run.reasons.length > 0) {
    console.log(`  reasons: ${run.reasons.join('; ')}`);
  }
}

export async function writeRunMeta(run, metaPath) {
  const payload = {
    phase: run.phase,
    requested_rps: run.requested_rps,
    achieved_rps: run.achieved_rps,
    runtime_mode: run.runtimeMode,
    passed: run.passed,
    reasons: run.reasons,
    exit_code: run.exitCode,
    command: run.command,
    summary_file: run.summaryFile
  };

  await fs.writeFile(metaPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export async function writeFinalSummary(config, boundaryResult) {
  const summary = {
    target_base_url: config.target.baseUrl,
    highest_sustainable_rps: boundaryResult.highestSustainableRps,
    first_failing_rps: boundaryResult.firstFailingRps,
    mix: config.mix.endpoints.map(endpoint => ({
      name: endpoint.name,
      weight: endpoint.weight
    })),
    sla: {
      max_error_rate: config.sla.maxErrorRate,
      p95_ms: config.sla.p95Ms,
      p99_ms: config.sla.p99Ms,
      min_achieved_ratio: config.sla.minAchievedRatio
    },
    runs: boundaryResult.runs.map(run => ({
      requested_rps: run.requested_rps,
      achieved_rps: run.achieved_rps,
      passed: run.passed,
      reasons: run.reasons,
      overall: run.overall,
      endpoints: Object.fromEntries(
        run.endpoints.map(endpoint => [
          endpoint.name,
          {
            achieved_rps: endpoint.achieved_rps,
            requests: endpoint.requests,
            error_rate: endpoint.error_rate,
            p95_ms: endpoint.p95_ms,
            p99_ms: endpoint.p99_ms
          }
        ])
      )
    }))
  };

  const targetPath = path.join(config.results.outputDir, 'summary.json');
  await fs.writeFile(targetPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return targetPath;
}

export function printFinalSummary(boundaryResult, finalSummaryPath) {
  console.log('');
  console.log(`Highest sustainable RPS: ${boundaryResult.highestSustainableRps}`);
  console.log(`First failing RPS: ${boundaryResult.firstFailingRps ?? 'none'}`);
  console.log(`Summary report: ${finalSummaryPath}`);
}
