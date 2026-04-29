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

test('GET /api/state treats repository Request body is too large errors as 500', async () => {
  const errors = [];
  const logger = { error: (...args) => errors.push(args) };
  const app = await startApiServer({
    loadState: async () => {
      throw new Error('Request body is too large');
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
        message: 'Request body is too large',
      },
    ]);
  } finally {
    await app.close();
  }
});

test('GET /api/state treats repository Request body must be valid JSON errors as 500', async () => {
  const errors = [];
  const logger = { error: (...args) => errors.push(args) };
  const app = await startApiServer({
    loadState: async () => {
      throw new Error('Request body must be valid JSON');
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
        message: 'Request body must be valid JSON',
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
      body: JSON.stringify({ state: validState, expectedVersion: 0 }),
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

test('non-API routes return false without writing a response', async () => {
  let wroteHead = false;
  let ended = false;
  const response = {
    writeHead() {
      wroteHead = true;
      throw new Error('writeHead should not be called');
    },
    end() {
      ended = true;
      throw new Error('end should not be called');
    },
  };

  const handled = await routeApiRequest({
    method: 'GET',
    url: '/index.html',
  }, response, {
    repository: {
      loadState: async () => ({ state: null, updatedAt: null }),
      saveState: async () => {},
      health: async () => ({ configured: true, reachable: true }),
    },
    logger: { error: () => {} },
  });

  assert.equal(handled, false);
  assert.equal(wroteHead, false);
  assert.equal(ended, false);
});

test('GET /api/state returns the saved state', async () => {
  const app = await startApiServer({
    loadState: async () => ({ state: validState, updatedAt: '2026-04-28T00:00:00.000Z', version: 4 }),
    saveState: async () => {},
    health: async () => ({ configured: true, reachable: true }),
  });

  try {
    const response = await fetch(`${app.baseUrl}/api/state`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload.state, validState);
    assert.equal(payload.updatedAt, '2026-04-28T00:00:00.000Z');
    assert.equal(payload.version, 4);
  } finally {
    await app.close();
  }
});

test('PUT /api/state validates and saves study state', async () => {
  let saved = null;
  let expectedVersion = null;
  const app = await startApiServer({
    loadState: async () => ({ state: null, updatedAt: null }),
    saveState: async (state, options) => {
      saved = state;
      expectedVersion = options.expectedVersion;
      return { state, updatedAt: '2026-04-28T00:00:00.000Z', version: 1 };
    },
    health: async () => ({ configured: true, reachable: true }),
  });

  try {
    const response = await fetch(`${app.baseUrl}/api/state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: validState, expectedVersion: 0 }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(saved, validState);
    assert.equal(expectedVersion, 0);
    assert.deepEqual(payload.state, validState);
    assert.equal(payload.version, 1);
  } finally {
    await app.close();
  }
});

test('PUT /api/state rejects missing expectedVersion without saving', async () => {
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
      body: JSON.stringify({ state: validState }),
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.deepEqual(payload, { error: 'Invalid expected version' });
    assert.equal(saveCalled, false);
  } finally {
    await app.close();
  }
});

test('PUT /api/state rejects null expectedVersion without saving', async () => {
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
      body: JSON.stringify({ state: validState, expectedVersion: null }),
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.deepEqual(payload, { error: 'Invalid expected version' });
    assert.equal(saveCalled, false);
  } finally {
    await app.close();
  }
});

test('PUT /api/state returns 409 when expectedVersion is stale', async () => {
  const conflict = new Error('Study state conflict');
  conflict.code = 'STUDY_STATE_CONFLICT';
  const app = await startApiServer({
    loadState: async () => ({ state: validState, updatedAt: '2026-04-28T00:00:00.000Z', version: 3 }),
    saveState: async () => {
      throw conflict;
    },
    health: async () => ({ configured: true, reachable: true }),
  });

  try {
    const response = await fetch(`${app.baseUrl}/api/state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: { ...validState, startedAt: '2026-04-29' }, expectedVersion: 3 }),
    });
    const payload = await response.json();

    assert.equal(response.status, 409);
    assert.deepEqual(payload, { error: 'Study state conflict' });
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

test('PUT /api/state rejects null payloads', async () => {
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
      body: 'null',
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.deepEqual(payload, { error: 'Invalid study state' });
    assert.equal(saveCalled, false);
  } finally {
    await app.close();
  }
});

test('PUT /api/state rejects empty payload objects', async () => {
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
      body: JSON.stringify({}),
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.deepEqual(payload, { error: 'Invalid study state' });
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

test('GET /api/health does not expose repository error details', async () => {
  const app = await startApiServer({
    loadState: async () => ({ state: null, updatedAt: null }),
    saveState: async () => {},
    health: async () => ({
      configured: true,
      reachable: false,
      error: 'getaddrinfo ENOTFOUND db.secret-project.supabase.co',
    }),
  });

  try {
    const response = await fetch(`${app.baseUrl}/api/health`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload, { configured: true, reachable: false });
    assert.equal(JSON.stringify(payload).includes('secret-project'), false);
    assert.equal(JSON.stringify(payload).includes('supabase.co'), false);
  } finally {
    await app.close();
  }
});
