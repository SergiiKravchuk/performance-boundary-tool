# perf-boundary

`perf-boundary` is a thin JS wrapper around k6 that searches for the highest sustainable combined RPS for a fixed two-endpoint traffic mix.

## What it does

- Runs an optional warmup.
- Increases load exponentially until the first failure.
- Uses binary search to find the highest passing RPS.
- Evaluates pass/fail using SLA thresholds, achieved-rate checks, and dropped iterations.
- Writes per-run artifacts plus a final summary JSON report.

## Runtime modes

- `auto`: use a local `k6` binary when available, otherwise fall back to Docker.
- `local`: require a local `k6` binary.
- `docker`: run `grafana/k6` in a container.

The wrapper itself is plain Node.js with no external npm dependencies.

## Usage

```bash
npm test
node ./src/cli.js run --config ./config.example.yaml
```

You can also override a few common values from the CLI:

```bash
node ./src/cli.js run \
  --config ./examples/localstack-empty-body.yaml \
  --target-base-url http://localhost:8080 \
  --start-rps 5 \
  --max-rps 80 \
  --runtime docker
```

## Config format

```yaml
target:
  baseUrl: http://localhost:8080

mix:
  endpoints:
    - name: primary
      weight: 70
      method: POST
      path: /endpoint-a
      headers:
        Content-Type: application/json
      bodyTemplateFile: ./examples/templates/endpoint-a.json
    - name: secondary
      weight: 30
      method: POST
      path: /endpoint-b
      headers:
        Content-Type: application/json
      bodyTemplateFile: ./examples/templates/endpoint-b.json

search:
  startRps: 5
  maxRps: 300
  resolutionRps: 1
  duration: 2m
  warmupDuration: 30s
  cooldownSeconds: 30

sla:
  maxErrorRate: 0.01
  p95Ms: 500
  p99Ms: 2000
  minAchievedRatio: 0.95

k6:
  preAllocatedVUs: 50
  maxVUs: 300

runtime:
  mode: auto
  dockerImage: grafana/k6:latest

health:
  url: null
  intervalSeconds: 5
  timeoutSeconds: 120

bodyGenerators:
  orderId:
    type: uuid
    duplicateRate: 0.05
    reuseWindow: 100
  customerRef:
    type: random
    length: 12
    charset: alnum
    duplicateRate: 0.02
    reuseWindow: 100
  requestKey:
    type: sequence
    prefix: req-
    zeroPad: 8
    duplicateRate: 0.00
    reuseWindow: 100

results:
  outputDir: ./results
```

## JSON body templates

Body templates are normal JSON files. String placeholders must occupy the full string value.

Example:

```json
{
  "orderId": "{{orderId}}",
  "customerRef": "{{customerRef}}",
  "requestKey": "{{requestKey}}"
}
```

Supported generators:

- `uuid`
- `random`
- `sequence`

Duplicate modeling is controlled per generator with `duplicateRate` and `reuseWindow`.

## Repo example

For the two local Spring endpoints you mentioned, use:

```bash
node ./src/cli.js run --config ./examples/localstack-empty-body.yaml --runtime docker
```

That config drives:

- `POST http://localhost:8080/s3-only-flow`
- `POST http://localhost:8080/lambda-flow`

with empty request bodies.

## Output

Each run writes:

- `results/run-<rps>.summary.json`
- `results/run-<rps>.meta.json`

The final report is written to:

- `results/summary.json`
