import { waitForRecovery } from './recovery.js';

export async function findBoundary({ config, runStep, onRunComplete = () => {} }) {
  const runs = [];

  if (config.search.warmupDuration && parseDurationAmount(config.search.warmupDuration) > 0) {
    const warmup = await runStep({
      phase: 'warmup',
      rate: config.search.startRps,
      duration: config.search.warmupDuration
    });
    onRunComplete(warmup);
    await waitForRecovery(config);
  }

  let highestPassingRps = 0;
  let firstFailingRps = null;
  let currentRate = config.search.startRps;

  while (true) {
    const run = await runMeasuredStep(config, runStep, onRunComplete, runs, currentRate);

    if (run.passed) {
      highestPassingRps = currentRate;
      if (currentRate >= config.search.maxRps) {
        return {
          highestSustainableRps: highestPassingRps,
          firstFailingRps,
          runs
        };
      }

      const nextRate = Math.min(config.search.maxRps, currentRate * 2);
      if (nextRate === currentRate) {
        return {
          highestSustainableRps: highestPassingRps,
          firstFailingRps,
          runs
        };
      }

      currentRate = nextRate;
      await waitForRecovery(config);
      continue;
    }

    firstFailingRps = currentRate;
    break;
  }

  let low = highestPassingRps;
  let high = firstFailingRps;

  while (high - low > config.search.resolutionRps) {
    const middle = Math.floor((low + high) / 2);
    if (middle === low || middle === high) {
      break;
    }

    await waitForRecovery(config);
    const run = await runMeasuredStep(config, runStep, onRunComplete, runs, middle);
    if (run.passed) {
      low = middle;
    } else {
      high = middle;
    }
  }

  return {
    highestSustainableRps: low,
    firstFailingRps,
    runs
  };
}

async function runMeasuredStep(config, runStep, onRunComplete, runs, rate) {
  const run = await runStep({
    phase: 'measure',
    rate,
    duration: config.search.duration
  });

  runs.push(run);
  onRunComplete(run);
  return run;
}

function parseDurationAmount(duration) {
  const match = String(duration).match(/^(\d+)(ms|s|m|h)$/);
  if (!match) {
    return 0;
  }
  return Number(match[1]);
}
