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
  const events = [];
  const storage = memoryStorage({
    'study-state': JSON.stringify({ ...savedState, startedAt: '2026-04-27' }),
  });
  const instrumentedStorage = {
    ...storage,
    getItem: (key) => {
      events.push(`getItem:${key}`);
      return storage.getItem(key);
    },
  };
  const fetchJson = async () => {
    events.push('fetch:/api/state');
    return {
      ok: true,
      json: async () => ({ state: savedState, updatedAt: '2026-04-28T00:00:00.000Z' }),
    };
  };

  const result = await loadInitialState({
    storage: instrumentedStorage,
    storageKey: 'study-state',
    createInitialState: () => ({ ...savedState, startedAt: '2026-04-26' }),
    fetchJson,
  });

  assert.equal(result.state.startedAt, '2026-04-28');
  assert.equal(result.syncStatus, CLOUD_SYNCED);
  assert.deepEqual(events, ['getItem:study-state', 'fetch:/api/state']);
});

test('loadInitialState keeps the local cache when the backend returns 200 without state', async () => {
  const storage = memoryStorage({
    'study-state': JSON.stringify(savedState),
  });
  const fetchJson = async () => ({
    ok: true,
    json: async () => ({ state: null, updatedAt: null }),
  });

  const result = await loadInitialState({
    storage,
    storageKey: 'study-state',
    createInitialState: () => ({ ...savedState, startedAt: '2026-04-26' }),
    fetchJson,
  });

  assert.deepEqual(result.state, savedState);
  assert.equal(result.syncStatus, LOCAL_ONLY);
});

test('loadInitialState falls back to local cache when cloud load fails', async () => {
  const storage = memoryStorage({
    'study-state': JSON.stringify(savedState),
  });
  const fetchJson = async () => {
    throw new Error('database offline');
  };
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const result = await loadInitialState({
      storage,
      storageKey: 'study-state',
      createInitialState: () => ({ ...savedState, startedAt: '2026-04-26' }),
      fetchJson,
    });

    assert.equal(result.state.startedAt, '2026-04-28');
    assert.equal(result.syncStatus, CLOUD_LOAD_FAILED);
  } finally {
    console.warn = originalWarn;
  }
});

test('loadInitialState returns local cache when the backend responds with a non-ok error body', async () => {
  const storage = memoryStorage({
    'study-state': JSON.stringify(savedState),
  });
  const fetchJson = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ error: 'Service unavailable' }),
  });
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const result = await loadInitialState({
      storage,
      storageKey: 'study-state',
      createInitialState: () => ({ ...savedState, startedAt: '2026-04-26' }),
      fetchJson,
    });

    assert.deepEqual(result.state, savedState);
    assert.equal(result.syncStatus, CLOUD_LOAD_FAILED);
  } finally {
    console.warn = originalWarn;
  }
});

test('loadInitialState recovers from corrupted local cache and still uses valid cloud state', async () => {
  const warnings = [];
  const storage = memoryStorage({
    'study-state': '{not valid json',
  });
  const fetchJson = async () => ({
    ok: true,
    json: async () => ({ state: savedState, updatedAt: '2026-04-28T00:00:00.000Z' }),
  });
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args);
  };

  try {
    const result = await loadInitialState({
      storage,
      storageKey: 'study-state',
      createInitialState: () => ({ ...savedState, startedAt: '2026-04-26' }),
      fetchJson,
    });

    assert.equal(result.state.startedAt, '2026-04-28');
    assert.equal(result.syncStatus, CLOUD_SYNCED);
    assert.ok(warnings.length > 0);
    assert.match(String(warnings[0][0]), /Local study state is invalid/);
  } finally {
    console.warn = originalWarn;
  }
});

test('loadInitialState returns cloud state when local cache update fails', async () => {
  const warnings = [];
  const storage = {
    getItem: () => JSON.stringify({ ...savedState, startedAt: '2026-04-27' }),
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  const fetchJson = async () => ({
    ok: true,
    json: async () => ({ state: savedState, updatedAt: '2026-04-28T00:00:00.000Z' }),
  });
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args);
  };

  try {
    const result = await loadInitialState({
      storage,
      storageKey: 'study-state',
      createInitialState: () => ({ ...savedState, startedAt: '2026-04-26' }),
      fetchJson,
    });

    assert.equal(result.state.startedAt, '2026-04-28');
    assert.equal(result.syncStatus, CLOUD_SYNCED);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0][0], 'Cloud state loaded but local cache update failed.');
    assert.match(String(warnings[0][1]), /QuotaExceededError/);
  } finally {
    console.warn = originalWarn;
  }
});

test('saveStateEverywhere writes local cache before saving to the backend', async () => {
  const events = [];
  const storage = memoryStorage();
  const calls = [];
  const instrumentedStorage = {
    ...storage,
    setItem: (key, value) => {
      events.push(`setItem:${key}`);
      return storage.setItem(key, value);
    },
  };
  const fetchJson = async (url, options) => {
    events.push(`fetch:${url}`);
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({ state: savedState, updatedAt: '2026-04-28T00:00:00.000Z' }),
    };
  };

  const status = await saveStateEverywhere({
    state: savedState,
    storage: instrumentedStorage,
    storageKey: 'study-state',
    fetchJson,
  });

  assert.equal(JSON.parse(storage.dump()['study-state']).startedAt, '2026-04-28');
  assert.equal(calls[0].url, '/api/state');
  assert.equal(calls[0].options.method, 'PUT');
  assert.equal(status, CLOUD_SYNCED);
  assert.deepEqual(events, ['setItem:study-state', 'fetch:/api/state']);
});

test('saveStateEverywhere keeps local cache when backend save fails', async () => {
  const storage = memoryStorage();
  const fetchJson = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ error: 'Database unavailable' }),
  });
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const status = await saveStateEverywhere({
      state: savedState,
      storage,
      storageKey: 'study-state',
      fetchJson,
    });

    assert.equal(JSON.parse(storage.dump()['study-state']).startedAt, '2026-04-28');
    assert.equal(status, LOCAL_ONLY);
  } finally {
    console.warn = originalWarn;
  }
});

test('saveStateEverywhere warns with status when backend returns non-JSON error', async () => {
  const storage = memoryStorage();
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args);
  };

  try {
    const fetchJson = async () => ({
      ok: false,
      status: 503,
      json: async () => {
        throw new Error('unexpected token');
      },
    });

    const status = await saveStateEverywhere({
      state: savedState,
      storage,
      storageKey: 'study-state',
      fetchJson,
    });

    assert.equal(status, LOCAL_ONLY);
    assert.match(String(warnings[0]), /503/);
  } finally {
    console.warn = originalWarn;
  }
});
