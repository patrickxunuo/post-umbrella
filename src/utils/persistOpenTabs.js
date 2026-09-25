const STORAGE_KEY = 'openTabs';
// Incremental largest-first drops before falling back to dropping every
// response, so a many-tab over-quota state cannot re-serialize N times.
const MAX_INCREMENTAL_RETRIES = 3;

function responseSize(tab) {
  if (!tab || typeof tab !== 'object' || tab.response == null) return 0;
  try {
    return JSON.stringify(tab.response).length;
  } catch {
    return Number.POSITIVE_INFINITY; // unserializable: drop it first
  }
}

function withoutResponse(tab) {
  const rest = { ...tab };
  delete rest.response;
  return rest;
}

function tryWrite(storage, tabs) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(tabs));
    return null;
  } catch (error) {
    return error;
  }
}

// Persists open tabs, degrading gracefully when the storage quota is hit: a
// large response body must never bubble a QuotaExceededError into React.
// Responses are dropped one tab at a time, largest first, so one oversized
// body does not erase the persisted responses of every other tab.
export function persistOpenTabs(storage, tabs) {
  let lastError = tryWrite(storage, tabs);
  if (lastError === null) return 'full';

  if (Array.isArray(tabs)) {
    const largestFirst = tabs
      .map((tab, index) => ({ index, size: responseSize(tab) }))
      .filter((entry) => entry.size > 0)
      .sort((a, b) => b.size - a.size);
    let current = tabs;
    const incremental = largestFirst.slice(0, MAX_INCREMENTAL_RETRIES);
    for (const { index } of incremental) {
      current = current.map((tab, i) => (i === index ? withoutResponse(tab) : tab));
      lastError = tryWrite(storage, current);
      if (lastError === null) return 'stripped';
    }
    if (largestFirst.length > incremental.length) {
      lastError = tryWrite(storage, tabs.map((tab) => (responseSize(tab) > 0 ? withoutResponse(tab) : tab)));
      if (lastError === null) return 'stripped';
    }
  }

  console.warn('Could not persist open tabs; skipping this update.', lastError);
  return 'failed';
}
