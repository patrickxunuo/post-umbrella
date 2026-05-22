import { describe, it, expect } from 'vitest';
import { filterDomains, makeCookie } from './cookieManagerUtils.js';

describe('filterDomains', () => {
  const domains = ['example.com', 'api.example.com', 'github.com', 'EXAMPLE.org'];

  it('returns all domains (order preserved) for an empty query', () => {
    expect(filterDomains(domains, '')).toEqual(domains);
  });

  it('returns all domains for a whitespace-only query', () => {
    expect(filterDomains(domains, '   ')).toEqual(domains);
  });

  it('matches case-insensitively (uppercase query matches lowercase domain)', () => {
    expect(filterDomains(domains, 'EX')).toEqual([
      'example.com',
      'api.example.com',
      'EXAMPLE.org',
    ]);
  });

  it('matches a lowercase query against an uppercase domain', () => {
    expect(filterDomains(['EXAMPLE.org'], 'example')).toEqual(['EXAMPLE.org']);
  });

  it('matches a partial mid-string substring', () => {
    expect(filterDomains(domains, 'thub')).toEqual(['github.com']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterDomains(domains, 'no-such-domain')).toEqual([]);
  });

  it('preserves order across multiple matches', () => {
    const ordered = ['z.example.com', 'a.example.com', 'm.example.com'];
    expect(filterDomains(ordered, 'example')).toEqual(ordered);
  });

  it('trims surrounding whitespace before matching', () => {
    expect(filterDomains(domains, '  github  ')).toEqual(['github.com']);
  });
});

describe('makeCookie', () => {
  it('returns a fully-defaulted cookie object for the given name/value', () => {
    expect(makeCookie('sid', 'abc123')).toEqual({
      name: 'sid',
      value: 'abc123',
      path: '/',
      expires: null,
      secure: false,
      httpOnly: false,
      sameSite: 'Lax',
      domain: null,
    });
  });

  it('uses name and value as-is (no trimming)', () => {
    const cookie = makeCookie('  spaced  ', '  val  ');
    expect(cookie.name).toBe('  spaced  ');
    expect(cookie.value).toBe('  val  ');
  });

  it('preserves an empty value', () => {
    expect(makeCookie('token', '')).toEqual({
      name: 'token',
      value: '',
      path: '/',
      expires: null,
      secure: false,
      httpOnly: false,
      sameSite: 'Lax',
      domain: null,
    });
  });
});
