// Shared variable substitution util.
// Single source of truth for {{env}}/{{collection}}/{:path} substitution
// across request execution, workflow execution, and cURL preview.

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Single-pass merge — collection first, env overrides. Avoids the bug where
// running collection sub then env sub sequentially makes env unable to override
// because the first pass already replaced the {{key}} pattern.
function buildEnvMap({ environment, collectionVariables }) {
  const resolved = new Map();
  if (collectionVariables) {
    for (const v of collectionVariables) {
      if (v.enabled === false || !v.key) continue;
      resolved.set(v.key, v.value ?? v.current_value ?? v.initial_value ?? '');
    }
  }
  if (environment?.variables) {
    for (const v of environment.variables) {
      if (v.enabled === false || !v.key) continue;
      resolved.set(v.key, v.value ?? v.current_value ?? v.initial_value ?? '');
    }
  }
  return resolved;
}

function applyEnvSubstitution(text, envMap) {
  if (!text) return text;
  let result = text;
  for (const [key, value] of envMap) {
    result = result.replace(
      new RegExp(`\\{\\{\\s*${escapeRegex(key)}\\s*\\}\\}`, 'g'),
      value ?? ''
    );
  }
  return result;
}

// Reserved characters that terminate a path variable name.
// RFC 3986 reserved chars + space + colon (a second colon ends the variable).
export const PATH_VAR_RESERVED = new Set([
  '/', '?', '#', '[', ']', '@',
  '!', '$', '&', "'", '(', ')', '*', '+', ',', ';', '=',
  ' ', ':',
]);

// Compute the [pathStart, pathEnd) substring of a URL where path-variable
// tokens are valid. Skips scheme://host:port and stops at ? or #.
function computePathRange(url) {
  let pathStart = 0;
  const schemeMatch = url.match(/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//);
  if (schemeMatch) {
    const afterScheme = schemeMatch[0].length;
    const firstSlash = url.indexOf('/', afterScheme);
    pathStart = firstSlash === -1 ? url.length : firstSlash;
  }
  let pathEnd = url.length;
  const queryStart = url.indexOf('?', pathStart);
  if (queryStart !== -1) pathEnd = Math.min(pathEnd, queryStart);
  const hashStart = url.indexOf('#', pathStart);
  if (hashStart !== -1) pathEnd = Math.min(pathEnd, hashStart);
  return { pathStart, pathEnd };
}

// Substitute {{env}} and {{collection}} variables in arbitrary text.
// Used for headers, body, auth, form-data, query params.
export function substituteEnv(text, { environment, collectionVariables } = {}) {
  if (!text) return text;
  return applyEnvSubstitution(text, buildEnvMap({ environment, collectionVariables }));
}

// Substitute the URL: applies path-vars first (with their values env-resolved),
// then env substitution on whatever remains.
export function substituteUrl(
  url,
  { environment, collectionVariables, pathVariables } = {}
) {
  if (!url) return url;
  const envMap = buildEnvMap({ environment, collectionVariables });

  let result = url;
  if (pathVariables && pathVariables.length > 0) {
    // Build the lookahead character class from PATH_VAR_RESERVED so it stays
    // in lockstep with the parser. \s covers space; the rest are literal escapes.
    const reservedChars = Array.from(PATH_VAR_RESERVED)
      .filter(ch => ch !== ' ')
      .map(ch => escapeRegex(ch))
      .join('');
    const lookahead = `(?=$|[${reservedChars}\\s])`;
    for (const pv of pathVariables) {
      if (!pv.key) continue;
      const resolvedValue = applyEnvSubstitution(pv.value || '', envMap);
      const pattern = new RegExp(`:${escapeRegex(pv.key)}${lookahead}`, 'g');
      result = result.replace(pattern, resolvedValue);
    }
  }
  return applyEnvSubstitution(result, envMap);
}

// Parse :name tokens out of a URL string in order.
// Returns Array<{ key, start, end }>.
//
// Skips `:` in scheme://host:port and ignores everything after ? or #.
export function extractPathVarTokens(url) {
  if (!url) return [];
  const tokens = [];
  const { pathStart, pathEnd } = computePathRange(url);
  let i = pathStart;
  while (i < pathEnd) {
    const ch = url[i];
    if (ch === ':' && url[i - 1] !== ':' && url[i + 1] !== ':') {
      let j = i + 1;
      while (j < pathEnd && !PATH_VAR_RESERVED.has(url[j])) j++;
      if (j > i + 1) {
        tokens.push({ key: url.slice(i + 1, j), start: i, end: j });
        i = j;
        continue;
      }
    }
    i++;
  }
  return tokens;
}

// Strip stray `:` followed immediately by a reserved char (or a non-name char).
// Trailing `:` at end-of-string is preserved (user may still be typing).
// `:` inside the host portion (scheme://host:port) is preserved.
export function sanitizeUrlForPathVars(url) {
  if (!url) return url;
  const { pathStart, pathEnd } = computePathRange(url);
  let result = '';
  for (let i = 0; i < url.length; i++) {
    const ch = url[i];
    // Only sanitize within the path portion
    if (ch === ':' && i >= pathStart && i < pathEnd) {
      const next = url[i + 1];
      if (next !== undefined && PATH_VAR_RESERVED.has(next) && next !== ':') {
        continue;
      }
    }
    result += ch;
  }
  return result;
}

// Reconcile current path-variables list against the URL.
// - For each token in URL: keep existing value if key matches.
// - For each entry in list NOT in URL: drop it.
// - New keys appended in URL order with empty value.
// - Duplicate keys in URL collapse to a single row (first occurrence).
export function reconcilePathVariables(url, currentPathVars) {
  const tokens = extractPathVarTokens(url);
  const seen = new Set();
  const result = [];
  for (const t of tokens) {
    if (seen.has(t.key)) continue;
    seen.add(t.key);
    const existing = currentPathVars?.find(pv => pv.key === t.key);
    result.push({ key: t.key, value: existing?.value || '' });
  }
  return result;
}
