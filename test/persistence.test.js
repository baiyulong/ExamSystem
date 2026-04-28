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
