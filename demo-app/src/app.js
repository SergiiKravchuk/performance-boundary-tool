import express from 'express';
import { randomInt } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function createShortenerApp({
  store = new Map(),
  generateCode = () => generateShortCode(6)
} = {}) {
  const app = express();

  app.use(express.json());

  app.route('/shorten')
    .post((request, response, next) => {
      try {
        const targetUrl = normalizeTargetUrl(request.body?.url);
        const code = generateCode();

        store.set(code, targetUrl);
        response.status(201).json({
          url: targetUrl,
          code,
          shortUrl: buildShortUrl(request, code)
        });
      } catch (error) {
        next(error);
      }
    })
    .all((request, response) => {
      response.set('Allow', 'POST').status(405).json({ error: 'Method not allowed. Use POST' });
    });

  app.route('/:code')
    .get((request, response) => {
      const targetUrl = store.get(request.params.code);
      if (!targetUrl) {
        response.status(404).json({ error: 'Short code not found' });
        return;
      }

      response.redirect(302, targetUrl);
    })
    .all((request, response) => {
      response.set('Allow', 'GET').status(405).json({ error: 'Method not allowed. Use GET' });
    });

  app.use((request, response) => {
    response.status(404).json({ error: 'Not found' });
  });

  app.use((error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    if (error instanceof SyntaxError && error.type === 'entity.parse.failed') {
      response.status(400).json({ error: 'Request body must be valid JSON' });
      return;
    }

    if (error?.statusCode === 400) {
      response.status(400).json({ error: error.message });
      return;
    }

    console.error(error);
    response.status(500).json({ error: 'Internal server error' });
  });

  return { app, store };
}

export function generateShortCode(length = 6) {
  let code = '';

  for (let index = 0; index < length; index += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }

  return code;
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
  const host = request.get('x-forwarded-host') ?? request.get('host') ?? 'localhost';
  const protocol = request.get('x-forwarded-proto') ?? request.protocol;
  return `${protocol}://${host}/${code}`;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}
