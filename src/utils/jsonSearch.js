export const SEARCH_MATCH_CAP = 5000;

// A control character keeps each text's lowercasing context (e.g. final sigma)
// independent of its neighbours; hits that reach it are rejected anyway.
const SEPARATOR = '\u0000';
const KIND_KEY = 0;
const KIND_VALUE = 1;

// Let users type quotes around a term the way they see it in the tree view
// (e.g. `"route_id"` matches the key `route_id`). Strip at most one leading
// and one trailing double-quote. Middle quotes are preserved.
export function normalizeSearchQuery(raw) {
  if (!raw) return '';
  let q = raw;
  if (q.startsWith('"')) q = q.slice(1);
  if (q.length > 0 && q.endsWith('"')) q = q.slice(0, -1);
  return q;
}

export function nodeSearchText(node) {
  const { type, value } = node;
  if (type === 'object' || type === 'array') return null;
  if (type === 'string') return typeof value === 'string' ? value : String(value);
  if (type === 'nan') return 'NaN';
  if (type === 'undefined') return 'undefined';
  if (type === 'null') return 'null';
  return String(value);
}

// One lowercased haystack per tree: every key text and value text in
// `tree.nodes` order, joined by SEPARATOR, with the start offset, owning node
// index and kind of each text.
const indexCache = new WeakMap();

function buildIndex(tree) {
  const nodes = tree.nodes;
  let count = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.keyKind === 'object') count++;
    if (node.type !== 'object' && node.type !== 'array') count++;
  }

  const texts = new Array(count);
  const starts = new Int32Array(count);
  const owners = new Int32Array(count);
  const kinds = new Uint8Array(count);
  let s = 0;
  let offset = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.keyKind === 'object') {
      const text = String(node.key);
      texts[s] = text;
      starts[s] = offset;
      owners[s] = i;
      kinds[s] = KIND_KEY;
      offset += text.length + 1;
      s++;
    }
    const text = nodeSearchText(node);
    if (text !== null) {
      texts[s] = text;
      starts[s] = offset;
      owners[s] = i;
      kinds[s] = KIND_VALUE;
      offset += text.length + 1;
      s++;
    }
  }

  const raw = texts.join(SEPARATOR);
  let haystack = raw.toLowerCase();
  // Lowercasing never shortens UTF-16 text, so an unchanged total length means
  // every offset still holds. Otherwise (e.g. 'İ' -> 'i̇') re-measure per text.
  if (haystack.length !== raw.length) {
    offset = 0;
    for (let k = 0; k < count; k++) {
      const lowered = texts[k].toLowerCase();
      texts[k] = lowered;
      starts[k] = offset;
      offset += lowered.length + 1;
    }
    haystack = texts.join(SEPARATOR);
  }

  return { haystack, starts, owners, kinds, count };
}

function getIndex(tree) {
  let index = indexCache.get(tree);
  if (!index) {
    index = buildIndex(tree);
    indexCache.set(tree, index);
  }
  return index;
}

// Last text whose start is <= pos, searching forward from `from` (hits arrive
// in increasing order, so the answer never moves backwards).
function segmentAt(starts, count, from, pos) {
  if (from + 1 >= count || starts[from + 1] > pos) return from;
  let lo = from + 1;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function findTreeMatches(tree, query, cap = SEARCH_MATCH_CAP) {
  if (!tree || !query || !(cap > 0)) return [];
  const q = String(query).toLowerCase();
  if (!q) return [];
  const { haystack, starts, owners, kinds, count } = getIndex(tree);
  if (count === 0) return [];

  const nodes = tree.nodes;
  const out = [];
  let seg = 0;
  let lastSeg = -1;
  let ordinal = 0;
  let cursor = 0;
  let idx;
  while (out.length < cap && (idx = haystack.indexOf(q, cursor)) !== -1) {
    seg = segmentAt(starts, count, seg, idx);
    const end = seg + 1 < count ? starts[seg + 1] - 1 : haystack.length;
    if (idx + q.length > end) {
      cursor = idx + 1;
      continue;
    }
    ordinal = seg === lastSeg ? ordinal + 1 : 0;
    lastSeg = seg;
    out.push({ id: nodes[owners[seg]].id, kind: kinds[seg] === KIND_KEY ? 'key' : 'value', ordinal });
    cursor = idx + q.length;
  }
  return out;
}
