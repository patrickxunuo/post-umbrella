// Insomnia v4 → Postman v2.1 parser. Walks `resources[]`, builds an item tree
// rooted at the workspace, and maps requests / folders / auth / scripts over
// into Postman shape. The detailed templating rewrites (`{% response %}`,
// `{% uuid %}`, etc.) happen in normalize.js — here we only build the tree and
// surface the Insomnia request id-map the normalizer needs to resolve
// cross-request references.

const POSTMAN_V21_SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

function safeUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback — shouldn't hit this in browsers or Node 16+.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function mapHeaders(insomniaHeaders) {
  if (!Array.isArray(insomniaHeaders)) return [];
  return insomniaHeaders
    .filter(h => h && (h.name || h.value))
    .map(h => ({
      key: h.name || '',
      value: h.value || '',
      disabled: h.disabled === true ? true : undefined,
    }));
}

function mapBody(insomniaBody) {
  if (!insomniaBody || typeof insomniaBody !== 'object') return undefined;
  const { mimeType, text, params, fileName } = insomniaBody;

  // Insomnia marks "no body" with mimeType null/undefined.
  if (!mimeType && !text && !Array.isArray(params) && !fileName) return undefined;

  if (mimeType === 'application/json' || (mimeType && mimeType.startsWith('text/')) || mimeType === 'application/xml') {
    return {
      mode: 'raw',
      raw: typeof text === 'string' ? text : '',
      options: mimeType === 'application/json' ? { raw: { language: 'json' } } : undefined,
    };
  }

  if (mimeType === 'multipart/form-data' || mimeType === 'application/x-www-form-urlencoded') {
    const formdata = (Array.isArray(params) ? params : []).map(p => ({
      key: p.name || '',
      value: p.value || '',
      type: p.type === 'file' ? 'file' : 'text',
      disabled: p.disabled === true ? true : undefined,
    }));
    return mimeType === 'multipart/form-data'
      ? { mode: 'formdata', formdata }
      : { mode: 'urlencoded', urlencoded: formdata };
  }

  // Fallback: raw passthrough so the content at least survives.
  if (typeof text === 'string') {
    return { mode: 'raw', raw: text };
  }
  return undefined;
}

function mapAuth(insomniaAuth, parentHasAuth) {
  if (!insomniaAuth || typeof insomniaAuth !== 'object') {
    return undefined; // inherit when parent has auth, none otherwise — caller decides
  }
  if (insomniaAuth.disabled === true) {
    return { type: 'noauth' };
  }
  const { type } = insomniaAuth;
  if (type === 'bearer') {
    return {
      type: 'bearer',
      bearer: [{ key: 'token', value: insomniaAuth.token || '', type: 'string' }],
    };
  }
  if (type === 'basic') {
    return {
      type: 'basic',
      basic: [
        { key: 'username', value: insomniaAuth.username || '', type: 'string' },
        { key: 'password', value: insomniaAuth.password || '', type: 'string' },
      ],
    };
  }
  if (type === 'apikey') {
    const location = insomniaAuth.addTo === 'queryParams' ? 'query' : 'header';
    return {
      type: 'apikey',
      apikey: [
        { key: 'key', value: insomniaAuth.key || '', type: 'string' },
        { key: 'value', value: insomniaAuth.value || '', type: 'string' },
        { key: 'in', value: location, type: 'string' },
      ],
    };
  }
  // Unknown — pass type through so schema validator / user can see it; normalize may warn.
  return { type: type || 'noauth' };
}

function buildEvents(preScript, postScript) {
  const event = [];
  if (preScript && typeof preScript === 'string' && preScript.trim()) {
    event.push({
      listen: 'prerequest',
      script: { type: 'text/javascript', exec: preScript.split('\n') },
    });
  }
  if (postScript && typeof postScript === 'string' && postScript.trim()) {
    event.push({
      listen: 'test',
      script: { type: 'text/javascript', exec: postScript.split('\n') },
    });
  }
  return event;
}

// Build a map from parentId → child resources so the tree walk is O(n).
function indexByParent(resources) {
  const byParent = new Map();
  for (const r of resources) {
    const p = r.parentId || null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(r);
  }
  return byParent;
}

function convertRequest(resource, parentHasAuth) {
  const url = typeof resource.url === 'string' ? resource.url : '';
  const headers = mapHeaders(resource.headers);
  const body = mapBody(resource.body);
  const auth = mapAuth(resource.authentication, parentHasAuth);

  const request = {
    method: (resource.method || 'GET').toUpperCase(),
    header: headers,
    url: { raw: url },
  };
  if (body) request.body = body;
  if (auth !== undefined) request.auth = auth;

  const item = {
    name: resource.name || 'Unnamed Request',
    request,
  };

  const events = buildEvents(resource.preRequestScript, resource.afterResponseScript);
  if (events.length > 0) item.event = events;

  return item;
}

function walkChildren(parentId, byParent, idMap, path, parentHasAuth) {
  const children = byParent.get(parentId) || [];
  // Preserve declared order when available (metaSortKey on Insomnia resources).
  const sorted = [...children].sort((a, b) => {
    const ak = typeof a.metaSortKey === 'number' ? a.metaSortKey : 0;
    const bk = typeof b.metaSortKey === 'number' ? b.metaSortKey : 0;
    return ak - bk;
  });

  const items = [];
  for (const child of sorted) {
    if (child._type === 'request') {
      const item = convertRequest(child, parentHasAuth);
      const itemPath = [...path, 'item', items.length];
      idMap[child._id] = itemPath;
      items.push(item);
    } else if (child._type === 'request_group') {
      const folderAuth = mapAuth(child.authentication, parentHasAuth);
      const folderHasAuth = parentHasAuth || (folderAuth && folderAuth.type === 'bearer');
      const folderIndex = items.length;
      const folderPath = [...path, 'item', folderIndex];
      const folderEvents = buildEvents(child.preRequestScript, child.afterResponseScript);
      const nestedItems = walkChildren(child._id, byParent, idMap, folderPath, folderHasAuth);
      const folder = { name: child.name || 'Folder', item: nestedItems };
      if (folderAuth !== undefined) folder.auth = folderAuth;
      if (folderEvents.length > 0) folder.event = folderEvents;
      items.push(folder);
    }
    // Other resource types (environment, cookie_jar, api_spec, ...) are
    // handled outside this traversal.
  }
  return items;
}

/** Convert an Insomnia v4 export into a Postman v2.1 collection object. */
export function parse(parsed) {
  const warnings = [];
  const idMap = {};
  const resources = Array.isArray(parsed.resources) ? parsed.resources : [];

  // Pick a workspace — Insomnia always has exactly one in a standard export,
  // but be defensive in case someone hand-assembled the file.
  const workspace = resources.find(r => r._type === 'workspace');
  if (!workspace) {
    warnings.push('No workspace resource found in Insomnia export — using a synthetic root.');
  }
  const rootName = workspace?.name || parsed.__export_source || 'Imported Insomnia Collection';

  const byParent = indexByParent(resources);

  // Root-level auth lives on the workspace in some exports; Insomnia doesn't
  // really model collection-wide auth the way Postman does, so this is best-effort.
  const rootAuth = mapAuth(workspace?.authentication, false);
  const rootHasAuth = rootAuth && rootAuth.type === 'bearer';

  const rootItems = walkChildren(workspace?._id || null, byParent, idMap, [], rootHasAuth);

  // Base environment → root-level variables. Sub-environments warn.
  const envResources = resources.filter(r => r._type === 'environment');
  const baseEnv = envResources.find(e => !e.parentId || e.parentId === workspace?._id);
  const subEnvs = envResources.filter(e => e !== baseEnv);

  const variable = [];
  if (baseEnv && baseEnv.data && typeof baseEnv.data === 'object') {
    for (const [key, value] of Object.entries(baseEnv.data)) {
      if (!key) continue;
      variable.push({ key, value: typeof value === 'string' ? value : JSON.stringify(value), type: 'string' });
    }
  }
  for (const sub of subEnvs) {
    warnings.push(`Sub-environment '${sub.name || sub._id}' not imported (only base environment is supported).`);
  }

  const postmanJson = {
    info: {
      _postman_id: safeUUID(),
      name: rootName,
      schema: POSTMAN_V21_SCHEMA,
    },
    item: rootItems,
  };

  if (rootAuth !== undefined) postmanJson.auth = rootAuth;
  if (variable.length > 0) postmanJson.variable = variable;

  const rootEvents = buildEvents(workspace?.preRequestScript, workspace?.afterResponseScript);
  if (rootEvents.length > 0) postmanJson.event = rootEvents;

  return { postmanJson, warnings, idMap };
}
