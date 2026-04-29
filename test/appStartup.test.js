import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import * as persistence from '../src/persistence.js';
import { createStartupLoadController } from '../src/startupLoad.js';

const existingLocalState = {
  cards: [],
  plan: [],
  wrongItems: [
    {
      id: 'existing-1',
      title: '既有错题',
      reason: '启动前已保存在本地的进度',
      createdAt: '2026-04-27',
    },
  ],
  startedAt: '2026-04-27',
};

const earlyMutation = {
  id: 'manual-1',
  title: '手动错题',
  reason: '云端加载完成前新增的错题',
  createdAt: '2026-04-28',
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
  const promise = new Promise((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

test('startup local hydration preserves existing progress plus early user mutation before cloud resolves', async () => {
  assert.equal(typeof persistence.loadLocalState, 'function');

  const storage = memoryStorage({
    'study-state': JSON.stringify(existingLocalState),
  });
  const startupLoad = createStartupLoadController();
  const cloudGet = deferred();
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
    let state = persistence.loadLocalState({
      storage,
      storageKey: 'study-state',
      createInitialState: () => ({ cards: [], plan: [], wrongItems: [], startedAt: '2026-04-26' }),
    });
    const loadPromise = persistence.loadInitialState({
      storage,
      storageKey: 'study-state',
      createInitialState: () => ({ cards: [], plan: [], wrongItems: [], startedAt: '2026-04-26' }),
      fetchJson,
      shouldCacheLoadedState: () => startupLoad.shouldApplyLoadedState(),
    });

    startupLoad.recordUserMutation();
    state = {
      ...state,
      wrongItems: [earlyMutation, ...state.wrongItems],
    };
    await persistence.saveStateEverywhere({
      state,
      storage,
      storageKey: 'study-state',
      fetchJson,
    });

    cloudGet.resolve({
      ok: true,
      json: async () => ({
        state: { cards: [], plan: [], wrongItems: [], startedAt: '2026-04-26' },
        updatedAt: '2026-04-26T00:00:00.000Z',
      }),
    });
    const loaded = await loadPromise;
    const completed = startupLoad.completeLoad({ currentState: state, loaded });

    assert.deepEqual(completed.state.wrongItems, [earlyMutation, existingLocalState.wrongItems[0]]);
    assert.deepEqual(JSON.parse(storage.dump()['study-state']).wrongItems, [
      earlyMutation,
      existingLocalState.wrongItems[0],
    ]);
  } finally {
    console.warn = originalWarn;
  }
});

test('app synchronously hydrates local state before the first render', async () => {
  const appSource = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');

  assert.match(appSource, /loadLocalState/, 'expected app to import synchronous local hydration');
  assert.match(
    appSource,
    /let\s+state\s*=\s*loadLocalState\(\{[\s\S]*?storageKey:\s*STORAGE_KEY[\s\S]*?createInitialState:\s*initialState[\s\S]*?\}\);/,
    'expected app state to start from local cache before renderAll() makes UI interactive',
  );
  assert.ok(
    appSource.indexOf('let state = loadLocalState') < appSource.indexOf('async function start()'),
    'expected synchronous hydration to happen before start() calls renderAll()',
  );
});
