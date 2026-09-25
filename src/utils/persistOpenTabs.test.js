import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  persistOpenTabs,
  loadOpenTabs,
  responseKey,
  OPEN_TABS_KEY,
  RESPONSE_KEY_PREFIX,
} from './persistOpenTabs';

// GH-72: open tabs persist as metadata under `openTabs` (no `response`) plus one
// `openTabs:response:<tabId>` key per tab that has a response. Unchanged
// responses (same object as last handled for that storage) are never written or
// stringified again, so editing one tab never re-serializes other tabs' bodies.

// Literal key names (the constants themselves are asserted separately below).
const META = 'openTabs';
const PREFIX = 'openTabs:response:';
const RK = (id) => `${PREFIX}${id}`;

function quotaError() {
  const err = new Error('The quota has been exceeded.');
  err.name = 'QuotaExceededError';
  return err;
}

/**
 * Fake Storage over a Map. A fresh object per test: the module keys its
 * per-storage record by the storage object, so a new fake is a "fresh page".
 * Pass `store` to share the underlying data with another fake (simulates a
 * reload: same persisted data, new module-level record).
 * `failSet(key, value)` returning true makes that setItem throw a quota error.
 * `enumerable` adds `length` / `key(i)` (orphan cleanup support).
 */
function makeStorage({ store = new Map(), failSet = null, enumerable = false } = {}) {
  const storage = {
    store,
    getItem: vi.fn((key) => (store.has(key) ? store.get(key) : null)),
    setItem: vi.fn((key, value) => {
      if (failSet && failSet(key, String(value))) throw quotaError();
      store.set(key, String(value));
    }),
    removeItem: vi.fn((key) => {
      store.delete(key);
    }),
  };
  if (enumerable) {
    Object.defineProperty(storage, 'length', { get: () => store.size, enumerable: true });
    storage.key = vi.fn((i) => {
      const keys = Array.from(store.keys());
      return i >= 0 && i < keys.length ? keys[i] : null;
    });
  }
  return storage;
}

/**
 * A response object whose JSON.stringify calls are counted through a
 * non-enumerable toJSON (it serializes to the same plain data).
 */
function countedResponse(data) {
  const counter = { calls: 0 };
  const response = { ...data };
  Object.defineProperty(response, 'toJSON', {
    value() {
      counter.calls += 1;
      return { ...data };
    },
    enumerable: false,
  });
  return { response, counter };
}

const responseData = (marker, extra = {}) => ({
  status: 200,
  statusText: 'OK',
  headers: [{ key: 'content-type', value: 'application/json' }],
  body: { marker, items: [1, 2, 3] },
  time: 12,
  size: 42,
  ...extra,
});

const requestTab = (id, extra = {}) => ({
  id,
  type: 'request',
  entityId: `r-${id}`,
  dirty: false,
  activeDetailTab: 'params',
  request: { id: `r-${id}`, name: `Req ${id}`, method: 'GET', url: `http://127.0.0.1/${id}` },
  ...extra,
});

const withoutResponse = (tab) => {
  const { response, ...rest } = tab;
  return rest;
};

const setKeys = (storage) => storage.setItem.mock.calls.map(([key]) => key);
const removedKeys = (storage) => storage.removeItem.mock.calls.map(([key]) => key);
const storedTabs = (storage) => JSON.parse(storage.store.get(META));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('persistOpenTabs module constants', () => {
  it('exports the storage key names and responseKey()', () => {
    expect(OPEN_TABS_KEY).toBe('openTabs');
    expect(RESPONSE_KEY_PREFIX).toBe('openTabs:response:');
    expect(responseKey('request-abc')).toBe('openTabs:response:request-abc');
    expect(responseKey('t1')).toBe(RESPONSE_KEY_PREFIX + 't1');
  });
});

describe('persistOpenTabs (GH-72)', () => {
  it('UT-001 writes metadata without responses to "openTabs" and each response to its own key; returns "full"', () => {
    const r1 = responseData('BODY-T1');
    const r2 = { status: 404, statusText: 'Not Found', body: 'BODY-T2', headers: [] };
    const tabs = [
      requestTab('t1', { response: r1 }),
      { id: 't2', type: 'example', entityId: 'e1', dirty: true, response: r2 },
      { id: 't3', type: 'collection', entityId: 'c1', dirty: false },
    ];
    const storage = makeStorage();

    const result = persistOpenTabs(storage, tabs);

    expect(result).toBe('full');

    // Exactly one metadata write plus one write per response.
    expect(setKeys(storage).filter((k) => k === META)).toHaveLength(1);
    expect(setKeys(storage).sort()).toEqual([META, RK('t1'), RK('t2')].sort());

    const meta = storedTabs(storage);
    expect(meta).toEqual([withoutResponse(tabs[0]), withoutResponse(tabs[1]), tabs[2]]);
    meta.forEach((tab) => expect(tab).not.toHaveProperty('response'));
    expect(storage.store.get(META)).not.toContain('BODY-T1');
    expect(storage.store.get(META)).not.toContain('BODY-T2');

    expect(storage.store.get(RK('t1'))).toBe(JSON.stringify(r1));
    expect(JSON.parse(storage.store.get(RK('t2')))).toEqual(r2);
    expect(storage.store.has(RK('t3'))).toBe(false);
  });

  it('UT-001 an empty tab list or a non-array input persists "[]" and returns "full"', () => {
    const empty = makeStorage();
    expect(persistOpenTabs(empty, [])).toBe('full');
    expect(empty.store.get(META)).toBe('[]');

    const nonArray = makeStorage();
    let result;
    expect(() => {
      result = persistOpenTabs(nonArray, undefined);
    }).not.toThrow();
    expect(result).toBe('full');
    expect(nonArray.store.get(META)).toBe('[]');

    const objectInput = makeStorage();
    expect(persistOpenTabs(objectInput, { id: 't1' })).toBe('full');
    expect(objectInput.store.get(META)).toBe('[]');
  });

  it('UT-002 (regression) editing one tab rewrites only the metadata and never re-stringifies unchanged responses', () => {
    const c1 = countedResponse(responseData('BODY-T1'));
    const c2 = countedResponse(responseData('BODY-T2'));
    const t1 = requestTab('t1', { response: c1.response });
    const t2 = requestTab('t2', { response: c2.response });
    const t3 = { id: 't3', type: 'collection', entityId: 'c1' };
    const storage = makeStorage();

    expect(persistOpenTabs(storage, [t1, t2, t3])).toBe('full');
    expect(c1.counter.calls).toBe(1);
    expect(c2.counter.calls).toBe(1);
    const t1KeyBefore = storage.store.get(RK('t1'));
    const t2KeyBefore = storage.store.get(RK('t2'));

    storage.setItem.mockClear();
    storage.removeItem.mockClear();

    // Keystroke in t1's URL: new tab object and request, same response object.
    const t1Edited = { ...t1, dirty: true, request: { ...t1.request, url: 'http://127.0.0.1/t1-EDITED' } };
    const result = persistOpenTabs(storage, [t1Edited, t2, t3]);

    expect(result).toBe('full');
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.setItem.mock.calls[0][0]).toBe(META);
    expect(removedKeys(storage).filter((k) => k.startsWith(PREFIX))).toEqual([]);

    // Unchanged responses were not serialized again.
    expect(c1.counter.calls).toBe(1);
    expect(c2.counter.calls).toBe(1);

    // The metadata carries the edit and no response body.
    const metaValue = storage.setItem.mock.calls[0][1];
    expect(metaValue).toContain('t1-EDITED');
    expect(metaValue).not.toContain('BODY-T1');
    expect(metaValue).not.toContain('BODY-T2');
    JSON.parse(metaValue).forEach((tab) => expect(tab).not.toHaveProperty('response'));

    // Previously persisted responses are untouched.
    expect(storage.store.get(RK('t1'))).toBe(t1KeyBefore);
    expect(storage.store.get(RK('t2'))).toBe(t2KeyBefore);
  });

  it('UT-003 a new response object on one tab rewrites only that tab\'s response key', () => {
    const c1 = countedResponse(responseData('BODY-T1'));
    const c2 = countedResponse(responseData('BODY-T2'));
    const t1 = requestTab('t1', { response: c1.response });
    const t2 = requestTab('t2', { response: c2.response });
    const storage = makeStorage();
    persistOpenTabs(storage, [t1, t2]);

    storage.setItem.mockClear();
    storage.removeItem.mockClear();

    const r1b = responseData('BODY-T1-SECOND', { status: 201, statusText: 'Created' });
    const result = persistOpenTabs(storage, [{ ...t1, response: r1b }, t2]);

    expect(result).toBe('full');
    expect(setKeys(storage).sort()).toEqual([META, RK('t1')].sort());
    expect(JSON.parse(storage.store.get(RK('t1')))).toEqual(r1b);
    expect(JSON.parse(storage.store.get(RK('t2')))).toEqual(responseData('BODY-T2'));
    expect(c1.counter.calls).toBe(1);
    expect(c2.counter.calls).toBe(1);
  });

  it('UT-004 a response set to null (or removed) removes its key and is forgotten', () => {
    const t1 = requestTab('t1', { response: responseData('BODY-T1') });
    const t2 = requestTab('t2', { response: responseData('BODY-T2') });
    const storage = makeStorage();
    persistOpenTabs(storage, [t1, t2]);
    expect(storage.store.has(RK('t1'))).toBe(true);

    storage.removeItem.mockClear();
    expect(persistOpenTabs(storage, [{ ...t1, response: null }, t2])).toBe('full');
    expect(removedKeys(storage)).toContain(RK('t1'));
    expect(storage.store.has(RK('t1'))).toBe(false);
    expect(storage.store.has(RK('t2'))).toBe(true);
    expect(storedTabs(storage).map((t) => t.id)).toEqual(['t1', 't2']);

    // Forgotten: another call with no response does not touch the key again.
    storage.removeItem.mockClear();
    storage.setItem.mockClear();
    persistOpenTabs(storage, [withoutResponse(t1), t2]);
    expect(removedKeys(storage)).not.toContain(RK('t1'));
    expect(setKeys(storage)).toEqual([META]);

    // An undefined response on a tab that has a recorded response also removes it.
    const other = makeStorage();
    persistOpenTabs(other, [t1]);
    persistOpenTabs(other, [withoutResponse(t1)]);
    expect(other.store.has(RK('t1'))).toBe(false);
  });

  it('UT-004 closing a tab removes its response key', () => {
    const t1 = requestTab('t1', { response: responseData('BODY-T1') });
    const t2 = requestTab('t2', { response: responseData('BODY-T2') });
    const storage = makeStorage();
    persistOpenTabs(storage, [t1, t2]);

    storage.removeItem.mockClear();
    expect(persistOpenTabs(storage, [t2])).toBe('full');

    expect(removedKeys(storage)).toContain(RK('t1'));
    expect(storage.store.has(RK('t1'))).toBe(false);
    expect(storage.store.has(RK('t2'))).toBe(true);
    expect(storedTabs(storage).map((t) => t.id)).toEqual(['t2']);
  });

  it('UT-004 a tab that becomes temporary has its response key removed and leaves the metadata', () => {
    const t1 = requestTab('t1', { response: responseData('BODY-T1') });
    const t2 = requestTab('t2', { response: responseData('BODY-T2') });
    const storage = makeStorage();
    persistOpenTabs(storage, [t1, t2]);

    storage.removeItem.mockClear();
    persistOpenTabs(storage, [{ ...t1, isTemporary: true }, t2]);

    expect(removedKeys(storage)).toContain(RK('t1'));
    expect(storage.store.has(RK('t1'))).toBe(false);
    expect(storedTabs(storage).map((t) => t.id)).toEqual(['t2']);
  });

  it('UT-005 a failing response write removes the key, returns "stripped", is not retried for the same object, and is retried for a new one', () => {
    const huge = countedResponse(responseData('HUGE-BODY'));
    const t1 = requestTab('t1', { response: huge.response });
    const t2 = requestTab('t2', { response: responseData('BODY-T2') });
    const storage = makeStorage({
      failSet: (key, value) => key === RK('t1') && value.includes('HUGE-BODY'),
    });
    // A stale value from an earlier session must not survive a failed write.
    storage.store.set(RK('t1'), JSON.stringify(responseData('STALE')));

    const first = persistOpenTabs(storage, [t1, t2]);

    expect(first).toBe('stripped');
    expect(removedKeys(storage)).toContain(RK('t1'));
    expect(storage.store.has(RK('t1'))).toBe(false);
    expect(JSON.parse(storage.store.get(RK('t2')))).toEqual(responseData('BODY-T2'));
    expect(storedTabs(storage).map((t) => t.id)).toEqual(['t1', 't2']);
    expect(storedTabs(storage)[0]).toEqual(withoutResponse(t1));
    expect(huge.counter.calls).toBe(1);

    // Same response object (tab edited): no retry, no re-stringify.
    storage.setItem.mockClear();
    const t1Edited = { ...t1, dirty: true, request: { ...t1.request, url: 'http://127.0.0.1/edited' } };
    const second = persistOpenTabs(storage, [t1Edited, t2]);

    expect(second).toBe('full');
    expect(setKeys(storage)).toEqual([META]);
    expect(huge.counter.calls).toBe(1);

    // A new response object that fits is written.
    storage.setItem.mockClear();
    const small = responseData('SMALL-BODY');
    const third = persistOpenTabs(storage, [{ ...t1Edited, response: small }, t2]);

    expect(third).toBe('full');
    expect(setKeys(storage)).toContain(RK('t1'));
    expect(JSON.parse(storage.store.get(RK('t1')))).toEqual(small);
  });

  it('UT-005 a new response object that still fails is attempted again and reported "stripped"', () => {
    const storage = makeStorage({ failSet: (key) => key === RK('t1') });
    const t1 = requestTab('t1', { response: responseData('A') });

    expect(persistOpenTabs(storage, [t1])).toBe('stripped');
    storage.setItem.mockClear();
    expect(persistOpenTabs(storage, [{ ...t1, response: responseData('B') }])).toBe('stripped');
    expect(setKeys(storage)).toContain(RK('t1'));
    expect(storage.store.has(RK('t1'))).toBe(false);
  });

  it('UT-006 a metadata write that throws once removes all response keys, retries the metadata, returns "stripped", and does not re-write the same responses later', () => {
    const c1 = countedResponse(responseData('BODY-T1'));
    const c2 = countedResponse(responseData('BODY-T2'));
    const t1 = requestTab('t1', { response: c1.response });
    const t2 = requestTab('t2', { response: c2.response });
    let failMetaOnce = false;
    const storage = makeStorage({
      failSet: (key) => {
        if (key === META && failMetaOnce) {
          failMetaOnce = false;
          return true;
        }
        return false;
      },
    });
    expect(persistOpenTabs(storage, [t1, t2])).toBe('full');
    expect(storage.store.has(RK('t1'))).toBe(true);
    expect(storage.store.has(RK('t2'))).toBe(true);

    storage.setItem.mockClear();
    storage.removeItem.mockClear();
    failMetaOnce = true;
    const t1Edited = { ...t1, dirty: true, request: { ...t1.request, url: 'http://127.0.0.1/edited-1' } };
    const result = persistOpenTabs(storage, [t1Edited, t2]);

    expect(result).toBe('stripped');
    expect(setKeys(storage)).toEqual([META, META]);
    expect(removedKeys(storage)).toEqual(expect.arrayContaining([RK('t1'), RK('t2')]));
    expect(storage.store.has(RK('t1'))).toBe(false);
    expect(storage.store.has(RK('t2'))).toBe(false);
    expect(storedTabs(storage)).toEqual([withoutResponse(t1Edited), withoutResponse(t2)]);

    // Later calls with the same response objects do not write them again.
    storage.setItem.mockClear();
    const t1Edited2 = { ...t1Edited, request: { ...t1Edited.request, url: 'http://127.0.0.1/edited-2' } };
    expect(persistOpenTabs(storage, [t1Edited2, t2])).toBe('full');
    expect(setKeys(storage)).toEqual([META]);
    expect(storage.store.has(RK('t1'))).toBe(false);
    expect(storage.store.has(RK('t2'))).toBe(false);
    expect(c1.counter.calls).toBe(1);
    expect(c2.counter.calls).toBe(1);
  });

  it('UT-006 a metadata write that throws once on the first call drops every response and still persists the metadata', () => {
    const c1 = countedResponse(responseData('BODY-T1'));
    const t1 = requestTab('t1', { response: c1.response });
    const t2 = requestTab('t2');
    let failMetaOnce = true;
    const storage = makeStorage({
      failSet: (key) => {
        if (key === META && failMetaOnce) {
          failMetaOnce = false;
          return true;
        }
        return false;
      },
    });
    storage.store.set(RK('t1'), JSON.stringify(responseData('STALE')));

    expect(persistOpenTabs(storage, [t1, t2])).toBe('stripped');
    expect(setKeys(storage)).toEqual([META, META]);
    expect(removedKeys(storage)).toContain(RK('t1'));
    expect(storage.store.has(RK('t1'))).toBe(false);
    expect(storedTabs(storage)).toEqual([withoutResponse(t1), t2]);

    const callsAfterFirst = c1.counter.calls;
    storage.setItem.mockClear();
    expect(persistOpenTabs(storage, [t1, t2])).toBe('full');
    expect(setKeys(storage)).toEqual([META]);
    expect(c1.counter.calls).toBe(callsAfterFirst);
  });

  it('UT-007 a metadata write that always throws returns "failed", warns once and never throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = makeStorage({ failSet: () => true });
    const tabs = [
      requestTab('t1', { response: responseData('BODY-T1') }),
      requestTab('t2', { response: responseData('BODY-T2') }),
    ];

    let result;
    expect(() => {
      result = persistOpenTabs(storage, tabs);
    }).not.toThrow();

    expect(result).toBe('failed');
    expect(warn).toHaveBeenCalledTimes(1);
    // First attempt plus exactly one retry of the metadata.
    expect(setKeys(storage).filter((k) => k === META)).toHaveLength(2);
    expect(storage.store.size).toBe(0);
  });

  it('UT-007 a non-quota storage error (every setItem throws TypeError) is handled the same way', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new TypeError('storage unavailable');
      }),
      removeItem: vi.fn(),
    };
    const tabs = [requestTab('t1', { response: responseData('BODY-T1') })];

    let result;
    expect(() => {
      result = persistOpenTabs(storage, tabs);
    }).not.toThrow();
    expect(result).toBe('failed');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('UT-007 consecutive failing calls warn once per failure streak; a successful metadata write (first try or retry) re-arms the warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // `metaFails` toggles persistent metadata failures; `metaFailsNext` makes
    // exactly the next N metadata writes throw, whatever `metaFails` says.
    let metaFails = true;
    let metaFailsNext = 0;
    const storage = makeStorage({
      failSet: (key) => {
        if (key !== META) return false;
        if (metaFailsNext > 0) {
          metaFailsNext -= 1;
          return true;
        }
        return metaFails;
      },
    });
    const t1 = requestTab('t1', { response: responseData('BODY-T1') });
    const t2 = requestTab('t2', { response: responseData('BODY-T2') });
    // One keystroke in t1's URL per call: a new tab array each time, same responses.
    const keystroke = (n) => [
      { ...t1, dirty: true, request: { ...t1.request, url: `http://127.0.0.1/t1-edit-${n}` } },
      t2,
    ];
    const persist = (tabs) => {
      let result;
      expect(() => {
        result = persistOpenTabs(storage, tabs);
      }).not.toThrow();
      return result;
    };

    // Streak 1: three failing calls, one warning in total.
    expect(persist(keystroke(1))).toBe('failed');
    expect(persist(keystroke(2))).toBe('failed');
    expect(persist(keystroke(3))).toBe('failed');
    expect(warn).toHaveBeenCalledTimes(1);

    // Only the next metadata write fails: the retry succeeds -> "stripped", no new
    // warning, and the successful retry re-arms the warning.
    metaFails = false;
    metaFailsNext = 1;
    storage.setItem.mockClear();
    expect(persist(keystroke('3a'))).toBe('stripped');
    expect(metaFailsNext).toBe(0);
    expect(setKeys(storage)).toEqual([META, META]);
    expect(storedTabs(storage).map((t) => t.request.url)).toEqual([
      'http://127.0.0.1/t1-edit-3a',
      t2.request.url,
    ]);
    expect(warn).toHaveBeenCalledTimes(1);

    // Streak 1b: the first failing call after the successful retry warns again.
    metaFails = true;
    expect(persist(keystroke('3b'))).toBe('failed');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(persist(keystroke('3c'))).toBe('failed');
    expect(warn).toHaveBeenCalledTimes(2);

    // The storage recovers for one call: the first metadata write succeeds and the
    // responses are unchanged -> "full", no new warning.
    metaFails = false;
    expect(persist(keystroke(4))).toBe('full');
    expect(storedTabs(storage).map((t) => t.request.url)).toEqual([
      'http://127.0.0.1/t1-edit-4',
      t2.request.url,
    ]);
    expect(warn).toHaveBeenCalledTimes(2);

    // Streak 2: the first failing call after the success warns again, later ones do not.
    metaFails = true;
    expect(persist(keystroke(5))).toBe('failed');
    expect(warn).toHaveBeenCalledTimes(3);
    expect(persist(keystroke(6))).toBe('failed');
    expect(persist(keystroke(7))).toBe('failed');
    expect(warn).toHaveBeenCalledTimes(3);

    // The streak is tracked per storage object: another failing storage warns on its own.
    const other = makeStorage({ failSet: (key) => key === META });
    expect(persistOpenTabs(other, keystroke(8))).toBe('failed');
    expect(warn).toHaveBeenCalledTimes(4);
    expect(persistOpenTabs(other, keystroke(9))).toBe('failed');
    expect(persist(keystroke(10))).toBe('failed');
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it('UT-008 circular or unserializable responses never throw, are dropped ("stripped"), and leave the metadata intact', () => {
    const circular = { status: 200, statusText: 'OK' };
    circular.self = circular;
    const bigint = { status: 200, body: { n: BigInt(10) } };
    const tabs = [
      requestTab('t1', { response: circular }),
      requestTab('t2', { response: bigint }),
      requestTab('t3', { response: responseData('BODY-T3') }),
    ];
    const storage = makeStorage();
    // Stale values must not survive.
    storage.store.set(RK('t1'), '{"stale":true}');
    storage.store.set(RK('t2'), '{"stale":true}');

    let result;
    expect(() => {
      result = persistOpenTabs(storage, tabs);
    }).not.toThrow();

    expect(result).toBe('stripped');
    expect(storedTabs(storage)).toEqual(tabs.map(withoutResponse));
    expect(storage.store.has(RK('t1'))).toBe(false);
    expect(storage.store.has(RK('t2'))).toBe(false);
    expect(JSON.parse(storage.store.get(RK('t3')))).toEqual(responseData('BODY-T3'));

    // Same objects again: not retried.
    storage.setItem.mockClear();
    expect(persistOpenTabs(storage, tabs)).toBe('full');
    expect(setKeys(storage)).toEqual([META]);
  });

  it('UT-009 temporary tabs, runState and docsCache are never written and input tabs are not mutated', () => {
    const r1 = responseData('BODY-T1');
    const tempResponse = responseData('BODY-TEMP');
    const tabs = [
      requestTab('t1', {
        response: r1,
        runState: { marker: 'RUNSTATE-MARKER', running: true },
        docsCache: { marker: 'DOCSCACHE-MARKER' },
      }),
      requestTab('temp-1', { isTemporary: true, response: tempResponse }),
      { id: 'docs-1', type: 'docs', entityId: 'c1', docsCache: { marker: 'DOCSCACHE-MARKER-2' } },
      { id: 'wf-1', type: 'workflow', entityId: 'w1', runState: { marker: 'RUNSTATE-MARKER-2' } },
    ];
    const snapshot = JSON.parse(JSON.stringify(tabs));
    const storage = makeStorage();

    expect(persistOpenTabs(storage, tabs)).toBe('full');

    const meta = storedTabs(storage);
    expect(meta.map((t) => t.id)).toEqual(['t1', 'docs-1', 'wf-1']);
    meta.forEach((tab) => {
      expect(tab).not.toHaveProperty('runState');
      expect(tab).not.toHaveProperty('docsCache');
      expect(tab).not.toHaveProperty('response');
    });
    expect(meta[0]).toEqual({
      id: 't1', type: 'request', entityId: 'r-t1', dirty: false, activeDetailTab: 'params', request: tabs[0].request,
    });

    const allWritten = storage.setItem.mock.calls.map(([k, v]) => `${k}=${v}`).join('\n');
    expect(allWritten).not.toContain('RUNSTATE-MARKER');
    expect(allWritten).not.toContain('DOCSCACHE-MARKER');
    expect(allWritten).not.toContain('BODY-TEMP');
    expect(allWritten).not.toContain('temp-1');
    expect(setKeys(storage).sort()).toEqual([META, RK('t1')].sort());

    // Inputs untouched.
    expect(tabs).toEqual(snapshot);
    expect(tabs[0].response).toBe(r1);
    expect(tabs[0]).toHaveProperty('runState');
    expect(tabs[0]).toHaveProperty('docsCache');
    expect(tabs[1].response).toBe(tempResponse);
  });
});

describe('loadOpenTabs (GH-72)', () => {
  it('UT-010 round trip restores the persisted selection with responses; the first persist after load writes no response keys', () => {
    const r1 = responseData('BODY-T1');
    const r3 = { status: 500, statusText: 'Server Error', body: 'plain text body', headers: [], time: 3, size: 15 };
    const tabs = [
      requestTab('t1', { response: r1, runState: { x: 1 }, docsCache: { y: 2 } }),
      requestTab('t2', { response: null }),
      { id: 't3', type: 'example', entityId: 'e3', dirty: true, response: r3 },
      requestTab('temp-9', { isTemporary: true, response: responseData('TEMP') }),
      { id: 'c4', type: 'collection', entityId: 'c4' },
    ];
    const writer = makeStorage({ enumerable: true });
    expect(persistOpenTabs(writer, tabs)).toBe('full');

    // "Reload": same persisted data, a new storage object (no module record yet).
    const reader = makeStorage({ store: writer.store, enumerable: true });
    const loaded = loadOpenTabs(reader);

    const { runState, docsCache, ...t1Selected } = tabs[0];
    const expected = [t1Selected, tabs[1], tabs[2], tabs[4]];
    expect(loaded.map(withoutResponse)).toEqual(expected.map(withoutResponse));
    expect(loaded[0].response).toEqual(r1);
    expect(loaded[1].response == null).toBe(true);
    expect(loaded[2].response).toEqual(r3);
    expect(loaded[3].response == null).toBe(true);
    loaded.forEach((tab) => {
      expect(tab).not.toHaveProperty('runState');
      expect(tab).not.toHaveProperty('docsCache');
    });

    // First persist after startup: only metadata, no response rewrites/removals.
    const result = persistOpenTabs(reader, loaded);
    expect(result).toBe('full');
    expect(setKeys(reader)).toEqual([META]);
    expect(removedKeys(reader).filter((k) => k === RK('t1') || k === RK('t3'))).toEqual([]);
    expect(JSON.parse(reader.store.get(RK('t1')))).toEqual(r1);
    expect(JSON.parse(reader.store.get(RK('t3')))).toEqual(r3);

    // Editing a loaded tab still writes only the metadata.
    reader.setItem.mockClear();
    const edited = [{ ...loaded[0], dirty: true, request: { ...loaded[0].request, url: 'http://x/edited' } }, ...loaded.slice(1)];
    expect(persistOpenTabs(reader, edited)).toBe('full');
    expect(setKeys(reader)).toEqual([META]);
  });

  it('UT-010 round trip works on a storage without length/key', () => {
    const tabs = [requestTab('t1', { response: responseData('BODY-T1') }), requestTab('t2')];
    const writer = makeStorage();
    persistOpenTabs(writer, tabs);

    const reader = makeStorage({ store: writer.store });
    const loaded = loadOpenTabs(reader);
    expect(loaded.map(withoutResponse)).toEqual(tabs.map(withoutResponse));
    expect(loaded[0].response).toEqual(responseData('BODY-T1'));
    expect(loaded[1].response == null).toBe(true);

    persistOpenTabs(reader, loaded);
    expect(setKeys(reader)).toEqual([META]);
  });

  it('UT-011 missing, corrupt or non-array "openTabs" data loads as []', () => {
    expect(loadOpenTabs(makeStorage())).toEqual([]);

    const cases = ['not json{', '', '{"id":"t1"}', '42', '"a string"', 'null', 'true'];
    for (const raw of cases) {
      const storage = makeStorage();
      storage.store.set(META, raw);
      let loaded;
      expect(() => {
        loaded = loadOpenTabs(storage);
      }).not.toThrow();
      expect(loaded).toEqual([]);
    }
  });

  it('UT-011 entries that are not plain objects are dropped', () => {
    const storage = makeStorage();
    const good = requestTab('t1');
    storage.store.set(META, JSON.stringify([1, null, 'x', true, [], good]));

    expect(loadOpenTabs(storage)).toEqual([good]);
  });

  it('UT-011 a getItem that throws yields [] without throwing', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('SecurityError');
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    let loaded;
    expect(() => {
      loaded = loadOpenTabs(storage);
    }).not.toThrow();
    expect(loaded).toEqual([]);
  });

  it('UT-011 a corrupt response entry leaves the tab without a response and removes the key', () => {
    const storage = makeStorage({ enumerable: true });
    const t1 = requestTab('t1');
    const t2 = requestTab('t2');
    const r2 = responseData('BODY-T2');
    storage.store.set(META, JSON.stringify([t1, t2]));
    storage.store.set(RK('t1'), '{corrupt');
    storage.store.set(RK('t2'), JSON.stringify(r2));

    const loaded = loadOpenTabs(storage);

    expect(loaded.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(loaded[0].response == null).toBe(true);
    expect(withoutResponse(loaded[0])).toEqual(t1);
    expect(loaded[1].response).toEqual(r2);
    expect(removedKeys(storage)).toContain(RK('t1'));
    expect(storage.store.has(RK('t1'))).toBe(false);
    expect(storage.store.has(RK('t2'))).toBe(true);
  });

  it('UT-012 legacy inline-response data loads as is and migrates to the split layout on the next persist', () => {
    const r1 = responseData('LEGACY-BODY-T1');
    const legacy = [
      requestTab('t1', { response: r1 }),
      requestTab('t2', { response: null }),
      { id: 'c3', type: 'collection', entityId: 'c3' },
    ];
    const storage = makeStorage({ enumerable: true });
    storage.store.set(META, JSON.stringify(legacy));

    let loaded;
    expect(() => {
      loaded = loadOpenTabs(storage);
    }).not.toThrow();
    expect(loaded.map(withoutResponse)).toEqual(legacy.map(withoutResponse));
    expect(loaded[0].response).toEqual(r1);
    // Inline legacy values are kept as is (including an explicit null).
    expect(loaded[1]).toHaveProperty('response', null);
    expect(loaded[2].response == null).toBe(true);

    const result = persistOpenTabs(storage, loaded);

    expect(result).toBe('full');
    expect(setKeys(storage)).toContain(RK('t1'));
    expect(JSON.parse(storage.store.get(RK('t1')))).toEqual(r1);
    expect(storage.store.get(META)).not.toContain('LEGACY-BODY-T1');
    storedTabs(storage).forEach((tab) => expect(tab).not.toHaveProperty('response'));
    expect(storage.store.has(RK('t2'))).toBe(false);

    // Migrated: the next persist with the same objects writes metadata only.
    storage.setItem.mockClear();
    expect(persistOpenTabs(storage, loaded)).toBe('full');
    expect(setKeys(storage)).toEqual([META]);

    // And a fresh load now reads the response from its own key.
    const reloaded = loadOpenTabs(makeStorage({ store: storage.store }));
    expect(reloaded[0].response).toEqual(r1);
    expect(reloaded.map((t) => t.id)).toEqual(['t1', 't2', 'c3']);
  });

  it('UT-013 orphaned response keys are removed on load; unrelated keys are untouched', () => {
    const storage = makeStorage({ enumerable: true });
    const t1 = requestTab('t1');
    const t2 = requestTab('t2');
    const r1 = responseData('BODY-T1');
    // Adjacent orphans: an iterate-and-remove loop over key(i) would skip one.
    storage.store.set('sb-127-auth-token', '{"access_token":"x"}');
    storage.store.set(RK('ghost-a'), JSON.stringify(responseData('GHOST-A')));
    storage.store.set(RK('ghost-b'), JSON.stringify(responseData('GHOST-B')));
    storage.store.set(META, JSON.stringify([t1, t2]));
    storage.store.set(RK('t1'), JSON.stringify(r1));
    storage.store.set('activeTabId', 't1');
    storage.store.set(RK('ghost-c'), '{corrupt');
    storage.store.set('openTabsBackup', 'keep me');
    storage.store.set('theme', 'dark');

    const loaded = loadOpenTabs(storage);

    expect(loaded.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(loaded[0].response).toEqual(r1);
    expect(storage.store.has(RK('ghost-a'))).toBe(false);
    expect(storage.store.has(RK('ghost-b'))).toBe(false);
    expect(storage.store.has(RK('ghost-c'))).toBe(false);
    expect(Array.from(storage.store.keys()).sort()).toEqual(
      ['sb-127-auth-token', META, RK('t1'), 'activeTabId', 'openTabsBackup', 'theme'].sort(),
    );
    expect(storage.store.get('openTabsBackup')).toBe('keep me');
    expect(storage.store.get('theme')).toBe('dark');
    expect(storage.store.get('activeTabId')).toBe('t1');
  });

  it('UT-013 a storage without length/key skips orphan cleanup without throwing', () => {
    const storage = makeStorage();
    const t1 = requestTab('t1');
    storage.store.set(META, JSON.stringify([t1]));
    storage.store.set(RK('ghost'), '{}');

    let loaded;
    expect(() => {
      loaded = loadOpenTabs(storage);
    }).not.toThrow();
    expect(loaded.map(withoutResponse)).toEqual([t1]);
    expect(storage.store.has(RK('ghost'))).toBe(true);
  });
});
