// Orchestrator: drives the import pipeline (parse → shape-check → schema →
// parser → normalize) and returns a single result shape the UI layer can show
// as either a commit-ready preview or a friendly error.

import { shapeCheck } from './shapeCheck.js';
import { validate } from './schemaValidate.js';
import { normalize } from './normalize.js';
import * as postmanParser from './postman.js';
import * as insomniaParser from './insomnia.js';
import * as selfParser from './selfFormat.js';

const parsers = {
  'postman-v2.1': postmanParser,
  'postman-v2.0': postmanParser,
  'insomnia-v4': insomniaParser,
  'post-umbrella': selfParser,
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

/**
 * Run the full import pipeline for a given format + raw file text.
 * Returns `{ ok: true, normalized, warnings }` or `{ ok: false, error }`.
 */
export async function runImport(format, rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    return { ok: false, error: { kind: 'parse', message: `Invalid JSON: ${e.message}` } };
  }

  const shape = shapeCheck(format, parsed);
  if (!shape.ok) {
    return { ok: false, error: { kind: 'shape', detected: shape.detected, reason: shape.reason } };
  }

  const schema = validate(format, parsed);
  if (!schema.ok) {
    return { ok: false, error: { kind: 'schema', errors: schema.errors } };
  }

  const parser = parsers[format];
  if (!parser) {
    return { ok: false, error: { kind: 'shape', detected: 'unknown', reason: `No parser registered for format "${format}".` } };
  }

  const { postmanJson, warnings: parseWarnings = [], idMap } = parser.parse(parsed);
  const { postmanJson: normalized, warnings: normWarnings = [] } = normalize(postmanJson, idMap);

  return {
    ok: true,
    normalized,
    warnings: dedupe([...parseWarnings, ...normWarnings]),
  };
}
