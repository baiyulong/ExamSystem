import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CLOUD_LOAD_FAILED,
  CLOUD_SYNCED,
  LOCAL_ONLY,
  loadInitialState,
  saveStateEverywhere,
} from '../src/persistence.js';
import { createStartupLoadController } from '../src/startupLoad.js';

const initialState = { cards: [], plan: [], wrongItems: [], startedAt: '2026-04-28' };
const loadedState = { ...initialState, startedAt: '2026-04-27' };
const userMutatedState = {
  ...initialState,
  wrongItems: [
    {
      id: 'manual-1',
      title: '手动错题',
      reason: '用户在启动加载完成前添加的错题',
      createdAt: '2026-04-28',
    },
  ],
};

function memoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    dump: () => Object.fromEntries(store.entries()),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

test('startup load applies loaded state when no user mutation happens during loading', () => {
  const startupLoad = createStartupLoadController();

  const result = startupLoad.completeLoad({
    currentState: initialState,
    loaded: { state: loadedState, syncStatus: CLOUD_SYNCED },
  });

  assert.equal(result.state, loadedState);
  assert.equal(result.syncStatus, CLOUD_SYNCED);
  assert.equal(result.shouldApplyLoadedSyncStatus, true);
});

test('startup load preserves current state when a user mutation happens before loading finishes', () => {
  const startupLoad = createStartupLoadController();

  startupLoad.recordUserMutation();
  const result = startupLoad.completeLoad({
    currentState: userMutatedState,
    loaded: { state: loadedState, syncStatus: CLOUD_LOAD_FAILED },
  });

  assert.equal(result.state, userMutatedState);
  assert.equal(result.syncStatus, undefined);
  assert.equal(result.shouldApplyLoadedSyncStatus, false);
});

test('startup load completion does not replace a sync status from an in-flight user save', () => {
  const startupLoad = createStartupLoadController();
  let syncStatus = CLOUD_SYNCED;

  startupLoad.recordUserMutation();
  const result = startupLoad.completeLoad({
    currentState: userMutatedState,
    loaded: { state: loadedState, syncStatus: CLOUD_LOAD_FAILED },
  });
  if (result.shouldApplyLoadedSyncStatus) {
    syncStatus = result.syncStatus;
  }

  assert.equal(syncStatus, CLOUD_SYNCED);
});

test('startup load reports whether a loaded snapshot is still safe to apply', () => {
  const startupLoad = createStartupLoadController();

  assert.equal(startupLoad.shouldApplyLoadedState(), true);

  startupLoad.recordUserMutation();

  assert.equal(startupLoad.shouldApplyLoadedState(), false);
});

test('startup load keeps user-saved local cache when pending cloud GET resolves a stale snapshot', async () => {
  const storage = memoryStorage();
  const startupLoad = createStartupLoadController();
  const startupGet = deferred();
  const originalWarn = console.warn;
  console.warn = () => {};
  const fetchJson = async (url, options) => {
    if (url === '/api/state' && options?.method === 'PUT') {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'offline' }),
      };
    }
    return startupGet.promise;
  };

  try {
    const loadPromise = loadInitialState({
      storage,
      storageKey: 'study-state',
      createInitialState: () => initialState,
      fetchJson,
      shouldCacheLoadedState: () => startupLoad.shouldApplyLoadedState(),
    });

    startupLoad.recordUserMutation();
    const userSaveStatus = await saveStateEverywhere({
      state: userMutatedState,
      storage,
      storageKey: 'study-state',
      fetchJson,
    });

    startupGet.resolve({
      ok: true,
      json: async () => ({ state: loadedState, updatedAt: '2026-04-27T00:00:00.000Z' }),
    });
    const loaded = await loadPromise;
    const result = startupLoad.completeLoad({ currentState: userMutatedState, loaded });

    assert.equal(userSaveStatus, LOCAL_ONLY);
    assert.equal(result.state, userMutatedState);
    assert.equal(result.shouldApplyLoadedSyncStatus, false);
    assert.deepEqual(JSON.parse(storage.dump()['study-state']), userMutatedState);
  } finally {
    console.warn = originalWarn;
  }
});
