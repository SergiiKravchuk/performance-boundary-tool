import assert from 'node:assert/strict';
import test from 'node:test';

import { createShortenerApp } from '../src/app.js';

test('POST /shorten returns 201 with a short URL and stores the mapping', async t => {
  const app = await startServer();
  t.after(app.close);

  const response = await fetch(`${app.origin}/shorten`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ url: 'https://example.com/some/path' })
  });

  assert.equal(response.status, 201);

  const body = await response.json();
  assert.equal(body.url, 'https://example.com/some/path');
  assert.match(body.code, /^[A-Za-z0-9]{6}$/);
  assert.equal(body.shortUrl, `${app.origin}/${body.code}`);
  assert.equal(app.store.get(body.code), 'https://example.com/some/path');
});

test('GET /:code redirects to the stored URL', async t => {
  const app = await startServer({ generateCode: () => 'AbC123' });
  t.after(app.close);

  const createResponse = await fetch(`${app.origin}/shorten`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ url: 'https://example.com/redirect-me' })
  });

  assert.equal(createResponse.status, 201);

  const redirectResponse = await fetch(`${app.origin}/AbC123`, {
    redirect: 'manual'
  });

  assert.equal(redirectResponse.status, 302);
  assert.equal(redirectResponse.headers.get('location'), 'https://example.com/redirect-me');
});

test('GET /:code returns 404 for an unknown code', async t => {
  const app = await startServer();
  t.after(app.close);

  const response = await fetch(`${app.origin}/missing`, {
    redirect: 'manual'
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Short code not found' });
});

test('POST /shorten returns 400 for invalid JSON', async t => {
  const app = await startServer();
  t.after(app.close);

  const response = await fetch(`${app.origin}/shorten`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: '{"url":'
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Request body must be valid JSON' });
});

test('POST /shorten returns 400 for invalid URL values', async t => {
  const app = await startServer();
  t.after(app.close);

  const cases = [
    {},
    { url: 42 },
    { url: '' },
    { url: 'ftp://example.com/file.txt' }
  ];

  for (const payload of cases) {
    const response = await fetch(`${app.origin}/shorten`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    assert.equal(response.status, 400);
  }
});

test('unsupported methods return 405 on supported routes', async t => {
  const app = await startServer();
  t.after(app.close);

  const shortenResponse = await fetch(`${app.origin}/shorten`, {
    method: 'GET'
  });
  assert.equal(shortenResponse.status, 405);
  assert.equal(shortenResponse.headers.get('allow'), 'POST');

  const codeResponse = await fetch(`${app.origin}/anything`, {
    method: 'DELETE'
  });
  assert.equal(codeResponse.status, 405);
  assert.equal(codeResponse.headers.get('allow'), 'GET');
});

test('non-matching routes return 404', async t => {
  const app = await startServer();
  t.after(app.close);

  const rootResponse = await fetch(`${app.origin}/`, {
    redirect: 'manual'
  });
  assert.equal(rootResponse.status, 404);

  const nestedResponse = await fetch(`${app.origin}/a/b`, {
    redirect: 'manual'
  });
  assert.equal(nestedResponse.status, 404);
});

async function startServer(options = {}) {
  const { app, store } = createShortenerApp(options);

  const server = await new Promise(resolve => {
    const listeningServer = app.listen(0, '127.0.0.1', () => {
      resolve(listeningServer);
    });
  });

  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    store,
    close: () => new Promise((resolve, reject) => {
      server.close(error => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    })
  };
}
