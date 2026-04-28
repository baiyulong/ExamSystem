import { validateStudyState } from './stateSchema.js';

export const CLOUD_SYNCED = 'cloud-synced';
export const CLOUD_LOAD_FAILED = 'cloud-load-failed';
export const LOCAL_ONLY = 'local-only';

function readLocalState({ storage, storageKey, createInitialState }) {
  const saved = storage.getItem(storageKey);
  if (!saved) return createInitialState();

  try {
    return validateStudyState(JSON.parse(saved));
  } catch (error) {
    console.warn('Local study state is invalid; starting from a fresh state.', error);
    return createInitialState();
  }
}

function writeLocalState({ state, storage, storageKey }) {
  storage.setItem(storageKey, JSON.stringify(validateStudyState(state)));
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
} = {}) {
  const localState = readLocalState({ storage, storageKey, createInitialState });

  try {
    const response = await fetchJson('/api/state');
    const payload = await readResponseJson(response);
    if (payload.state != null) {
      const cloudState = validateStudyState(payload.state);
      try {
        writeLocalState({ state: cloudState, storage, storageKey });
      } catch (error) {
        console.warn('Cloud state loaded but local cache update failed.', error);
      }
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
  let localWriteSucceeded = true;
  try {
    writeLocalState({ state, storage, storageKey });
  } catch (error) {
    localWriteSucceeded = false;
    console.warn('Local cache write failed before cloud save.', error);
  }

  try {
    const response = await fetchJson('/api/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state }),
    });
    await readResponseJson(response);
    return CLOUD_SYNCED;
  } catch (error) {
    if (localWriteSucceeded) {
      console.warn('Cloud state save failed; local cache is preserved.', error);
    } else {
      console.warn('Cloud state save failed after local cache write failed.', error);
    }
    return LOCAL_ONLY;
  }
}
