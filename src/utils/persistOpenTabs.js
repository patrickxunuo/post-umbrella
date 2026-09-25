export const OPEN_TABS_KEY = 'openTabs';
export const RESPONSE_KEY_PREFIX = 'openTabs:response:';

// Per storage: `handled` maps tabId -> response object last written (or
// dropped). Responses are replaced, never mutated, so identity tells us whether
// a body changed and unchanged bodies are never re-serialized on unrelated tab
// edits. `failing` marks a metadata-write failure streak so it warns only once.
const stateByStorage = new WeakMap();

export function responseKey(tabId) {
  return RESPONSE_KEY_PREFIX + tabId;
}

function stateFor(storage) {
  if (storage === null || (typeof storage !== 'object' && typeof storage !== 'function')) {
    return { handled: new Map(), failing: false };
  }
  let state = stateByStorage.get(storage);
  if (!state) {
    state = { handled: new Map(), failing: false };
    stateByStorage.set(storage, state);
  }
  return state;
}

function safeRemove(storage, key) {
  try {
    storage.removeItem(key);
  } catch {
    // best effort: a failed cleanup must never surface
  }
}

function tryWriteMeta(storage, metas) {
  try {
    storage.setItem(OPEN_TABS_KEY, JSON.stringify(metas));
    return null;
  } catch (error) {
    return error;
  }
}

function selectPersisted(tabs) {
  const persisted = [];
  for (const tab of Array.isArray(tabs) ? tabs : []) {
    if (!tab || typeof tab !== 'object' || tab.isTemporary) continue;
    const meta = { ...tab };
    delete meta.runState;
    delete meta.docsCache;
    delete meta.response;
    persisted.push({ id: tab.id, response: tab.response, meta });
  }
  return persisted;
}

// Writes tab metadata under one key and each response under its own key, so a
// keystroke in one tab costs only the metadata plus responses that changed.
// Quota errors degrade to dropping responses; nothing is ever thrown.
export function persistOpenTabs(storage, tabs) {
  const state = stateFor(storage);
  const { handled } = state;
  const persisted = selectPersisted(tabs);
  const metas = persisted.map((entry) => entry.meta);
  let stripped = false;

  if (tryWriteMeta(storage, metas) !== null) {
    const keys = new Set([...handled.keys(), ...persisted.map((entry) => entry.id)]);
    keys.forEach((id) => safeRemove(storage, responseKey(id)));
    handled.clear();
    persisted.forEach(({ id, response }) => {
      if (response != null) handled.set(id, response);
    });
    const retryError = tryWriteMeta(storage, metas);
    if (retryError !== null) {
      if (!state.failing) {
        state.failing = true;
        console.warn('Could not persist open tabs; further failures are not reported until a write succeeds.', retryError);
      }
      return 'failed';
    }
    stripped = true;
  }
  state.failing = false;

  for (const { id, response } of persisted) {
    if (response != null) {
      if (handled.get(id) === response) continue;
      try {
        storage.setItem(responseKey(id), JSON.stringify(response));
      } catch {
        safeRemove(storage, responseKey(id));
        stripped = true;
      }
      handled.set(id, response);
    } else if (handled.has(id)) {
      safeRemove(storage, responseKey(id));
      handled.delete(id);
    }
  }

  const persistedIds = new Set(persisted.map((entry) => entry.id));
  for (const id of [...handled.keys()]) {
    if (persistedIds.has(id)) continue;
    safeRemove(storage, responseKey(id));
    handled.delete(id);
  }

  return stripped ? 'stripped' : 'full';
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function readTabs(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(OPEN_TABS_KEY));
    return Array.isArray(parsed) ? parsed.filter(isPlainObject) : [];
  } catch {
    return [];
  }
}

function attachResponse(storage, tab, handled) {
  // Legacy (pre-split) tabs carry the response inline; the next persist moves it.
  if (Object.prototype.hasOwnProperty.call(tab, 'response')) return;
  const key = responseKey(tab.id);
  let raw;
  try {
    raw = storage.getItem(key);
  } catch {
    return;
  }
  if (raw == null) return;
  let response;
  try {
    response = JSON.parse(raw);
  } catch {
    safeRemove(storage, key);
    return;
  }
  tab.response = response;
  handled.set(tab.id, response);
}

function removeOrphanResponses(storage, tabs) {
  try {
    if (typeof storage.key !== 'function' || typeof storage.length !== 'number') return;
    const keep = new Set(tabs.map((tab) => responseKey(tab.id)));
    const orphans = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (typeof key === 'string' && key.startsWith(RESPONSE_KEY_PREFIX) && !keep.has(key)) {
        orphans.push(key);
      }
    }
    orphans.forEach((key) => safeRemove(storage, key));
  } catch {
    // best effort: orphans are retried on the next load
  }
}

export function loadOpenTabs(storage) {
  const tabs = readTabs(storage);
  const { handled } = stateFor(storage);
  tabs.forEach((tab) => attachResponse(storage, tab, handled));
  removeOrphanResponses(storage, tabs);
  return tabs;
}
