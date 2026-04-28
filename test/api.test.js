import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { routeApiRequest } from '../server/api.js';

const validState = {
  cards: [],
  plan: [],
  wrongItems: [],
  startedAt: '2026-04-28',
};

function startApiServer(repository, logger = { error: () => {} }) {
  const server = createServer((request, response) => {
    routeApiRequest(request, response, {
      repository,
      logger,
    });
  });

  return new Promise((resolve) => {
    server.listen(0, () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

test('GET /api/state returns 500 for unexpected repository errors', async () => {
  const errors = [];
  const logger = { error: (...args) => errors.push(args) };
  const app = await startApiServer({
    loadState: async () => {
      throw new Error('Connection reset');
    },
    saveState: async () => {},
    health: async () => ({ configured: true, reachable: true }),
  }, logger);

  try {
    const response = await fetch(`${app.baseUrl}/api/state`);
    const payload = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(payload, { error: 'Persistence service failed' });
    assert.equal(errors.length, 1);
    assert.deepEqual(errors[0], [
      'API request failed',
      {
        method: 'GET',
        path: '/api/state',
        message: 'Connection reset',
      },
    ]);
  } finally {
    await app.close();
  }
});

test('GET /api/state treats non-validation Invalid study state errors as 500', async () => {
  const errors = [];
  const logger = { error: (...args) => errors.push(args) };
  const app = await startApiServer({
    loadState: async () => {
      throw new Error('Invalid study state: repository unavailable');
    },
    saveState: async () => {},
    health: async () => ({ configured: true, reachable: true }),
  }, logger);

  try {
    const response = await fetch(`${app.baseUrl}/api/state`);
    const payload = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(payload, { error: 'Persistence service failed' });
    assert.equal(errors.length, 1);
    assert.deepEqual(errors[0], [
      'API request failed',
      {
        method: 'GET',
        path: '/api/state',
        message: 'Invalid study state: repository unavailable',
      },
    ]);
  } finally {
    await app.close();
  }
});

test('PUT /api/state returns 500 for unexpected repository errors', async () => {
  const errors = [];
  const logger = { error: (...args) => errors.push(args) };
  const app = await startApiServer({
    loadState: async () => ({ state: null, updatedAt: null }),
    saveState: async () => {
      throw new Error('Disk full');
    },
    health: async () => ({ configured: true, reachable: true }),
  }, logger);

  try {
    const response = await fetch(`${app.baseUrl}/api/state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: validState }),
    });
    const payload = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(payload, { error: 'Persistence service failed' });
    assert.equal(errors.length, 1);
    assert.deepEqual(errors[0], [
      'API request failed',
      {
        method: 'PUT',
        path: '/api/state',
        message: 'Disk full',
      },
    ]);
  } finally {
    await app.close();
  }
});

test('unknown API routes return 404', async () => {
  const app = await startApiServer({
    loadState: async () => ({ state: null, updatedAt: null }),
    saveState: async () => {},
    health: async () => ({ configured: true, reachable: true }),
  });

  try {
    const response = await fetch(`${app.baseUrl}/api/unknown`);
    const payload = await response.json();

    assert.equal(response.status, 404);
    assert.deepEqual(payload, { error: 'API route not found' });
  } finally {
    await app.close();
  }
});

test('GET /api/state returns the saved state', async () => {
  const app = await startApiServer({
    loadState: async () => ({ state: validState, updatedAt: '2026-04-28T00:00:00.000Z' }),
    saveState: async () => {},
    health: async () => ({ configured: true, reachable: true }),
  });

  try {
    const response = await fetch(`${app.baseUrl}/api/state`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload.state, validState);
    assert.equal(payload.updatedAt, '2026-04-28T00:00:00.000Z');
  } finally {
    await app.close();
  }
});

test('PUT /api/state validates and saves study state', async () => {
  let saved = null;
  const app = await startApiServer({
    loadState: async () => ({ state: null, updatedAt: null }),
    saveState: async (state) => {
      saved = state;
      return { state, updatedAt: '2026-04-28T00:00:00.000Z' };
    },
    health: async () => ({ configured: true, reachable: true }),
  });

  try {
    const response = await fetch(`${app.baseUrl}/api/state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: validState }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(saved, validState);
    assert.deepEqual(payload.state, validState);
  } finally {
    await app.close();
  }
});

test('PUT /api/state rejects invalid payloads', async () => {
  let saveCalled = false;
  const app = await startApiServer({
    loadState: async () => ({ state: null, updatedAt: null }),
    saveState: async () => {
      saveCalled = true;
    },
    health: async () => ({ configured: true, reachable: true }),
  });

  try {
    const response = await fetch(`${app.baseUrl}/api/state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: { cards: [] } }),
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, 'Invalid study state');
    assert.equal(saveCalled, false);
  } finally {
    await app.close();
  }
});

test('PUT /api/state rejects oversized multibyte payloads before validation', async () => {
  let saveCalled = false;
  const oversizedPadding = '汉'.repeat(333334);
  const requestBody = JSON.stringify({
    state: validState,
    padding: oversizedPadding,
  });

  assert.ok(Buffer.byteLength(requestBody, 'utf8') > 1_000_000);

  const app = await startApiServer({
    loadState: async () => ({ state: null, updatedAt: null }),
    saveState: async () => {
      saveCalled = true;
    },
    health: async () => ({ configured: true, reachable: true }),
  });

  try {
    const response = await fetch(`${app.baseUrl}/api/state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: requestBody,
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.deepEqual(payload, { error: 'Request body is too large' });
    assert.equal(saveCalled, false);
  } finally {
    await app.close();
  }
});

test('GET /api/health returns repository health', async () => {
  const app = await startApiServer({
    loadState: async () => ({ state: null, updatedAt: null }),
    saveState: async () => {},
    health: async () => ({ configured: false, reachable: false }),
  });

  try {
    const response = await fetch(`${app.baseUrl}/api/health`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload, { configured: false, reachable: false });
  } finally {
    await app.close();
  }
});
