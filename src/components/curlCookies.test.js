import { describe, it, expect } from 'vitest';
import { generateCurl } from './RequestEditor';
import { parseCurl } from './ImportCurlModal';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

// A jar cookie is a plain { name, value } object (the 9th arg shape).
function jarCookie(name, value) {
  return { name, value };
}

// A header row as used by generateCurl's `headers` argument.
function header(key, value) {
  return { key, value, enabled: true };
}

// Extract the contents of the single -b '...' flag from a generated curl
// string, or null if there is no -b flag. Accounts for the '\'' escape
// sequence by matching up to the closing quote that is NOT part of an escape.
function extractCookieFlag(curl) {
  // -b ' ... ' where embedded single quotes are written as '\''
  const match = curl.match(/-b '((?:[^']|'\\'')*)'/);
  if (!match) return null;
  // Reverse the shell escaping to recover the original cookie string.
  return match[1].replace(/'\\''/g, "'");
}

// Pull the Cookie header row(s) out of a parseCurl result.
function cookieRows(result) {
  return result.headers.filter((h) => h.key === 'Cookie');
}

// All non-empty header rows (drops the trailing empty editing row).
function realHeaders(result) {
  return result.headers.filter((h) => h.key);
}

// ===========================================================================
// EXPORT — generateCurl
// Acceptance Criteria 1–4 plus export edge cases.
// ===========================================================================

describe('generateCurl — cookie export', () => {
  // --- Criterion 1: export emits -b ---
  describe('Criterion 1: emits -b for jar cookies', () => {
    it('emits a single -b flag with a single jar cookie', () => {
      const curl = generateCurl('GET', 'https://api.example.com/', [], '', 'none', [], 'none', '', [
        jarCookie('a', '1'),
      ]);
      expect(extractCookieFlag(curl)).toBe('a=1');
    });

    it('emits multiple jar cookies joined by "; " in order', () => {
      const curl = generateCurl('GET', 'https://api.example.com/', [], '', 'none', [], 'none', '', [
        jarCookie('a', '1'),
        jarCookie('b', '2'),
        jarCookie('c', '3'),
      ]);
      expect(extractCookieFlag(curl)).toBe('a=1; b=2; c=3');
    });

    it('emits exactly one -b flag (not one per cookie)', () => {
      const curl = generateCurl('GET', 'https://api.example.com/', [], '', 'none', [], 'none', '', [
        jarCookie('a', '1'),
        jarCookie('b', '2'),
      ]);
      const occurrences = (curl.match(/-b '/g) || []).length;
      expect(occurrences).toBe(1);
    });

    it('emits -b for a manual Cookie header even with an empty jar', () => {
      const curl = generateCurl(
        'GET',
        'https://api.example.com/',
        [header('Cookie', 'sid=xyz')],
        '',
        'none',
        [],
        'none',
        '',
        []
      );
      expect(extractCookieFlag(curl)).toBe('sid=xyz');
    });
  });

  // --- Criterion 2: no duplication (never both -b and -H 'Cookie:') ---
  describe('Criterion 2: never emits a -H Cookie header', () => {
    it('does not emit -H \'Cookie: ...\' when a manual Cookie header is present', () => {
      const curl = generateCurl(
        'GET',
        'https://api.example.com/',
        [header('Cookie', 'a=1')],
        '',
        'none',
        [],
        'none',
        '',
        []
      );
      expect(curl).not.toMatch(/-H 'Cookie:/i);
      // The cookie is still represented, just via -b.
      expect(extractCookieFlag(curl)).toBe('a=1');
    });

    it('folds a manual Cookie header into -b and never duplicates it as -H', () => {
      const curl = generateCurl(
        'GET',
        'https://api.example.com/',
        [header('Content-Type', 'application/json'), header('Cookie', 'a=1; b=2')],
        '',
        'none',
        [],
        'none',
        '',
        [jarCookie('c', '3')]
      );
      // No Cookie header line at all.
      expect(curl).not.toMatch(/-H 'Cookie:/i);
      // Non-cookie header is preserved.
      expect(curl).toContain("-H 'Content-Type: application/json'");
      // Cookie flows through -b.
      expect(extractCookieFlag(curl)).toBe('a=1; b=2; c=3');
    });

    it('skips a Cookie header regardless of key case', () => {
      const curl = generateCurl(
        'GET',
        'https://api.example.com/',
        [header('cookie', 'a=1')],
        '',
        'none',
        [],
        'none',
        '',
        []
      );
      expect(curl).not.toMatch(/-H '[Cc]ookie:/);
      expect(extractCookieFlag(curl)).toBe('a=1');
    });
  });

  // --- Criterion 3: manual wins / merge order ---
  describe('Criterion 3: manual wins and merge order', () => {
    it('puts manual pairs first, appends jar-only cookies', () => {
      const curl = generateCurl(
        'GET',
        'https://api.example.com/',
        [header('Cookie', 'm1=1; m2=2')],
        '',
        'none',
        [],
        'none',
        '',
        [jarCookie('jarOnly', 'jv')]
      );
      expect(extractCookieFlag(curl)).toBe('m1=1; m2=2; jarOnly=jv');
    });

    it('lets the manual value win on a name collision', () => {
      const curl = generateCurl(
        'GET',
        'https://api.example.com/',
        [header('Cookie', 'session=manual')],
        '',
        'none',
        [],
        'none',
        '',
        [jarCookie('session', 'jar'), jarCookie('extra', 'jarExtra')]
      );
      const value = extractCookieFlag(curl);
      expect(value).toContain('session=manual');
      expect(value).not.toContain('session=jar');
      expect(value).toContain('extra=jarExtra');
      // Manual pair stays in front, jar-only appended.
      expect(value).toBe('session=manual; extra=jarExtra');
    });
  });

  // --- Criterion 4: no cookies -> no -b ---
  describe('Criterion 4: no cookies produces no -b', () => {
    it('emits no -b flag with neither jar cookies nor a manual Cookie header', () => {
      const curl = generateCurl('GET', 'https://api.example.com/', [], '', 'none', [], 'none', '', []);
      expect(curl).not.toContain('-b ');
      expect(extractCookieFlag(curl)).toBeNull();
    });

    it('emits no -b flag when the cookies arg is omitted entirely (backward compat)', () => {
      const curl = generateCurl('GET', 'https://api.example.com/', [], '', 'none', [], 'none', '');
      expect(curl).not.toContain('-b ');
    });

    it('produces identical output with no cookies arg and an empty cookies array', () => {
      const withOmitted = generateCurl(
        'POST',
        'https://api.example.com/users',
        [header('Content-Type', 'application/json')],
        '{"a":1}',
        'json',
        [],
        'none',
        ''
      );
      const withEmpty = generateCurl(
        'POST',
        'https://api.example.com/users',
        [header('Content-Type', 'application/json')],
        '{"a":1}',
        'json',
        [],
        'none',
        '',
        []
      );
      expect(withEmpty).toBe(withOmitted);
      expect(withEmpty).not.toContain('-b ');
    });
  });

  // --- Edge cases for export ---
  describe('export edge cases', () => {
    it('preserves a cookie value containing "=" (split on first "=" only)', () => {
      const curl = generateCurl('GET', 'https://api.example.com/', [], '', 'none', [], 'none', '', [
        jarCookie('token', 'a=b=c'),
      ]);
      expect(extractCookieFlag(curl)).toBe('token=a=b=c');
    });

    it('shell-escapes single quotes inside the cookie value', () => {
      const curl = generateCurl(
        'GET',
        'https://api.example.com/',
        [header('Cookie', "x=a'b")],
        '',
        'none',
        [],
        'none',
        '',
        []
      );
      // The raw output uses the '\'' escape sequence.
      expect(curl).toContain("-b 'x=a'\\''b'");
      // And it decodes back to the original value.
      expect(extractCookieFlag(curl)).toBe("x=a'b");
    });

    it('handles jar-only cookies with no manual Cookie header', () => {
      const curl = generateCurl('GET', 'https://api.example.com/', [], '', 'none', [], 'none', '', [
        jarCookie('only', 'v'),
      ]);
      expect(extractCookieFlag(curl)).toBe('only=v');
      expect(curl).not.toMatch(/-H 'Cookie:/i);
    });

    it('handles a manual-only Cookie header with an empty jar', () => {
      const curl = generateCurl(
        'GET',
        'https://api.example.com/',
        [header('Cookie', 'm=1')],
        '',
        'none',
        [],
        'none',
        '',
        []
      );
      expect(extractCookieFlag(curl)).toBe('m=1');
    });

    it('still emits the body and other flags alongside -b', () => {
      const curl = generateCurl(
        'POST',
        'https://api.example.com/login',
        [header('Content-Type', 'application/json')],
        '{"u":"x"}',
        'json',
        [],
        'none',
        '',
        [jarCookie('sid', 'abc')]
      );
      expect(curl).toContain('-X POST');
      expect(curl).toContain("'https://api.example.com/login'");
      expect(curl).toContain("-H 'Content-Type: application/json'");
      expect(curl).toContain('-d \'{"u":"x"}\'');
      expect(extractCookieFlag(curl)).toBe('sid=abc');
    });
  });
});

// ===========================================================================
// IMPORT — parseCurl
// Acceptance Criteria 5–7 plus import edge cases.
// ===========================================================================

describe('parseCurl — cookie import', () => {
  // --- Criterion 5: import -b / --cookie ---
  describe('Criterion 5: parses -b / --cookie into one Cookie header', () => {
    it('parses -b "a=1; b=2" into a single Cookie header', () => {
      const result = parseCurl('curl -b "a=1; b=2" https://api.example.com/');
      const rows = cookieRows(result);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ key: 'Cookie', value: 'a=1; b=2', enabled: true });
    });

    it('parses --cookie long form into a single Cookie header', () => {
      const result = parseCurl('curl --cookie "a=1; b=2" https://api.example.com/');
      const rows = cookieRows(result);
      expect(rows).toHaveLength(1);
      expect(rows[0].value).toBe('a=1; b=2');
    });

    it('appends the Cookie row before the trailing empty editing row', () => {
      const result = parseCurl('curl -b "a=1" https://api.example.com/');
      const last = result.headers[result.headers.length - 1];
      expect(last).toEqual({ key: '', value: '', enabled: true });
      // Exactly one real header (the Cookie one) plus the trailing empty row.
      expect(realHeaders(result)).toHaveLength(1);
      expect(realHeaders(result)[0].key).toBe('Cookie');
    });
  });

  // --- Criterion 6: import -H "Cookie: ..." ---
  describe('Criterion 6: parses -H "Cookie: ..." into one Cookie header', () => {
    it('parses a Cookie header passed via -H', () => {
      const result = parseCurl('curl -H "Cookie: a=1; b=2" https://api.example.com/');
      const rows = cookieRows(result);
      expect(rows).toHaveLength(1);
      expect(rows[0].value).toBe('a=1; b=2');
    });

    it('does not create a duplicate Cookie row from a -H Cookie header', () => {
      const result = parseCurl('curl -H "Cookie: a=1" https://api.example.com/');
      expect(cookieRows(result)).toHaveLength(1);
    });

    it('recognizes a mixed-case cookie header key', () => {
      const result = parseCurl('curl -H "cookie: a=1; b=2" https://api.example.com/');
      const rows = cookieRows(result);
      expect(rows).toHaveLength(1);
      expect(rows[0].value).toBe('a=1; b=2');
    });
  });

  // --- Criterion 7: import merge (-b + -H Cookie), first-wins ---
  describe('Criterion 7: merges -b and -H Cookie into one row', () => {
    it('merges -b "a=1" and -H "Cookie: b=2" into a single Cookie header', () => {
      const result = parseCurl('curl -b "a=1" -H "Cookie: b=2" https://api.example.com/');
      const rows = cookieRows(result);
      expect(rows).toHaveLength(1);
      expect(rows[0].value).toBe('a=1; b=2');
    });

    it('keeps first occurrence on a name collision across sources', () => {
      // -b appears first, so a=first wins over the -H a=second.
      const result = parseCurl('curl -b "a=first" -H "Cookie: a=second; b=2" https://api.example.com/');
      const rows = cookieRows(result);
      expect(rows).toHaveLength(1);
      expect(rows[0].value).toBe('a=first; b=2');
    });

    it('still produces exactly one Cookie row from multiple cookie sources', () => {
      const result = parseCurl('curl -b "a=1" --cookie "b=2" -H "Cookie: c=3" https://api.example.com/');
      expect(cookieRows(result)).toHaveLength(1);
      expect(cookieRows(result)[0].value).toBe('a=1; b=2; c=3');
    });
  });

  // --- Import edge cases ---
  describe('import edge cases', () => {
    it('tolerates whitespace around cookie segments', () => {
      const result = parseCurl('curl -b " a = 1 ; b=2 " https://api.example.com/');
      expect(cookieRows(result)[0].value).toBe('a=1; b=2');
    });

    it('does not affect non-cookie headers', () => {
      const result = parseCurl(
        'curl -H "Content-Type: application/json" -b "a=1" https://api.example.com/'
      );
      const ct = result.headers.find((h) => h.key === 'Content-Type');
      expect(ct).toBeDefined();
      expect(ct.value).toBe('application/json');
      expect(cookieRows(result)).toHaveLength(1);
    });

    it('does not affect body or method defaulting', () => {
      const result = parseCurl('curl -b "a=1" -d \'{"x":1}\' https://api.example.com/');
      expect(result.method).toBe('POST');
      expect(result.body).toBe('{"x":1}');
      expect(result.bodyType).toBe('json');
      expect(cookieRows(result)[0].value).toBe('a=1');
    });

    it('preserves the URL and default method for a plain cookie GET', () => {
      const result = parseCurl('curl -b "a=1" https://api.example.com/path');
      expect(result.url).toBe('https://api.example.com/path');
      expect(result.method).toBe('GET');
    });

    it('produces no Cookie row when there are no cookie sources', () => {
      const result = parseCurl('curl -H "Content-Type: text/plain" https://api.example.com/');
      expect(cookieRows(result)).toHaveLength(0);
    });
  });
});

// ===========================================================================
// ROUND-TRIP — Criterion 8
// Export cookies, re-import the generated curl, assert preservation.
// ===========================================================================

describe('cookie round-trip (Criterion 8)', () => {
  it('preserves cookies through generate -> parse', () => {
    const exported = generateCurl(
      'GET',
      'https://api.example.com/',
      [],
      '',
      'none',
      [],
      'none',
      '',
      [jarCookie('a', '1'), jarCookie('b', '2')]
    );
    const bValue = extractCookieFlag(exported);
    expect(bValue).toBe('a=1; b=2');

    const reimported = parseCurl(exported);
    const rows = cookieRows(reimported);
    expect(rows).toHaveLength(1);
    // The imported Cookie header value matches the exported -b value.
    expect(rows[0].value).toBe(bValue);
  });

  it('round-trips a merged manual + jar cookie set', () => {
    const exported = generateCurl(
      'GET',
      'https://api.example.com/',
      [header('Cookie', 'session=manual')],
      '',
      'none',
      [],
      'none',
      '',
      [jarCookie('session', 'jar'), jarCookie('extra', 'e')]
    );
    const bValue = extractCookieFlag(exported);
    expect(bValue).toBe('session=manual; extra=e');

    const reimported = parseCurl(exported);
    const rows = cookieRows(reimported);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(bValue);
  });

  it('round-trips re-exporting the imported Cookie header back to -b', () => {
    const exported = generateCurl('GET', 'https://api.example.com/', [], '', 'none', [], 'none', '', [
      jarCookie('a', '1'),
      jarCookie('b', '2'),
    ]);
    const reimported = parseCurl(exported);
    const cookieHeader = cookieRows(reimported)[0];

    // Feed the imported Cookie header back into generateCurl (no jar this time).
    const reExported = generateCurl(
      reimported.method,
      reimported.url,
      [cookieHeader],
      reimported.body,
      reimported.bodyType,
      reimported.formData,
      'none',
      '',
      []
    );
    expect(extractCookieFlag(reExported)).toBe('a=1; b=2');
    expect(reExported).not.toMatch(/-H 'Cookie:/i);
  });
});
