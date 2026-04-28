import test from 'node:test';
import assert from 'node:assert/strict';

import { CLOUD_LOAD_FAILED, CLOUD_SYNCED } from '../src/persistence.js';
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
