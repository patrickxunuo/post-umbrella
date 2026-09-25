import { describe, it, expect, vi, afterEach } from 'vitest';
import { persistOpenTabs } from './persistOpenTabs';

// GH-70 (B8): a 10 MB response stored on a tab blows the localStorage quota.
// persistOpenTabs(storage, tabs) must write the full JSON when it fits, drop
// tabs' `response` one at a time (largest first) retrying after each drop, and
// never let a final failure escape (it warns once and reports 'failed').

const makeTabs = () => [
  {
    id: 't1',
    type: 'request',
    entityId: 'r1',
    dirty: false,
    request: { url: 'http://127.0.0.1/large.json', method: 'GET' },
    response: { status: 200, body: 'x'.repeat(200), headers: [] },
  },
  {
    id: 't2',
    type: 'example',
    entityId: 'e1',
    dirty: true,
    response: { status: 404 },
  },
  {
    id: 't3',
    type: 'collection',
    entityId: 'c1',
  },
];

// Fake Storage whose setItem throws for the first `failures` calls.
function makeStorage(failures = 0) {
  const store = new Map();
  let remaining = failures;
  const setItem = vi.fn((key, value) => {
    if (remaining > 0) {
      remaining -= 1;
      const err = new Error('The quota has been exceeded.');
      err.name = 'QuotaExceededError';
      throw err;
    }
    store.set(key, String(value));
  });
  return {
    store,
    setItem,
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    removeItem: (key) => { store.delete(key); },
  };
}

describe('persistOpenTabs (UT-011)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('UT-011 writes the full JSON under "openTabs" and returns "full"', () => {
    const tabs = makeTabs();
    const storage = makeStorage(0);

    const result = persistOpenTabs(storage, tabs);

    expect(result).toBe('full');
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledWith('openTabs', JSON.stringify(tabs));
    expect(storage.getItem('openTabs')).toBe(JSON.stringify(tabs));
    // Responses survive in the stored payload when the write fits.
    expect(JSON.parse(storage.getItem('openTabs'))[0].response).toEqual(tabs[0].response);
  });

  it('UT-011 drops only the largest tab\'s "response" when the first write throws and returns "stripped"', () => {
    const tabs = makeTabs();
    const snapshot = JSON.stringify(tabs);
    const storage = makeStorage(1);

    const result = persistOpenTabs(storage, tabs);

    expect(result).toBe('stripped');
    expect(storage.setItem).toHaveBeenCalledTimes(2);

    // First attempt carried the full payload.
    expect(storage.setItem.mock.calls[0][0]).toBe('openTabs');
    expect(storage.setItem.mock.calls[0][1]).toBe(snapshot);

    // Retry dropped the response of the tab with the largest response only.
    const [retryKey, retryValue] = storage.setItem.mock.calls[1];
    expect(retryKey).toBe('openTabs');
    const stored = JSON.parse(retryValue);
    expect(stored).toHaveLength(tabs.length);
    expect(stored[0]).not.toHaveProperty('response');
    expect(stored[0]).toMatchObject({ id: 't1', type: 'request', entityId: 'r1', dirty: false });
    expect(stored[0].request).toEqual(tabs[0].request);
    expect(stored[1]).toEqual(tabs[1]); // smaller response survives
    expect(stored[2]).toEqual(tabs[2]);

    // The retry's payload is what ended up in storage; the caller's tabs are untouched.
    expect(storage.getItem('openTabs')).toBe(retryValue);
    expect(JSON.stringify(tabs)).toBe(snapshot);
  });

  it('UT-011 keeps dropping responses largest-first until the write fits', () => {
    const tabs = makeTabs();
    const storage = makeStorage(2);

    expect(persistOpenTabs(storage, tabs)).toBe('stripped');
    expect(storage.setItem).toHaveBeenCalledTimes(3);
    const stored = JSON.parse(storage.setItem.mock.calls[2][1]);
    expect(stored[0]).not.toHaveProperty('response');
    expect(stored[1]).not.toHaveProperty('response');
    expect(stored[2]).toEqual(tabs[2]);
  });

  it('UT-011 swallows a final throw, warns once and returns "failed" without throwing', () => {
    const tabs = makeTabs();
    // Full write + one retry per tab that carries a response (t1, t2) all fail.
    const storage = makeStorage(3);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    let result;
    expect(() => {
      result = persistOpenTabs(storage, tabs);
    }).not.toThrow();

    expect(result).toBe('failed');
    expect(storage.setItem).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(storage.getItem('openTabs')).toBe(null);
  });

  it('UT-011 returns "failed" for a non-quota error as well (any error triggers the retry path)', () => {
    const tabs = makeTabs();
    const storage = {
      setItem: vi.fn(() => { throw new TypeError('storage unavailable'); }),
      getItem: () => null,
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => persistOpenTabs(storage, tabs)).not.toThrow();
    expect(persistOpenTabs(storage, tabs)).toBe('failed');
    expect(storage.setItem).toHaveBeenCalledTimes(6); // full + two retries, per invocation
    expect(warn).toHaveBeenCalled();
  });

  it('UT-011 caps incremental drops, then drops every response at once', () => {
    // Six tabs with responses: full write + 3 incremental retries fail, the
    // drop-all fallback fits.
    const tabs = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`,
      type: 'request',
      entityId: `r${i}`,
      response: { status: 200, body: 'x'.repeat(100 + i) },
    }));
    const storage = makeStorage(4);

    expect(persistOpenTabs(storage, tabs)).toBe('stripped');
    expect(storage.setItem).toHaveBeenCalledTimes(5);
    const stored = JSON.parse(storage.setItem.mock.calls[4][1]);
    stored.forEach((tab) => expect(tab).not.toHaveProperty('response'));
    expect(stored.map((tab) => tab.id)).toEqual(tabs.map((tab) => tab.id));
  });

  it('UT-011 an unserializable response never throws out of the guard', () => {
    const circular = { status: 200 };
    circular.self = circular;
    const tabs = [{ id: 't1', type: 'request', response: circular }, { id: 't2', type: 'collection' }];
    const storage = makeStorage(0);

    let result;
    expect(() => {
      result = persistOpenTabs(storage, tabs);
    }).not.toThrow();
    expect(result).toBe('stripped');
    expect(JSON.parse(storage.getItem('openTabs'))).toEqual([{ id: 't1', type: 'request' }, { id: 't2', type: 'collection' }]);
  });

  it('UT-011 an empty tab list persists as "[]" and returns "full"', () => {
    const storage = makeStorage(0);
    expect(persistOpenTabs(storage, [])).toBe('full');
    expect(storage.getItem('openTabs')).toBe('[]');
  });
});
