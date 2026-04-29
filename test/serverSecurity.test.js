import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRequestHandler } from '../server.js';

async function startStaticServer({ root }) {
  const server = createServer(createRequestHandler({
    root,
    repository: {
      health: async () => ({ configured: false, reachable: false }),
      loadState: async () => ({ state: null, updatedAt: null, version: null }),
      saveState: async () => { throw new Error('not used'); },
    },
  }));
  await new Promise((resolve) => {
    server.listen(0, resolve);
  });
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

test('static server does not serve dotfiles such as .env', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exam-static-'));
  await writeFile(join(root, 'index.html'), '<h1>ok</h1>');
  await writeFile(join(root, '.env'), 'DATABASE_URL=postgresql://example-secret');
  const app = await startStaticServer({ root });

  try {
    const response = await fetch(`${app.baseUrl}/.env`);
    const body = await response.text();

    assert.equal(response.status, 404);
    assert.equal(body, 'Not found');
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('static server rejects malformed percent-encoded paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exam-static-'));
  await writeFile(join(root, 'index.html'), '<h1>ok</h1>');
  const app = await startStaticServer({ root });

  try {
    const response = await fetch(`${app.baseUrl}/%E0%A4%A`);
    const body = await response.text();

    assert.equal(response.status, 404);
    assert.equal(body, 'Not found');
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
