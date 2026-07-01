import assert from 'node:assert/strict';
import test from 'node:test';

import {captureResponseValues, isSuccessfulStatus, resolveEndpointUrl} from '../k6/runtime-helpers.js';

test('resolveEndpointUrl prefers captured absolute URLs when available', () => {
    const endpoint = {
        name: 'redirect',
        path: '/{{randomCode}}',
        urlTemplate: '{{shortUrl}}',
        urlTemplateRate: 0.7
    };
    const values = {
        shortUrl: 'http://localhost:3000/AbC123',
        randomCode: 'missing1'
    };

    const url = resolveEndpointUrl(endpoint, {
        baseUrl: 'http://localhost:3000',
        randomValue: 0.2,
        resolvePlaceholder: name => values[name]
    });

    assert.equal(url, 'http://localhost:3000/AbC123');
});

test('resolveEndpointUrl falls back to the configured path when the captured URL is unavailable', () => {
    const endpoint = {
        name: 'redirect',
        path: '/{{randomCode}}',
        urlTemplate: '{{shortUrl}}',
        urlTemplateRate: 0.7
    };
    const values = {
        randomCode: 'missing1'
    };

    const url = resolveEndpointUrl(endpoint, {
        baseUrl: 'http://localhost:3000',
        randomValue: 0.2,
        resolvePlaceholder: name => values[name]
    });

    assert.equal(url, 'http://localhost:3000/missing1');
});

test('captureResponseValues stores configured JSON fields', () => {
    const captured = captureResponseValues(
        {
            responseCapture: {
                shortUrl: 'shortUrl',
                code: 'meta.code'
            }
        },
        {
            shortUrl: 'http://localhost:3000/AbC123',
            meta: {
                code: 'AbC123'
            }
        }
    );

    assert.deepEqual(captured, {
        shortUrl: 'http://localhost:3000/AbC123',
        code: 'AbC123'
    });
});

test('isSuccessfulStatus treats 4xx as successful and 5xx as errors', () => {
    assert.equal(isSuccessfulStatus(201), true);
    assert.equal(isSuccessfulStatus(302), true);
    assert.equal(isSuccessfulStatus(404), true);
    assert.equal(isSuccessfulStatus(500), false);
    assert.equal(isSuccessfulStatus(undefined), false);
});
