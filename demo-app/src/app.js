import http from 'node:http';
import { randomInt } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function createShortenerServer({
  store = new Map(),
  generateCode = () => generateShortCode(6)
} = {}) {
  const server = http.createServer((request, response) => {
    void handleRequest(request, response, { store, generateCode }).catch(error => {
      if (error?.statusCode === 400) {
        writeJson(response, 400, { error: error.message });
        return;
      }

      if (!response.headersSent) {
        writeJson(response, 500, { error: 'Internal server error' });
      } else {
        response.end();
      }

      console.error(error);
    });
  });

  return { server, store };
}

export function generateShortCode(length = 6) {
  let code = '';

  for (let index = 0; index < length; index += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }

  return code;
}

async function handleRequest(request, response, { store, generateCode }) {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const { pathname } = url;

  if (pathname === '/shorten') {
    if (request.method !== 'POST') {
      writeMethodNotAllowed(response, 'POST');
      return;
    }

    const payload = await readJsonBody(request);
    const targetUrl = normalizeTargetUrl(payload?.url);
    const code = generateCode();

    store.set(code, targetUrl);
    writeJson(response, 201, {
      url: targetUrl,
      code,
      shortUrl: buildShortUrl(request, code)
    });
    return;
  }

  if (pathname !== '/shorten' && /^\/[^/]+$/.test(pathname)) {
    if (request.method !== 'GET') {
      writeMethodNotAllowed(response, 'GET');
      return;
    }

    const code = pathname.slice(1);
    const targetUrl = store.get(code);
    if (!targetUrl) {
      writeJson(response, 404, { error: 'Short code not found' });
      return;
    }

    response.writeHead(302, { Location: targetUrl });
    response.end();
    return;
  }

  writeJson(response, 404, { error: 'Not found' });
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');
  if (rawBody.trim().length === 0) {
    throw badRequest('Request body must be valid JSON');
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw badRequest('Request body must be valid JSON');
  }
}

function normalizeTargetUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw badRequest('Field "url" must be a non-empty string');
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw badRequest('Field "url" must be a valid absolute URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw badRequest('Field "url" must use http or https');
  }

  return parsed.toString();
}

function buildShortUrl(request, code) {
  const host = getHeaderValue(request.headers['x-forwarded-host']) ?? getHeaderValue(request.headers.host) ?? 'localhost';
  const protocol = getHeaderValue(request.headers['x-forwarded-proto']) ?? 'http';
  return `${protocol}://${host}/${code}`;
}

function getHeaderValue(value) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value ?? null;
}

function writeMethodNotAllowed(response, method) {
  response.setHeader('Allow', method);
  writeJson(response, 405, { error: `Method not allowed. Use ${method}` });
}

function writeJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  response.end(body);
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}
