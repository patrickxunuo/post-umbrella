// Pure helpers for the Cookie Manager dialog.
// Kept free of React so they can be unit-tested in isolation (Vitest).

// Case-insensitive substring filter of domain names.
// - empty/whitespace query returns all domains unchanged (same order)
// - otherwise returns domains whose lowercased name includes the lowercased trimmed query
export function filterDomains(domains, query) {
  const list = Array.isArray(domains) ? domains : [];
  const q = (query || '').trim().toLowerCase();
  if (!q) return list.slice();
  return list.filter((domain) => String(domain).toLowerCase().includes(q));
}

// Build a well-formed cookie object for manual creation.
// name/value are used as-is (trimming is the caller's responsibility).
export function makeCookie(name, value) {
  return {
    name,
    value,
    path: '/',
    expires: null,
    secure: false,
    httpOnly: false,
    sameSite: 'Lax',
    domain: null,
  };
}
