const SAME_SITE_VALUES = ['Lax', 'Strict', 'None'];

export function getDomainFromUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function parseSetCookie(headerValue) {
  if (!headerValue || !headerValue.trim()) return null;

  const segments = headerValue.split(';');
  const first = segments[0];
  const eq = first.indexOf('=');
  if (eq === -1) return null;

  const name = first.slice(0, eq).trim();
  if (!name) return null;
  const value = first.slice(eq + 1).trim();

  const cookie = {
    name,
    value,
    path: '/',
    expires: null,
    secure: false,
    httpOnly: false,
    sameSite: 'Lax',
    domain: null,
  };

  let maxAgeExpires;
  let expiresAttr = null;

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i].trim();
    if (!seg) continue;
    const idx = seg.indexOf('=');
    const rawKey = idx === -1 ? seg : seg.slice(0, idx);
    const val = idx === -1 ? '' : seg.slice(idx + 1).trim();
    const key = rawKey.trim().toLowerCase();

    switch (key) {
      case 'path':
        cookie.path = val || '/';
        break;
      case 'domain': {
        const d = val.replace(/^\./, '').toLowerCase();
        cookie.domain = d || null;
        break;
      }
      case 'expires': {
        const parsed = Date.parse(val);
        if (!Number.isNaN(parsed)) expiresAttr = parsed;
        break;
      }
      case 'max-age': {
        const maxAge = parseInt(val, 10);
        if (!Number.isNaN(maxAge)) maxAgeExpires = Date.now() + maxAge * 1000;
        break;
      }
      case 'secure':
        cookie.secure = true;
        break;
      case 'httponly':
        cookie.httpOnly = true;
        break;
      case 'samesite': {
        const match = SAME_SITE_VALUES.find((s) => s.toLowerCase() === val.toLowerCase());
        cookie.sameSite = match || 'Lax';
        break;
      }
      default:
        break;
    }
  }

  if (maxAgeExpires !== undefined) {
    cookie.expires = maxAgeExpires;
  } else if (expiresAttr !== null) {
    cookie.expires = expiresAttr;
  }

  return cookie;
}

function pathMatches(urlPath, cookiePath) {
  if (urlPath === cookiePath) return true;
  if (cookiePath === '/') return true;
  const prefix = cookiePath.endsWith('/') ? cookiePath : cookiePath + '/';
  return urlPath.startsWith(prefix);
}

export function cookiesForUrl(jar, url) {
  let host;
  let urlPath;
  let isHttps;
  try {
    const parsed = new URL(url);
    host = parsed.hostname.toLowerCase();
    urlPath = parsed.pathname || '/';
    isHttps = parsed.protocol === 'https:';
  } catch {
    return [];
  }
  if (!urlPath) urlPath = '/';

  const now = Date.now();
  const result = [];

  for (const key of Object.keys(jar)) {
    const cookies = jar[key];
    if (!cookies) continue;
    for (const cookie of cookies) {
      let domainOk;
      if (cookie.domain) {
        domainOk = host === cookie.domain || host.endsWith('.' + cookie.domain);
      } else {
        domainOk = host === key;
      }
      if (!domainOk) continue;

      if (!pathMatches(urlPath, cookie.path || '/')) continue;

      if (cookie.expires != null && cookie.expires <= now) continue;

      if (cookie.secure && !isHttps) continue;

      result.push(cookie);
    }
  }

  return result;
}

export function serializeCookieHeader(cookies) {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

export function upsertCookie(jar, domain, cookie) {
  const key = domain.toLowerCase();
  const existing = jar[key] || [];
  const idx = existing.findIndex((c) => c.name === cookie.name && c.path === cookie.path);

  let next;
  if (idx === -1) {
    next = [...existing, cookie];
  } else {
    next = existing.slice();
    next[idx] = cookie;
  }

  return { ...jar, [key]: next };
}

export function removeCookie(jar, domain, name) {
  const key = domain.toLowerCase();
  const existing = jar[key];
  if (!existing) return { ...jar };

  const next = existing.filter((c) => c.name !== name);
  const result = { ...jar };
  if (next.length === 0) {
    delete result[key];
  } else {
    result[key] = next;
  }
  return result;
}

export function removeDomain(jar, domain) {
  const key = domain.toLowerCase();
  const result = { ...jar };
  delete result[key];
  return result;
}
