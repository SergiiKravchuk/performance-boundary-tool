import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildScenarioConfig } from './config.js';
import { evaluateSummary, normalizeRunSummary } from './summary.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOOL_ROOT = path.resolve(__dirname, '..');
const K6_SCRIPT_PATH = path.join(TOOL_ROOT, 'k6', 'scenario.js');
const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

export async function executeK6Run(config, runOptions) {
  await fs.mkdir(config.results.outputDir, { recursive: true });

  const filePrefix = runOptions.phase === 'warmup' ? `warmup-${runOptions.rate}` : `run-${runOptions.rate}`;
  const summaryFile = path.join(config.results.outputDir, `${filePrefix}.summary.json`);
  const metaFile = path.join(config.results.outputDir, `${filePrefix}.meta.json`);
  const runtimeMode = await resolveRuntimeMode(config.runtime.mode);
  const scenarioConfig = buildScenarioConfig(config, {
    rate: runOptions.rate,
    duration: runOptions.duration,
    resultFile: runtimeMode === 'docker' ? `/results/${filePrefix}.summary.json` : summaryFile
  });
  const runtimeScenarioConfig = runtimeMode === 'docker'
    ? rewriteLocalhostBaseUrl(scenarioConfig)
    : scenarioConfig;

  const execution = runtimeMode === 'docker'
    ? await runDockerK6(config, runtimeScenarioConfig)
    : await runLocalK6(runtimeScenarioConfig);

  let summaryContents;
  try {
    summaryContents = await fs.readFile(summaryFile, 'utf8');
  } catch {
    throw new Error(`k6 did not produce ${summaryFile}.\nstdout:\n${execution.stdout}\nstderr:\n${execution.stderr}`);
  }

  const normalizedSummary = normalizeRunSummary(JSON.parse(summaryContents));
  const evaluation = evaluateSummary(normalizedSummary, config);

  return {
    ...normalizedSummary,
    ...evaluation,
    phase: runOptions.phase,
    runtimeMode,
    exitCode: execution.exitCode,
    command: execution.command,
    stdout: execution.stdout,
    stderr: execution.stderr,
    summaryFile,
    metaFile
  };
}

async function runLocalK6(scenarioConfig) {
  const args = ['run', K6_SCRIPT_PATH];
  return spawnCommand('k6', args, {
    env: {
      ...process.env,
      SCENARIO_CONFIG: JSON.stringify(scenarioConfig)
    }
  });
}

async function runDockerK6(config, scenarioConfig) {
  const scenarioDirectory = path.dirname(K6_SCRIPT_PATH);
  const args = [
    'run',
    '--rm',
    '-i',
    '--add-host',
    'host.docker.internal:host-gateway',
    '-e',
    `SCENARIO_CONFIG=${JSON.stringify(scenarioConfig)}`,
    '-v',
    `${toDockerPath(scenarioDirectory)}:/tool/k6:ro`,
    '-v',
    `${toDockerPath(config.results.outputDir)}:/results`,
    config.runtime.dockerImage,
    'run',
    '/tool/k6/scenario.js'
  ];

  return spawnCommand('docker', args, {});
}

async function resolveRuntimeMode(mode) {
  if (mode === 'local') {
    if (!await commandExists('k6', ['version'])) {
      throw new Error('runtime.mode=local was requested but no local k6 binary is available.');
    }
    return 'local';
  }

  if (mode === 'docker') {
    if (!await commandExists('docker', ['--version'])) {
      throw new Error('runtime.mode=docker was requested but Docker is not available.');
    }
    return 'docker';
  }

  if (await commandExists('k6', ['version'])) {
    return 'local';
  }

  if (await commandExists('docker', ['--version'])) {
    return 'docker';
  }

  throw new Error('No supported runtime found. Install k6 or Docker.');
}

async function commandExists(command, args) {
  try {
    const result = await spawnCommand(command, args, {});
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

function spawnCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: TOOL_ROOT,
      shell: false,
      windowsHide: true,
      ...options
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', error => {
      reject(error);
    });

    child.on('close', exitCode => {
      resolve({
        exitCode: exitCode ?? -1,
        stdout,
        stderr,
        command: [command, ...args].join(' ')
      });
    });
  });
}

function rewriteLocalhostBaseUrl(scenarioConfig) {
  const rewrittenUrl = new URL(scenarioConfig.baseUrl);
  if (!LOCALHOST_HOSTNAMES.has(rewrittenUrl.hostname)) {
    return scenarioConfig;
  }

  rewrittenUrl.hostname = 'host.docker.internal';
  return {
    ...scenarioConfig,
    baseUrl: rewrittenUrl.toString().replace(/\/$/, '')
  };
}

function toDockerPath(targetPath) {
  return path.resolve(targetPath).replace(/\\/g, '/');
}
