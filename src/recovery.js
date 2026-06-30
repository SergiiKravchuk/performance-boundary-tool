function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export async function waitForRecovery(config) {
  if (config.health?.url) {
    await waitForHealthyEndpoint(config);
    return;
  }

  const cooldownSeconds = config.search?.cooldownSeconds ?? 0;
  if (cooldownSeconds > 0) {
    await sleep(cooldownSeconds * 1000);
  }
}

async function waitForHealthyEndpoint(config) {
  const timeoutAt = Date.now() + config.health.timeoutSeconds * 1000;
  const intervalMs = config.health.intervalSeconds * 1000;
  let lastStatus = 'no response';

  while (Date.now() <= timeoutAt) {
    try {
      const startedAt = Date.now();
      const response = await fetch(config.health.url, { method: 'GET' });
      const elapsedMs = Date.now() - startedAt;
      lastStatus = `${response.status} in ${elapsedMs}ms`;

      if (response.ok) {
        return;
      }
    } catch (error) {
      lastStatus = error.message;
    }

    await sleep(intervalMs);
  }

  throw new Error(`Health endpoint did not recover in time: ${lastStatus}`);
}
