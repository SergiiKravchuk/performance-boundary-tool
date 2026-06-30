#!/usr/bin/env node

import fs from 'node:fs/promises';

import { loadConfig } from './config.js';
import { executeK6Run } from './k6-runner.js';
import { printFinalSummary, printRunResult, writeFinalSummary, writeRunMeta } from './report.js';
import { findBoundary } from './search.js';

async function main() {
  const { command, options } = parseCommandLine(process.argv.slice(2));

  if (options.help || command !== 'run') {
    printHelp();
    process.exit(options.help ? 0 : 1);
  }

  const config = await loadConfig(options.config, options);
  await fs.mkdir(config.results.outputDir, { recursive: true });

  const boundaryResult = await findBoundary({
    config,
    runStep: async runOptions => {
      const run = await executeK6Run(config, runOptions);
      await writeRunMeta(run, run.metaFile);
      return run;
    },
    onRunComplete: run => {
      printRunResult(run);
    }
  });

  const finalSummaryPath = await writeFinalSummary(config, boundaryResult);
  printFinalSummary(boundaryResult, finalSummaryPath);
}

function parseCommandLine(argv) {
  const args = [...argv];
  const command = args.shift();
  const options = {};

  while (args.length > 0) {
    const current = args.shift();
    if (current === '--help' || current === '-h') {
      options.help = true;
      continue;
    }

    if (!current.startsWith('--')) {
      throw new Error(`Unexpected argument: ${current}`);
    }

    const key = current.slice(2);
    const value = args.shift();
    if (value === undefined) {
      throw new Error(`Missing value for --${key}`);
    }

    switch (key) {
      case 'config':
        options.config = value;
        break;
      case 'target-base-url':
        options.targetBaseUrl = value;
        break;
      case 'start-rps':
        options.startRps = Number(value);
        break;
      case 'max-rps':
        options.maxRps = Number(value);
        break;
      case 'duration':
        options.duration = value;
        break;
      case 'runtime':
        options.runtime = value;
        break;
      case 'results-dir':
        options.resultsDir = value;
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  return { command, options };
}

function printHelp() {
  console.log(`Usage:
  node ./src/cli.js run --config ./config.yaml [options]

Options:
  --target-base-url <url>
  --start-rps <number>
  --max-rps <number>
  --duration <duration>
  --runtime <auto|local|docker>
  --results-dir <path>
  --help
`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
