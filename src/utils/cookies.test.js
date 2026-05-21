import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getDomainFromUrl,
  parseSetCookie,
  cookiesForUrl,
  serializeCookieHeader,
  upsertCookie,
  removeCookie,
  removeDomain,
  extractSetCookies,
  buildCookieHeader,
} from './cookies.js';

// Helper to build a Cookie object with spec defaults.
function cookie(name, value, overrides = {}) {
  return {
    name,
    value,
    path: '/',
    expires: null,
    secure: false,
    httpOnly: false,
    sameSite: 'Lax',
    domain: null,
    ...overrides,
  };
}

describe('getDomainFromUrl', () => {
  it('lowercases the hostname', () => {
    expect(getDomainFromUrl('https://Example.COM/path')).toBe('example.com');
  });

  it('strips port', () => {
    expect(getDomainFromUrl('http://example.com:3001/path')).toBe('example.com');
  });

  it('strips path, query, and hash', () => {
    expect(getDomainFromUrl('https://api.example.com/a/b?x=1#frag')).toBe('api.example.com');
  });

  it('handles a bare host with no path', () => {
    expect(getDomainFromUrl('https://sub.example.com')).toBe('sub.example.com');
  });

  it('returns empty string for empty input', () => {
    expect(getDomainFromUrl('')).toBe('');
  });

  it('returns empty string for an unparseable url', () => {
    expect(getDomainFromUrl('not a url')).toBe('');
  });
});

describe('parseSetCookie', () => {
  it('parses a basic name=value pair with defaults', () => {
    const c = parseSetCookie('session=abc123');
    expect(c).not.toBeNull();
    expect(c.name).toBe('session');
    expect(c.value).toBe('abc123');
    expect(c.path).toBe('/');
    expect(c.expires).toBeNull();
    expect(c.secure).toBe(false);
    expect(c.httpOnly).toBe(false);
    expect(c.sameSite).toBe('Lax');
    expect(c.domain).toBeNull();
  });

  it('parses an empty value', () => {
    const c = parseSetCookie('foo=');
    expect(c).not.toBeNull();
    expect(c.name).toBe('foo');
    expect(c.value).toBe('');
  });

  it('treats attribute names case-insensitively', () => {
    const c = parseSetCookie('a=b; PaTh=/api; SECURE; httponly');
    expect(c.path).toBe('/api');
    expect(c.secure).toBe(true);
    expect(c.httpOnly).toBe(true);
  });

  it('converts Expires to epoch milliseconds via Date.parse', () => {
    const dateStr = 'Wed, 21 Oct 2099 07:28:00 GMT';
    const c = parseSetCookie(`a=b; Expires=${dateStr}`);
    expect(c.expires).toBe(Date.parse(dateStr));
  });

  it('lets Max-Age win when both Max-Age and Expires are present', () => {
    vi.useFakeTimers();
    const now = 1_000_000_000_000;
    vi.setSystemTime(now);
    const c = parseSetCookie('a=b; Expires=Wed, 21 Oct 2099 07:28:00 GMT; Max-Age=100');
    expect(c.expires).toBe(now + 100 * 1000);
    vi.useRealTimers();
  });

  it('computes expiry from Max-Age in seconds', () => {
    vi.useFakeTimers();
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);
    const c = parseSetCookie('a=b; Max-Age=60');
    expect(c.expires).toBe(now + 60 * 1000);
    vi.useRealTimers();
  });

  it('treats Max-Age=0 as already expired (in the past)', () => {
    vi.useFakeTimers();
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);
    const c = parseSetCookie('a=b; Max-Age=0');
    expect(c.expires).toBeLessThanOrEqual(now);
    vi.useRealTimers();
  });

  it('treats negative Max-Age as already expired', () => {
    vi.useFakeTimers();
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);
    const c = parseSetCookie('a=b; Max-Age=-50');
    expect(c.expires).toBeLessThanOrEqual(now);
    vi.useRealTimers();
  });

  it('strips a single leading dot from Domain and lowercases it', () => {
    const c = parseSetCookie('a=b; Domain=.Example.com');
    expect(c.domain).toBe('example.com');
  });

  it('lowercases Domain without a leading dot', () => {
    const c = parseSetCookie('a=b; Domain=API.Example.COM');
    expect(c.domain).toBe('api.example.com');
  });

  it('sets Secure and HttpOnly flags by presence', () => {
    const c = parseSetCookie('a=b; Secure; HttpOnly');
    expect(c.secure).toBe(true);
    expect(c.httpOnly).toBe(true);
  });

  it('normalizes SameSite=none to canonical None', () => {
    const c = parseSetCookie('a=b; SameSite=none');
    expect(c.sameSite).toBe('None');
  });

  it('normalizes SameSite=strict to canonical Strict', () => {
    const c = parseSetCookie('a=b; SameSite=strict');
    expect(c.sameSite).toBe('Strict');
  });

  it('normalizes SameSite=lax to canonical Lax', () => {
    const c = parseSetCookie('a=b; SameSite=LAX');
    expect(c.sameSite).toBe('Lax');
  });

  it('defaults SameSite to Lax when missing', () => {
    const c = parseSetCookie('a=b');
    expect(c.sameSite).toBe('Lax');
  });

  it('defaults Path to / when missing', () => {
    const c = parseSetCookie('a=b');
    expect(c.path).toBe('/');
  });

  it('returns null for an empty string', () => {
    expect(parseSetCookie('')).toBeNull();
  });

  it('returns null when there is no name=value pair (only attributes)', () => {
    expect(parseSetCookie('Secure; HttpOnly; Path=/')).toBeNull();
  });
});

describe('cookiesForUrl', () => {
  it('matches a subdomain via an explicit domain attribute', () => {
    const jar = {
      'example.com': [cookie('a', '1', { domain: 'example.com' })],
    };
    const result = cookiesForUrl(jar, 'https://api.example.com/');
    expect(result.map((c) => c.name)).toContain('a');
  });

  it('matches the apex domain itself via an explicit domain attribute', () => {
    const jar = {
      'example.com': [cookie('a', '1', { domain: 'example.com' })],
    };
    const result = cookiesForUrl(jar, 'https://example.com/');
    expect(result.map((c) => c.name)).toContain('a');
  });

  it('uses exact-host matching for a host-only cookie (domain null)', () => {
    const jar = {
      'example.com': [cookie('a', '1', { domain: null })],
    };
    expect(cookiesForUrl(jar, 'https://example.com/').map((c) => c.name)).toContain('a');
    // host-only cookie must NOT leak to a subdomain
    expect(cookiesForUrl(jar, 'https://api.example.com/').map((c) => c.name)).not.toContain('a');
  });

  it('matches by path prefix', () => {
    const jar = {
      'example.com': [cookie('a', '1', { domain: 'example.com', path: '/api' })],
    };
    expect(cookiesForUrl(jar, 'https://example.com/api').map((c) => c.name)).toContain('a');
    expect(cookiesForUrl(jar, 'https://example.com/api/users').map((c) => c.name)).toContain('a');
    expect(cookiesForUrl(jar, 'https://example.com/apixyz').map((c) => c.name)).not.toContain('a');
    expect(cookiesForUrl(jar, 'https://example.com/other').map((c) => c.name)).not.toContain('a');
  });

  it('treats a default path of / as matching everything', () => {
    const jar = {
      'example.com': [cookie('a', '1', { domain: 'example.com', path: '/' })],
    };
    expect(cookiesForUrl(jar, 'https://example.com/anything/here').map((c) => c.name)).toContain('a');
  });

  it('treats a URL with no path as path /', () => {
    const jar = {
      'example.com': [cookie('a', '1', { domain: 'example.com', path: '/' })],
    };
    expect(cookiesForUrl(jar, 'https://example.com').map((c) => c.name)).toContain('a');
  });

  it('drops expired cookies', () => {
    vi.useFakeTimers();
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);
    const jar = {
      'example.com': [
        cookie('expired', '1', { domain: 'example.com', expires: now - 1000 }),
        cookie('live', '2', { domain: 'example.com', expires: now + 1000 }),
        cookie('session', '3', { domain: 'example.com', expires: null }),
      ],
    };
    const names = cookiesForUrl(jar, 'https://example.com/').map((c) => c.name);
    expect(names).not.toContain('expired');
    expect(names).toContain('live');
    expect(names).toContain('session');
    vi.useRealTimers();
  });

  it('drops cookies whose expiry exactly equals now', () => {
    vi.useFakeTimers();
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);
    const jar = {
      'example.com': [cookie('a', '1', { domain: 'example.com', expires: now })],
    };
    expect(cookiesForUrl(jar, 'https://example.com/').map((c) => c.name)).not.toContain('a');
    vi.useRealTimers();
  });

  it('sends secure cookies only over https', () => {
    const jar = {
      'example.com': [cookie('s', '1', { domain: 'example.com', secure: true })],
    };
    expect(cookiesForUrl(jar, 'https://example.com/').map((c) => c.name)).toContain('s');
    expect(cookiesForUrl(jar, 'http://example.com/').map((c) => c.name)).not.toContain('s');
  });

  it('finds a cookie stored under a parent domain for a subdomain request', () => {
    const jar = {
      'example.com': [cookie('parent', '1', { domain: 'example.com' })],
    };
    const result = cookiesForUrl(jar, 'https://api.example.com/');
    expect(result.map((c) => c.name)).toContain('parent');
  });

  it('iterates all jar domains', () => {
    const jar = {
      'example.com': [cookie('a', '1', { domain: 'example.com' })],
      'other.com': [cookie('b', '2', { domain: 'other.com' })],
    };
    const names = cookiesForUrl(jar, 'https://example.com/').map((c) => c.name);
    expect(names).toContain('a');
    expect(names).not.toContain('b');
  });
});

describe('serializeCookieHeader', () => {
  it('joins cookies as k=v pairs separated by "; "', () => {
    const cookies = [cookie('k1', 'v1'), cookie('k2', 'v2')];
    expect(serializeCookieHeader(cookies)).toBe('k1=v1; k2=v2');
  });

  it('returns empty string for an empty array', () => {
    expect(serializeCookieHeader([])).toBe('');
  });
});

describe('upsertCookie', () => {
  it('inserts a new cookie under a domain', () => {
    const jar = {};
    const next = upsertCookie(jar, 'example.com', cookie('a', '1'));
    expect(next['example.com'].map((c) => c.name)).toEqual(['a']);
  });

  it('replaces an existing cookie by name+path', () => {
    const jar = { 'example.com': [cookie('a', 'old', { path: '/' })] };
    const next = upsertCookie(jar, 'example.com', cookie('a', 'new', { path: '/' }));
    expect(next['example.com'].length).toBe(1);
    expect(next['example.com'][0].value).toBe('new');
  });

  it('keeps cookies with the same name but different path as separate entries', () => {
    const jar = { 'example.com': [cookie('a', '1', { path: '/' })] };
    const next = upsertCookie(jar, 'example.com', cookie('a', '2', { path: '/api' }));
    expect(next['example.com'].length).toBe(2);
  });

  it('does NOT mutate the input jar', () => {
    const jar = { 'example.com': [cookie('a', '1')] };
    const snapshot = JSON.parse(JSON.stringify(jar));
    upsertCookie(jar, 'example.com', cookie('b', '2'));
    expect(jar).toEqual(snapshot);
  });

  it('lowercases the domain key', () => {
    const next = upsertCookie({}, 'Example.COM', cookie('a', '1'));
    expect(Object.keys(next)).toContain('example.com');
    expect(Object.keys(next)).not.toContain('Example.COM');
  });
});

describe('removeCookie', () => {
  it('removes all cookies with the given name under the domain', () => {
    const jar = {
      'example.com': [cookie('a', '1'), cookie('b', '2')],
    };
    const next = removeCookie(jar, 'example.com', 'a');
    expect(next['example.com'].map((c) => c.name)).toEqual(['b']);
  });

  it('drops the domain key when it becomes empty', () => {
    const jar = { 'example.com': [cookie('a', '1')] };
    const next = removeCookie(jar, 'example.com', 'a');
    expect(next['example.com']).toBeUndefined();
    expect(Object.keys(next)).not.toContain('example.com');
  });

  it('is a no-op when the cookie is absent', () => {
    const jar = { 'example.com': [cookie('a', '1')] };
    const next = removeCookie(jar, 'example.com', 'missing');
    expect(next['example.com'].map((c) => c.name)).toEqual(['a']);
  });

  it('is a no-op when the domain is absent', () => {
    const jar = { 'example.com': [cookie('a', '1')] };
    const next = removeCookie(jar, 'absent.com', 'a');
    expect(next).toEqual(jar);
  });

  it('does NOT mutate the input jar', () => {
    const jar = { 'example.com': [cookie('a', '1'), cookie('b', '2')] };
    const snapshot = JSON.parse(JSON.stringify(jar));
    removeCookie(jar, 'example.com', 'a');
    expect(jar).toEqual(snapshot);
  });
});

describe('removeDomain', () => {
  it('drops the domain entry', () => {
    const jar = {
      'example.com': [cookie('a', '1')],
      'other.com': [cookie('b', '2')],
    };
    const next = removeDomain(jar, 'example.com');
    expect(next['example.com']).toBeUndefined();
    expect(next['other.com']).toBeDefined();
  });

  it('is a no-op when the domain is absent', () => {
    const jar = { 'example.com': [cookie('a', '1')] };
    const next = removeDomain(jar, 'absent.com');
    expect(next).toEqual(jar);
  });

  it('does NOT mutate the input jar', () => {
    const jar = { 'example.com': [cookie('a', '1')] };
    const snapshot = JSON.parse(JSON.stringify(jar));
    removeDomain(jar, 'example.com');
    expect(jar).toEqual(snapshot);
  });
});

describe('extractSetCookies', () => {
  it('returns result.setCookies verbatim (proxy path)', () => {
    expect(extractSetCookies({ setCookies: ['a=1', 'b=2'] })).toEqual(['a=1', 'b=2']);
  });

  it('reads set-cookie values from a headers array, case-insensitively, in order (Tauri path)', () => {
    const result = {
      headers: [
        { key: 'Set-Cookie', value: 'a=1; Path=/' },
        { key: 'Content-Type', value: 'text/html' },
        { key: 'set-cookie', value: 'b=2' },
      ],
    };
    expect(extractSetCookies(result)).toEqual(['a=1; Path=/', 'b=2']);
  });

  it('returns [] when a headers array has no set-cookie entries (browser path)', () => {
    expect(extractSetCookies({ headers: [{ key: 'Content-Type', value: 'text/html' }] })).toEqual([]);
  });

  it('returns [] for an empty object', () => {
    expect(extractSetCookies({})).toEqual([]);
  });

  it('returns [] for null', () => {
    expect(extractSetCookies(null)).toEqual([]);
  });

  it('returns [] for undefined', () => {
    expect(extractSetCookies(undefined)).toEqual([]);
  });

  it('lets setCookies take precedence over headers (does not also scan headers)', () => {
    const result = { setCookies: ['x=1'], headers: [{ key: 'set-cookie', value: 'y=2' }] };
    expect(extractSetCookies(result)).toEqual(['x=1']);
  });

  it('is null-safe for header entries that lack a key', () => {
    const result = {
      headers: [
        { value: 'orphan' },
        null,
        { key: 'set-cookie', value: 'a=1' },
      ],
    };
    expect(extractSetCookies(result)).toEqual(['a=1']);
  });

  it('does NOT mutate its input', () => {
    const result = {
      setCookies: ['a=1', 'b=2'],
      headers: [{ key: 'set-cookie', value: 'c=3' }],
    };
    const snapshot = JSON.parse(JSON.stringify(result));
    extractSetCookies(result);
    expect(result).toEqual(snapshot);
  });
});

describe('buildCookieHeader', () => {
  // Note: expiry/domain/path/secure filtering is enforced upstream by
  // cookiesForUrl (covered by the 'cookiesForUrl' tests above), so
  // buildCookieHeader does not retest that — its jar input is pre-filtered.

  // --- Criterion 1: jar cookies present -> header contains them ---
  it('serializes a single jar cookie as name=value', () => {
    expect(buildCookieHeader([cookie('a', '1')])).toBe('a=1');
  });

  it('serializes multiple jar cookies joined by "; " in order', () => {
    const jar = [cookie('a', '1'), cookie('b', '2'), cookie('c', '3')];
    expect(buildCookieHeader(jar)).toBe('a=1; b=2; c=3');
  });

  // --- Criterion 2: empty jar (and no manual) -> '' ---
  it('returns empty string for an empty jar and no manual value', () => {
    expect(buildCookieHeader([])).toBe('');
  });

  it('returns empty string for an empty jar and an empty manual value', () => {
    expect(buildCookieHeader([], '')).toBe('');
  });

  it('returns empty string when both inputs are absent', () => {
    expect(buildCookieHeader([], undefined)).toBe('');
  });

  // --- Criterion 3: manual preserved + merged, manual wins on collision ---
  it('preserves a manual Cookie value when the jar is empty', () => {
    expect(buildCookieHeader([], 'a=1; b=2')).toBe('a=1; b=2');
  });

  it('keeps the manual value verbatim on a name collision (manual wins)', () => {
    const jar = [cookie('a', 'JAR')];
    expect(buildCookieHeader(jar, 'a=MANUAL')).toBe('a=MANUAL');
  });

  it('uses the manual value (not the jar value) for a colliding name even with other cookies present', () => {
    const jar = [cookie('session', 'jarSession'), cookie('extra', 'jarExtra')];
    const result = buildCookieHeader(jar, 'session=manualSession');
    expect(result).toContain('session=manualSession');
    expect(result).not.toContain('session=jarSession');
    expect(result).toContain('extra=jarExtra');
  });

  // --- Criterion 3/4: non-colliding manual cookies kept alongside jar; ordering ---
  it('keeps non-colliding manual cookies alongside jar cookies, manual first then jar-only', () => {
    const jar = [cookie('jarOnly', 'jv')];
    expect(buildCookieHeader(jar, 'm1=1; m2=2')).toBe('m1=1; m2=2; jarOnly=jv');
  });

  it('orders manual cookies first then jar-only cookies, dropping jar duplicates', () => {
    const jar = [cookie('a', 'jarA'), cookie('z', 'jarZ')];
    // 'a' collides -> manual wins and stays in manual position; 'z' is jar-only and appended
    expect(buildCookieHeader(jar, 'a=manualA; b=manualB')).toBe('a=manualA; b=manualB; z=jarZ');
  });

  it('matches collision names case-sensitively (different case = not a collision)', () => {
    const jar = [cookie('Session', 'jarValue')];
    // manual 'session' (lowercase) does NOT collide with jar 'Session'
    const result = buildCookieHeader(jar, 'session=manualValue');
    expect(result).toBe('session=manualValue; Session=jarValue');
  });

  // --- Edge cases: whitespace, no '=', empty segments, falsy manual ---
  it('trims whitespace around manual segment names and values', () => {
    const jar = [cookie('c', '3')];
    expect(buildCookieHeader(jar, ' a = 1 ; b=2 ')).toBe('a=1; b=2; c=3');
  });

  it('treats a manual segment with no "=" as a name with an empty value', () => {
    // Spec: split each segment on the FIRST '='; only empty/empty-name
    // segments are dropped. A bare token has a non-empty name -> value ''.
    expect(buildCookieHeader([], 'a=1; justaflag; b=2')).toBe('a=1; justaflag=; b=2');
  });

  it('ignores empty manual segments', () => {
    expect(buildCookieHeader([], 'a=1;; ; b=2;')).toBe('a=1; b=2');
  });

  it('ignores a manual segment with an empty name', () => {
    expect(buildCookieHeader([], '=novalue; a=1')).toBe('a=1');
  });

  it('splits a manual segment on the FIRST "=" only (value may contain "=")', () => {
    expect(buildCookieHeader([], 'token=a=b=c')).toBe('token=a=b=c');
  });

  it('treats undefined manualCookieValue as no manual cookies', () => {
    const jar = [cookie('a', '1')];
    expect(buildCookieHeader(jar, undefined)).toBe('a=1');
  });

  it('treats empty-string manualCookieValue as no manual cookies', () => {
    const jar = [cookie('a', '1')];
    expect(buildCookieHeader(jar, '')).toBe('a=1');
  });

  it('returns the manual value alone when the jar is empty after dedupe', () => {
    const jar = [cookie('a', 'jar')];
    expect(buildCookieHeader(jar, 'a=manual')).toBe('a=manual');
  });
});
