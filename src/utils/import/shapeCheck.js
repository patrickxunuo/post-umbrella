// Syntactic, cheap detection of which format the parsed JSON actually looks
// like. Runs before schema validation so wrong-format uploads can fail fast
// with a helpful "Switch to <detected>?" suggestion in the UI.

const POSTMAN_V21_SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';
const POSTMAN_V20_SCHEMA = 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json';

/** Identify the format of a parsed JSON object (best-effort, syntactic only). */
export function detectFormat(parsed) {
  if (!parsed || typeof parsed !== 'object') return 'unknown';
  if (parsed.info && typeof parsed.info._post_umbrella_version === 'string') {
    return 'post-umbrella';
  }
  const schemaUrl = parsed.info && typeof parsed.info.schema === 'string' ? parsed.info.schema : '';
  if (schemaUrl === POSTMAN_V21_SCHEMA) return 'postman-v2.1';
  if (schemaUrl === POSTMAN_V20_SCHEMA) return 'postman-v2.0';
  // Some Postman exports use slightly different casing / trailing slashes.
  if (schemaUrl.includes('schema.getpostman.com') && schemaUrl.includes('v2.1')) return 'postman-v2.1';
  if (schemaUrl.includes('schema.getpostman.com') && schemaUrl.includes('v2.0')) return 'postman-v2.0';
  if (parsed._type === 'export' && parsed.__export_format === 4) return 'insomnia-v4';
  if (typeof parsed.openapi === 'string' || typeof parsed.swagger === 'string') return 'openapi-3';
  return 'unknown';
}

/**
 * Verify the parsed JSON's shape matches the user-chosen `format`.
 * Returns `{ ok: true }` on match, or `{ ok: false, detected, reason }` on mismatch.
 */
export function shapeCheck(format, parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, detected: 'unknown', reason: 'Not a JSON object.' };
  }
  const detected = detectFormat(parsed);

  if (format === 'postman-v2.1') {
    const schemaUrl = parsed.info && typeof parsed.info.schema === 'string' ? parsed.info.schema : '';
    if (schemaUrl === POSTMAN_V21_SCHEMA || schemaUrl.includes('v2.1')) return { ok: true };
    return {
      ok: false,
      detected,
      reason: `Expected Postman v2.1 schema URL in info.schema, got "${schemaUrl || '(missing)'}".`,
    };
  }

  if (format === 'postman-v2.0') {
    const schemaUrl = parsed.info && typeof parsed.info.schema === 'string' ? parsed.info.schema : '';
    if (schemaUrl === POSTMAN_V20_SCHEMA || schemaUrl.includes('v2.0')) return { ok: true };
    return {
      ok: false,
      detected,
      reason: `Expected Postman v2.0 schema URL in info.schema, got "${schemaUrl || '(missing)'}".`,
    };
  }

  if (format === 'insomnia-v4') {
    if (parsed._type === 'export' && parsed.__export_format === 4) return { ok: true };
    return {
      ok: false,
      detected,
      reason: 'Expected _type === "export" and __export_format === 4.',
    };
  }

  if (format === 'post-umbrella') {
    if (parsed.info && typeof parsed.info._post_umbrella_version === 'string') return { ok: true };
    return {
      ok: false,
      detected,
      reason: 'Expected info._post_umbrella_version to be set on Post Umbrella exports.',
    };
  }

  if (format === 'openapi-3') {
    if (typeof parsed.openapi === 'string' && /^3\./.test(parsed.openapi)) return { ok: true };
    if (typeof parsed.swagger === 'string' && /^2\./.test(parsed.swagger)) return { ok: true };
    return {
      ok: false,
      detected,
      reason: 'Expected an OpenAPI 3.x (openapi) or Swagger 2.x (swagger) version string at the root.',
    };
  }

  return { ok: false, detected, reason: `Unknown format "${format}".` };
}
