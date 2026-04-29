import { validateStudyState } from './stateSchema.js';

export const CLOUD_SYNCED = 'cloud-synced';
export const CLOUD_ONLY = 'cloud-only';
export const CLOUD_LOAD_FAILED = 'cloud-load-failed';
export const LOCAL_ONLY = 'local-only';
export const SAVE_FAILED = 'save-failed';

function localSyncMetadataKey(storageKey) {
  return `${storageKey}:sync-metadata`;
}

let localSaveSequence = 0;
let latestLocalSaveAttemptId = null;
const cloudVersionsByStorage = new WeakMap();

function nextLocalSaveId() {
  localSaveSequence += 1;
  const uniqueSuffix = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${Date.now()}-${localSaveSequence}-${uniqueSuffix}`;
}

function readLocalState({ storage, storageKey, createInitialState }) {
  let saved;
  try {
    saved = storage.getItem(storageKey);
  } catch (error) {
    console.warn('Local study state is invalid; starting from a fresh state.', error);
    return { state: createInitialState(), hasValidLocalState: false };
  }
  if (!saved) return { state: createInitialState(), hasValidLocalState: false };

  try {
    return { state: validateStudyState(JSON.parse(saved)), hasValidLocalState: true };
  } catch (error) {
    console.warn('Local study state is invalid; starting from a fresh state.', error);
    return { state: createInitialState(), hasValidLocalState: false };
  }
}

function writeLocalState({ state, storage, storageKey }) {
  storage.setItem(storageKey, JSON.stringify(state));
}

function readLocalSyncMetadata({ storage, storageKey }) {
  let saved;
  try {
    saved = storage.getItem(localSyncMetadataKey(storageKey));
  } catch (error) {
    console.warn('Local sync metadata is invalid; treating local cache as local-only.', error);
    return { dirty: true, unreadable: true };
  }
  if (!saved) return { dirty: false };

  try {
    const metadata = JSON.parse(saved);
    const hasCloudVersion = Object.hasOwn(metadata ?? {}, 'cloudVersion');
    const cloudVersion = metadata?.cloudVersion;
    return {
      dirty: metadata?.dirty === true,
      saveId: typeof metadata?.saveId === 'string' ? metadata.saveId : undefined,
      cloudVersionKnown: hasCloudVersion && (Number.isInteger(cloudVersion) || cloudVersion === null),
      cloudVersion,
    };
  } catch (error) {
    console.warn('Local sync metadata is invalid; treating local cache as local-only.', error);
    return { dirty: true, unreadable: true };
  }
}

function writeLocalSyncMetadata({
  dirty,
  saveId,
  cloudVersion,
  cloudVersionKnown = false,
  storage,
  storageKey,
}) {
  const metadata = {
    dirty,
    saveId,
    updatedAt: new Date().toISOString(),
  };
  if (cloudVersionKnown) {
    metadata.cloudVersion = cloudVersion;
  }
  storage.setItem(localSyncMetadataKey(storageKey), JSON.stringify(metadata));
}

function markLocalDirty({ saveId, storage, storageKey }) {
  try {
    const currentMetadata = readLocalSyncMetadata({ storage, storageKey });
    const knownCloudVersion = getKnownCloudVersion({ storage, storageKey });
    const preserveDirtyBaseVersion = currentMetadata.dirty && currentMetadata.cloudVersionKnown;
    writeLocalSyncMetadata({
      dirty: true,
      saveId,
      cloudVersion: preserveDirtyBaseVersion || !knownCloudVersion.known
        ? currentMetadata.cloudVersion
        : knownCloudVersion.version,
      cloudVersionKnown: preserveDirtyBaseVersion || knownCloudVersion.known || currentMetadata.cloudVersionKnown,
      storage,
      storageKey,
    });
  } catch (error) {
    console.warn('Local sync metadata update failed.', error);
    return false;
  }
  return true;
}

function markLocalClean({ expectedSaveId, rememberCloudVersion = true, storage, storageKey }) {
  try {
    const currentMetadata = readLocalSyncMetadata({ storage, storageKey });
    if (expectedSaveId && currentMetadata.dirty && currentMetadata.saveId !== expectedSaveId) {
      const dirtySaveBelongsToThisContext = latestLocalSaveAttemptId === currentMetadata.saveId;
      if (rememberCloudVersion && !dirtySaveBelongsToThisContext) {
        return true;
      }
    }
    if (expectedSaveId && latestLocalSaveAttemptId && latestLocalSaveAttemptId !== expectedSaveId) {
      if (currentMetadata.dirty) {
        const knownCloudVersion = getKnownCloudVersion({ storage, storageKey });
        writeLocalSyncMetadata({
          dirty: true,
          saveId: currentMetadata.saveId,
          cloudVersion: knownCloudVersion.known ? knownCloudVersion.version : currentMetadata.cloudVersion,
          cloudVersionKnown: knownCloudVersion.known || currentMetadata.cloudVersionKnown,
          storage,
          storageKey,
        });
      }
      return true;
    }
    const knownCloudVersion = getKnownCloudVersion({ storage, storageKey });
    const shouldRememberCloudVersion = rememberCloudVersion && knownCloudVersion.known;
    if (!rememberCloudVersion && !currentMetadata.dirty) {
      return true;
    }
    writeLocalSyncMetadata({
      dirty: false,
      saveId: expectedSaveId ?? currentMetadata.saveId,
      cloudVersion: shouldRememberCloudVersion ? knownCloudVersion.version : currentMetadata.cloudVersion,
      cloudVersionKnown: shouldRememberCloudVersion || (!rememberCloudVersion ? false : currentMetadata.cloudVersionKnown),
      storage,
      storageKey,
    });
  } catch (error) {
    console.warn('Local sync metadata update failed.', error);
    return false;
  }
  return true;
}

function setKnownCloudVersion({ storage, storageKey, version }) {
  if (version !== null && !Number.isInteger(version)) return;
  let storageVersions = cloudVersionsByStorage.get(storage);
  if (!storageVersions) {
    storageVersions = new Map();
    cloudVersionsByStorage.set(storage, storageVersions);
  }
  storageVersions.set(storageKey, Number.isInteger(version) ? version : null);
}

function getKnownCloudVersion({ storage, storageKey }) {
  const storageVersions = cloudVersionsByStorage.get(storage);
  if (!storageVersions?.has(storageKey)) return { known: false, version: undefined };
  return { known: true, version: storageVersions.get(storageKey) };
}

function getCloudVersionForSave({ storage, storageKey }) {
  const metadata = readLocalSyncMetadata({ storage, storageKey });
  if (metadata.dirty && metadata.cloudVersionKnown) {
    setKnownCloudVersion({ storage, storageKey, version: metadata.cloudVersion });
    return { known: true, version: metadata.cloudVersion };
  }
  const knownCloudVersion = getKnownCloudVersion({ storage, storageKey });
  if (knownCloudVersion.known) return knownCloudVersion;
  if (metadata.cloudVersionKnown) {
    setKnownCloudVersion({ storage, storageKey, version: metadata.cloudVersion });
    return { known: true, version: metadata.cloudVersion };
  }
  return { known: false, version: undefined };
}

export function loadLocalState({
  storage = localStorage,
  storageKey,
  createInitialState,
} = {}) {
  return readLocalState({ storage, storageKey, createInitialState }).state;
}

// Preserve the exact save-call snapshot until its queued cloud write runs.
function cloneStudyState(state) {
  return JSON.parse(JSON.stringify(state));
}

async function readResponseJson(response) {
  if (!response.ok) {
    const detail = `Request failed with status ${response.status}`;
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(detail);
    }
    throw new Error(payload?.error ?? detail);
  }
  return response.json();
}

export async function loadInitialState({
  storage = localStorage,
  storageKey,
  createInitialState,
  fetchJson = fetch,
  shouldCacheLoadedState = () => true,
} = {}) {
  const localCache = readLocalState({ storage, storageKey, createInitialState });
  const localState = localCache.state;
  const localSyncMetadata = readLocalSyncMetadata({ storage, storageKey });

  if (localCache.hasValidLocalState && localSyncMetadata.dirty) {
    return { state: localState, syncStatus: LOCAL_ONLY };
  }

  try {
    const response = await fetchJson('/api/state');
    const payload = await readResponseJson(response);
    if (payload.state != null) {
      let cloudState;
      try {
        cloudState = validateStudyState(payload.state);
      } catch (error) {
        console.warn('Cloud state failed schema validation; using local cache.', error);
        return { state: localState, syncStatus: CLOUD_LOAD_FAILED };
      }
      setKnownCloudVersion({ storage, storageKey, version: payload.version });
      const freshLocalSyncMetadata = readLocalSyncMetadata({ storage, storageKey });
      if (freshLocalSyncMetadata.dirty) {
        const freshLocalCache = readLocalState({ storage, storageKey, createInitialState });
        if (freshLocalCache.hasValidLocalState) {
          return { state: freshLocalCache.state, syncStatus: LOCAL_ONLY };
        }
      }
      const shouldCache = shouldCacheLoadedState({ state: cloudState, localState });
      let localWriteSucceeded = true;
      if (shouldCache) {
        try {
          writeLocalState({ state: cloudState, storage, storageKey });
          markLocalClean({ storage, storageKey });
        } catch (error) {
          localWriteSucceeded = false;
          console.warn('Cloud state loaded but local cache update failed.', error);
        }
      }
      return { state: cloudState, syncStatus: shouldCache && localWriteSucceeded ? CLOUD_SYNCED : CLOUD_ONLY };
    }
    setKnownCloudVersion({ storage, storageKey, version: payload.version });
    return { state: localState, syncStatus: LOCAL_ONLY };
  } catch (error) {
    console.warn('Cloud state load failed; using local cache.', error);
    return { state: localState, syncStatus: CLOUD_LOAD_FAILED };
  }
}

async function saveCloudState({
  state,
  storage,
  storageKey,
  fetchJson,
  localWriteSucceeded,
  localDirtyMetadataSucceeded,
  localSaveId,
}) {
  try {
    const expectedVersion = getCloudVersionForSave({ storage, storageKey });
    const requestBody = {
      state,
      expectedVersion: expectedVersion.known ? expectedVersion.version ?? 0 : 0,
    };
    const response = await fetchJson('/api/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    const payload = await readResponseJson(response);
    setKnownCloudVersion({ storage, storageKey, version: payload.version });
    const localCleanMetadataSucceeded = markLocalClean({
      expectedSaveId: localSaveId,
      rememberCloudVersion: localWriteSucceeded,
      storage,
      storageKey,
    });
    if (!localWriteSucceeded && !localCleanMetadataSucceeded) {
      return SAVE_FAILED;
    }
    return localWriteSucceeded ? CLOUD_SYNCED : CLOUD_ONLY;
  } catch (error) {
    if (localWriteSucceeded && localDirtyMetadataSucceeded) {
      console.warn('Cloud state save failed; local cache is preserved.', error);
      return LOCAL_ONLY;
    }
    console.warn('Cloud state save failed after local cache write failed.', error);
    return SAVE_FAILED;
  }
}

let stateSaveQueue = Promise.resolve();

export async function saveStateEverywhere({
  state,
  storage = localStorage,
  storageKey,
  fetchJson = fetch,
} = {}) {
  const validState = cloneStudyState(validateStudyState(state));
  let localWriteSucceeded = true;
  let localDirtyMetadataSucceeded = false;
  const localSaveId = nextLocalSaveId();
  latestLocalSaveAttemptId = localSaveId;
  try {
    writeLocalState({ state: validState, storage, storageKey });
    localDirtyMetadataSucceeded = markLocalDirty({ saveId: localSaveId, storage, storageKey });
  } catch (error) {
    localWriteSucceeded = false;
    console.warn('Local cache write failed before cloud save.', error);
  }

  const queuedSave = stateSaveQueue.then(() => saveCloudState({
    state: validState,
    storage,
    storageKey,
    fetchJson,
    localWriteSucceeded,
    localDirtyMetadataSucceeded,
    localSaveId,
  }));
  stateSaveQueue = queuedSave.catch(() => undefined);
  return queuedSave;
}
