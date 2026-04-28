# Supabase Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save all mutable study progress to Supabase PostgreSQL while keeping localStorage as a fast fallback cache.

**Architecture:** The browser will continue to run the existing web/PWA UI, but it will call same-origin Node endpoints for persistence. The Node server will read `DATABASE_URL` from `.env`, initialize a single `study_state` table, and expose `GET /api/state`, `PUT /api/state`, and `GET /api/health`.

**Tech Stack:** Node.js ES modules, native `node:test`, `pg`, `dotenv`, browser `fetch`, `localStorage`, Supabase PostgreSQL.

---

## File Structure

- Create `src/stateSchema.js`: shared validation for the persisted study-state shape.
- Create `src/persistence.js`: browser-side local/cloud persistence helpers.
- Create `server/api.js`: API routing and JSON request/response helpers.
- Create `server/database.js`: PostgreSQL pool and study-state repository.
- Modify `server.js`: route `/api/*` before static file serving.
- Modify `src/app.js`: async startup, cloud load/save, visible sync status.
- Modify `index.html`: add a sync status element in the hero.
- Modify `styles.css`: style the sync status badge.
- Modify `package.json` and create `package-lock.json`: add `pg` and `dotenv`.
- Create `.env.example`: document required configuration without secrets.
- Modify `.gitignore`: keep `.env` ignored.
- Create tests:
  - `test/stateSchema.test.js`
  - `test/persistence.test.js`
  - `test/api.test.js`

## Task 1: Add Shared Study-State Validation

**Files:**
- Create: `src/stateSchema.js`
- Create: `test/stateSchema.test.js`

- [ ] **Step 1: Write the failing validation tests**

Create `test/stateSchema.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { isStudyState, validateStudyState } from '../src/stateSchema.js';

const validState = {
  cards: [
    {
      id: 'card-quality-attributes',
      knowledgeId: 'quality-attributes',
      question: '质量属性如何影响架构设计？',
      answer: '质量属性决定架构取舍。',
      priority: 'P0',
      intervalIndex: 1,
      reviewCount: 2,
      lapseCount: 0,
      nextReviewAt: '2026-05-01',
      status: 'learning',
    },
  ],
  plan: [
    {
      id: 'week-1',
      week: 1,
      phase: '框架建立',
      title: '考试大纲与导学',
      focus: '建立考试地图',
      status: 'in-progress',
    },
  ],
  wrongItems: [
    {
      id: 'wrong-1',
      cardId: 'card-quality-attributes',
      title: '质量属性',
      reason: '容易混淆可用性和可靠性',
      createdAt: '2026-04-28',
    },
  ],
  startedAt: '2026-04-28',
};

test('isStudyState accepts the current persisted state shape', () => {
  assert.equal(isStudyState(validState), true);
});

test('isStudyState rejects missing required collections', () => {
  assert.equal(isStudyState({ ...validState, cards: undefined }), false);
  assert.equal(isStudyState({ ...validState, plan: undefined }), false);
  assert.equal(isStudyState({ ...validState, wrongItems: undefined }), false);
});

test('validateStudyState returns the original state for valid input', () => {
  assert.equal(validateStudyState(validState), validState);
});

test('validateStudyState throws a clear error for invalid input', () => {
  assert.throws(
    () => validateStudyState({ cards: [], plan: [], startedAt: '2026-04-28' }),
    /Invalid study state/,
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- test/stateSchema.test.js
```

Expected: FAIL with `Cannot find module '../src/stateSchema.js'`.

- [ ] **Step 3: Implement validation**

Create `src/stateSchema.js`:

```js
const REQUIRED_STATE_ARRAYS = ['cards', 'plan', 'wrongItems'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasString(value, key) {
  return typeof value[key] === 'string' && value[key].length > 0;
}

function isCard(value) {
  return isPlainObject(value)
    && hasString(value, 'id')
    && hasString(value, 'knowledgeId')
    && hasString(value, 'question')
    && hasString(value, 'answer')
    && hasString(value, 'priority')
    && Number.isInteger(value.intervalIndex)
    && Number.isInteger(value.reviewCount)
    && Number.isInteger(value.lapseCount)
    && hasString(value, 'nextReviewAt')
    && hasString(value, 'status');
}

function isPlanItem(value) {
  return isPlainObject(value)
    && hasString(value, 'id')
    && Number.isInteger(value.week)
    && hasString(value, 'phase')
    && hasString(value, 'title')
    && hasString(value, 'focus')
    && hasString(value, 'status');
}

function isWrongItem(value) {
  return isPlainObject(value)
    && hasString(value, 'id')
    && hasString(value, 'title')
    && hasString(value, 'reason')
    && hasString(value, 'createdAt');
}

export function isStudyState(value) {
  if (!isPlainObject(value) || !hasString(value, 'startedAt')) return false;
  if (!REQUIRED_STATE_ARRAYS.every((key) => Array.isArray(value[key]))) return false;

  return value.cards.every(isCard)
    && value.plan.every(isPlanItem)
    && value.wrongItems.every(isWrongItem);
}

export function validateStudyState(value) {
  if (!isStudyState(value)) {
    throw new Error('Invalid study state: expected cards, plan, wrongItems, and startedAt');
  }
  return value;
}
```

- [ ] **Step 4: Run validation tests**

Run:

```bash
npm test -- test/stateSchema.test.js
```

Expected: PASS for all tests in `test/stateSchema.test.js`.

- [ ] **Step 5: Run the existing algorithm tests**

Run:

```bash
npm test -- test/studyEngine.test.js
```

Expected: PASS for all existing spaced-repetition tests.

- [ ] **Step 6: Commit**

```bash
git add src/stateSchema.js test/stateSchema.test.js
git commit -m "test: add study state validation"
```

## Task 2: Add Browser Persistence Helpers

**Files:**
- Create: `src/persistence.js`
- Create: `test/persistence.test.js`

- [ ] **Step 1: Write failing persistence-helper tests**

Create `test/persistence.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CLOUD_LOAD_FAILED,
  CLOUD_SYNCED,
  LOCAL_ONLY,
  loadInitialState,
  saveStateEverywhere,
} from '../src/persistence.js';

const savedState = {
  cards: [],
  plan: [],
  wrongItems: [],
  startedAt: '2026-04-28',
};

function memoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    dump: () => Object.fromEntries(store.entries()),
  };
}

test('loadInitialState renders local cache first and then replaces it with cloud state', async () => {
  const storage = memoryStorage({
    'study-state': JSON.stringify({ ...savedState, startedAt: '2026-04-27' }),
  });
  const fetchJson = async () => ({
    ok: true,
    json: async () => ({ state: savedState, updatedAt: '2026-04-28T00:00:00.000Z' }),
  });

  const result = await loadInitialState({
    storage,
    storageKey: 'study-state',
    createInitialState: () => ({ ...savedState, startedAt: '2026-04-26' }),
    fetchJson,
  });

  assert.equal(result.state.startedAt, '2026-04-28');
  assert.equal(result.syncStatus, CLOUD_SYNCED);
});

test('loadInitialState falls back to local cache when cloud load fails', async () => {
  const storage = memoryStorage({
    'study-state': JSON.stringify(savedState),
  });
  const fetchJson = async () => {
    throw new Error('database offline');
  };

  const result = await loadInitialState({
    storage,
    storageKey: 'study-state',
    createInitialState: () => ({ ...savedState, startedAt: '2026-04-26' }),
    fetchJson,
  });

  assert.equal(result.state.startedAt, '2026-04-28');
  assert.equal(result.syncStatus, CLOUD_LOAD_FAILED);
});

test('saveStateEverywhere writes local cache before saving to the backend', async () => {
  const storage = memoryStorage();
  const calls = [];
  const fetchJson = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({ state: savedState, updatedAt: '2026-04-28T00:00:00.000Z' }),
    };
  };

  const status = await saveStateEverywhere({
    state: savedState,
    storage,
    storageKey: 'study-state',
    fetchJson,
  });

  assert.equal(JSON.parse(storage.dump()['study-state']).startedAt, '2026-04-28');
  assert.equal(calls[0].url, '/api/state');
  assert.equal(calls[0].options.method, 'PUT');
  assert.equal(status, CLOUD_SYNCED);
});

test('saveStateEverywhere keeps local cache when backend save fails', async () => {
  const storage = memoryStorage();
  const fetchJson = async () => ({
    ok: false,
    json: async () => ({ error: 'Database unavailable' }),
  });

  const status = await saveStateEverywhere({
    state: savedState,
    storage,
    storageKey: 'study-state',
    fetchJson,
  });

  assert.equal(JSON.parse(storage.dump()['study-state']).startedAt, '2026-04-28');
  assert.equal(status, LOCAL_ONLY);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- test/persistence.test.js
```

Expected: FAIL with `Cannot find module '../src/persistence.js'`.

- [ ] **Step 3: Implement persistence helpers**

Create `src/persistence.js`:

```js
import { validateStudyState } from './stateSchema.js';

export const CLOUD_SYNCED = 'cloud-synced';
export const CLOUD_LOAD_FAILED = 'cloud-load-failed';
export const LOCAL_ONLY = 'local-only';

function readLocalState({ storage, storageKey, createInitialState }) {
  const saved = storage.getItem(storageKey);
  if (!saved) return createInitialState();
  return validateStudyState(JSON.parse(saved));
}

function writeLocalState({ state, storage, storageKey }) {
  storage.setItem(storageKey, JSON.stringify(validateStudyState(state)));
}

async function readResponseJson(response) {
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed with status ${response.status}`);
  }
  return payload;
}

export async function loadInitialState({
  storage = localStorage,
  storageKey,
  createInitialState,
  fetchJson = fetch,
} = {}) {
  const localState = readLocalState({ storage, storageKey, createInitialState });

  try {
    const response = await fetchJson('/api/state');
    const payload = await readResponseJson(response);
    if (payload.state) {
      const cloudState = validateStudyState(payload.state);
      writeLocalState({ state: cloudState, storage, storageKey });
      return { state: cloudState, syncStatus: CLOUD_SYNCED };
    }
    return { state: localState, syncStatus: LOCAL_ONLY };
  } catch (error) {
    console.warn('Cloud state load failed; using local cache.', error);
    return { state: localState, syncStatus: CLOUD_LOAD_FAILED };
  }
}

export async function saveStateEverywhere({
  state,
  storage = localStorage,
  storageKey,
  fetchJson = fetch,
} = {}) {
  writeLocalState({ state, storage, storageKey });

  try {
    const response = await fetchJson('/api/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state }),
    });
    await readResponseJson(response);
    return CLOUD_SYNCED;
  } catch (error) {
    console.warn('Cloud state save failed; local cache is preserved.', error);
    return LOCAL_ONLY;
  }
}
```

- [ ] **Step 4: Run persistence tests**

Run:

```bash
npm test -- test/persistence.test.js
```

Expected: PASS for all persistence-helper tests.

- [ ] **Step 5: Commit**

```bash
git add src/persistence.js test/persistence.test.js
git commit -m "test: add browser persistence helpers"
```

## Task 3: Add API Handlers With Repository Injection

**Files:**
- Create: `server/api.js`
- Create: `test/api.test.js`

- [ ] **Step 1: Write failing API tests**

Create `test/api.test.js`:

```js
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

function startApiServer(repository) {
  const server = createServer((request, response) => {
    routeApiRequest(request, response, {
      repository,
      logger: { error: () => {} },
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
```

- [ ] **Step 2: Run the API tests to verify they fail**

Run:

```bash
npm test -- test/api.test.js
```

Expected: FAIL with `Cannot find module '../server/api.js'`.

- [ ] **Step 3: Implement API routing**

Create `server/api.js`:

```js
import { validateStudyState } from '../src/stateSchema.js';

const MAX_BODY_BYTES = 1_000_000;

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Request body must be valid JSON'));
      }
    });
    request.on('error', reject);
  });
}

export async function routeApiRequest(request, response, { repository, logger = console } = {}) {
  const url = new URL(request.url ?? '/', 'http://localhost');

  try {
    if (request.method === 'GET' && url.pathname === '/api/health') {
      sendJson(response, 200, await repository.health());
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/state') {
      sendJson(response, 200, await repository.loadState());
      return true;
    }

    if (request.method === 'PUT' && url.pathname === '/api/state') {
      const payload = await readJsonBody(request);
      const state = validateStudyState(payload.state);
      sendJson(response, 200, await repository.saveState(state));
      return true;
    }

    if (url.pathname.startsWith('/api/')) {
      sendJson(response, 404, { error: 'API route not found' });
      return true;
    }

    return false;
  } catch (error) {
    if (error.message?.startsWith('Invalid study state')) {
      sendJson(response, 400, { error: 'Invalid study state' });
      return true;
    }
    if (error.message === 'Request body must be valid JSON' || error.message === 'Request body is too large') {
      sendJson(response, 400, { error: error.message });
      return true;
    }

    logger.error('API request failed', {
      method: request.method,
      path: url.pathname,
      message: error.message,
    });
    sendJson(response, 500, { error: 'Persistence service failed' });
    return true;
  }
}
```

- [ ] **Step 4: Run API tests**

Run:

```bash
npm test -- test/api.test.js
```

Expected: PASS for all API handler tests.

- [ ] **Step 5: Commit**

```bash
git add server/api.js test/api.test.js
git commit -m "test: add study state API handlers"
```

## Task 4: Add Supabase PostgreSQL Repository and Configuration

**Files:**
- Create: `server/database.js`
- Create: `.env.example`
- Modify: `.gitignore`
- Modify: `package.json`
- Create/modify: `package-lock.json`

- [ ] **Step 1: Install database dependencies**

Run:

```bash
npm install pg dotenv
```

Expected:

- `package.json` gains `dependencies` for `pg` and `dotenv`.
- `package-lock.json` is created or updated.
- Do not install Supabase JS in this phase because the browser must not receive database credentials.

- [ ] **Step 2: Create environment example**

Create `.env.example`:

```env
# Copy this file to .env and set the real Supabase PostgreSQL connection string.
# Never commit .env.
DATABASE_URL=postgresql://postgres:[password]@db.example.supabase.co:5432/postgres
```

- [ ] **Step 3: Ensure `.env` is ignored**

Modify `.gitignore` so it includes:

```gitignore
.env
.env.local
```

Keep the existing ignored entries, including `document/`.

- [ ] **Step 4: Implement PostgreSQL repository**

Create `server/database.js`:

```js
import 'dotenv/config';
import pg from 'pg';

import { validateStudyState } from '../src/stateSchema.js';

const { Pool } = pg;
const STATE_ROW_ID = 'default';

const schemaSql = `
create table if not exists study_state (
  id text primary key,
  state jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
`;

export function createDatabaseStateRepository({
  connectionString = process.env.DATABASE_URL,
  pool = connectionString ? new Pool({ connectionString }) : null,
} = {}) {
  let schemaReady = false;

  async function ensureSchema() {
    if (!pool || schemaReady) return;
    await pool.query(schemaSql);
    schemaReady = true;
  }

  return {
    async health() {
      if (!pool) return { configured: false, reachable: false };
      try {
        await ensureSchema();
        await pool.query('select 1');
        return { configured: true, reachable: true };
      } catch (error) {
        return { configured: true, reachable: false, error: error.message };
      }
    },

    async loadState() {
      if (!pool) return { state: null, updatedAt: null };
      await ensureSchema();
      const result = await pool.query(
        'select state, updated_at from study_state where id = $1',
        [STATE_ROW_ID],
      );
      if (result.rowCount === 0) return { state: null, updatedAt: null };
      return {
        state: validateStudyState(result.rows[0].state),
        updatedAt: result.rows[0].updated_at.toISOString(),
      };
    },

    async saveState(state) {
      if (!pool) {
        throw new Error('DATABASE_URL is not configured');
      }
      const validState = validateStudyState(state);
      await ensureSchema();
      const result = await pool.query(
        `
        insert into study_state (id, state, version, updated_at)
        values ($1, $2::jsonb, 1, now())
        on conflict (id)
        do update set
          state = excluded.state,
          version = study_state.version + 1,
          updated_at = now()
        returning state, updated_at
        `,
        [STATE_ROW_ID, JSON.stringify(validState)],
      );
      return {
        state: validateStudyState(result.rows[0].state),
        updatedAt: result.rows[0].updated_at.toISOString(),
      };
    },
  };
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test
```

Expected: all tests pass. No real database is required for this task.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .env.example .gitignore server/database.js
git commit -m "feat: add Supabase database repository"
```

## Task 5: Wire API Routes Into the Existing Server

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Update server imports**

Modify the top of `server.js` to add:

```js
import { routeApiRequest } from './server/api.js';
import { createDatabaseStateRepository } from './server/database.js';
```

Keep the existing imports:

```js
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
```

- [ ] **Step 2: Create the repository once at startup**

After `const port = Number(process.env.PORT ?? 4173);`, add:

```js
const repository = createDatabaseStateRepository();
```

- [ ] **Step 3: Route API requests before static files**

Replace the `createServer((request, response) => { ... })` block with:

```js
createServer(async (request, response) => {
  const handledApi = await routeApiRequest(request, response, { repository });
  if (handledApi) return;

  const filePath = safePath(request.url ?? '/');
  if (!filePath || !existsSync(filePath)) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  response.writeHead(200, {
    'content-type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
  });
  createReadStream(filePath).pipe(response);
}).listen(port, () => {
  console.log(`Study system running at http://localhost:${port}`);
});
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat: wire persistence API into server"
```

## Task 6: Connect the Frontend to Cloud Persistence

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Import persistence helpers**

At the top of `src/app.js`, add:

```js
import {
  CLOUD_LOAD_FAILED,
  CLOUD_SYNCED,
  LOCAL_ONLY,
  loadInitialState,
  saveStateEverywhere,
} from './persistence.js';
```

Keep the existing imports from `data.js` and `studyEngine.js`.

- [ ] **Step 2: Replace synchronous state initialization**

Replace:

```js
let state = loadState();
```

with:

```js
let state = initialState();
let syncStatus = LOCAL_ONLY;
```

Keep `loadState()` and `saveState()` only if they are still used temporarily. After the next step, remove both functions to avoid two persistence paths.

- [ ] **Step 3: Add sync-status rendering and saving**

Add these functions after the `$` helper:

```js
function syncStatusText(status) {
  if (status === CLOUD_SYNCED) return '云端已同步';
  if (status === CLOUD_LOAD_FAILED) return '云端读取失败，使用本地缓存';
  return '本地暂存';
}

function renderSyncStatus() {
  const element = $('#sync-status');
  if (!element) return;
  element.textContent = syncStatusText(syncStatus);
  element.dataset.status = syncStatus;
}

async function persistState() {
  syncStatus = await saveStateEverywhere({
    state,
    storageKey: STORAGE_KEY,
  });
  renderSyncStatus();
}
```

- [ ] **Step 4: Replace all `saveState(state)` calls**

In `src/app.js`, replace each:

```js
saveState(state);
renderAll();
```

with:

```js
renderAll();
persistState();
```

There are currently three save paths:

- review outcome click
- plan completion click
- manual wrong-item click

- [ ] **Step 5: Add async startup**

Replace the final startup call:

```js
renderAll();
```

with:

```js
async function start() {
  renderAll();
  const loaded = await loadInitialState({
    storageKey: STORAGE_KEY,
    createInitialState: initialState,
  });
  state = loaded.state;
  syncStatus = loaded.syncStatus;
  renderAll();
}

start();
```

- [ ] **Step 6: Remove old local-only functions**

Delete these functions from `src/app.js`:

```js
function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved ? JSON.parse(saved) : initialState();
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
```

- [ ] **Step 7: Ensure `renderAll()` renders sync status**

At the beginning or end of `renderAll()`, add:

```js
renderSyncStatus();
```

- [ ] **Step 8: Run tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/app.js
git commit -m "feat: sync frontend state through backend API"
```

## Task 7: Add Sync Status UI

**Files:**
- Modify: `index.html`
- Modify: `styles.css`

- [ ] **Step 1: Add the sync badge to the hero**

Modify `index.html` lines 17-18 from:

```html
      </div>
      <button id="reset-demo" type="button">重置进度</button>
```

to:

```html
      </div>
      <div class="hero-actions">
        <span class="sync-status" id="sync-status" data-status="local-only">本地暂存</span>
        <button id="reset-demo" type="button">重置进度</button>
      </div>
```

- [ ] **Step 2: Style the sync badge**

Add this CSS after the `.hero button, .primary` rule:

```css
.hero-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
}

.sync-status {
  border-radius: 999px;
  padding: 7px 12px;
  color: white;
  background: rgba(255, 255, 255, .18);
  font-size: 13px;
  font-weight: 700;
}

.sync-status[data-status="cloud-synced"] {
  background: rgba(22, 163, 74, .9);
}

.sync-status[data-status="cloud-load-failed"],
.sync-status[data-status="local-only"] {
  background: rgba(180, 83, 9, .9);
}
```

Modify the `.hero button, .primary` rule by removing:

```css
  align-self: start;
```

The button will now be positioned by `.hero-actions`.

- [ ] **Step 3: Run tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add index.html styles.css
git commit -m "feat: show cloud sync status"
```

## Task 8: Configure Local Supabase Connection and Verify End-to-End

**Files:**
- Create locally only: `.env`
- Do not commit: `.env`

- [ ] **Step 1: Create local `.env` without printing it**

Create `.env` from `.env.example` and set `DATABASE_URL` to the Supabase PostgreSQL connection string provided by the user. Do not echo the full value to the terminal and do not include it in commits.

Run:

```bash
cp .env.example .env
```

Then edit `.env` manually or with a safe patch that does not display the secret in command output.

- [ ] **Step 2: Verify `.env` is ignored**

Run:

```bash
git status --short .env
```

Expected: no output.

- [ ] **Step 3: Run automated tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Start the server**

Run:

```bash
npm start
```

Expected startup output:

```text
Study system running at http://localhost:4173
```

- [ ] **Step 5: Check health endpoint**

In a second terminal, run:

```bash
curl -s http://localhost:4173/api/health
```

Expected when Supabase is reachable:

```json
{"configured":true,"reachable":true}
```

- [ ] **Step 6: Check state save endpoint**

Run:

```bash
curl -s -X PUT http://localhost:4173/api/state \
  -H 'content-type: application/json' \
  --data '{"state":{"cards":[],"plan":[],"wrongItems":[],"startedAt":"2026-04-28"}}'
```

Expected response contains:

```json
{"state":{"cards":[],"plan":[],"wrongItems":[],"startedAt":"2026-04-28"},"updatedAt":"..."}
```

- [ ] **Step 7: Check state load endpoint**

Run:

```bash
curl -s http://localhost:4173/api/state
```

Expected response contains:

```json
{"state":{"cards":[],"plan":[],"wrongItems":[],"startedAt":"2026-04-28"},"updatedAt":"..."}
```

- [ ] **Step 8: Restore app-generated local state if needed**

If Step 6 used the minimal curl state against the real database, open the app and click “重置进度” once to regenerate full cards and plan, then perform one study action so the full state is saved to Supabase.

- [ ] **Step 9: Stop the server**

Stop the `npm start` process with `Ctrl+C` in the terminal running it.

## Task 9: Final Verification and Push

**Files:**
- Verify all changed files
- Push commits to GitHub

- [ ] **Step 1: Confirm no secrets are staged or tracked**

Run:

```bash
git status --short
git ls-files .env
git grep -n "DATABASE_URL=.*@" -- . ':!.env.example'
git grep -n "postgresql://postgres:" -- . ':!.env.example'
```

Expected:

- `.env` is not listed by `git ls-files .env`.
- The secret password is not found.
- The real Supabase host is not committed outside ignored local files.

- [ ] **Step 2: Run the full test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Inspect commit history**

Run:

```bash
git log --oneline --decorate -8
```

Expected: the Supabase persistence commits are present on `main`.

- [ ] **Step 4: Push to GitHub**

Run:

```bash
git push origin main
```

Expected: push succeeds without large-file or secret warnings.

## Self-Review

- Spec coverage: The plan covers server-side Supabase persistence, `.env` configuration, no frontend secrets, localStorage fallback, explicit sync status, API error handling, automated tests, and manual Supabase verification.
- Placeholder scan: No task uses placeholder markers or vague "add handling later" instructions.
- Type consistency: The persisted state shape is consistently `cards`, `plan`, `wrongItems`, and `startedAt`; API payloads consistently use `{ state, updatedAt }`; sync statuses consistently use `cloud-synced`, `cloud-load-failed`, and `local-only`.
