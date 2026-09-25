import { describe, it, expect } from 'vitest';
import {
  SEARCH_MATCH_CAP,
  normalizeSearchQuery,
  nodeSearchText,
  findTreeMatches,
} from './jsonSearch.js';
import { buildJsonTree, flattenVisibleRows, createExpansion, findRowIndex } from './jsonTree.js';

// GH-71: response search over the flat node table built by buildJsonTree.
// A match is addressed as { id, kind: 'key' | 'value', ordinal }: the node id
// (JSON.stringify(path)), which text of that node matched, and the 0-based
// occurrence index within that one text.

const findNode = (tree, id) => {
  const node = tree.nodes.find((n) => n.id === id);
  if (!node) throw new Error(`node ${id} not found`);
  return node;
};

const idOf = (...path) => JSON.stringify(path);
const shape = (matches) => matches.map(({ id, kind, ordinal }) => ({ id, kind, ordinal }));
const hit = (id, kind, ordinal) => ({ id, kind, ordinal });
const search = (value, query, cap) => {
  const tree = buildJsonTree(value);
  return shape(cap === undefined ? findTreeMatches(tree, query) : findTreeMatches(tree, query, cap));
};

const LOREM = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore';

// Same record shape as jsonTree.test.js UT-009 and the E2E large.json fixture.
const makeRecord = (i) => ({
  id: i,
  uuid: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  name: `Record ${i} ${LOREM}`,
  description: `${LOREM} ${LOREM} #${i}`,
  score: i + 0.25,
  ratio: -((i % 97) + 0.5),
  count: i * 3,
  active: i % 2 === 0,
  verified: i % 3 === 0,
  note: i % 5 === 0 ? null : `note-${i}`,
  tags: [`tag-${i % 7}`, `tag-${(i + 3) % 7}`, i % 11],
  meta: {
    level: i % 10,
    weight: (i % 100) / 100 + 0.005,
    flags: { alpha: true, beta: false },
    parent: null,
  },
  empty: {},
  none: [],
});

describe('jsonSearch (GH-71)', () => {
  it('UT-101 normalizeSearchQuery strips at most one leading and one trailing double quote (B1)', () => {
    expect(normalizeSearchQuery(null)).toBe('');
    expect(normalizeSearchQuery(undefined)).toBe('');
    expect(normalizeSearchQuery('')).toBe('');

    expect(normalizeSearchQuery('"route_id"')).toBe('route_id');
    expect(normalizeSearchQuery('"a')).toBe('a');
    expect(normalizeSearchQuery('a"')).toBe('a');
    expect(normalizeSearchQuery('"')).toBe('');
    expect(normalizeSearchQuery('""')).toBe('');
    expect(normalizeSearchQuery('a"b')).toBe('a"b');

    // Only one quote per side; inner quotes survive.
    expect(normalizeSearchQuery('"""')).toBe('"');
    expect(normalizeSearchQuery('""a""')).toBe('"a"');
    expect(normalizeSearchQuery('"a"b"')).toBe('a"b');

    // Nothing else changes: no case folding, no trimming.
    expect(normalizeSearchQuery('route_id')).toBe('route_id');
    expect(normalizeSearchQuery('"AbC"')).toBe('AbC');
    expect(normalizeSearchQuery(' a ')).toBe(' a ');
    expect(typeof normalizeSearchQuery('"x"')).toBe('string');
  });

  it('UT-102 nodeSearchText returns the raw searchable text per node type; containers yield null (B2)', () => {
    const value = {
      str: 'he said "hi" \\ back\nnext',
      blank: '',
      int: 42,
      zero: 0,
      float: 3.5,
      neg: -7,
      negFloat: -0.25,
      inf: Infinity,
      big: 10n,
      yes: true,
      no: false,
      nothing: null,
      n: NaN,
      u: undefined,
      emptyObj: {},
      emptyArr: [],
      obj: { a: 1 },
      arr: [1, 'x'],
    };
    const tree = buildJsonTree(value);
    const text = (id) => nodeSearchText(findNode(tree, id));

    // Strings: the raw value — no surrounding quotes, no JSON escaping.
    expect(text(idOf('str'))).toBe('he said "hi" \\ back\nnext');
    expect(text(idOf('blank'))).toBe('');

    expect(text(idOf('int'))).toBe('42');
    expect(text(idOf('zero'))).toBe('0');
    expect(text(idOf('float'))).toBe('3.5');
    expect(text(idOf('neg'))).toBe('-7');
    expect(text(idOf('negFloat'))).toBe('-0.25');
    expect(text(idOf('inf'))).toBe('Infinity');
    expect(text(idOf('big'))).toBe('10');
    expect(text(idOf('yes'))).toBe('true');
    expect(text(idOf('no'))).toBe('false');
    expect(text(idOf('nothing'))).toBe('null');
    expect(text(idOf('n'))).toBe('NaN');
    expect(text(idOf('u'))).toBe('undefined');

    // Containers (empty or not, root included) have no searchable value text.
    expect(text(idOf('emptyObj'))).toBeNull();
    expect(text(idOf('emptyArr'))).toBeNull();
    expect(text(idOf('obj'))).toBeNull();
    expect(text(idOf('arr'))).toBeNull();
    expect(text('[]')).toBeNull();

    // Array elements are ordinary leaves.
    expect(text(idOf('arr', 0))).toBe('1');
    expect(text(idOf('arr', 1))).toBe('x');
    expect(text(idOf('obj', 'a'))).toBe('1');

    // A primitive root is a leaf too.
    expect(nodeSearchText(buildJsonTree('solo').nodes[0])).toBe('solo');
    expect(nodeSearchText(buildJsonTree(7).nodes[0])).toBe('7');
    expect(nodeSearchText(buildJsonTree(null).nodes[0])).toBe('null');
    expect(nodeSearchText(buildJsonTree({}).nodes[0])).toBeNull();
    expect(nodeSearchText(buildJsonTree([]).nodes[0])).toBeNull();
  });

  it('UT-103 matches follow preorder, key before value, left-to-right non-overlapping ordinals (B3)', () => {
    const value = { ab: 'xabyab', list: ['ab', 1], nested: { abab: true } };
    expect(search(value, 'ab')).toEqual([
      hit(idOf('ab'), 'key', 0),
      hit(idOf('ab'), 'value', 0),
      hit(idOf('ab'), 'value', 1),
      hit(idOf('list', 0), 'value', 0),
      hit(idOf('nested', 'abab'), 'key', 0),
      hit(idOf('nested', 'abab'), 'key', 1),
    ]);

    // Non-overlapping: the next search starts after the previous occurrence.
    expect(search({ k: 'aaa' }, 'aa')).toEqual([hit(idOf('k'), 'value', 0)]);
    expect(search({ k: 'aaaa' }, 'aa')).toEqual([hit(idOf('k'), 'value', 0), hit(idOf('k'), 'value', 1)]);

    // A key whose value is a container matches before any of its descendants.
    expect(search({ abc: { abc: 'abc' } }, 'abc')).toEqual([
      hit(idOf('abc'), 'key', 0),
      hit(idOf('abc', 'abc'), 'key', 0),
      hit(idOf('abc', 'abc'), 'value', 0),
    ]);

    // Empty query never matches.
    expect(search(value, '')).toEqual([]);
  });

  it('UT-104 search is case-insensitive and covers numbers, booleans, null; indices, root and containers never match', () => {
    const tree = buildJsonTree({
      Name: 'HeLLo WoRLD',
      num: 12345,
      pi: 3.14,
      neg: -7,
      yes: true,
      no: false,
      nothing: null,
    });
    const find = (q) => shape(findTreeMatches(tree, q));

    expect(find('hello')).toEqual([hit(idOf('Name'), 'value', 0)]);
    expect(find('WORLD')).toEqual([hit(idOf('Name'), 'value', 0)]);
    expect(find('NAME')).toEqual([hit(idOf('Name'), 'key', 0)]);
    expect(find('34')).toEqual([hit(idOf('num'), 'value', 0)]);
    expect(find('.1')).toEqual([hit(idOf('pi'), 'value', 0)]);
    expect(find('-7')).toEqual([hit(idOf('neg'), 'value', 0)]);
    expect(find('tru')).toEqual([hit(idOf('yes'), 'value', 0)]);
    expect(find('ALS')).toEqual([hit(idOf('no'), 'value', 0)]);
    expect(find('nul')).toEqual([hit(idOf('nothing'), 'value', 0)]);

    expect(search({ n: NaN, u: undefined }, 'nan')).toEqual([hit(idOf('n'), 'value', 0)]);
    expect(search({ n: NaN, u: undefined }, 'NDEF')).toEqual([hit(idOf('u'), 'value', 0)]);

    // Array indices have no key text.
    expect(search(['x'], '0')).toEqual([]);
    expect(search([['a'], ['b']], '1')).toEqual([]);
    // ...but keys of objects inside arrays do.
    expect(search([{ k: 'v' }], 'k')).toEqual([hit(idOf(0, 'k'), 'key', 0)]);

    // Containers never contribute value text ([object Object], "1,2", brackets).
    const containers = { a: { b: 1 }, c: [1, 2] };
    expect(search(containers, 'object')).toEqual([]);
    expect(search(containers, '1,2')).toEqual([]);
    expect(search(containers, '[')).toEqual([]);
    expect(search(containers, '{')).toEqual([]);
    expect(search({}, 'object')).toEqual([]);

    // The root has no key text, but a primitive root's value is searchable.
    expect(search('hello', 'ell')).toEqual([hit('[]', 'value', 0)]);
    expect(search(12345, '34')).toEqual([hit('[]', 'value', 0)]);
  });

  it('UT-105 the result stops at the cap (default SEARCH_MATCH_CAP and a custom cap); empty query -> []', () => {
    expect(SEARCH_MATCH_CAP).toBe(5000);

    const many = buildJsonTree(Array.from({ length: 6000 }, () => 'x'));
    const capped = findTreeMatches(many, 'x');
    expect(capped).toHaveLength(SEARCH_MATCH_CAP);
    expect(shape([capped[0]])).toEqual([hit('[0]', 'value', 0)]);
    expect(shape([capped[SEARCH_MATCH_CAP - 1]])).toEqual([hit(`[${SEARCH_MATCH_CAP - 1}]`, 'value', 0)]);

    // Exactly the cap when exactly that many exist; everything when fewer.
    expect(findTreeMatches(buildJsonTree(Array(5000).fill('x')), 'x')).toHaveLength(5000);
    expect(findTreeMatches(buildJsonTree(Array(5001).fill('x')), 'x')).toHaveLength(5000);
    expect(findTreeMatches(buildJsonTree(Array(4999).fill('x')), 'x')).toHaveLength(4999);

    // Many occurrences inside one text are capped too.
    const oneText = findTreeMatches(buildJsonTree({ a: 'x'.repeat(6000) }), 'x');
    expect(oneText).toHaveLength(SEARCH_MATCH_CAP);
    expect(oneText[SEARCH_MATCH_CAP - 1].ordinal).toBe(SEARCH_MATCH_CAP - 1);

    // Custom cap keeps the first `cap` matches in order.
    expect(shape(findTreeMatches(many, 'x', 3))).toEqual([
      hit('[0]', 'value', 0),
      hit('[1]', 'value', 0),
      hit('[2]', 'value', 0),
    ]);
    expect(search({ a: 'x'.repeat(10) }, 'x', 4)).toEqual([
      hit(idOf('a'), 'value', 0),
      hit(idOf('a'), 'value', 1),
      hit(idOf('a'), 'value', 2),
      hit(idOf('a'), 'value', 3),
    ]);
    // The cap may fall between the key and the value of one node.
    expect(search({ x: 'xx' }, 'x', 2)).toEqual([hit(idOf('x'), 'key', 0), hit(idOf('x'), 'value', 0)]);
    expect(search({ x: 'xx' }, 'x', 1)).toEqual([hit(idOf('x'), 'key', 0)]);

    expect(findTreeMatches(many, '')).toEqual([]);
    expect(findTreeMatches(many, '', 3)).toEqual([]);
  });

  it('UT-106 matches never span two texts; control characters inside a text still match; length-changing lowercase keeps ids right', () => {
    const pair = { a: 'ab', b: 'cd' };
    // Concatenated text would be "a" "ab" "b" "cd": none of these may match across a boundary.
    expect(search(pair, 'bc')).toEqual([]);
    expect(search(pair, 'aa')).toEqual([]);
    expect(search(pair, 'bb')).toEqual([]);
    expect(search(pair, 'abb')).toEqual([]);
    expect(search(pair, '\u0000')).toEqual([]);
    expect(search(pair, '\n')).toEqual([]);
    expect(search(pair, 'b\u0000c')).toEqual([]);
    expect(search(pair, 'b\nc')).toEqual([]);
    expect(search(pair, 'ab\u0000b')).toEqual([]);
    expect(search(pair, 'ab\nb')).toEqual([]);

    // A text that itself contains the character still matches it.
    expect(search({ a: 'x\u0000y' }, '\u0000')).toEqual([hit(idOf('a'), 'value', 0)]);
    expect(search({ a: 'x\ny' }, '\n')).toEqual([hit(idOf('a'), 'value', 0)]);
    expect(search({ a: 'x\ny' }, 'x\ny')).toEqual([hit(idOf('a'), 'value', 0)]);
    expect(search({ 'k\nk': 1 }, '\n')).toEqual([hit(idOf('k\nk'), 'key', 0)]);

    // 'İ' (U+0130) lowercases to two code units; later ids must not drift.
    expect('İ'.toLowerCase()).toHaveLength(2);
    expect(search({ 'İx': 'x1', b: 'ax', c: ['x'] }, 'x')).toEqual([
      hit(idOf('İx'), 'key', 0),
      hit(idOf('İx'), 'value', 0),
      hit(idOf('b'), 'value', 0),
      hit(idOf('c', 0), 'value', 0),
    ]);

    const heavy = {
      'İİİİİİİİİİx': 1,
      a: 'x',
      b: 'y',
      c: 'x',
      d: 'yy',
      e: 'zx',
      f: 'İİİİİİİİİİ',
      g: 'x',
      h: ['y', 'x'],
    };
    expect(search(heavy, 'x')).toEqual([
      hit(idOf('İİİİİİİİİİx'), 'key', 0),
      hit(idOf('a'), 'value', 0),
      hit(idOf('c'), 'value', 0),
      hit(idOf('e'), 'value', 0),
      hit(idOf('g'), 'value', 0),
      hit(idOf('h', 1), 'value', 0),
    ]);
    expect(search(heavy, 'y')).toEqual([
      hit(idOf('b'), 'value', 0),
      hit(idOf('d'), 'value', 0),
      hit(idOf('d'), 'value', 1),
      hit(idOf('h', 0), 'value', 0),
    ]);

    // Both sides are lowercased with toLowerCase(), exactly as before.
    expect(search({ a: 'İ' }, 'İ')).toEqual([hit(idOf('a'), 'value', 0)]);
    expect(search({ a: 'İ', b: 'q' }, 'i')).toEqual([hit(idOf('a'), 'value', 0)]);
  });

  it('UT-107 match ids equal tree.nodes ids (JSON.stringify(path)), including keys that need escaping', () => {
    const value = {
      'we"ird': { 'a\\b': 'x', 'new\nline': ['x'] },
      'x y': 'plain',
      'ü': 'x',
    };
    const tree = buildJsonTree(value);
    const nodeIds = new Set(tree.nodes.map((n) => n.id));
    const find = (q) => shape(findTreeMatches(tree, q));

    const xs = find('x');
    expect(xs).toEqual([
      hit(JSON.stringify(['we"ird', 'a\\b']), 'value', 0),
      hit(JSON.stringify(['we"ird', 'new\nline', 0]), 'value', 0),
      hit(JSON.stringify(['x y']), 'key', 0),
      hit(JSON.stringify(['ü']), 'value', 0),
    ]);
    xs.forEach((m) => expect(nodeIds.has(m.id)).toBe(true));

    // Keys are searched in their raw form: one backslash, a real quote, a real newline.
    expect(find('e"i')).toEqual([hit('["we\\"ird"]', 'key', 0)]);
    expect(find('e"i')[0].id).toBe(JSON.stringify(['we"ird']));
    expect(find('\\')).toEqual([hit(JSON.stringify(['we"ird', 'a\\b']), 'key', 0)]);
    expect(find('\nl')).toEqual([hit(JSON.stringify(['we"ird', 'new\nline']), 'key', 0)]);
    [...find('e"i'), ...find('\\'), ...find('\nl')].forEach((m) => expect(nodeIds.has(m.id)).toBe(true));

    // Every match on a larger mixed body points at an existing node.
    const mixed = buildJsonTree({ list: [{ 'k"1': 'val' }, { k2: ['val', { val: 'val' }] }], val: null });
    const mixedIds = new Set(mixed.nodes.map((n) => n.id));
    const valHits = shape(findTreeMatches(mixed, 'val'));
    expect(valHits).toEqual([
      hit(JSON.stringify(['list', 0, 'k"1']), 'value', 0),
      hit(JSON.stringify(['list', 1, 'k2', 0]), 'value', 0),
      hit(JSON.stringify(['list', 1, 'k2', 1, 'val']), 'key', 0),
      hit(JSON.stringify(['list', 1, 'k2', 1, 'val']), 'value', 0),
      hit(JSON.stringify(['val']), 'key', 0),
    ]);
    valHits.forEach((m) => expect(mixedIds.has(m.id)).toBe(true));
  });

  it('UT-108 the per-tree search index is reused and never leaks between trees (B4)', () => {
    const treeA = buildJsonTree({ a: 'foo', b: 'food' });
    const treeB = buildJsonTree({ c: ['foo'], d: { foo: 'bar' } });

    const firstA = shape(findTreeMatches(treeA, 'foo'));
    expect(firstA).toEqual([hit(idOf('a'), 'value', 0), hit(idOf('b'), 'value', 0)]);

    const firstB = shape(findTreeMatches(treeB, 'foo'));
    expect(firstB).toEqual([hit(idOf('c', 0), 'value', 0), hit(idOf('d', 'foo'), 'key', 0)]);

    // Searching B did not disturb A, and repeated calls agree.
    expect(shape(findTreeMatches(treeA, 'foo'))).toEqual(firstA);
    expect(shape(findTreeMatches(treeB, 'foo'))).toEqual(firstB);
    expect(shape(findTreeMatches(treeA, 'foo'))).toEqual(firstA);

    // Other queries and caps on the same (reused) index.
    expect(shape(findTreeMatches(treeA, 'od'))).toEqual([hit(idOf('b'), 'value', 0)]);
    expect(shape(findTreeMatches(treeA, 'bar'))).toEqual([]);
    expect(shape(findTreeMatches(treeB, 'bar'))).toEqual([hit(idOf('d', 'foo'), 'value', 0)]);
    expect(shape(findTreeMatches(treeA, 'foo', 1))).toEqual([hit(idOf('a'), 'value', 0)]);
    expect(shape(findTreeMatches(treeA, 'foo'))).toEqual(firstA);

    // A new tree object gets its own index, even for identical-looking ids.
    const treeA2 = buildJsonTree({ a: 'bar' });
    expect(shape(findTreeMatches(treeA2, 'foo'))).toEqual([]);
    expect(shape(findTreeMatches(treeA2, 'bar'))).toEqual([hit(idOf('a'), 'value', 0)]);
    expect(shape(findTreeMatches(treeA, 'foo'))).toEqual(firstA);
    expect(shape(findTreeMatches(treeA, 'bar'))).toEqual([]);

    // Two trees built from the same value are independent but agree.
    const value = { k: 'same' };
    const t1 = buildJsonTree(value);
    const t2 = buildJsonTree(value);
    expect(shape(findTreeMatches(t1, 'am'))).toEqual([hit(idOf('k'), 'value', 0)]);
    expect(shape(findTreeMatches(t2, 'am'))).toEqual([hit(idOf('k'), 'value', 0)]);
  });

  it('UT-109 perf (B5): ~10 MB body — first call < 1000 ms, later calls < 100 ms, findRowIndex < 50 ms', () => {
    const MIN_BYTES = 10 * 1024 * 1024;
    const records = [];
    let size = '{"records":[]}'.length;
    for (let i = 0; size < MIN_BYTES + 64 * 1024; i++) {
      const rec = makeRecord(i);
      records.push(rec);
      size += JSON.stringify(rec).length + 1;
    }
    const body = { records };
    expect(JSON.stringify(body).length).toBeGreaterThanOrEqual(MIN_BYTES);

    // Tree construction is not part of the search budget.
    const tree = buildJsonTree(body);
    expect(tree.nodes.length).toBeGreaterThan(100000);

    // First call on this tree includes building its search index.
    const t0 = performance.now();
    const first = findTreeMatches(tree, 'zzzz-no-match');
    const firstMs = performance.now() - t0;
    expect(first).toEqual([]);
    expect(firstMs).toBeLessThan(1000);

    // Later no-match call scans the whole (reused) index.
    const t1 = performance.now();
    const none = findTreeMatches(tree, 'qqqq-still-no-match');
    const noneMs = performance.now() - t1;
    expect(none).toEqual([]);
    expect(noneMs).toBeLessThan(100);

    // Later cap-hitting call.
    const t2 = performance.now();
    const capped = findTreeMatches(tree, 'e');
    const cappedMs = performance.now() - t2;
    expect(capped).toHaveLength(SEARCH_MATCH_CAP);
    expect(cappedMs).toBeLessThan(100);

    // A cap-hitting call whose last hit lies deep in the body (~89 % in: "note-1xxxx").
    const t3 = performance.now();
    const deepCapped = findTreeMatches(tree, 'note-1');
    const deepCappedMs = performance.now() - t3;
    expect(deepCapped).toHaveLength(SEARCH_MATCH_CAP);
    expect(deepCappedMs).toBeLessThan(100);
    const lastPath = JSON.parse(deepCapped[SEARCH_MATCH_CAP - 1].id);
    expect(lastPath[0]).toBe('records');
    expect(lastPath[2]).toBe('note');
    expect(lastPath[1]).toBeGreaterThan(records.length / 2);

    // A unique hit in the very last record.
    const lastIndex = records.length - 1;
    const lastNameId = JSON.stringify(['records', lastIndex, 'name']);
    const t4 = performance.now();
    const unique = shape(findTreeMatches(tree, `Record ${lastIndex} lorem`));
    const uniqueMs = performance.now() - t4;
    expect(unique).toEqual([hit(lastNameId, 'value', 0)]);
    expect(uniqueMs).toBeLessThan(100);

    // Row lookup of the last record's name leaf over the fully expanded rows.
    const rows = flattenVisibleRows(tree, createExpansion('expanded'), null);
    expect(rows.length).toBeGreaterThan(100000);
    // Warm up, then take the fastest of several runs: a single cold scan is
    // noisy while other Vitest workers are busy with their own large bodies.
    let rowIndex = findRowIndex(rows, lastNameId);
    let rowMs = Infinity;
    for (let i = 0; i < 5; i++) {
      const t5 = performance.now();
      rowIndex = findRowIndex(rows, lastNameId);
      rowMs = Math.min(rowMs, performance.now() - t5);
    }
    expect(rowIndex).toBeGreaterThanOrEqual(0);
    expect(rows[rowIndex].rowId).toBe(lastNameId);
    expect(rows[rowIndex].kind).toBe('leaf');
    expect(rowMs).toBeLessThan(50);
  }, 60000);
});
