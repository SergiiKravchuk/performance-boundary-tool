import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';

const runtimeConfig = JSON.parse(__ENV.SCENARIO_CONFIG || '{}');

const endpointMetrics = [
  {
    duration: new Trend('endpoint_1_duration', true),
    errors: new Rate('endpoint_1_errors'),
    requests: new Counter('endpoint_1_requests')
  },
  {
    duration: new Trend('endpoint_2_duration', true),
    errors: new Rate('endpoint_2_errors'),
    requests: new Counter('endpoint_2_requests')
  }
];

const totalRequests = new Counter('total_requests');
const generatorState = new Map();

export const options = {
  scenarios: {
    boundary_test: {
      executor: 'constant-arrival-rate',
      rate: Number(runtimeConfig.rate || 1),
      timeUnit: '1s',
      duration: String(runtimeConfig.duration || '10s'),
      preAllocatedVUs: Number(runtimeConfig.k6?.preAllocatedVUs || 10),
      maxVUs: Number(runtimeConfig.k6?.maxVUs || 100)
    }
  },
  thresholds: buildThresholds(runtimeConfig)
};

export default function () {
  const endpointIndex = chooseEndpoint(runtimeConfig.endpoints || []);
  const endpoint = runtimeConfig.endpoints[endpointIndex];
  const metrics = endpointMetrics[endpointIndex];
  const bodyPayload = endpoint.bodyTemplate == null ? null : renderTemplate(endpoint.bodyTemplate, runtimeConfig.bodyGenerators || {});
  const requestBody = bodyPayload == null ? null : JSON.stringify(bodyPayload);
  const response = http.request(
    endpoint.method,
    `${runtimeConfig.baseUrl}${endpoint.path}`,
    requestBody,
    {
      headers: endpoint.headers || {},
      tags: {
        endpoint: endpoint.name
      }
    }
  );

  const failed = !response || response.status < 200 || response.status >= 300;
  totalRequests.add(1);
  metrics.requests.add(1);
  metrics.duration.add(response?.timings?.duration ?? 0);
  metrics.errors.add(failed);
}

export function handleSummary(data) {
  const durationSeconds = Number(runtimeConfig.durationSeconds || 1);
  const totalRequestCount = getMetricCount(data, 'total_requests');
  const endpoints = (runtimeConfig.endpoints || []).map((endpoint, index) => {
    const requestCount = getMetricCount(data, `endpoint_${index + 1}_requests`);
    return {
      name: endpoint.name,
      weight: endpoint.weight,
      requests: requestCount,
      achieved_rps: safeDivide(requestCount, durationSeconds),
      error_rate: getMetricRate(data, `endpoint_${index + 1}_errors`),
      p95_ms: getMetricPercentile(data, `endpoint_${index + 1}_duration`, 'p(95)'),
      p99_ms: getMetricPercentile(data, `endpoint_${index + 1}_duration`, 'p(99)')
    };
  });

  const summary = {
    requested_rps: Number(runtimeConfig.rate || 0),
    achieved_rps: safeDivide(totalRequestCount, durationSeconds),
    duration_seconds: durationSeconds,
    thresholds_passed: thresholdsPassed(data),
    overall: {
      total_requests: totalRequestCount,
      error_rate: getMetricRate(data, 'http_req_failed'),
      dropped_iterations: getMetricCount(data, 'dropped_iterations')
    },
    endpoints
  };

  return {
    [runtimeConfig.resultFile]: JSON.stringify(summary, null, 2)
  };
}

function buildThresholds(config) {
  const thresholds = {
    http_req_failed: [`rate<${config.sla?.maxErrorRate ?? 0.01}`]
  };

  (config.endpoints || []).forEach((endpoint, index) => {
    thresholds[`endpoint_${index + 1}_duration`] = [
      `p(95)<${config.sla?.p95Ms ?? 500}`,
      `p(99)<${config.sla?.p99Ms ?? 2000}`
    ];
    thresholds[`endpoint_${index + 1}_errors`] = [`rate<${config.sla?.maxErrorRate ?? 0.01}`];
  });

  return thresholds;
}

function chooseEndpoint(endpoints) {
  const totalWeight = endpoints.reduce((sum, endpoint) => sum + Number(endpoint.weight || 0), 0);
  const marker = Math.random() * totalWeight;
  let cumulative = 0;

  for (let index = 0; index < endpoints.length; index += 1) {
    cumulative += Number(endpoints[index].weight || 0);
    if (marker <= cumulative) {
      return index;
    }
  }

  return Math.max(endpoints.length - 1, 0);
}

function renderTemplate(value, generators) {
  if (Array.isArray(value)) {
    return value.map(entry => renderTemplate(entry, generators));
  }

  if (value && typeof value === 'object') {
    const rendered = {};
    Object.keys(value).forEach(key => {
      rendered[key] = renderTemplate(value[key], generators);
    });
    return rendered;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const match = value.match(/^\{\{([A-Za-z0-9_-]+)\}\}$/);
  if (!match) {
    return value;
  }

  return generateValue(match[1], generators[match[1]]);
}

function generateValue(generatorName, generatorConfig) {
  const state = generatorState.get(generatorName) ?? { counter: 0, history: [] };
  generatorState.set(generatorName, state);

  if (state.history.length > 0 && Math.random() < Number(generatorConfig.duplicateRate || 0)) {
    const reuseIndex = Math.floor(Math.random() * state.history.length);
    return state.history[reuseIndex];
  }

  state.counter += 1;
  let value;

  switch (generatorConfig.type) {
    case 'uuid':
      value = generateUuid();
      break;
    case 'random':
      value = generateRandomString(generatorConfig.length, generatorConfig.charset);
      break;
    case 'sequence':
      value = `${generatorConfig.prefix || ''}${String(state.counter).padStart(Number(generatorConfig.zeroPad || 0), '0')}`;
      break;
    default:
      value = `${generatorName}-${state.counter}`;
      break;
  }

  state.history.push(value);
  const reuseWindow = Number(generatorConfig.reuseWindow || 100);
  if (state.history.length > reuseWindow) {
    state.history.splice(0, state.history.length - reuseWindow);
  }

  return value;
}

function generateUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const randomValue = Math.floor(Math.random() * 16);
    const value = character === 'x' ? randomValue : (randomValue & 0x3) | 0x8;
    return value.toString(16);
  });
}

function generateRandomString(length, charset) {
  const alphabet = selectAlphabet(charset);
  let result = '';
  for (let index = 0; index < length; index += 1) {
    const letterIndex = Math.floor(Math.random() * alphabet.length);
    result += alphabet[letterIndex];
  }
  return result;
}

function selectAlphabet(charset) {
  switch (charset) {
    case 'alpha':
      return 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    case 'hex':
      return '0123456789abcdef';
    case 'alnum':
    default:
      return 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  }
}

function getMetricRate(data, metricName) {
  return Number(data.metrics?.[metricName]?.values?.rate ?? 0);
}

function getMetricCount(data, metricName) {
  return Number(data.metrics?.[metricName]?.values?.count ?? 0);
}

function getMetricPercentile(data, metricName, percentileKey) {
  return Number(data.metrics?.[metricName]?.values?.[percentileKey] ?? 0);
}

function safeDivide(value, divisor) {
  if (!divisor) {
    return 0;
  }
  return Number(value) / Number(divisor);
}

function thresholdsPassed(data) {
  return Object.values(data.metrics || {}).every(metric => {
    if (!metric.thresholds) {
      return true;
    }

    return Object.values(metric.thresholds).every(threshold => threshold.ok !== false);
  });
}
