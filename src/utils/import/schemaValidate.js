import Ajv from 'ajv';
import AjvDraft04 from 'ajv-draft-04';
import addFormats from 'ajv-formats';
import postmanV21 from './schemas/postman-v2.1.schema.json';
import postmanV20 from './schemas/postman-v2.0.schema.json';
import insomniaV4 from './schemas/insomnia-v4.schema.json';

// Postman schemas use JSON Schema draft-04, so they need the ajv-draft-04
// adapter. Insomnia uses draft-07 which the default Ajv handles. `strict: false`
// and `strictSchema: false` relax Ajv's own meta-validation so the canonical
// Postman schemas compile without requiring surgery.
const ajv07 = new Ajv({ allErrors: true, strict: false, strictSchema: false });
addFormats(ajv07);
const ajv04 = new AjvDraft04({ allErrors: true, strict: false, strictSchema: false });
addFormats(ajv04);

const validators = {
  'postman-v2.1': ajv04.compile(postmanV21),
  'postman-v2.0': ajv04.compile(postmanV20),
  'insomnia-v4': ajv07.compile(insomniaV4),
  // Post Umbrella exports are Postman v2.1 + a `_post_umbrella_version` field.
  // shapeCheck already verifies that field; reuse the v2.1 schema here to avoid
  // bundling a near-identical 55 KB duplicate.
  'post-umbrella': ajv04.compile(postmanV21),
};

/** Validate a parsed JSON object against the chosen import format's schema. */
export async function validate(format, parsed) {
  if (format === 'openapi-3') {
    const SwaggerParser = (await import('@apidevtools/swagger-parser')).default;
    try {
      await SwaggerParser.validate(structuredClone(parsed));
      return { ok: true };
    } catch (err) {
      const pathArr = (err && err.details && err.details[0] && err.details[0].path) || [];
      return {
        ok: false,
        errors: [{
          path: Array.isArray(pathArr) && pathArr.length > 0 ? pathArr.join('.') : '(root)',
          message: (err && err.message) || String(err),
        }],
      };
    }
  }

  const v = validators[format];
  if (!v) {
    return { ok: false, errors: [{ path: '', message: `Unknown format ${format}` }] };
  }
  if (v(parsed)) return { ok: true };
  return {
    ok: false,
    errors: (v.errors || []).map(e => ({
      path: e.instancePath || '(root)',
      message: e.message,
      expected: e.schemaPath,
      actual: e.data,
    })),
  };
}
