import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import useCookieStore from './cookieStore.js';

const STORAGE_KEY = 'pu_cookie_jar';

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
});

// Read the persisted jar straight out of localStorage.
function persistedJar() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
}

describe('useCookieStore - setCookiesFromResponse', () => {
  it('stores parsed cookies under the URL host domain and getCookiesForUrl returns them', () => {
    useCookieStore.setState({ jar: {} });
    useCookieStore.getState().setCookiesFromResponse('https://example.com/login', [
      'session=abc; Path=/',
      'token=xyz; Path=/',
    ]);

    const jar = useCookieStore.getState().jar;
    expect(jar['example.com']).toBeDefined();
    expect(jar['example.com'].map((c) => c.name).sort()).toEqual(['session', 'token']);

    const cookies = useCookieStore.getState().getCookiesForUrl('https://example.com/login');
    expect(cookies.map((c) => c.name).sort()).toEqual(['session', 'token']);
  });

  it('stores under the explicit Domain attribute when the URL host domain-matches it', () => {
    useCookieStore.setState({ jar: {} });
    useCookieStore.getState().setCookiesFromResponse('https://api.example.com/x', [
      'a=1; Domain=example.com; Path=/',
    ]);

    const jar = useCookieStore.getState().jar;
    expect(jar['example.com']).toBeDefined();
    expect(jar['example.com'].map((c) => c.name)).toContain('a');
  });

  it('skips Set-Cookie strings that fail to parse', () => {
    useCookieStore.setState({ jar: {} });
    useCookieStore.getState().setCookiesFromResponse('https://example.com/', [
      'good=1; Path=/',
      'Secure; HttpOnly', // no name=value -> parseSetCookie returns null
    ]);

    const jar = useCookieStore.getState().jar;
    expect(jar['example.com'].map((c) => c.name)).toEqual(['good']);
  });

  it('persists the jar to localStorage after setting cookies', () => {
    useCookieStore.setState({ jar: {} });
    useCookieStore.getState().setCookiesFromResponse('https://example.com/', ['a=1; Path=/']);
    expect(persistedJar()).toEqual(useCookieStore.getState().jar);
  });
});

describe('useCookieStore - upsert / removeCookie / removeDomain / getDomains', () => {
  const cookieA = {
    name: 'a',
    value: '1',
    path: '/',
    expires: null,
    secure: false,
    httpOnly: false,
    sameSite: 'Lax',
    domain: null,
  };

  it('upsert adds a cookie and persists', () => {
    useCookieStore.setState({ jar: {} });
    useCookieStore.getState().upsert('example.com', cookieA);

    expect(useCookieStore.getState().jar['example.com'].map((c) => c.name)).toContain('a');
    expect(persistedJar()).toEqual(useCookieStore.getState().jar);
  });

  it('removeCookie removes a cookie and persists', () => {
    useCookieStore.setState({ jar: { 'example.com': [cookieA, { ...cookieA, name: 'b' }] } });
    useCookieStore.getState().removeCookie('example.com', 'a');

    expect(useCookieStore.getState().jar['example.com'].map((c) => c.name)).toEqual(['b']);
    expect(persistedJar()).toEqual(useCookieStore.getState().jar);
  });

  it('removeDomain drops the domain and persists', () => {
    useCookieStore.setState({ jar: { 'example.com': [cookieA], 'other.com': [cookieA] } });
    useCookieStore.getState().removeDomain('example.com');

    expect(useCookieStore.getState().jar['example.com']).toBeUndefined();
    expect(useCookieStore.getState().jar['other.com']).toBeDefined();
    expect(persistedJar()).toEqual(useCookieStore.getState().jar);
  });

  it('getDomains returns the jar keys', () => {
    useCookieStore.setState({ jar: { 'example.com': [cookieA], 'other.com': [cookieA] } });
    expect(useCookieStore.getState().getDomains().sort()).toEqual(['example.com', 'other.com']);
  });
});

describe('useCookieStore - persistence and initialization', () => {
  it('a fresh store instance reads the persisted jar from localStorage on init', async () => {
    const seeded = {
      'example.com': [
        {
          name: 'seed',
          value: 'v',
          path: '/',
          expires: null,
          secure: false,
          httpOnly: false,
          sameSite: 'Lax',
          domain: null,
        },
      ],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));

    vi.resetModules();
    const mod = await import('./cookieStore.js');
    const freshStore = mod.default;

    expect(freshStore.getState().jar).toEqual(seeded);
  });

  it('initializes with an empty jar when localStorage is missing the key', async () => {
    localStorage.removeItem(STORAGE_KEY);
    vi.resetModules();
    const mod = await import('./cookieStore.js');
    expect(mod.default.getState().jar).toEqual({});
  });

  it('initializes with an empty jar when localStorage JSON is malformed (no throw)', async () => {
    localStorage.setItem(STORAGE_KEY, '{ this is not valid json');
    vi.resetModules();
    const mod = await import('./cookieStore.js');
    expect(mod.default.getState().jar).toEqual({});
  });
});
