import fs from 'node:fs/promises';
import path from 'node:path';

import {parseYaml} from './yaml.js';

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const PLACEHOLDER_PATTERN = /^\{\{([A-Za-z0-9_-]+)}}$/;
const INLINE_PLACEHOLDER_PATTERN = /\{\{([A-Za-z0-9_-]+)}}/g;
const DURATION_PATTERN = /^(\d+)(ms|s|m|h)$/;
const STATUS_PATTERN = /^(?:[1-5]xx|[1-5]\d{2})$/i;

export async function loadConfig(configPath, cliOverrides = {}) {
    if (!configPath) {
        throw new Error('A config path is required.');
    }

    const resolvedConfigPath = path.resolve(configPath);
    const configDirectory = path.dirname(resolvedConfigPath);
    const fileContents = await fs.readFile(resolvedConfigPath, 'utf8');
    const rawConfig = parseConfigFile(resolvedConfigPath, fileContents);
    const mergedConfig = applyCliOverrides(rawConfig, cliOverrides);

    return normalizeConfig(mergedConfig, configDirectory, resolvedConfigPath);
}

export function parseConfigFile(filePath, contents) {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === '.json') {
        return JSON.parse(contents);
    }

    if (extension === '.yml' || extension === '.yaml') {
        return parseYaml(contents);
    }

    throw new Error(`Unsupported config format for ${filePath}. Use .json, .yaml, or .yml.`);
}

export function applyCliOverrides(rawConfig, overrides) {
    const config = structuredClone(rawConfig ?? {});
    config.target ??= {};
    config.search ??= {};
    config.runtime ??= {};
    config.results ??= {};

    if (overrides.targetBaseUrl) {
        config.target.baseUrl = overrides.targetBaseUrl;
    }

    if (overrides.startRps !== undefined) {
        config.search.startRps = overrides.startRps;
    }

    if (overrides.maxRps !== undefined) {
        config.search.maxRps = overrides.maxRps;
    }

    if (overrides.duration) {
        config.search.duration = overrides.duration;
    }

    if (overrides.runtime) {
        config.runtime.mode = overrides.runtime;
    }

    if (overrides.resultsDir) {
        config.results.outputDir = overrides.resultsDir;
    }

    return config;
}

export async function normalizeConfig(rawConfig, configDirectory, configPath = null) {
    const config = structuredClone(rawConfig ?? {});

    config.target ??= {};
    config.mix ??= {};
    config.search ??= {};
    config.sla ??= {};
    config.k6 ??= {};
    config.runtime ??= {};
    config.health ??= {};
    config.bodyGenerators ??= {};
    config.results ??= {};

    const normalized = {
        configPath,
        configDirectory,
        target: {
            baseUrl: ensureValidBaseUrl(config.target.baseUrl)
        },
        search: {
            startRps: toPositiveInteger(config.search.startRps ?? 5, 'search.startRps'),
            maxRps: toPositiveInteger(config.search.maxRps ?? 300, 'search.maxRps'),
            resolutionRps: toPositiveInteger(config.search.resolutionRps ?? 1, 'search.resolutionRps'),
            duration: ensureDuration(config.search.duration ?? '2m', 'search.duration'),
            warmupDuration: ensureDuration(config.search.warmupDuration ?? '30s', 'search.warmupDuration'),
            cooldownSeconds: toNonNegativeInteger(config.search.cooldownSeconds ?? 30, 'search.cooldownSeconds')
        },
        sla: {
            maxErrorRate: toRate(config.sla.maxErrorRate ?? 0.01, 'sla.maxErrorRate'),
            p95Ms: toPositiveNumber(config.sla.p95Ms ?? 500, 'sla.p95Ms'),
            p99Ms: toPositiveNumber(config.sla.p99Ms ?? 2000, 'sla.p99Ms'),
            minAchievedRatio: toRate(config.sla.minAchievedRatio ?? 0.95, 'sla.minAchievedRatio')
        },
        k6: {
            preAllocatedVUs: toPositiveInteger(config.k6.preAllocatedVUs ?? 50, 'k6.preAllocatedVUs'),
            maxVUs: toPositiveInteger(config.k6.maxVUs ?? 300, 'k6.maxVUs')
        },
        runtime: {
            mode: ensureRuntimeMode(config.runtime.mode ?? 'auto'),
            dockerImage: String(config.runtime.dockerImage ?? 'grafana/k6:latest')
        },
        health: {
            url: config.health.url == null ? null : ensureValidUrl(config.health.url, 'health.url'),
            intervalSeconds: toPositiveInteger(config.health.intervalSeconds ?? 5, 'health.intervalSeconds'),
            timeoutSeconds: toPositiveInteger(config.health.timeoutSeconds ?? 120, 'health.timeoutSeconds')
        },
        bodyGenerators: normalizeBodyGenerators(config.bodyGenerators),
        results: {
            outputDir: path.resolve(configDirectory, String(config.results.outputDir ?? './results'))
        }
    };

    if (normalized.search.startRps > normalized.search.maxRps) {
        throw new Error('search.startRps must be less than or equal to search.maxRps.');
    }

    normalized.mix = await normalizeMix(config.mix, configDirectory, normalized.bodyGenerators);
    return normalized;
}

export function buildScenarioConfig(config, options) {
    return {
        baseUrl: config.target.baseUrl,
        rate: options.rate,
        duration: options.duration,
        durationSeconds: parseDurationToSeconds(options.duration),
        resultFile: options.resultFile,
        endpoints: config.mix.endpoints.map(endpoint => ({
            name: endpoint.name,
            weight: endpoint.weight,
            method: endpoint.method,
            path: endpoint.path,
            urlTemplate: endpoint.urlTemplate,
            urlTemplateRate: endpoint.urlTemplateRate,
            headers: endpoint.headers,
            bodyTemplate: endpoint.bodyTemplate,
            responseCapture: endpoint.responseCapture,
            successStatuses: endpoint.successStatuses
        })),
        bodyGenerators: config.bodyGenerators,
        sla: config.sla,
        k6: config.k6
    };
}

export function parseDurationToSeconds(duration) {
    const match = String(duration).match(DURATION_PATTERN);
    if (!match) {
        throw new Error(`Unsupported duration value: ${duration}`);
    }

    const amount = Number(match[1]);
    const unit = match[2];

    switch (unit) {
        case 'ms':
            return amount / 1000;
        case 's':
            return amount;
        case 'm':
            return amount * 60;
        case 'h':
            return amount * 3600;
        default:
            throw new Error(`Unsupported duration unit: ${unit}`);
    }
}

async function normalizeMix(mixConfig, configDirectory, generators) {
    const endpoints = Array.isArray(mixConfig.endpoints) ? mixConfig.endpoints : [];
    if (endpoints.length !== 2) {
        throw new Error('mix.endpoints must contain exactly 2 endpoints.');
    }

    const responseCaptureNames = collectResponseCaptureNames(endpoints);
    const templateNames = new Set([...Object.keys(generators), ...responseCaptureNames]);
    const normalizedEndpoints = [];
    const usedNames = new Set();

    for (const [index, endpoint] of endpoints.entries()) {
        const name = String(endpoint.name ?? '').trim();
        if (!name) {
            throw new Error(`mix.endpoints[${index}].name is required.`);
        }

        if (usedNames.has(name)) {
            throw new Error(`Duplicate endpoint name: ${name}`);
        }

        usedNames.add(name);

        const method = String(endpoint.method ?? 'GET').toUpperCase();
        if (!HTTP_METHODS.has(method)) {
            throw new Error(`Unsupported HTTP method for endpoint ${name}: ${method}`);
        }

        const pathValue = String(endpoint.path ?? '');
        if (!pathValue.startsWith('/')) {
            throw new Error(`Endpoint ${name} path must start with '/'.`);
        }
        validateInlineTemplate(pathValue, templateNames, `${name} path`);

        const headers = normalizeHeaders(endpoint.headers ?? {});
        const weight = toPositiveNumber(endpoint.weight ?? 1, `mix.endpoints[${index}].weight`);
        const bodyTemplateFile = endpoint.bodyTemplateFile == null ? null : path.resolve(configDirectory, String(endpoint.bodyTemplateFile));
        const bodyTemplate = bodyTemplateFile ? await loadBodyTemplate(bodyTemplateFile, generators, name) : null;
        const urlTemplate = normalizeUrlTemplate(endpoint.urlTemplate, templateNames, `mix.endpoints[${index}].urlTemplate`);
        const urlTemplateRate = urlTemplate == null ? 0 : toRate(endpoint.urlTemplateRate ?? 1, `mix.endpoints[${index}].urlTemplateRate`);
        const responseCapture = normalizeResponseCapture(endpoint.responseCapture, `mix.endpoints[${index}].responseCapture`);
        const successStatuses = normalizeSuccessStatuses(endpoint.successStatuses, `mix.endpoints[${index}].successStatuses`);

        normalizedEndpoints.push({
            name,
            weight,
            method,
            path: pathValue,
            urlTemplate,
            urlTemplateRate,
            headers,
            bodyTemplateFile,
            bodyTemplate,
            responseCapture,
            successStatuses
        });
    }

    const totalWeight = normalizedEndpoints.reduce((sum, endpoint) => sum + endpoint.weight, 0);
    return {
        endpoints: normalizedEndpoints.map(endpoint => ({
            ...endpoint,
            normalizedWeight: endpoint.weight / totalWeight
        }))
    };
}

async function loadBodyTemplate(templatePath, generators, endpointName) {
    const contents = await fs.readFile(templatePath, 'utf8');
    const template = JSON.parse(contents);
    validateTemplateObject(template, new Set(Object.keys(generators)), `${endpointName} template`);
    return template;
}

function collectResponseCaptureNames(endpoints) {
    const captureNames = new Set();

    endpoints.forEach((endpoint, index) => {
        const responseCapture = endpoint?.responseCapture;
        if (responseCapture == null) {
            return;
        }

        if (typeof responseCapture !== 'object' || Array.isArray(responseCapture)) {
            throw new Error(`mix.endpoints[${index}].responseCapture must be an object.`);
        }

        Object.keys(responseCapture).forEach(name => {
            if (!/^[A-Za-z0-9_-]+$/.test(name)) {
                throw new Error(`mix.endpoints[${index}].responseCapture contains an invalid variable name: ${name}`);
            }

            if (captureNames.has(name)) {
                throw new Error(`Duplicate response capture name: ${name}`);
            }

            captureNames.add(name);
        });
    });

    return captureNames;
}

function normalizeHeaders(headers) {
    if (headers == null || typeof headers !== 'object' || Array.isArray(headers)) {
        throw new Error('Endpoint headers must be an object.');
    }

    return Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [String(key), String(value)])
    );
}

function normalizeUrlTemplate(value, templateNames, fieldName) {
    if (value == null) {
        return null;
    }

    const template = String(value).trim();
    if (!template) {
        throw new Error(`${fieldName} must not be empty.`);
    }

    validateInlineTemplate(template, templateNames, fieldName);
    if (!template.includes('{{')) {
        ensureValidUrl(template, fieldName);
    }

    return template;
}

function normalizeResponseCapture(value, fieldName) {
    if (value == null) {
        return {};
    }

    if (typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${fieldName} must be an object.`);
    }

    return Object.fromEntries(
        Object.entries(value).map(([name, selector]) => {
            if (typeof selector !== 'string' || selector.trim().length === 0) {
                throw new Error(`${fieldName}.${name} must be a non-empty string.`);
            }

            return [name, selector.trim()];
        })
    );
}

function normalizeSuccessStatuses(value, fieldName) {
    const statuses = value == null ? ['2xx', '3xx', '4xx'] : value;
    if (!Array.isArray(statuses) || statuses.length === 0) {
        throw new Error(`${fieldName} must be a non-empty array.`);
    }

    return statuses.map(status => {
        const normalized = String(status).trim();
        if (!STATUS_PATTERN.test(normalized)) {
            throw new Error(`${fieldName} values must use status codes like 201 or ranges like 2xx.`);
        }

        return normalized.toLowerCase();
    });
}

function normalizeBodyGenerators(generators) {
    if (generators == null) {
        return {};
    }

    if (typeof generators !== 'object' || Array.isArray(generators)) {
        throw new Error('bodyGenerators must be an object.');
    }

    const normalized = {};
    for (const [name, config] of Object.entries(generators)) {
        if (typeof config !== 'object' || config == null || Array.isArray(config)) {
            throw new Error(`bodyGenerators.${name} must be an object.`);
        }

        const type = String(config.type ?? '').trim();
        if (!['uuid', 'random', 'sequence'].includes(type)) {
            throw new Error(`bodyGenerators.${name}.type must be uuid, random, or sequence.`);
        }

        const generator = {
            type,
            duplicateRate: toRate(config.duplicateRate ?? 0, `bodyGenerators.${name}.duplicateRate`),
            reuseWindow: toPositiveInteger(config.reuseWindow ?? 100, `bodyGenerators.${name}.reuseWindow`)
        };

        if (type === 'random') {
            generator.length = toPositiveInteger(config.length ?? 12, `bodyGenerators.${name}.length`);
            generator.charset = ensureRandomCharset(config.charset ?? 'alnum', `bodyGenerators.${name}.charset`);
        }

        if (type === 'sequence') {
            generator.prefix = String(config.prefix ?? '');
            generator.zeroPad = toNonNegativeInteger(config.zeroPad ?? 0, `bodyGenerators.${name}.zeroPad`);
        }

        normalized[name] = generator;
    }

    return normalized;
}

function ensureRandomCharset(value, fieldName) {
    const charset = String(value);
    if (!['alpha', 'alnum', 'hex'].includes(charset)) {
        throw new Error(`${fieldName} must be alpha, alnum, or hex.`);
    }

    return charset;
}

function validateTemplateObject(value, generatorNames, label, pointer = '$') {
    if (Array.isArray(value)) {
        value.forEach((entry, index) => {
            validateTemplateObject(entry, generatorNames, label, `${pointer}[${index}]`);
        });
        return;
    }

    if (value && typeof value === 'object') {
        Object.entries(value).forEach(([key, entry]) => {
            validateTemplateObject(entry, generatorNames, label, `${pointer}.${key}`);
        });
        return;
    }

    if (typeof value !== 'string') {
        return;
    }

    const placeholderMatch = value.match(PLACEHOLDER_PATTERN);
    if (placeholderMatch) {
        const generatorName = placeholderMatch[1];
        if (!generatorNames.has(generatorName)) {
            throw new Error(`${label} references unknown generator "${generatorName}" at ${pointer}.`);
        }
        return;
    }

    if (value.includes('{{') || value.includes('}}')) {
        throw new Error(`${label} uses a partial placeholder at ${pointer}. Placeholders must fill the entire string value.`);
    }
}

function validateInlineTemplate(value, templateNames, label) {
    const placeholderNames = [];
    const placeholderFreeValue = String(value).replace(INLINE_PLACEHOLDER_PATTERN, (_, name) => {
        placeholderNames.push(name);
        return '';
    });

    if (placeholderFreeValue.includes('{{') || placeholderFreeValue.includes('}}')) {
        throw new Error(`${label} contains a malformed placeholder.`);
    }

    placeholderNames.forEach(name => {
        if (!templateNames.has(name)) {
            throw new Error(`${label} references unknown placeholder "${name}".`);
        }
    });
}

function ensureValidBaseUrl(value) {
    return ensureValidUrl(value, 'target.baseUrl');
}

function ensureValidUrl(value, fieldName) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${fieldName} is required.`);
    }

    try {
        return new URL(value).toString().replace(/\/$/, '');
    } catch {
        throw new Error(`${fieldName} must be a valid URL.`);
    }
}

function ensureRuntimeMode(value) {
    const mode = String(value);
    if (!['auto', 'local', 'docker'].includes(mode)) {
        throw new Error('runtime.mode must be auto, local, or docker.');
    }
    return mode;
}

function ensureDuration(value, fieldName) {
    if (!DURATION_PATTERN.test(String(value))) {
        throw new Error(`${fieldName} must use ms, s, m, or h units.`);
    }
    return String(value);
}

function toPositiveInteger(value, fieldName) {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) {
        throw new Error(`${fieldName} must be a positive integer.`);
    }
    return number;
}

function toNonNegativeInteger(value, fieldName) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) {
        throw new Error(`${fieldName} must be a non-negative integer.`);
    }
    return number;
}

function toPositiveNumber(value, fieldName) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        throw new Error(`${fieldName} must be a positive number.`);
    }
    return number;
}

function toRate(value, fieldName) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 1) {
        throw new Error(`${fieldName} must be between 0 and 1.`);
    }
    return number;
}
