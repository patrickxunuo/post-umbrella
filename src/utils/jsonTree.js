export const ROOT_ID = '[]';

// Object keys repeat across records, so cache their JSON tokens; the cache is
// bounded and simply reset when it fills.
const KEY_TOKEN_CACHE_LIMIT = 5000;
const keyTokenCache = new Map();

function keyToken(key) {
  if (typeof key === 'number') return String(key);
  let token = keyTokenCache.get(key);
  if (token === undefined) {
    token = JSON.stringify(key);
    if (keyTokenCache.size >= KEY_TOKEN_CACHE_LIMIT) keyTokenCache.clear();
    keyTokenCache.set(key, token);
  }
  return token;
}

export function childId(parentId, key) {
  const token = keyToken(key);
  return parentId === ROOT_ID ? `[${token}]` : `${parentId.slice(0, -1)},${token}]`;
}

export function ancestorIds(id) {
  let path;
  try {
    path = JSON.parse(id);
  } catch {
    return [];
  }
  if (!Array.isArray(path)) return [];
  const out = [];
  for (let i = 0; i < path.length; i++) out.push(JSON.stringify(path.slice(0, i)));
  return out;
}

export function valueType(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  if (t === 'string') return 'string';
  if (t === 'boolean') return 'boolean';
  if (t === 'bigint') return 'int';
  if (t === 'number') {
    if (Number.isNaN(v)) return 'nan';
    return Number.isInteger(v) ? 'int' : 'float';
  }
  return t === 'object' ? 'object' : 'string';
}

// Appends one node to `nodes` and, when it has children, a frame to `frames`
// so the caller's loop descends into it. Leaves close themselves immediately.
// A frame's `prefix` is the container id minus its closing bracket plus the
// separator, so each child id is a single concatenation.
function pushNode(nodes, frames, id, parentId, depth, key, keyKind, value, isLast) {
  const type = valueType(value);
  let keys = null;
  let childCount = 0;
  if (type === 'array') childCount = value.length;
  else if (type === 'object') {
    keys = Object.keys(value);
    childCount = keys.length;
  }
  const node = { id, parentId, depth, key, keyKind, type, value, childCount, end: 0, isLast };
  nodes.push(node);
  if (childCount > 0) {
    const prefix = id === ROOT_ID ? '[' : `${id.slice(0, -1)},`;
    frames.push({ node, keys, prefix, i: 0, last: childCount - 1 });
  } else {
    node.end = nodes.length;
  }
}

export function buildJsonTree(value) {
  const nodes = [];
  const frames = [];
  pushNode(nodes, frames, ROOT_ID, null, 0, null, 'root', value, true);
  while (frames.length > 0) {
    const frame = frames[frames.length - 1];
    const i = frame.i;
    if (i > frame.last) {
      frames.pop();
      frame.node.end = nodes.length;
      continue;
    }
    frame.i = i + 1;
    const parent = frame.node;
    const keys = frame.keys;
    const key = keys ? keys[i] : i;
    pushNode(
      nodes,
      frames,
      `${frame.prefix}${keyToken(key)}]`,
      parent.id,
      parent.depth + 1,
      key,
      keys ? 'object' : 'array',
      parent.value[key],
      i === frame.last
    );
  }
  return { nodes };
}

export function createExpansion(mode) {
  return { mode: mode === 'collapsed' ? 'collapsed' : 'expanded', overrides: new Set() };
}

export function isNodeExpanded(node, expansion, forcedIds) {
  const id = node.id;
  const base = expansion.mode === 'expanded' || (!!forcedIds && forcedIds.has(id));
  return expansion.overrides.has(id) ? !base : base;
}

export function toggleNode(expansion, id) {
  const overrides = new Set(expansion.overrides);
  if (overrides.has(id)) overrides.delete(id);
  else overrides.add(id);
  return { mode: expansion.mode, overrides };
}

function closeRow(node) {
  return { kind: 'close', rowId: `${node.id}:close`, node, depth: node.depth, expanded: false };
}

export function flattenVisibleRows(tree, expansion, forcedIds) {
  const nodes = tree.nodes;
  const total = nodes.length;
  const rows = [];
  const open = []; // expanded containers awaiting their close row
  let i = 0;
  while (i < total) {
    while (open.length > 0 && open[open.length - 1].end === i) {
      rows.push(closeRow(open.pop()));
    }
    const node = nodes[i];
    if (node.childCount > 0) {
      const expanded = isNodeExpanded(node, expansion, forcedIds);
      rows.push({ kind: 'open', rowId: node.id, node, depth: node.depth, expanded });
      if (expanded) {
        open.push(node);
        i++;
      } else {
        i = node.end;
      }
    } else if (node.type === 'object' || node.type === 'array') {
      rows.push({ kind: 'empty', rowId: node.id, node, depth: node.depth, expanded: false });
      i++;
    } else {
      rows.push({ kind: 'leaf', rowId: node.id, node, depth: node.depth, expanded: false });
      i++;
    }
  }
  while (open.length > 0) rows.push(closeRow(open.pop()));
  return rows;
}

export function nodeToJsonText(node) {
  const { type, value } = node;
  if (type === 'object' || type === 'array') return JSON.stringify(value, null, 2);
  if (type === 'string') return JSON.stringify(value);
  if (type === 'undefined') return 'undefined';
  if (type === 'nan') return 'NaN';
  return String(value);
}

export function rowIndexMap(rows) {
  const map = new Map();
  for (let i = 0; i < rows.length; i++) map.set(rows[i].rowId, i);
  return map;
}
