// OpenAPI 3.x / Swagger 2.x → Postman v2.1 parser. Async because swagger-parser
// dereferences $ref via (mocked) I/O. Walks the dereferenced spec, groups
// requests by first tag into folders, and maps security schemes to Postman auth
// or header/query injections. Outputs the same shape as the sync parsers:
// `{ postmanJson, warnings, idMap: undefined }`. Normalize.js runs after this
// and rewrites any foreign templating it finds (there shouldn't be any — we
// emit clean `{{var}}` references everywhere).

const POSTMAN_V21_SCHEMA_URL = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

function safeUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Replace `{name}` path params with Postman's `{{name}}` convention.
function templatizePath(pathKey) {
  if (typeof pathKey !== 'string') return '';
  return pathKey.replace(/\{([^}]+)\}/g, (_m, name) => `{{${name}}}`);
}

// Extract `{name}` tokens from an OpenAPI path string.
function extractPathParamNames(pathKey) {
  if (typeof pathKey !== 'string') return [];
  const names = [];
  const re = /\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(pathKey)) !== null) {
    names.push(m[1]);
  }
  return names;
}

function isJsonContentType(ct) {
  if (typeof ct !== 'string') return false;
  if (ct === 'application/json') return true;
  return /^application\/[^\s;]+\+json$/.test(ct);
}

// Best-effort stub from a schema. Keeps it simple: empty strings for scalars,
// `{}` for objects, `[]` for arrays.
function stubFromSchema(schema) {
  if (!schema || typeof schema !== 'object') return {};
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.type === 'object' || schema.properties) {
    const out = {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    const props = schema.properties || {};
    for (const name of required) {
      const p = props[name];
      out[name] = stubFromSchema(p);
    }
    return out;
  }
  if (schema.type === 'array') return [];
  if (schema.type === 'integer' || schema.type === 'number') return 0;
  if (schema.type === 'boolean') return false;
  return '';
}

// Pick an example body from a requestBody `content` map. Returns `undefined`
// if nothing usable is present.
function pickBodyExample(content) {
  if (!content || typeof content !== 'object') return undefined;
  const keys = Object.keys(content);
  const ct = keys.find(isJsonContentType);
  if (!ct) return undefined;
  const media = content[ct];
  if (!media || typeof media !== 'object') return undefined;
  if (media.example !== undefined) return media.example;
  if (media.examples && typeof media.examples === 'object') {
    for (const ex of Object.values(media.examples)) {
      if (ex && Object.prototype.hasOwnProperty.call(ex, 'value')) return ex.value;
    }
  }
  if (media.schema) return stubFromSchema(media.schema);
  return undefined;
}

// Map a single OpenAPI parameter into a Postman header/query entry, or null if
// in: cookie (caller emits warning) or in: path (handled separately).
function mapParameter(param) {
  if (!param || typeof param !== 'object') return null;
  const name = param.name || '';
  const valueRaw = param.example !== undefined
    ? param.example
    : (param.schema && param.schema.example !== undefined
        ? param.schema.example
        : (param.schema && param.schema.default !== undefined
            ? param.schema.default
            : ''));
  const value = typeof valueRaw === 'string' ? valueRaw : (valueRaw === undefined || valueRaw === null ? '' : String(valueRaw));
  return { key: name, value };
}

// Seed (or reuse) a root-level collection variable.
function seedVariable(variableList, seen, key, value) {
  if (!key) return;
  if (seen.has(key)) return;
  seen.add(key);
  variableList.push({ key, value: value == null ? '' : String(value), type: 'string' });
}

// Map a single security requirement to side-effects on the request:
// mutates request.auth / request.header / url.query and seeds variables.
function mapSecurity(requirement, securitySchemes, context) {
  const { request, urlQuery, variableList, seenVars, warnings, operationName } = context;
  if (!requirement || typeof requirement !== 'object') return;

  const schemeNames = Object.keys(requirement);
  for (const schemeName of schemeNames) {
    const scheme = securitySchemes[schemeName];
    if (!scheme || typeof scheme !== 'object') {
      warnings.push(`Operation '${operationName}': security scheme '${schemeName}' not defined in components.securitySchemes — skipped.`);
      continue;
    }

    if (scheme.type === 'http' && scheme.scheme === 'bearer') {
      request.auth = {
        type: 'bearer',
        bearer: [{ key: 'token', value: '{{bearerToken}}', type: 'string' }],
      };
      seedVariable(variableList, seenVars, 'bearerToken', '');
      continue;
    }

    if (scheme.type === 'http' && scheme.scheme === 'basic') {
      warnings.push(`Operation '${operationName}': HTTP Basic auth is not automated — configure manually.`);
      continue;
    }

    if (scheme.type === 'apiKey') {
      const headerName = scheme.name || 'X-API-Key';
      if (scheme.in === 'header') {
        if (!Array.isArray(request.header)) request.header = [];
        request.header.push({ key: headerName, value: '{{apiKey}}', disabled: false });
        seedVariable(variableList, seenVars, 'apiKey', '');
        warnings.push(`Operation '${operationName}': API Key auth mapped to header '${headerName}'. Review the generated header if needed.`);
        continue;
      }
      if (scheme.in === 'query') {
        urlQuery.push({ key: headerName, value: '{{apiKey}}' });
        seedVariable(variableList, seenVars, 'apiKey', '');
        warnings.push(`Operation '${operationName}': API Key auth mapped to query parameter '${headerName}'. Review the generated URL if needed.`);
        continue;
      }
      if (scheme.in === 'cookie') {
        warnings.push(`Operation '${operationName}': API Key in cookie is not supported — skipped.`);
        continue;
      }
      warnings.push(`Operation '${operationName}': API Key location '${scheme.in || 'unknown'}' not supported — skipped.`);
      continue;
    }

    if (scheme.type === 'oauth2' || scheme.type === 'openIdConnect') {
      warnings.push(`Operation '${operationName}': ${scheme.type} auth is not automated — configure manually.`);
      continue;
    }

    warnings.push(`Operation '${operationName}': unknown security scheme type '${scheme.type || 'unknown'}' — skipped.`);
  }
}

// Build a folder item for a tag.
function buildFolder(name) {
  return { name: name || 'Untitled', item: [] };
}

// Map a single operation to a Postman request item.
function mapOperation(pathKey, method, operation, pathItem, context) {
  const { deref, hasBaseUrl, variableList, seenVars, warnings } = context;
  const upperMethod = method.toUpperCase();
  const name = typeof operation.operationId === 'string' && operation.operationId.trim()
    ? operation.operationId
    : `${upperMethod} ${pathKey}`;

  const templatedPath = templatizePath(pathKey);
  const rawUrl = hasBaseUrl ? `{{baseUrl}}${templatedPath}` : templatedPath;

  const header = [];
  const urlQuery = [];

  // Path params — seed collection variables.
  const pathParamNames = extractPathParamNames(pathKey);
  const pathItemParams = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
  const opParams = Array.isArray(operation.parameters) ? operation.parameters : [];
  const allParams = [...pathItemParams, ...opParams];

  for (const paramName of pathParamNames) {
    const paramDef = allParams.find(p => p && p.in === 'path' && p.name === paramName);
    let seedValue = '';
    if (paramDef) {
      if (paramDef.example !== undefined) seedValue = paramDef.example;
      else if (paramDef.schema && paramDef.schema.example !== undefined) seedValue = paramDef.schema.example;
      else if (paramDef.schema && paramDef.schema.default !== undefined) seedValue = paramDef.schema.default;
    }
    seedVariable(variableList, seenVars, paramName, seedValue);
  }

  // Query / header / cookie parameters.
  for (const param of allParams) {
    if (!param || typeof param !== 'object') continue;
    if (param.in === 'path') continue;
    if (param.in === 'cookie') {
      warnings.push(`Operation '${name}': cookie parameter '${param.name || '(unnamed)'}' is not supported — skipped.`);
      continue;
    }
    const mapped = mapParameter(param);
    if (!mapped) continue;
    if (param.in === 'query') urlQuery.push(mapped);
    else if (param.in === 'header') header.push({ ...mapped, disabled: false });
  }

  const request = {
    method: upperMethod,
    header,
    url: {
      raw: rawUrl,
    },
  };

  if (urlQuery.length > 0) request.url.query = urlQuery;

  // Request body.
  if (operation.requestBody && typeof operation.requestBody === 'object') {
    const example = pickBodyExample(operation.requestBody.content);
    if (example !== undefined) {
      request.body = {
        mode: 'raw',
        raw: JSON.stringify(example, null, 2),
        options: { raw: { language: 'json' } },
      };
    }
  }

  // Security.
  const opSecurity = Array.isArray(operation.security) ? operation.security : null;
  const specSecurity = Array.isArray(deref.security) ? deref.security : null;
  const effectiveSecurity = opSecurity !== null ? opSecurity : (specSecurity || []);
  const securitySchemes = (deref.components && deref.components.securitySchemes) || {};

  if (effectiveSecurity.length > 0) {
    const [first, ...alternates] = effectiveSecurity;
    if (alternates.length > 0) {
      const altNames = alternates.map(a => Object.keys(a || {}).join('+') || '(empty)').join(', ');
      warnings.push(`Operation '${name}': multiple security alternatives — using the first; alternates dropped (${altNames}).`);
    }
    mapSecurity(first, securitySchemes, {
      request,
      urlQuery,
      variableList,
      seenVars,
      warnings,
      operationName: name,
    });
    // urlQuery may have been mutated; re-attach if now non-empty and wasn't before.
    if (urlQuery.length > 0 && !request.url.query) request.url.query = urlQuery;
  }

  const item = { name, request };

  // Response examples.
  const responses = operation.responses || {};
  const responseItems = [];
  for (const [code, resp] of Object.entries(responses)) {
    if (!resp || !resp.content || typeof resp.content !== 'object') continue;
    for (const [ct, media] of Object.entries(resp.content)) {
      if (!media || typeof media !== 'object') continue;
      let example;
      if (media.example !== undefined) {
        example = media.example;
      } else if (media.examples && typeof media.examples === 'object') {
        const first = Object.values(media.examples).find(e => e && Object.prototype.hasOwnProperty.call(e, 'value'));
        if (first) example = first.value;
      }
      if (example === undefined) continue;
      const numericCode = Number(code);
      const bodyStr = typeof example === 'string' ? example : JSON.stringify(example, null, 2);
      responseItems.push({
        name: `${code} ${resp.description || ''}`.trim(),
        originalRequest: {
          method: request.method,
          header: request.header,
          url: request.url,
          body: request.body,
        },
        status: resp.description || String(code),
        code: Number.isFinite(numericCode) ? numericCode : 0,
        _postman_previewlanguage: 'json',
        header: [{ key: 'Content-Type', value: ct }],
        body: bodyStr,
      });
    }
  }
  if (responseItems.length > 0) item.response = responseItems;

  return item;
}

/**
 * Parse an OpenAPI 3.x (or Swagger 2.x) spec into a Postman v2.1 collection.
 * Async because it uses swagger-parser to bundle + dereference `$ref`s.
 */
export async function parse(parsed) {
  const warnings = [];

  let bundled;
  let deref;
  try {
    const SwaggerParser = (await import('@apidevtools/swagger-parser')).default;
    bundled = await SwaggerParser.bundle(structuredClone(parsed));
    if (parsed && typeof parsed.swagger === 'string' && /^2\./.test(parsed.swagger)) {
      warnings.push('Swagger 2.0 converted on-the-fly — verify fields where 2.x and 3.x diverge.');
    }
    deref = await SwaggerParser.dereference(bundled);
  } catch (err) {
    const msg = (err && err.message) || String(err);
    throw new Error(`OpenAPI parsing failed: ${msg}`);
  }

  const info = (deref && deref.info) || {};
  const collectionName = [info.title || 'Imported OpenAPI Collection', info.version ? `(${info.version})` : '']
    .filter(Boolean)
    .join(' ');

  // Servers → variables.
  const variable = [];
  const seenVars = new Set();
  const servers = Array.isArray(deref.servers) ? deref.servers : [];
  let hasBaseUrl = false;
  if (servers.length === 0) {
    warnings.push('No servers defined — request URLs will be relative paths only (no {{baseUrl}} seed).');
  } else {
    const first = servers[0];
    if (first && typeof first.url === 'string') {
      seedVariable(variable, seenVars, 'baseUrl', first.url);
      hasBaseUrl = true;
    }
    if (servers.length > 1) {
      const alternates = [];
      for (let i = 1; i < servers.length; i += 1) {
        const s = servers[i];
        const key = `baseUrl_${i}`;
        if (s && typeof s.url === 'string') {
          seedVariable(variable, seenVars, key, s.url);
          alternates.push(`${key}=${s.url}`);
        }
      }
      if (alternates.length > 0) {
        warnings.push(`Multiple servers detected — seeded alternates: ${alternates.join(', ')}.`);
      }
    }
  }

  // Build tag → folder map. Seed with deref.tags in declared order, then fold
  // in any tags we see on operations that weren't declared.
  const tagToFolder = new Map();
  const declaredTags = Array.isArray(deref.tags) ? deref.tags : [];
  for (const t of declaredTags) {
    if (t && typeof t.name === 'string' && !tagToFolder.has(t.name)) {
      tagToFolder.set(t.name, buildFolder(t.name));
    }
  }

  const rootRequests = [];

  const paths = (deref && deref.paths) || null;
  if (!paths || typeof paths !== 'object') {
    warnings.push('No paths defined in the spec — resulting collection is empty.');
  } else {
    for (const [pathKey, pathItem] of Object.entries(paths)) {
      if (!pathItem || typeof pathItem !== 'object') continue;
      for (const method of HTTP_METHODS) {
        const operation = pathItem[method];
        if (!operation || typeof operation !== 'object') continue;

        const item = mapOperation(pathKey, method, operation, pathItem, {
          deref,
          hasBaseUrl,
          variableList: variable,
          seenVars,
          warnings,
        });

        const firstTag = Array.isArray(operation.tags) && operation.tags.length > 0 ? operation.tags[0] : null;
        if (firstTag) {
          if (!tagToFolder.has(firstTag)) tagToFolder.set(firstTag, buildFolder(firstTag));
          tagToFolder.get(firstTag).item.push(item);
        } else {
          rootRequests.push(item);
        }
      }
    }
  }

  const tagFolders = Array.from(tagToFolder.values()).filter(f => Array.isArray(f.item) && f.item.length > 0);

  const postmanJson = {
    info: {
      _postman_id: safeUUID(),
      name: collectionName,
      schema: POSTMAN_V21_SCHEMA_URL,
    },
    item: [...rootRequests, ...tagFolders],
  };

  if (variable.length > 0) postmanJson.variable = variable;

  if (info.description && typeof info.description === 'string' && info.description.trim()) {
    postmanJson.event = [{
      listen: 'prerequest',
      script: { type: 'text/javascript', exec: [`// ${info.description.replace(/\r?\n/g, ' ')}`] },
    }];
  }

  return { postmanJson, warnings, idMap: undefined };
}
