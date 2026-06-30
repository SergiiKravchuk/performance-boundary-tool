import test from 'node:test';
import assert from 'node:assert/strict';

import { parseYaml } from '../src/yaml.js';

test('parseYaml handles nested objects and arrays', () => {
  const document = `
target:
  baseUrl: http://localhost:8080
mix:
  endpoints:
    - name: primary
      weight: 70
      method: POST
      path: /a
      bodyTemplateFile: null
    - name: secondary
      weight: 30
      method: POST
      path: /b
      bodyTemplateFile: ./body.json
bodyGenerators:
  requestKey:
    type: sequence
    prefix: req-
    zeroPad: 4
`;

  const parsed = parseYaml(document);

  assert.equal(parsed.target.baseUrl, 'http://localhost:8080');
  assert.equal(parsed.mix.endpoints[0].name, 'primary');
  assert.equal(parsed.mix.endpoints[1].bodyTemplateFile, './body.json');
  assert.equal(parsed.bodyGenerators.requestKey.zeroPad, 4);
});
