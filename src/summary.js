export function evaluateSummary(summary, config) {
  const reasons = [];
  const minimumAchievedRps = summary.requested_rps * config.sla.minAchievedRatio;

  if (summary.achieved_rps < minimumAchievedRps) {
    reasons.push(
      `achieved RPS ${formatNumber(summary.achieved_rps)} is below minimum ${formatNumber(minimumAchievedRps)}`
    );
  }

  if (summary.overall.error_rate >= config.sla.maxErrorRate) {
    reasons.push(
      `overall error rate ${formatRate(summary.overall.error_rate)} is above ${formatRate(config.sla.maxErrorRate)}`
    );
  }

  if (summary.overall.dropped_iterations > 0) {
    reasons.push(`dropped iterations detected (${summary.overall.dropped_iterations})`);
  }

  for (const endpoint of summary.endpoints) {
    if (endpoint.error_rate >= config.sla.maxErrorRate) {
      reasons.push(
        `${endpoint.name} error rate ${formatRate(endpoint.error_rate)} is above ${formatRate(config.sla.maxErrorRate)}`
      );
    }

    if (endpoint.p95_ms > config.sla.p95Ms) {
      reasons.push(`${endpoint.name} p95 ${formatNumber(endpoint.p95_ms)}ms is above ${config.sla.p95Ms}ms`);
    }

    if (endpoint.p99_ms > config.sla.p99Ms) {
      reasons.push(`${endpoint.name} p99 ${formatNumber(endpoint.p99_ms)}ms is above ${config.sla.p99Ms}ms`);
    }
  }

  return {
    passed: reasons.length === 0,
    reasons
  };
}

export function normalizeRunSummary(summary) {
  return {
    requested_rps: Number(summary.requested_rps ?? 0),
    achieved_rps: Number(summary.achieved_rps ?? 0),
    duration_seconds: Number(summary.duration_seconds ?? 0),
    thresholds_passed: Boolean(summary.thresholds_passed),
    overall: {
      total_requests: Number(summary.overall?.total_requests ?? 0),
      error_rate: Number(summary.overall?.error_rate ?? 0),
      dropped_iterations: Number(summary.overall?.dropped_iterations ?? 0)
    },
    endpoints: Array.isArray(summary.endpoints)
      ? summary.endpoints.map(endpoint => ({
          name: String(endpoint.name),
          weight: Number(endpoint.weight ?? 0),
          requests: Number(endpoint.requests ?? 0),
          achieved_rps: Number(endpoint.achieved_rps ?? 0),
          error_rate: Number(endpoint.error_rate ?? 0),
          p95_ms: Number(endpoint.p95_ms ?? 0),
          p99_ms: Number(endpoint.p99_ms ?? 0)
        }))
      : []
  };
}

export function formatRate(value) {
  return `${formatNumber(value * 100)}%`;
}

export function formatNumber(value) {
  return Number(value).toFixed(2).replace(/\.00$/, '');
}
