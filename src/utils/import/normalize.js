// Normalization layer. Runs after any parser (Postman / Insomnia / self) and
// scrubs foreign templating out of every string field in the tree. Insomnia's
// `{% response %}` tags are the real-world bug that triggered this work —
// those get rewritten to `{{slug_token}}` plus a post-response script on the
// producing request. Other `{% ... %}` tags and unknown `{{$dynamics}}` get
// warnings so the user can see what didn't survive the import.

const TOP5_DYNAMICS = new Set(['guid', 'timestamp', 'randomInt', 'randomUUID', 'isoTimestamp']);

function slugify(name) {
  if (!name || typeof name !== 'string') return 'request';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_') || 'request';
}

// Convert a JSONPath like "$.id_token" or "$['access']['token']" into a safe
// JS accessor expression rooted at `data`. Returns null if the path is too
// complex to safely generate (caller falls back to a TODO placeholder + warning).
function jsonPathAccessor(path) {
  if (!path || typeof path !== 'string') return null;
  let p = path.trim();
  if (p.startsWith('$')) p = p.slice(1);
  if (p === '' || p === '.') return 'data';
  // Accept sequences of .ident, [number], ['key'] or ["key"].
  const tokens = [];
  let rest = p;
  while (rest.length > 0) {
    const dotMatch = rest.match(/^\.([A-Za-z_][A-Za-z0-9_]*)/);
    if (dotMatch) {
      tokens.push({ kind: 'prop', value: dotMatch[1] });
      rest = rest.slice(dotMatch[0].length);
      continue;
    }
    const bracketMatch = rest.match(/^\[(\d+)\]/);
    if (bracketMatch) {
      tokens.push({ kind: 'index', value: Number(bracketMatch[1]) });
      rest = rest.slice(bracketMatch[0].length);
      continue;
    }
    const quotedMatch = rest.match(/^\[['"]([^'"\]]+)['"]\]/);
    if (quotedMatch) {
      tokens.push({ kind: 'prop', value: quotedMatch[1] });
      rest = rest.slice(quotedMatch[0].length);
      continue;
    }
    return null;
  }
  let expr = 'data';
  for (const t of tokens) {
    if (t.kind === 'index') {
      expr += `?.[${t.value}]`;
    } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t.value)) {
      expr += `?.${t.value}`;
    } else {
      expr += `?.[${JSON.stringify(t.value)}]`;
    }
  }
  return expr;
}

function decodeBase64(b64) {
  try {
    if (typeof atob === 'function') return atob(b64);
  } catch { /* fall through */ }
  if (typeof Buffer !== 'undefined') {
    try { return Buffer.from(b64, 'base64').toString('utf8'); } catch { /* noop */ }
  }
  return '';
}

// Resolve an idMap path ([..., 'item', index, 'item', index, ...]) back to the
// actual object inside postmanJson. Mirrors the walker in insomnia.js.
function resolvePath(root, path) {
  let node = root;
  for (const segment of path) {
    if (node == null) return null;
    node = node[segment];
  }
  return node;
}

function ensureEvents(item) {
  if (!Array.isArray(item.event)) item.event = [];
  return item.event;
}

function appendPostResponseScript(producingItem, scriptLine) {
  const events = ensureEvents(producingItem);
  let testEvent = events.find(e => e.listen === 'test');
  if (!testEvent) {
    testEvent = { listen: 'test', script: { type: 'text/javascript', exec: [] } };
    events.push(testEvent);
  }
  if (!testEvent.script) testEvent.script = { type: 'text/javascript', exec: [] };
  if (!Array.isArray(testEvent.script.exec)) {
    testEvent.script.exec = typeof testEvent.script.exec === 'string'
      ? testEvent.script.exec.split('\n')
      : [];
  }
  testEvent.script.exec.push(scriptLine);
}

// ----- String scanning -----

const RESPONSE_TAG_RE = /\{%\s*response\s+'body'\s*,\s*'([^']+)'\s*,\s*'b64::([^:]+)::[^']+'[^%]*%\}/g;
const GENERIC_TAG_RE = /\{%\s*(\w+)\b[^%]*%\}/g;
const DYNAMIC_VAR_RE = /\{\{\$(\w+)\}\}/g;

function rewriteString(str, ctx) {
  if (typeof str !== 'string' || str.length === 0) return str;
  let out = str;

  // 1. Insomnia `{% response 'body', 'req_<id>', 'b64::<jsonpath>::<hash>' %}`
  out = out.replace(RESPONSE_TAG_RE, (match, producerId, jsonPathB64) => {
    const jsonPath = decodeBase64(jsonPathB64);
    const producerPath = ctx.idMap ? ctx.idMap[producerId] : null;
    const producerItem = producerPath ? resolvePath(ctx.postmanJson, producerPath) : null;
    const accessor = jsonPathAccessor(jsonPath);

    if (!producerItem || !accessor) {
      ctx.warnings.push(
        `Request ${ctx.currentName}: replaced unresolvable {% response %} tag with {{TODO_FIX_insomnia_response}} — original: ${match}.`
      );
      return '{{TODO_FIX_insomnia_response}}';
    }

    const producerName = producerItem.name || 'Unnamed Request';
    const slug = `${slugify(producerName)}_token`;
    const scriptLine = `const data = pm.response.json(); const value = ${accessor}; if (value !== undefined) pm.collectionVariables.set(${JSON.stringify(slug)}, value);`;

    // Dedup scripts: if we've already added one for this producer+slug, don't duplicate.
    const alreadyAdded = ctx.scriptsAdded.get(producerId);
    if (!alreadyAdded || !alreadyAdded.has(slug)) {
      appendPostResponseScript(producerItem, scriptLine);
      if (!alreadyAdded) ctx.scriptsAdded.set(producerId, new Set([slug]));
      else alreadyAdded.add(slug);
    }

    ctx.warnings.push(
      `Request ${ctx.currentName}: replaced {% response %} tag with {{${slug}}}; post-response script added to '${producerName}'.`
    );
    return `{{${slug}}}`;
  });

  // 2. Other `{% ... %}` tags (after response handled).
  out = out.replace(GENERIC_TAG_RE, (match, kind) => {
    if (kind === 'response') return match; // already handled (or unresolvable above)
    if (kind === 'uuid') {
      if (!ctx.seenUuid) {
        ctx.warnings.push(`Insomnia {% uuid %} tags converted to {{$guid}} (Postman dynamic variable).`);
        ctx.seenUuid = true;
      }
      return '{{$guid}}';
    }
    if (kind === 'timestamp') {
      if (!ctx.seenTimestamp) {
        ctx.warnings.push(`Insomnia {% timestamp %} tags converted to {{$timestamp}} (Postman dynamic variable).`);
        ctx.seenTimestamp = true;
      }
      return '{{$timestamp}}';
    }
    ctx.warnings.push(
      `Request ${ctx.currentName}: unsupported Insomnia tag {% ${kind} %} replaced with {{TODO_FIX_${kind}}} — original: ${match}.`
    );
    return `{{TODO_FIX_${kind}}}`;
  });

  // 3. Postman dynamic variables. Collect — don't rewrite — but seed collection vars
  // for the top 5 so users see something on the variables tab.
  let dyn;
  DYNAMIC_VAR_RE.lastIndex = 0;
  while ((dyn = DYNAMIC_VAR_RE.exec(out)) !== null) {
    const name = dyn[1];
    if (TOP5_DYNAMICS.has(name)) {
      if (!ctx.seededDynamics.has(name)) {
        ctx.seededDynamics.add(name);
        ctx.warnings.push(
          `Postman dynamic variable {{$${name}}} detected — seeding collection variable "${name}" as a placeholder (value filled at runtime in Postman; Post Umbrella does not auto-evaluate).`
        );
      }
    } else {
      ctx.warnings.push(
        `Request ${ctx.currentName}: unsupported Postman dynamic variable {{$${name}}} left in place — review and replace manually.`
      );
    }
  }

  return out;
}

// ----- Tree walker -----

function walkAuth(auth, ctx) {
  if (!auth || typeof auth !== 'object') return;
  for (const kind of ['bearer', 'apikey', 'basic', 'oauth2', 'oauth1']) {
    if (Array.isArray(auth[kind])) {
      for (const kv of auth[kind]) {
        if (kv && typeof kv.value === 'string') {
          kv.value = rewriteString(kv.value, ctx);
        }
      }
    }
  }
}

function walkRequest(item, ctx) {
  ctx.currentName = item.name || 'Unnamed Request';
  const req = item.request;
  if (!req) return;

  // URL
  if (typeof req.url === 'string') {
    req.url = rewriteString(req.url, ctx);
  } else if (req.url && typeof req.url === 'object' && typeof req.url.raw === 'string') {
    req.url.raw = rewriteString(req.url.raw, ctx);
  }

  // Headers
  if (Array.isArray(req.header)) {
    for (const h of req.header) {
      if (h && typeof h.key === 'string') h.key = rewriteString(h.key, ctx);
      if (h && typeof h.value === 'string') h.value = rewriteString(h.value, ctx);
    }
  }

  // Body
  if (req.body && typeof req.body === 'object') {
    if (typeof req.body.raw === 'string') req.body.raw = rewriteString(req.body.raw, ctx);
    if (Array.isArray(req.body.formdata)) {
      for (const f of req.body.formdata) {
        if (f && typeof f.value === 'string') f.value = rewriteString(f.value, ctx);
      }
    }
    if (Array.isArray(req.body.urlencoded)) {
      for (const f of req.body.urlencoded) {
        if (f && typeof f.value === 'string') f.value = rewriteString(f.value, ctx);
      }
    }
  }

  walkAuth(req.auth, ctx);

  // Events on the item (pre/post scripts)
  if (Array.isArray(item.event)) {
    for (const ev of item.event) {
      if (ev && ev.script && Array.isArray(ev.script.exec)) {
        ev.script.exec = ev.script.exec.map(line =>
          typeof line === 'string' ? rewriteString(line, ctx) : line
        );
      }
    }
  }
}

function walkFolderOrRoot(node, ctx) {
  walkAuth(node.auth, ctx);
  if (Array.isArray(node.event)) {
    for (const ev of node.event) {
      if (ev && ev.script && Array.isArray(ev.script.exec)) {
        ev.script.exec = ev.script.exec.map(line =>
          typeof line === 'string' ? rewriteString(line, ctx) : line
        );
      }
    }
  }
  if (Array.isArray(node.variable)) {
    for (const v of node.variable) {
      if (v && typeof v.value === 'string') {
        ctx.currentName = `Variable '${v.key || '(unnamed)'}'`;
        v.value = rewriteString(v.value, ctx);
      }
    }
  }
  if (Array.isArray(node.item)) {
    for (const child of node.item) {
      if (child && child.request) {
        walkRequest(child, ctx);
      } else if (child && Array.isArray(child.item)) {
        walkFolderOrRoot(child, ctx);
      }
    }
  }
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const w of list) {
    if (!seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
  }
  return out;
}

/**
 * Scrub foreign templating out of every string field in a Postman v2.1 tree.
 * Accepts an optional `idMap` (from the Insomnia parser) so `{% response %}`
 * references can be resolved to a producing item in the same tree.
 */
export function normalize(postmanJson, idMap) {
  const ctx = {
    postmanJson,
    idMap: idMap || null,
    warnings: [],
    seededDynamics: new Set(),
    scriptsAdded: new Map(),
    seenUuid: false,
    seenTimestamp: false,
    currentName: 'Collection',
  };

  walkFolderOrRoot(postmanJson, ctx);

  // Seed collection variables for the top-5 Postman dynamics we encountered.
  if (ctx.seededDynamics.size > 0) {
    if (!Array.isArray(postmanJson.variable)) postmanJson.variable = [];
    for (const name of ctx.seededDynamics) {
      const existing = postmanJson.variable.find(v => v && v.key === name);
      if (!existing) {
        postmanJson.variable.push({
          key: name,
          value: '(auto-generated each request)',
          type: 'string',
        });
      }
    }
  }

  return { postmanJson, warnings: dedupe(ctx.warnings) };
}
