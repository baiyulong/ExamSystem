import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CLOUD_LOAD_FAILED,
  CLOUD_ONLY,
  CLOUD_SYNCED,
  LOCAL_ONLY,
  SAVE_FAILED,
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
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
  assert.deepEqual(events, [
    'getItem:study-state',
    'getItem:study-state:sync-metadata',
    'fetch:/api/state',
    'getItem:study-state:sync-metadata',
    'getItem:study-state:sync-metadata',
  ]);
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

test('loadInitialState recovers when local cache read throws and still uses valid cloud state', async () => {
  const warnings = [];
  const storage = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {},
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

    assert.deepEqual(result.state, savedState);
    assert.equal(result.syncStatus, CLOUD_SYNCED);
    assert.ok(warnings.length > 0);
    assert.match(String(warnings[0][0]), /Local study state is invalid/);
    assert.match(String(warnings[0][1]), /SecurityError/);
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
    assert.equal(result.syncStatus, CLOUD_ONLY);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0][0], 'Cloud state loaded but local cache update failed.');
    assert.match(String(warnings[0][1]), /QuotaExceededError/);
  } finally {
    console.warn = originalWarn;
  }
});

test('loadInitialState falls back to local cache when cloud state is schema invalid', async () => {
  const warnings = [];
  const localState = { ...savedState, startedAt: '2026-04-27' };
  const storage = memoryStorage({
    'study-state': JSON.stringify(localState),
  });
  const fetchJson = async () => ({
    ok: true,
    json: async () => ({ state: { ...savedState, startedAt: '' }, updatedAt: '2026-04-28T00:00:00.000Z' }),
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

    assert.deepEqual(result.state, localState);
    assert.equal(result.syncStatus, CLOUD_LOAD_FAILED);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0][0], 'Cloud state failed schema validation; using local cache.');
    assert.match(String(warnings[0][1]), /Invalid study state/);
  } finally {
    console.warn = originalWarn;
  }
});

test('loadInitialState treats malformed sync metadata with valid local state as local-only', async () => {
  const localState = { ...savedState, startedAt: '2026-04-29' };
  const staleCloudState = { ...savedState, startedAt: '2026-04-27' };
  const storage = memoryStorage({
    'study-state': JSON.stringify(localState),
    'study-state:sync-metadata': '{not valid json',
  });
  let fetchCalled = false;
  const fetchJson = async () => {
    fetchCalled = true;
    return {
      ok: true,
      json: async () => ({ state: staleCloudState, updatedAt: '2026-04-27T00:00:00.000Z', version: 1 }),
    };
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

    assert.equal(fetchCalled, false);
    assert.deepEqual(result.state, localState);
    assert.equal(result.syncStatus, LOCAL_ONLY);
    assert.deepEqual(JSON.parse(storage.dump()['study-state']), localState);
  } finally {
    console.warn = originalWarn;
  }
});

test('loadInitialState treats unreadable sync metadata with valid local state as local-only', async () => {
  const localState = { ...savedState, startedAt: '2026-04-29' };
  const staleCloudState = { ...savedState, startedAt: '2026-04-27' };
  const backingStorage = memoryStorage({
    'study-state': JSON.stringify(localState),
  });
  const storage = {
    getItem: (key) => {
      if (key === 'study-state:sync-metadata') {
        throw new Error('SecurityError');
      }
      return backingStorage.getItem(key);
    },
    setItem: backingStorage.setItem,
    dump: backingStorage.dump,
  };
  let fetchCalled = false;
  const fetchJson = async () => {
    fetchCalled = true;
    return {
      ok: true,
      json: async () => ({ state: staleCloudState, updatedAt: '2026-04-27T00:00:00.000Z', version: 1 }),
    };
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

    assert.equal(fetchCalled, false);
    assert.deepEqual(result.state, localState);
    assert.equal(result.syncStatus, LOCAL_ONLY);
    assert.deepEqual(JSON.parse(storage.dump()['study-state']), localState);
  } finally {
    console.warn = originalWarn;
  }
});

test('saveStateEverywhere uses expectedVersion 0 after malformed sync metadata and preserves dirty local state on conflict', async () => {
  const localState = { ...savedState, startedAt: '2026-04-29' };
  const storage = memoryStorage({
    'study-state': JSON.stringify(localState),
    'study-state:sync-metadata': '{not valid json',
  });
  const calls = [];
  const fetchJson = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: false,
      status: 409,
      json: async () => ({ error: 'Study state conflict' }),
    };
  };
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const status = await saveStateEverywhere({
      state: localState,
      storage,
      storageKey: 'study-state',
      fetchJson,
    });

    const putBody = JSON.parse(calls[0].options.body);
    const metadata = JSON.parse(storage.dump()['study-state:sync-metadata']);
    assert.equal(putBody.expectedVersion, 0);
    assert.equal(status, LOCAL_ONLY);
    assert.deepEqual(JSON.parse(storage.dump()['study-state']), localState);
    assert.equal(metadata.dirty, true);
  } finally {
    console.warn = originalWarn;
  }
});

test('saveStateEverywhere uses expectedVersion 0 when sync metadata is missing before any cloud load', async () => {
  const storage = memoryStorage();
  const calls = [];
  const fetchJson = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({ state: savedState, updatedAt: '2026-04-28T00:00:00.000Z', version: 1 }),
    };
  };

  const status = await saveStateEverywhere({
    state: savedState,
    storage,
    storageKey: 'study-state',
    fetchJson,
  });

  const putBody = JSON.parse(calls[0].options.body);
  assert.equal(putBody.expectedVersion, 0);
  assert.equal(status, CLOUD_SYNCED);
});

test('saveStateEverywhere uses expectedVersion 0 after cloud load failure and preserves dirty local state on conflict', async () => {
  const localState = { ...savedState, startedAt: '2026-04-29' };
  const storage = memoryStorage({
    'study-state': JSON.stringify(localState),
  });
  const calls = [];
  const fetchJson = async (url, options) => {
    calls.push({ url, options });
    if (options?.method === 'PUT') {
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'Study state conflict' }),
      };
    }
    throw new Error('database offline');
  };
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const loaded = await loadInitialState({
      storage,
      storageKey: 'study-state',
      createInitialState: () => ({ ...savedState, startedAt: '2026-04-26' }),
      fetchJson,
    });
    const status = await saveStateEverywhere({
      state: localState,
      storage,
      storageKey: 'study-state',
      fetchJson,
    });

    const putBody = JSON.parse(calls.find((call) => call.options?.method === 'PUT').options.body);
    const metadata = JSON.parse(storage.dump()['study-state:sync-metadata']);
    assert.equal(loaded.syncStatus, CLOUD_LOAD_FAILED);
    assert.equal(putBody.expectedVersion, 0);
    assert.equal(status, LOCAL_ONLY);
    assert.deepEqual(JSON.parse(storage.dump()['study-state']), localState);
    assert.equal(metadata.dirty, true);
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
  assert.deepEqual(events, [
    'setItem:study-state',
    'setItem:study-state:sync-metadata',
    'fetch:/api/state',
    'setItem:study-state:sync-metadata',
  ]);
});

test('saveStateEverywhere sends queued saves in mutation order even when the first cloud save is slower', async () => {
  const storage = memoryStorage();
  const firstSave = deferred();
  const secondSave = deferred();
  const cloudWrites = [];
  const olderState = { ...savedState, startedAt: '2026-04-27' };
  const newerState = { ...savedState, startedAt: '2026-04-28' };
  const fetchJson = async (url, options) => {
    const body = JSON.parse(options.body);
    cloudWrites.push({ url, startedAt: body.state.startedAt });
    if (cloudWrites.length === 1) return firstSave.promise;
    if (cloudWrites.length === 2) return secondSave.promise;
    throw new Error('unexpected extra cloud save');
  };

  try {
    const olderSavePromise = saveStateEverywhere({
      state: olderState,
      storage,
      storageKey: 'study-state',
      fetchJson,
    });
    const newerSavePromise = saveStateEverywhere({
      state: newerState,
      storage,
      storageKey: 'study-state',
      fetchJson,
    });
    olderState.startedAt = '2026-04-26';
    newerState.startedAt = '2026-04-29';

    await Promise.resolve();
    assert.deepEqual(
      cloudWrites.map((write) => write.startedAt),
      ['2026-04-27'],
      'newer cloud save must wait for the older save to finish',
    );

    firstSave.resolve({
      ok: true,
      json: async () => ({ state: olderState, updatedAt: '2026-04-27T00:00:00.000Z' }),
    });
    assert.equal(await olderSavePromise, CLOUD_SYNCED);
    await Promise.resolve();
    assert.deepEqual(
      cloudWrites.map((write) => write.startedAt),
      ['2026-04-27', '2026-04-28'],
    );

    secondSave.resolve({
      ok: true,
      json: async () => ({ state: newerState, updatedAt: '2026-04-28T00:00:00.000Z' }),
    });
    assert.equal(await newerSavePromise, CLOUD_SYNCED);
    assert.equal(cloudWrites.at(-1).startedAt, '2026-04-28');
  } finally {
    firstSave.resolve({
      ok: true,
      json: async () => ({ state: olderState, updatedAt: '2026-04-27T00:00:00.000Z' }),
    });
    secondSave.resolve({
      ok: true,
      json: async () => ({ state: newerState, updatedAt: '2026-04-28T00:00:00.000Z' }),
    });
  }
});

test('saveStateEverywhere advances expectedVersion between queued same-tab saves', async () => {
  const storage = memoryStorage();
  const firstSave = deferred();
  const secondSave = deferred();
  const cloudWrites = [];
  const firstState = { ...savedState, startedAt: '2026-04-29' };
  const secondState = { ...savedState, startedAt: '2026-04-30' };
  const fetchJson = async (url, options) => {
    if (options?.method === 'PUT') {
      const body = JSON.parse(options.body);
      cloudWrites.push({ expectedVersion: body.expectedVersion, startedAt: body.state.startedAt });
      if (cloudWrites.length === 1) return firstSave.promise;
      if (cloudWrites.length === 2) return secondSave.promise;
      throw new Error('unexpected extra cloud save');
    }
    return {
      ok: true,
      json: async () => ({ state: savedState, updatedAt: '2026-04-28T00:00:00.000Z', version: 7 }),
    };
  };

  try {
    await loadInitialState({
      storage,
      storageKey: 'study-state',
      createInitialState: () => ({ ...savedState, startedAt: '2026-04-26' }),
      fetchJson,
    });

    const firstSavePromise = saveStateEverywhere({
      state: firstState,
      storage,
      storageKey: 'study-state',
      fetchJson,
    });
    const secondSavePromise = saveStateEverywhere({
      state: secondState,
      storage,
      storageKey: 'study-state',
      fetchJson,
    });

    await Promise.resolve();
    assert.deepEqual(cloudWrites, [{ expectedVersion: 7, startedAt: '2026-04-29' }]);

    firstSave.resolve({
      ok: true,
      json: async () => ({ state: firstState, updatedAt: '2026-04-29T00:00:00.000Z', version: 8 }),
    });
    assert.equal(await firstSavePromise, CLOUD_SYNCED);
    await Promise.resolve();

    assert.deepEqual(cloudWrites, [
      { expectedVersion: 7, startedAt: '2026-04-29' },
      { expectedVersion: 8, startedAt: '2026-04-30' },
    ]);

    secondSave.resolve({
      ok: true,
      json: async () => ({ state: secondState, updatedAt: '2026-04-30T00:00:00.000Z', version: 9 }),
    });
    assert.equal(await secondSavePromise, CLOUD_SYNCED);
    assert.equal(JSON.parse(storage.dump()['study-state:sync-metadata']).dirty, false);
    assert.equal(JSON.parse(storage.dump()['study-state:sync-metadata']).cloudVersion, 9);
  } finally {
    firstSave.resolve({
      ok: true,
      json: async () => ({ state: firstState, updatedAt: '2026-04-29T00:00:00.000Z', version: 8 }),
    });
    secondSave.resolve({
      ok: true,
      json: async () => ({ state: secondState, updatedAt: '2026-04-30T00:00:00.000Z', version: 9 }),
    });
  }
});

test('saveStateEverywhere continues queued saves after a failed cloud save', async () => {
  const storage = memoryStorage();
  const firstSave = deferred();
  const cloudWrites = [];
  const failedState = { ...savedState, startedAt: '2026-04-27' };
  const recoveredState = { ...savedState, startedAt: '2026-04-28' };
  const fetchJson = async (url, options) => {
    const body = JSON.parse(options.body);
    cloudWrites.push(body.state.startedAt);
    if (cloudWrites.length === 1) return firstSave.promise;
    return {
      ok: true,
      json: async () => ({ state: recoveredState, updatedAt: '2026-04-28T00:00:00.000Z' }),
    };
  };
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const failedSavePromise = saveStateEverywhere({
      state: failedState,
      storage,
      storageKey: 'study-state',
      fetchJson,
    });
    const recoveredSavePromise = saveStateEverywhere({
      state: recoveredState,
      storage,
      storageKey: 'study-state',
      fetchJson,
    });

    await Promise.resolve();
    assert.deepEqual(cloudWrites, ['2026-04-27']);

    firstSave.resolve({
      ok: false,
      status: 503,
      json: async () => ({ error: 'offline' }),
    });
    assert.equal(await failedSavePromise, LOCAL_ONLY);
    assert.equal(await recoveredSavePromise, CLOUD_SYNCED);
    assert.deepEqual(cloudWrites, ['2026-04-27', '2026-04-28']);
  } finally {
    firstSave.resolve({
      ok: true,
      json: async () => ({ state: failedState, updatedAt: '2026-04-27T00:00:00.000Z' }),
    });
    console.warn = originalWarn;
  }
});

test('saveStateEverywhere rejects invalid state before local or cloud writes', async () => {
  const storage = memoryStorage();
  const calls = [];
  const fetchJson = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({ state: savedState, updatedAt: '2026-04-28T00:00:00.000Z' }),
    };
  };

  await assert.rejects(
    () => saveStateEverywhere({
      state: { ...savedState, startedAt: '' },
      storage,
      storageKey: 'study-state',
      fetchJson,
    }),
    /Invalid study state/,
  );

  assert.deepEqual(storage.dump(), {});
  assert.equal(calls.length, 0);
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

test('saveStateEverywhere reports save failure when dirty metadata cannot persist before cloud failure', async () => {
  const backingStorage = memoryStorage();
  const storage = {
    getItem: backingStorage.getItem,
    setItem: (key, value) => {
      if (key === 'study-state:sync-metadata') {
        throw new Error('QuotaExceededError');
      }
      backingStorage.setItem(key, value);
    },
    dump: backingStorage.dump,
  };
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
    assert.equal(status, SAVE_FAILED);
  } finally {
    console.warn = originalWarn;
  }
});

test('loadInitialState preserves dirty local cache after a local-only save when cloud is stale', async () => {
  const storage = memoryStorage();
  const localNewerState = {
    ...savedState,
    wrongItems: [
      {
        id: 'manual-1',
        title: '手动错题',
        reason: '本地离线保存的进度',
        createdAt: '2026-04-28',
      },
    ],
  };
  const staleCloudState = { ...savedState, startedAt: '2026-04-27' };
  const fetchJson = async (url, options) => {
    if (url === '/api/state' && options?.method === 'PUT') {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'offline' }),
      };
    }
    return {
      ok: true,
      json: async () => ({ state: staleCloudState, updatedAt: '2026-04-27T00:00:00.000Z' }),
    };
  };
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const saveStatus = await saveStateEverywhere({
      state: localNewerState,
      storage,
      storageKey: 'study-state',
      fetchJson,
    });
    const loaded = await loadInitialState({
      storage,
      storageKey: 'study-state',
      createInitialState: () => ({ ...savedState, startedAt: '2026-04-26' }),
      fetchJson,
    });

    assert.equal(saveStatus, LOCAL_ONLY);
    assert.deepEqual(loaded.state, localNewerState);
    assert.equal(loaded.syncStatus, LOCAL_ONLY);
    assert.deepEqual(JSON.parse(storage.dump()['study-state']), localNewerState);
  } finally {
    console.warn = originalWarn;
  }
});

test('loadInitialState preserves dirty local save made while cloud load is in flight', async () => {
  const storage = memoryStorage({
    'study-state': JSON.stringify({ ...savedState, startedAt: '2026-04-27' }),
  });
  const cloudGet = deferred();
  const localNewerState = {
    ...savedState,
    wrongItems: [
      {
        id: 'manual-1',
        title: '手动错题',
        reason: '云端读取期间本地离线保存的进度',
        createdAt: '2026-04-28',
      },
    ],
  };
  const staleCloudState = { ...savedState, startedAt: '2026-04-26' };
  const fetchJson = async (url, options) => {
    if (url === '/api/state' && options?.method === 'PUT') {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'offline' }),
      };
    }
    return cloudGet.promise;
  };
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const loadPromise = loadInitialState({
      storage,
      storageKey: 'study-state',
      createInitialState: () => ({ ...savedState, startedAt: '2026-04-25' }),
      fetchJson,
    });
    await Promise.resolve();
    const saveStatus = await saveStateEverywhere({
      state: localNewerState,
      storage,
      storageKey: 'study-state',
      fetchJson,
    });

    cloudGet.resolve({
      ok: true,
      json: async () => ({ state: staleCloudState, updatedAt: '2026-04-26T00:00:00.000Z' }),
    });
    const loaded = await loadPromise;

    assert.equal(saveStatus, LOCAL_ONLY);
    assert.deepEqual(loaded.state, localNewerState);
    assert.equal(loaded.syncStatus, LOCAL_ONLY);
    assert.deepEqual(JSON.parse(storage.dump()['study-state']), localNewerState);
    assert.equal(JSON.parse(storage.dump()['study-state:sync-metadata']).dirty, true);
  } finally {
    cloudGet.resolve({
      ok: true,
      json: async () => ({ state: staleCloudState, updatedAt: '2026-04-26T00:00:00.000Z' }),
    });
    console.warn = originalWarn;
  }
});

test('older queued cloud success does not clear a newer dirty local save marker', async () => {
  const storage = memoryStorage();
  const firstSave = deferred();
  const secondSave = deferred();
  const olderState = { ...savedState, startedAt: '2026-04-27' };
  const newerState = {
    ...savedState,
    wrongItems: [
      {
        id: 'manual-1',
        title: '手动错题',
        reason: '第二次本地保存的进度',
        createdAt: '2026-04-28',
      },
    ],
  };
  const staleCloudState = { ...savedState, startedAt: '2026-04-26' };
  const cloudWrites = [];
  const fetchJson = async (url, options) => {
    if (url === '/api/state' && options?.method === 'PUT') {
      cloudWrites.push(JSON.parse(options.body).state.startedAt);
      if (cloudWrites.length === 1) return firstSave.promise;
      if (cloudWrites.length === 2) return secondSave.promise;
      throw new Error('unexpected extra cloud save');
    }
    return {
      ok: true,
      json: async () => ({ state: staleCloudState, updatedAt: '2026-04-26T00:00:00.000Z' }),
    };
  };

  try {
    const olderSavePromise = saveStateEverywhere({
      state: olderState,
      storage,
      storageKey: 'study-state',
      fetchJson,
    });
    saveStateEverywhere({
      state: newerState,
      storage,
      storageKey: 'study-state',
      fetchJson,
    });

    await Promise.resolve();
    firstSave.resolve({
      ok: true,
      json: async () => ({ state: olderState, updatedAt: '2026-04-27T00:00:00.000Z' }),
    });
    assert.equal(await olderSavePromise, CLOUD_SYNCED);
    await Promise.resolve();

    const loaded = await loadInitialState({
      storage,
      storageKey: 'study-state',
      createInitialState: () => ({ ...savedState, startedAt: '2026-04-25' }),
      fetchJson,
    });

    assert.deepEqual(loaded.state, newerState);
    assert.equal(loaded.syncStatus, LOCAL_ONLY);
    assert.deepEqual(JSON.parse(storage.dump()['study-state']), newerState);
  } finally {
    firstSave.resolve({
      ok: true,
      json: async () => ({ state: olderState, updatedAt: '2026-04-27T00:00:00.000Z' }),
    });
    secondSave.resolve({
      ok: true,
      json: async () => ({ state: newerState, updatedAt: '2026-04-28T00:00:00.000Z' }),
    });
  }
});

test('older cloud success after local write failure does not clear a newer dirty local save marker', async () => {
  const backingStorage = memoryStorage();
  let failNextStateWrite = true;
  const storage = {
    getItem: backingStorage.getItem,
    setItem: (key, value) => {
      if (key === 'study-state' && failNextStateWrite) {
        failNextStateWrite = false;
        throw new Error('QuotaExceededError');
      }
      backingStorage.setItem(key, value);
    },
    dump: backingStorage.dump,
  };
  const firstSave = deferred();
  const secondSave = deferred();
  const firstState = { ...savedState, startedAt: '2026-04-27' };
  const newerState = {
    ...savedState,
    wrongItems: [
      {
        id: 'manual-1',
        title: '手动错题',
        reason: '本地写入恢复后的进度',
        createdAt: '2026-04-28',
      },
    ],
  };
  const staleCloudState = { ...savedState, startedAt: '2026-04-26' };
  const cloudWrites = [];
  const fetchJson = async (url, options) => {
    if (url === '/api/state' && options?.method === 'PUT') {
      cloudWrites.push(JSON.parse(options.body).state.startedAt);
      if (cloudWrites.length === 1) return firstSave.promise;
      if (cloudWrites.length === 2) return secondSave.promise;
      throw new Error('unexpected extra cloud save');
    }
    return {
      ok: true,
      json: async () => ({ state: staleCloudState, updatedAt: '2026-04-26T00:00:00.000Z' }),
    };
  };
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const firstSavePromise = saveStateEverywhere({
      state: firstState,
      storage,
      storageKey: 'study-state',
      fetchJson,
    });
    saveStateEverywhere({
      state: newerState,
      storage,
      storageKey: 'study-state',
      fetchJson,
    });

    await Promise.resolve();
    firstSave.resolve({
      ok: true,
      json: async () => ({ state: firstState, updatedAt: '2026-04-27T00:00:00.000Z' }),
    });
    assert.equal(await firstSavePromise, CLOUD_ONLY);
    await Promise.resolve();

    const loaded = await loadInitialState({
      storage,
      storageKey: 'study-state',
      createInitialState: () => ({ ...savedState, startedAt: '2026-04-25' }),
      fetchJson,
    });

    assert.deepEqual(loaded.state, newerState);
    assert.equal(loaded.syncStatus, LOCAL_ONLY);
    assert.deepEqual(JSON.parse(storage.dump()['study-state']), newerState);
  } finally {
    firstSave.resolve({
      ok: true,
      json: async () => ({ state: firstState, updatedAt: '2026-04-27T00:00:00.000Z' }),
    });
    secondSave.resolve({
      ok: true,
      json: async () => ({ state: newerState, updatedAt: '2026-04-28T00:00:00.000Z' }),
    });
    console.warn = originalWarn;
  }
});

test('older cloud success does not clear dirty marker after newer metadata write failure', async () => {
  const backingStorage = memoryStorage();
  let metadataWrites = 0;
  const storage = {
    getItem: backingStorage.getItem,
    setItem: (key, value) => {
      if (key === 'study-state:sync-metadata') {
        metadataWrites += 1;
        if (metadataWrites === 2) {
          throw new Error('QuotaExceededError');
        }
      }
      backingStorage.setItem(key, value);
    },
    dump: backingStorage.dump,
  };
  const firstSave = deferred();
  const secondSave = deferred();
  const olderState = { ...savedState, startedAt: '2026-04-27' };
  const newerState = {
    ...savedState,
    wrongItems: [
      {
        id: 'manual-1',
        title: '手动错题',
        reason: '元数据写入失败后的本地进度',
        createdAt: '2026-04-29',
      },
    ],
  };
  const staleCloudState = { ...savedState, startedAt: '2026-04-26' };
  const cloudWrites = [];
  const fetchJson = async (url, options) => {
    if (url === '/api/state' && options?.method === 'PUT') {
      cloudWrites.push(JSON.parse(options.body).state);
      if (cloudWrites.length === 1) return firstSave.promise;
      if (cloudWrites.length === 2) return secondSave.promise;
      throw new Error('unexpected extra cloud save');
    }
    return {
      ok: true,
      json: async () => ({ state: staleCloudState, updatedAt: '2026-04-26T00:00:00.000Z', version: 1 }),
    };
  };
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const olderSavePromise = saveStateEverywhere({
      state: olderState,
      storage,
      storageKey: 'study-state',
      fetchJson,
    });
    const newerSavePromise = saveStateEverywhere({
      state: newerState,
      storage,
      storageKey: 'study-state',
      fetchJson,
    });

    await Promise.resolve();
    firstSave.resolve({
      ok: true,
      json: async () => ({ state: olderState, updatedAt: '2026-04-27T00:00:00.000Z', version: 2 }),
    });
    assert.equal(await olderSavePromise, CLOUD_SYNCED);

    secondSave.resolve({
      ok: false,
      status: 503,
      json: async () => ({ error: 'offline' }),
    });
    assert.equal(await newerSavePromise, SAVE_FAILED);

    const loaded = await loadInitialState({
      storage,
      storageKey: 'study-state',
      createInitialState: () => ({ ...savedState, startedAt: '2026-04-25' }),
      fetchJson,
    });

    assert.deepEqual(loaded.state, newerState);
    assert.equal(loaded.syncStatus, LOCAL_ONLY);
    assert.deepEqual(JSON.parse(storage.dump()['study-state']), newerState);
  } finally {
    firstSave.resolve({
      ok: true,
      json: async () => ({ state: olderState, updatedAt: '2026-04-27T00:00:00.000Z', version: 2 }),
    });
    secondSave.resolve({
      ok: true,
      json: async () => ({ state: newerState, updatedAt: '2026-04-29T00:00:00.000Z', version: 3 }),
    });
    console.warn = originalWarn;
  }
});

test('saveStateEverywhere reports cloud-only when local cache write fails', async () => {
  const warnings = [];
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  const calls = [];
  const fetchJson = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({ state: savedState, updatedAt: '2026-04-28T00:00:00.000Z' }),
    };
  };
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args);
  };

  try {
    const status = await saveStateEverywhere({
      state: savedState,
      storage,
      storageKey: 'study-state',
      fetchJson,
    });

    assert.equal(status, CLOUD_ONLY);
    assert.equal(calls[0].url, '/api/state');
    assert.equal(warnings[0][0], 'Local cache write failed before cloud save.');
    assert.match(String(warnings[0][1]), /QuotaExceededError/);
  } finally {
    console.warn = originalWarn;
  }
});

test('saveStateEverywhere reports cloud failure after local cache write fails', async () => {
  const warnings = [];
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  const calls = [];
  const fetchJson = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: false,
      status: 503,
      json: async () => ({ error: 'Database unavailable' }),
    };
  };
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args);
  };

  try {
    const status = await saveStateEverywhere({
      state: savedState,
      storage,
      storageKey: 'study-state',
      fetchJson,
    });

    assert.equal(status, SAVE_FAILED);
    assert.equal(calls[0].url, '/api/state');
    assert.equal(warnings[0][0], 'Local cache write failed before cloud save.');
    assert.match(String(warnings[0][1]), /QuotaExceededError/);
    assert.equal(warnings[1][0], 'Cloud state save failed after local cache write failed.');
    assert.match(String(warnings[1][1]), /Database unavailable/);
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

test('saveStateEverywhere sends latest loaded cloud version and preserves local cache on conflict', async () => {
  const storage = memoryStorage({
    'study-state': JSON.stringify({ ...savedState, startedAt: '2026-04-27' }),
  });
  const loadedCloudState = { ...savedState, startedAt: '2026-04-28' };
  const localConflictState = { ...savedState, startedAt: '2026-04-29' };
  const calls = [];
  const fetchJson = async (url, options) => {
    calls.push({ url, options });
    if (options?.method === 'PUT') {
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'Study state conflict' }),
      };
    }
    return {
      ok: true,
      json: async () => ({ state: loadedCloudState, updatedAt: '2026-04-28T00:00:00.000Z', version: 7 }),
    };
  };
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const loaded = await loadInitialState({
      storage,
      storageKey: 'study-state',
      createInitialState: () => ({ ...savedState, startedAt: '2026-04-26' }),
      fetchJson,
    });
    const status = await saveStateEverywhere({
      state: localConflictState,
      storage,
      storageKey: 'study-state',
      fetchJson,
    });

    const putBody = JSON.parse(calls.find((call) => call.options?.method === 'PUT').options.body);
    assert.equal(loaded.syncStatus, CLOUD_SYNCED);
    assert.equal(putBody.expectedVersion, 7);
    assert.equal(status, LOCAL_ONLY);
    assert.deepEqual(JSON.parse(storage.dump()['study-state']), localConflictState);
    assert.equal(JSON.parse(storage.dump()['study-state:sync-metadata']).dirty, true);
  } finally {
    console.warn = originalWarn;
  }
});

test('saveStateEverywhere sends expectedVersion 0 after loading an empty cloud row', async () => {
  const storage = memoryStorage();
  const calls = [];
  const fetchJson = async (url, options) => {
    calls.push({ url, options });
    if (options?.method === 'PUT') {
      return {
        ok: true,
        json: async () => ({ state: savedState, updatedAt: '2026-04-28T00:00:00.000Z', version: 1 }),
      };
    }
    return {
      ok: true,
      json: async () => ({ state: null, updatedAt: null, version: null }),
    };
  };

  const loaded = await loadInitialState({
    storage,
    storageKey: 'study-state',
    createInitialState: () => ({ ...savedState, startedAt: '2026-04-26' }),
    fetchJson,
  });
  const status = await saveStateEverywhere({
    state: savedState,
    storage,
    storageKey: 'study-state',
    fetchJson,
  });

  const putBody = JSON.parse(calls.find((call) => call.options?.method === 'PUT').options.body);
  assert.equal(loaded.syncStatus, LOCAL_ONLY);
  assert.equal(putBody.expectedVersion, 0);
  assert.equal(status, CLOUD_SYNCED);
});

test('saveStateEverywhere preserves expectedVersion for dirty conflict retry after reload', async () => {
  const storage = memoryStorage();
  const loadedCloudState = { ...savedState, startedAt: '2026-04-28' };
  const localConflictState = { ...savedState, startedAt: '2026-04-29' };
  const retryState = { ...savedState, startedAt: '2026-04-30' };
  const initialCalls = [];
  const initialFetchJson = async (url, options) => {
    initialCalls.push({ url, options });
    if (options?.method === 'PUT') {
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'Study state conflict' }),
      };
    }
    return {
      ok: true,
      json: async () => ({ state: loadedCloudState, updatedAt: '2026-04-28T00:00:00.000Z', version: 7 }),
    };
  };
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    await loadInitialState({
      storage,
      storageKey: 'study-state',
      createInitialState: () => ({ ...savedState, startedAt: '2026-04-26' }),
      fetchJson: initialFetchJson,
    });
    assert.equal(await saveStateEverywhere({
      state: localConflictState,
      storage,
      storageKey: 'study-state',
      fetchJson: initialFetchJson,
    }), LOCAL_ONLY);

    const reloadedStorage = memoryStorage(storage.dump());
    const retryCalls = [];
    const retryFetchJson = async (url, options) => {
      retryCalls.push({ url, options });
      if (options?.method === 'PUT') {
        return {
          ok: true,
          json: async () => ({ state: retryState, updatedAt: '2026-04-30T00:00:00.000Z', version: 8 }),
        };
      }
      throw new Error('dirty local state should skip cloud load after reload');
    };

    const loadedAfterReload = await loadInitialState({
      storage: reloadedStorage,
      storageKey: 'study-state',
      createInitialState: () => ({ ...savedState, startedAt: '2026-04-26' }),
      fetchJson: retryFetchJson,
    });
    const retryStatus = await saveStateEverywhere({
      state: retryState,
      storage: reloadedStorage,
      storageKey: 'study-state',
      fetchJson: retryFetchJson,
    });

    const retryPutBody = JSON.parse(retryCalls.find((call) => call.options?.method === 'PUT').options.body);
    assert.deepEqual(loadedAfterReload.state, localConflictState);
    assert.equal(loadedAfterReload.syncStatus, LOCAL_ONLY);
    assert.equal(retryPutBody.expectedVersion, 7);
    assert.equal(retryStatus, CLOUD_SYNCED);
  } finally {
    console.warn = originalWarn;
  }
});

test('saveStateEverywhere keeps dirty base version when in-flight cloud load returns newer version', async () => {
  const storage = memoryStorage({
    'study-state': JSON.stringify({ ...savedState, startedAt: '2026-04-27' }),
    'study-state:sync-metadata': JSON.stringify({
      dirty: false,
      saveId: 'synced-save',
      cloudVersion: 7,
      updatedAt: '2026-04-27T00:00:00.000Z',
    }),
  });
  const cloudGet = deferred();
  const localDirtyState = { ...savedState, startedAt: '2026-04-29' };
  const retryState = { ...savedState, startedAt: '2026-04-30' };
  const putBodies = [];
  const fetchJson = async (url, options) => {
    if (options?.method === 'PUT') {
      putBodies.push(JSON.parse(options.body));
      if (putBodies.length === 1) {
        return {
          ok: false,
          status: 409,
          json: async () => ({ error: 'Study state conflict' }),
        };
      }
      return {
        ok: true,
        json: async () => ({ state: retryState, updatedAt: '2026-04-30T00:00:00.000Z', version: 8 }),
      };
    }
    return cloudGet.promise;
  };
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const loadPromise = loadInitialState({
      storage,
      storageKey: 'study-state',
      createInitialState: () => ({ ...savedState, startedAt: '2026-04-26' }),
      fetchJson,
    });
    await Promise.resolve();
    assert.equal(await saveStateEverywhere({
      state: localDirtyState,
      storage,
      storageKey: 'study-state',
      fetchJson,
    }), LOCAL_ONLY);

    cloudGet.resolve({
      ok: true,
      json: async () => ({ state: { ...savedState, startedAt: '2026-04-28' }, updatedAt: '2026-04-28T00:00:00.000Z', version: 8 }),
    });
    const loaded = await loadPromise;
    assert.deepEqual(loaded.state, localDirtyState);
    assert.equal(loaded.syncStatus, LOCAL_ONLY);

    assert.equal(await saveStateEverywhere({
      state: retryState,
      storage,
      storageKey: 'study-state',
      fetchJson,
    }), CLOUD_SYNCED);

    assert.equal(putBodies[0].expectedVersion, 7);
    assert.equal(putBodies[1].expectedVersion, 7);
  } finally {
    cloudGet.resolve({
      ok: true,
      json: async () => ({ state: savedState, updatedAt: '2026-04-28T00:00:00.000Z', version: 8 }),
    });
    console.warn = originalWarn;
  }
});
