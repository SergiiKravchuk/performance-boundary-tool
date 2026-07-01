const INLINE_PLACEHOLDER_PATTERN = /\{\{([A-Za-z0-9_-]+)}}/g;

export function resolveEndpointUrl(endpoint, options) {
    const {
        baseUrl,
        randomValue = Math.random(),
        resolvePlaceholder = () => undefined
    } = options;

    if (endpoint.urlTemplate && randomValue < Number(endpoint.urlTemplateRate ?? 1)) {
        const renderedUrl = renderStringTemplate(endpoint.urlTemplate, resolvePlaceholder);
        if (renderedUrl.complete) {
            return renderedUrl.value;
        }
    }

    const renderedPath = renderStringTemplate(endpoint.path, resolvePlaceholder);
    if (!renderedPath.complete) {
        throw new Error(`Unable to resolve request path for endpoint ${endpoint.name}.`);
    }

    return `${baseUrl}${renderedPath.value}`;
}

export function renderStringTemplate(template, resolvePlaceholder) {
    let complete = true;
    const value = String(template).replace(INLINE_PLACEHOLDER_PATTERN, (match, name) => {
        const resolved = resolvePlaceholder(name);
        if (resolved == null) {
            complete = false;
            return match;
        }

        return String(resolved);
    });

    return {value, complete};
}

export function captureResponseValues(endpoint, responseBody) {
    if (!endpoint.responseCapture || responseBody == null || typeof responseBody !== 'object') {
        return {};
    }

    return Object.fromEntries(
        Object.entries(endpoint.responseCapture)
            .map(([name, selector]) => [name, getPathValue(responseBody, selector)])
            .filter(([, value]) => value !== undefined)
    );
}

export function isSuccessfulStatus(status, successStatuses = ['2xx', '3xx', '4xx']) {
    if (!Number.isInteger(status)) {
        return false;
    }

    return successStatuses.some(candidate => {
        const normalized = String(candidate).toLowerCase();
        if (normalized.endsWith('xx')) {
            return String(status).startsWith(normalized[0]);
        }

        return status === Number(normalized);
    });
}

function getPathValue(value, selector) {
    return String(selector)
        .split('.')
        .filter(Boolean)
        .reduce((current, segment) => {
            if (current == null || typeof current !== 'object') {
                return undefined;
            }

            return current[segment];
        }, value);
}
