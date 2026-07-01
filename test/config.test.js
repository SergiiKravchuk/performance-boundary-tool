import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {loadConfig} from '../src/config.js';

test('loadConfig normalizes two-endpoint config with placeholders', async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'perf-boundary-config-'));
    const templatePath = path.join(tempDirectory, 'body.json');
    const configPath = path.join(tempDirectory, 'config.yaml');

    await fs.writeFile(templatePath, JSON.stringify({requestKey: '{{requestKey}}'}, null, 2));
    await fs.writeFile(
        configPath,
        `target:
  baseUrl: http://localhost:8080
mix:
  endpoints:
    - name: one
      weight: 70
      method: POST
      path: /a
      bodyTemplateFile: ./body.json
    - name: two
      weight: 30
      method: POST
      path: /b
      bodyTemplateFile: null
bodyGenerators:
  requestKey:
    type: sequence
search:
  startRps: 5
  maxRps: 20
results:
  outputDir: ./out
`,
        'utf8'
    );

    const config = await loadConfig(configPath, {});

    assert.equal(config.mix.endpoints.length, 2);
    assert.equal(config.mix.endpoints[0].bodyTemplate.requestKey, '{{requestKey}}');
    assert.equal(config.mix.endpoints[1].bodyTemplate, null);
    assert.equal(config.mix.endpoints[0].successStatuses.join(','), '2xx,3xx,4xx');
    assert.equal(config.results.outputDir, path.join(tempDirectory, 'out'));
});

test('loadConfig normalizes response capture and url templates', async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'perf-boundary-config-'));
    const templatePath = path.join(tempDirectory, 'body.json');
    const configPath = path.join(tempDirectory, 'config.yaml');

    await fs.writeFile(templatePath, JSON.stringify({url: '{{targetUrl}}'}, null, 2));
    await fs.writeFile(
        configPath,
        `target:
  baseUrl: http://localhost:3000
mix:
  endpoints:
    - name: shorten
      weight: 70
      method: POST
      path: /shorten
      bodyTemplateFile: ./body.json
      responseCapture:
        shortUrl: shortUrl
    - name: redirect
      weight: 30
      method: GET
      path: /{{randomCode}}
      urlTemplate: '{{shortUrl}}'
      urlTemplateRate: 0.65
      successStatuses:
        - 3xx
        - 4xx
bodyGenerators:
  targetUrl:
    type: sequence
  randomCode:
    type: random
    length: 6
`,
        'utf8'
    );

    const config = await loadConfig(configPath, {});

    assert.deepEqual(config.mix.endpoints[0].responseCapture, {shortUrl: 'shortUrl'});
    assert.equal(config.mix.endpoints[1].path, '/{{randomCode}}');
    assert.equal(config.mix.endpoints[1].urlTemplate, '{{shortUrl}}');
    assert.equal(config.mix.endpoints[1].urlTemplateRate, 0.65);
    assert.deepEqual(config.mix.endpoints[1].successStatuses, ['3xx', '4xx']);
});

test('loadConfig rejects partial placeholders', async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'perf-boundary-config-'));
    const templatePath = path.join(tempDirectory, 'body.json');
    const configPath = path.join(tempDirectory, 'config.yaml');

    await fs.writeFile(templatePath, JSON.stringify({requestKey: 'id-{{requestKey}}'}, null, 2));
    await fs.writeFile(
        configPath,
        `target:
  baseUrl: http://localhost:8080
mix:
  endpoints:
    - name: one
      weight: 70
      method: POST
      path: /a
      bodyTemplateFile: ./body.json
    - name: two
      weight: 30
      method: POST
      path: /b
      bodyTemplateFile: null
bodyGenerators:
  requestKey:
    type: sequence
`,
        'utf8'
    );

    await assert.rejects(() => loadConfig(configPath, {}), /partial placeholder/);
});
