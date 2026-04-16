// Orchestrator: drives the import pipeline (parse → shape-check → schema →
// parser → normalize) and returns a single result shape the UI layer can show
// as either a commit-ready preview or a friendly error.

import { shapeCheck } from './shapeCheck.js';
import { validate } from './schemaValidate.js';
import { normalize } from './normalize.js';
import * as postmanParser from './postman.js';
import * as insomniaParser from './insomnia.js';
import * as selfParser from './selfFormat.js';

// Lazy loader map — OpenAPI pulls swagger-parser (100+ KB) and is only
// resolved when the user actually picks that format.
const parsers = {
  'postman-v2.1': () => Promise.resolve(postmanParser),
  'postman-v2.0': () => Promise.resolve(postmanParser),
  'insomnia-v4': () => Promise.resolve(insomniaParser),
  'post-umbrella': () => Promise.resolve(selfParser),
  'openapi-3': () => import('./openapi.js'),
};

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const w of list || []) {
    if (!seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
  }
  return out;
}

// Format-aware raw-text parse. OpenAPI tries JSON then YAML; everything else
// is JSON only.
async function parseRaw(format, rawText) {
  if (format === 'openapi-3') {
    try {
      return { ok: true, parsed: JSON.parse(rawText) };
    } catch {
      // fall through to YAML
    }
    try {
      const YAML = (await import('yaml')).default;
      return { ok: true, parsed: YAML.parse(rawText) };
    } catch (e) {
      return { ok: false, error: { kind: 'parse', message: `Not valid JSON or YAML: ${e.message}` } };
    }
  }
  try {
    return { ok: true, parsed: JSON.parse(rawText) };
  } catch (e) {
    return { ok: false, error: { kind: 'parse', message: `Invalid JSON: ${e.message}` } };
  }
}

/**
 * Run the full import pipeline for a given format + raw file text.
 * Returns `{ ok: true, normalized, warnings }` or `{ ok: false, error }`.
 */
export async function runImport(format, rawText) {
  const parseResult = await parseRaw(format, rawText);
  if (!parseResult.ok) return { ok: false, error: parseResult.error };
  const parsed = parseResult.parsed;

  const shape = shapeCheck(format, parsed);
  if (!shape.ok) {
    return { ok: false, error: { kind: 'shape', detected: shape.detected, reason: shape.reason } };
  }

  const schema = await validate(format, parsed);
  if (!schema.ok) {
    return { ok: false, error: { kind: 'schema', errors: schema.errors } };
  }

  const loader = parsers[format];
  if (!loader) {
    return { ok: false, error: { kind: 'shape', detected: 'unknown', reason: `No parser registered for format "${format}".` } };
  }

  let parser;
  try {
    parser = await loader();
  } catch (e) {
    return { ok: false, error: { kind: 'parse', message: `Failed to load parser for ${format}: ${e.message}` } };
  }

  let parserOutput;
  try {
    parserOutput = await parser.parse(parsed);
  } catch (e) {
    return { ok: false, error: { kind: 'parse', message: e.message || String(e) } };
  }

  const { postmanJson, warnings: parseWarnings = [], idMap } = parserOutput;
  const { postmanJson: normalized, warnings: normWarnings = [] } = normalize(postmanJson, idMap);

  return {
    ok: true,
    normalized,
    warnings: dedupe([...parseWarnings, ...normWarnings]),
  };
}
