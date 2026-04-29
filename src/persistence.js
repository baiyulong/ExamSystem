import { validateStudyState } from './stateSchema.js';

export const CLOUD_SYNCED = 'cloud-synced';
export const CLOUD_ONLY = 'cloud-only';
export const CLOUD_LOAD_FAILED = 'cloud-load-failed';
export const CLOUD_CONFLICT = 'cloud-conflict';
export const LOCAL_ONLY = 'local-only';
export const SAVE_FAILED = 'save-failed';

class HttpResponseError extends Error {
  constructor(message, { status }) {
    super(message);
    this.name = 'HttpResponseError';
    this.status = status;
  }
}

function localSyncMetadataKey(storageKey) {
  return `${storageKey}:sync-metadata`;
}

function localDirtyFallbackKey(storageKey) {
  return `${storageKey}:dirty-fallback`;
}

let localSaveSequence = 0;
let latestLocalSaveAttemptId = null;
const localSaveIds = new Set();
const cloudVersionsByStorage = new WeakMap();

function nextLocalSaveId() {
  localSaveSequence += 1;
  const uniqueSuffix = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  const saveId = `${Date.now()}-${localSaveSequence}-${uniqueSuffix}`;
  localSaveIds.add(saveId);
  return saveId;
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

function restoreLocalState({ previousState, storage, storageKey }) {
  if (previousState == null) {
    if (typeof storage.removeItem === 'function') {
      storage.removeItem(storageKey);
      return;
    }
    storage.setItem(storageKey, '');
    return;
  }
  storage.setItem(storageKey, previousState);
}

function readLocalSyncMetadata({ storage, storageKey }) {
  const fallbackMetadata = readLocalDirtyFallback({ storage, storageKey });
  let saved;
  try {
    saved = storage.getItem(localSyncMetadataKey(storageKey));
  } catch (error) {
    console.warn('Local sync metadata is invalid; treating local cache as local-only.', error);
    return { dirty: true, unreadable: true };
  }
  if (!saved) return fallbackMetadata ?? { dirty: false };

  try {
    const metadata = JSON.parse(saved);
    const hasCloudVersion = Object.hasOwn(metadata ?? {}, 'cloudVersion');
    const cloudVersion = metadata?.cloudVersion;
    const parsedMetadata = {
      dirty: metadata?.dirty === true,
      saveId: typeof metadata?.saveId === 'string' ? metadata.saveId : undefined,
      cloudVersionKnown: hasCloudVersion && (Number.isInteger(cloudVersion) || cloudVersion === null),
      cloudVersion,
      conflict: metadata?.conflict === true,
    };
    if (fallbackMetadata?.dirty
      && (!parsedMetadata.dirty || parsedMetadata.saveId !== fallbackMetadata.saveId)) {
      return fallbackMetadata;
    }
    return parsedMetadata;
  } catch (error) {
    console.warn('Local sync metadata is invalid; treating local cache as local-only.', error);
    return { dirty: true, unreadable: true };
  }
}

function readLocalDirtyFallback({ storage, storageKey }) {
  let saved;
  try {
    saved = storage.getItem(localDirtyFallbackKey(storageKey));
  } catch (error) {
    console.warn('Local sync fallback metadata is invalid; treating local cache as local-only.', error);
    return { dirty: true, unreadable: true };
  }
  if (!saved) return null;

  try {
    const metadata = JSON.parse(saved);
    const hasCloudVersion = Object.hasOwn(metadata ?? {}, 'cloudVersion');
    const cloudVersion = metadata?.cloudVersion;
    return {
      dirty: metadata?.dirty === true,
      saveId: typeof metadata?.saveId === 'string' ? metadata.saveId : undefined,
      cloudVersionKnown: hasCloudVersion && (Number.isInteger(cloudVersion) || cloudVersion === null),
      cloudVersion,
      conflict: metadata?.conflict === true,
    };
  } catch (error) {
    console.warn('Local sync fallback metadata is invalid; treating local cache as local-only.', error);
    return { dirty: true, unreadable: true };
  }
}

function writeLocalSyncMetadata({
  dirty,
  saveId,
  cloudVersion,
  cloudVersionKnown = false,
  conflict = false,
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
  if (conflict) {
    metadata.conflict = true;
  }
  storage.setItem(localSyncMetadataKey(storageKey), JSON.stringify(metadata));
}

function writeLocalDirtyFallback({
  saveId,
  cloudVersion,
  cloudVersionKnown = false,
  conflict = false,
  storage,
  storageKey,
}) {
  const metadata = {
    dirty: true,
    saveId,
    updatedAt: new Date().toISOString(),
  };
  if (cloudVersionKnown) {
    metadata.cloudVersion = cloudVersion;
  }
  if (conflict) {
    metadata.conflict = true;
  }
  storage.setItem(localDirtyFallbackKey(storageKey), JSON.stringify(metadata));
}

function clearLocalDirtyFallback({ storage, storageKey }) {
  if (typeof storage.removeItem === 'function') {
    storage.removeItem(localDirtyFallbackKey(storageKey));
    return;
  }
  storage.setItem(localDirtyFallbackKey(storageKey), '');
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
    try {
      const currentMetadata = readLocalSyncMetadata({ storage, storageKey });
      const knownCloudVersion = getKnownCloudVersion({ storage, storageKey });
      const preserveDirtyBaseVersion = currentMetadata.dirty && currentMetadata.cloudVersionKnown;
      writeLocalDirtyFallback({
        saveId,
        cloudVersion: preserveDirtyBaseVersion || !knownCloudVersion.known
          ? currentMetadata.cloudVersion
          : knownCloudVersion.version,
        cloudVersionKnown: preserveDirtyBaseVersion || knownCloudVersion.known || currentMetadata.cloudVersionKnown,
        storage,
        storageKey,
      });
      return true;
    } catch (fallbackError) {
      console.warn('Local sync fallback metadata update failed.', fallbackError);
    }
    return false;
  }
  return true;
}

function preserveLocalOnlyState({ state, saveId, storage, storageKey }) {
  try {
    const currentMetadata = readLocalSyncMetadata({ storage, storageKey });
    if (currentMetadata.dirty && currentMetadata.saveId !== saveId) {
      return false;
    }
    writeLocalState({ state, storage, storageKey });
    return markLocalDirty({ saveId, storage, storageKey });
  } catch (error) {
    console.warn('Local cache recovery failed after cloud save failure.', error);
    return false;
  }
}

function markLocalConflict({
  saveId,
  cloudVersion,
  cloudVersionKnown = false,
  storage,
  storageKey,
}) {
  try {
    writeLocalSyncMetadata({
      dirty: true,
      saveId,
      cloudVersion,
      cloudVersionKnown,
      conflict: true,
      storage,
      storageKey,
    });
    return true;
  } catch (error) {
    console.warn('Local sync metadata update failed.', error);
    try {
      writeLocalDirtyFallback({
        saveId,
        cloudVersion,
        cloudVersionKnown,
        conflict: true,
        storage,
        storageKey,
      });
      return true;
    } catch (fallbackError) {
      console.warn('Local sync fallback metadata update failed.', fallbackError);
      return false;
    }
  }
}

function preserveConflictedLocalState({
  state,
  saveId,
  cloudVersion,
  cloudVersionKnown = false,
  storage,
  storageKey,
}) {
  try {
    const currentMetadata = readLocalSyncMetadata({ storage, storageKey });
    if (currentMetadata.dirty && currentMetadata.saveId !== saveId) {
      return false;
    }
    writeLocalState({ state, storage, storageKey });
    return markLocalConflict({
      saveId,
      cloudVersion,
      cloudVersionKnown,
      storage,
      storageKey,
    });
  } catch (error) {
    console.warn('Local cache recovery failed after cloud conflict.', error);
    return false;
  }
}

function markLocalClean({ expectedSaveId, rememberCloudVersion = true, storage, storageKey }) {
  try {
    const currentMetadata = readLocalSyncMetadata({ storage, storageKey });
    if (expectedSaveId && currentMetadata.dirty && currentMetadata.saveId !== expectedSaveId) {
      const dirtySaveBelongsToThisContext = localSaveIds.has(currentMetadata.saveId);
      if (!dirtySaveBelongsToThisContext) {
        return { ok: true, staleCompletion: false };
      }
    }
    if (expectedSaveId && latestLocalSaveAttemptId && latestLocalSaveAttemptId !== expectedSaveId) {
      let staleCompletion = false;
      if (currentMetadata.dirty) {
        staleCompletion = true;
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
      return { ok: true, staleCompletion };
    }
    const knownCloudVersion = getKnownCloudVersion({ storage, storageKey });
    const shouldRememberCloudVersion = rememberCloudVersion && knownCloudVersion.known;
    if (!rememberCloudVersion && !currentMetadata.dirty) {
      return { ok: true, staleCompletion: false };
    }
    writeLocalSyncMetadata({
      dirty: false,
      saveId: expectedSaveId ?? currentMetadata.saveId,
      cloudVersion: shouldRememberCloudVersion ? knownCloudVersion.version : currentMetadata.cloudVersion,
      cloudVersionKnown: shouldRememberCloudVersion || (!rememberCloudVersion ? false : currentMetadata.cloudVersionKnown),
      storage,
      storageKey,
    });
    clearLocalDirtyFallback({ storage, storageKey });
  } catch (error) {
    console.warn('Local sync metadata update failed.', error);
    return { ok: false, staleCompletion: false };
  }
  return { ok: true, staleCompletion: false };
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
      throw new HttpResponseError(detail, { status: response.status });
    }
    throw new HttpResponseError(payload?.error ?? detail, { status: response.status });
  }
  return response.json();
}

async function refreshCloudVersionAfterConflict({ fetchJson, storage, storageKey }) {
  const response = await fetchJson('/api/state');
  const payload = await readResponseJson(response);
  setKnownCloudVersion({ storage, storageKey, version: payload.version });
  return {
    known: true,
    version: Number.isInteger(payload.version) ? payload.version : null,
  };
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
    return { state: localState, syncStatus: localSyncMetadata.conflict ? CLOUD_CONFLICT : LOCAL_ONLY };
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
          return {
            state: freshLocalCache.state,
            syncStatus: freshLocalSyncMetadata.conflict ? CLOUD_CONFLICT : LOCAL_ONLY,
          };
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
    if (!localWriteSucceeded && !localCleanMetadataSucceeded.ok) {
      return SAVE_FAILED;
    }
    if (localCleanMetadataSucceeded.staleCompletion) {
      return LOCAL_ONLY;
    }
    return localWriteSucceeded ? CLOUD_SYNCED : CLOUD_ONLY;
  } catch (error) {
    if (error.status === 409 && localWriteSucceeded && localDirtyMetadataSucceeded) {
      let latestCloudVersion = { known: false, version: undefined };
      try {
        latestCloudVersion = await refreshCloudVersionAfterConflict({ fetchJson, storage, storageKey });
      } catch (refreshError) {
        console.warn('Cloud conflict detected but latest cloud version could not be loaded.', refreshError);
      }
      if (preserveConflictedLocalState({
        state,
        saveId: localSaveId,
        cloudVersion: latestCloudVersion.version,
        cloudVersionKnown: latestCloudVersion.known,
        storage,
        storageKey,
      })) {
        console.warn('Cloud state save conflicted; local cache is preserved.', error);
        return CLOUD_CONFLICT;
      }
      console.warn('Cloud state save conflicted and local cache could not be preserved.', error);
      return SAVE_FAILED;
    }
    if (localWriteSucceeded && localDirtyMetadataSucceeded
      && preserveLocalOnlyState({ state, saveId: localSaveId, storage, storageKey })) {
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
  let previousLocalState = null;
  try {
    previousLocalState = storage.getItem(storageKey);
    writeLocalState({ state: validState, storage, storageKey });
    localDirtyMetadataSucceeded = markLocalDirty({ saveId: localSaveId, storage, storageKey });
    if (!localDirtyMetadataSucceeded) {
      restoreLocalState({ previousState: previousLocalState, storage, storageKey });
      localWriteSucceeded = false;
    }
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
