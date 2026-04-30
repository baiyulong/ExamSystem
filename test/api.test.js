import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { routeApiRequest } from '../server/api.js';

function startApiServer() {
  const server = createServer(async (request, response) => {
    const handled = await routeApiRequest(request, response);
    if (!handled) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'API route not found' }));
    }
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

test('GET /api/health returns {ok:true} when DB is reachable', async () => {
  const app = await startApiServer();
  try {
    const res = await fetch(`${app.baseUrl}/api/health`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
  } finally {
    await app.close();
  }
});

test('GET /api/dashboard returns numeric counts', async () => {
  const app = await startApiServer();
  try {
    const res = await fetch(`${app.baseUrl}/api/dashboard`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(typeof body.total_cards, 'number');
    assert.equal(typeof body.due_count, 'number');
    assert.ok(body.total_cards > 0, 'should have seeded knowledge points');
  } finally {
    await app.close();
  }
});

test('GET /api/knowledge returns list of knowledge points', async () => {
  const app = await startApiServer();
  try {
    const res = await fetch(`${app.baseUrl}/api/knowledge`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(body));
    assert.ok(body.length > 0);
    assert.ok(body[0].id, 'points have id');
    assert.ok(body[0].title, 'points have title');
    assert.ok(body[0].priority, 'points have priority');
  } finally {
    await app.close();
  }
});

test('GET /api/knowledge/:id returns single point', async () => {
  const app = await startApiServer();
  try {
    const listRes = await fetch(`${app.baseUrl}/api/knowledge`);
    const list = await listRes.json();
    const first = list[0];

    const res = await fetch(`${app.baseUrl}/api/knowledge/${encodeURIComponent(first.id)}`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.id, first.id);
    assert.equal(body.title, first.title);
  } finally {
    await app.close();
  }
});

test('GET /api/knowledge/:id returns 404 for unknown id', async () => {
  const app = await startApiServer();
  try {
    const res = await fetch(`${app.baseUrl}/api/knowledge/nonexistent-xyz`);
    const body = await res.json();
    assert.equal(res.status, 404);
    assert.ok(body.error);
  } finally {
    await app.close();
  }
});

test('GET /api/cards/due returns array', async () => {
  const app = await startApiServer();
  try {
    const res = await fetch(`${app.baseUrl}/api/cards/due`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(body));
  } finally {
    await app.close();
  }
});

test('POST /api/cards/:id/review with known=true updates progress', async () => {
  const app = await startApiServer();
  try {
    const listRes = await fetch(`${app.baseUrl}/api/knowledge`);
    const list = await listRes.json();
    const cardId = list[0].id;

    const res = await fetch(`${app.baseUrl}/api/cards/${encodeURIComponent(cardId)}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ known: true }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.review_count > 0);
    assert.ok(body.next_due);

    // Reset back
    await fetch(`${app.baseUrl}/api/cards/${encodeURIComponent(cardId)}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ known: false }),
    });
  } finally {
    await app.close();
  }
});

test('POST /api/cards/:id/review rejects missing known field', async () => {
  const app = await startApiServer();
  try {
    const listRes = await fetch(`${app.baseUrl}/api/knowledge`);
    const list = await listRes.json();
    const cardId = list[0].id;

    const res = await fetch(`${app.baseUrl}/api/cards/${encodeURIComponent(cardId)}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ known: 'yes' }),
    });
    assert.equal(res.status, 400);
  } finally {
    await app.close();
  }
});

test('GET /api/wrong returns array', async () => {
  const app = await startApiServer();
  try {
    const res = await fetch(`${app.baseUrl}/api/wrong`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(body));
  } finally {
    await app.close();
  }
});

test('POST /api/wrong adds item, DELETE /api/wrong/:id removes it', async () => {
  const app = await startApiServer();
  try {
    const listRes = await fetch(`${app.baseUrl}/api/knowledge`);
    const list = await listRes.json();
    const knowledgeId = list[0].id;

    const addRes = await fetch(`${app.baseUrl}/api/wrong`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ knowledge_id: knowledgeId, note: 'test wrong item' }),
    });
    const added = await addRes.json();
    assert.equal(addRes.status, 201);
    assert.equal(added.knowledge_id, knowledgeId);
    assert.ok(added.id);

    const delRes = await fetch(`${app.baseUrl}/api/wrong/${added.id}`, { method: 'DELETE' });
    assert.equal(delRes.status, 204);
  } finally {
    await app.close();
  }
});

test('GET /api/plan returns 20-week plan', async () => {
  const app = await startApiServer();
  try {
    const res = await fetch(`${app.baseUrl}/api/plan`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 20);
    assert.ok(body[0].week);
    assert.ok(body[0].title);
  } finally {
    await app.close();
  }
});

test('PUT /api/plan/:id updates plan status', async () => {
  const app = await startApiServer();
  try {
    const planRes = await fetch(`${app.baseUrl}/api/plan`);
    const plan = await planRes.json();
    const item = plan[0];
    const original = item.status;

    const res = await fetch(`${app.baseUrl}/api/plan/${encodeURIComponent(item.id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'in-progress' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.status, 'in-progress');

    // Restore
    await fetch(`${app.baseUrl}/api/plan/${encodeURIComponent(item.id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: original }),
    });
  } finally {
    await app.close();
  }
});

test('PUT /api/plan/:id rejects invalid status', async () => {
  const app = await startApiServer();
  try {
    const planRes = await fetch(`${app.baseUrl}/api/plan`);
    const plan = await planRes.json();

    const res = await fetch(`${app.baseUrl}/api/plan/${encodeURIComponent(plan[0].id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'invalid-status' }),
    });
    assert.equal(res.status, 400);
  } finally {
    await app.close();
  }
});

test('GET /api/papers returns paper templates', async () => {
  const app = await startApiServer();
  try {
    const res = await fetch(`${app.baseUrl}/api/papers`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(body));
    assert.ok(body.length > 0);
    assert.ok(body[0].title);
  } finally {
    await app.close();
  }
});

test('unknown API routes return 404', async () => {
  const app = await startApiServer();
  try {
    const res = await fetch(`${app.baseUrl}/api/nonexistent`);
    const body = await res.json();
    assert.equal(res.status, 404);
    assert.ok(body.error);
  } finally {
    await app.close();
  }
});

test('non-API path returns false without writing response', async () => {
  const fakeResponse = {
    writeHead() { throw new Error('should not be called'); },
    end() { throw new Error('should not be called'); },
  };
  const handled = await routeApiRequest({ method: 'GET', url: '/index.html' }, fakeResponse);
  assert.equal(handled, false);
});
