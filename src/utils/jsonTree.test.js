import { describe, it, expect } from 'vitest';
import {
  ROOT_ID,
  childId,
  ancestorIds,
  valueType,
  buildJsonTree,
  createExpansion,
  isNodeExpanded,
  toggleNode,
  flattenVisibleRows,
  nodeToJsonText,
  rowIndexMap,
} from './jsonTree.js';

// GH-70: pure, iterative tree helpers behind the row-virtualized JSON viewer.
// Node ids are JSON.stringify(path) — the same strings the search dock builds.

const SAMPLE = { a: [{ b: 1 }, 2], c: {} };

const findNode = (tree, id) => {
  const node = tree.nodes.find((n) => n.id === id);
  if (!node) throw new Error(`node ${id} not found`);
  return node;
};

const rowSummary = (rows) => rows.map((r) => [r.kind, r.rowId, r.depth]);

describe('jsonTree (GH-70)', () => {
  it('UT-001 childId / ancestorIds / ROOT_ID use JSON.stringify(path) forms, ancestors root-first', () => {
    expect(ROOT_ID).toBe('[]');
    expect(ROOT_ID).toBe(JSON.stringify([]));

    expect(childId(ROOT_ID, 'a')).toBe('["a"]');
    expect(childId('["a"]', 0)).toBe('["a",0]');
    expect(childId('["a",0]', 'b')).toBe('["a",0,"b"]');
    expect(childId(ROOT_ID, 0)).toBe(JSON.stringify([0]));

    // Keys needing JSON escaping still match JSON.stringify(path).
    expect(childId(ROOT_ID, 'we"ird')).toBe(JSON.stringify(['we"ird']));
    expect(childId(childId(ROOT_ID, 'x y'), 'z')).toBe(JSON.stringify(['x y', 'z']));

    // Chained ids equal the id built from the whole path in one go.
    const path = ['a', 0, 'b'];
    const chained = path.reduce((id, key) => childId(id, key), ROOT_ID);
    expect(chained).toBe(JSON.stringify(path));

    expect(ancestorIds('["a",0,"b"]')).toEqual(['[]', '["a"]', '["a",0]']);
    expect(ancestorIds('["a"]')).toEqual(['[]']);
    expect(ancestorIds(ROOT_ID)).toEqual([]);
    // Excludes the id itself.
    expect(ancestorIds('["a",0,"b"]')).not.toContain('["a",0,"b"]');
  });

  it('UT-002 valueType classifies every JSON-ish value kind', () => {
    expect(valueType('x')).toBe('string');
    expect(valueType('')).toBe('string');
    expect(valueType(1)).toBe('int');
    expect(valueType(0)).toBe('int');
    expect(valueType(-7)).toBe('int');
    expect(valueType(10n)).toBe('int');
    expect(valueType(1.5)).toBe('float');
    expect(valueType(-0.25)).toBe('float');
    expect(valueType(3.14)).toBe('float');
    expect(valueType(Infinity)).toBe('float');
    expect(valueType(-Infinity)).toBe('float');
    expect(valueType(NaN)).toBe('nan');
    expect(valueType(true)).toBe('boolean');
    expect(valueType(false)).toBe('boolean');
    expect(valueType(null)).toBe('null');
    expect(valueType(undefined)).toBe('undefined');
    expect(valueType({})).toBe('object');
    expect(valueType({ a: 1 })).toBe('object');
    expect(valueType([])).toBe('array');
    expect(valueType([1, 2])).toBe('array');
  });

  it('UT-003 buildJsonTree emits preorder nodes with depth/key/keyKind/childCount/end/isLast', () => {
    const tree = buildJsonTree(SAMPLE);
    expect(Array.isArray(tree.nodes)).toBe(true);
    expect(tree.nodes.map((n) => n.id)).toEqual([
      '[]',
      '["a"]',
      '["a",0]',
      '["a",0,"b"]',
      '["a",1]',
      '["c"]',
    ]);

    const [root, a, a0, a0b, a1, c] = tree.nodes;

    expect(root).toMatchObject({
      id: '[]', parentId: null, depth: 0, key: null, keyKind: 'root',
      type: 'object', childCount: 2, end: 6, isLast: true,
    });
    expect(root.value).toBe(SAMPLE);

    expect(a).toMatchObject({
      id: '["a"]', parentId: '[]', depth: 1, key: 'a', keyKind: 'object',
      type: 'array', childCount: 2, end: 5, isLast: false,
    });
    expect(a.value).toBe(SAMPLE.a);

    expect(a0).toMatchObject({
      id: '["a",0]', parentId: '["a"]', depth: 2, key: 0, keyKind: 'array',
      type: 'object', childCount: 1, end: 4, isLast: false,
    });

    expect(a0b).toMatchObject({
      id: '["a",0,"b"]', parentId: '["a",0]', depth: 3, key: 'b', keyKind: 'object',
      type: 'int', value: 1, childCount: 0, end: 4, isLast: true,
    });

    expect(a1).toMatchObject({
      id: '["a",1]', parentId: '["a"]', depth: 2, key: 1, keyKind: 'array',
      type: 'int', value: 2, childCount: 0, end: 5, isLast: true,
    });

    expect(c).toMatchObject({
      id: '["c"]', parentId: '[]', depth: 1, key: 'c', keyKind: 'object',
      type: 'object', childCount: 0, end: 6, isLast: true,
    });

    // `end` of every node points just past its last descendant, never beyond the array.
    tree.nodes.forEach((n, i) => {
      expect(n.end).toBeGreaterThan(i);
      expect(n.end).toBeLessThanOrEqual(tree.nodes.length);
    });

    // Object children follow Object.keys order, array children index order.
    const ordered = buildJsonTree({ z: 1, a: [true, false] });
    expect(ordered.nodes.map((n) => n.key)).toEqual([null, 'z', 'a', 0, 1]);

    // A primitive root is a single leaf node.
    const prim = buildJsonTree(42);
    expect(prim.nodes).toHaveLength(1);
    expect(prim.nodes[0]).toMatchObject({
      id: '[]', parentId: null, depth: 0, key: null, keyKind: 'root',
      type: 'int', value: 42, childCount: 0, end: 1, isLast: true,
    });

    // Empty containers as root have childCount 0.
    expect(buildJsonTree([]).nodes[0]).toMatchObject({ type: 'array', childCount: 0, end: 1 });
  });

  it('UT-004 flattenVisibleRows (all expanded) yields open/leaf/empty/close rows in order; close rows carry node depth', () => {
    const tree = buildJsonTree(SAMPLE);
    const rows = flattenVisibleRows(tree, createExpansion('expanded'), null);

    expect(rowSummary(rows)).toEqual([
      ['open', '[]', 0],
      ['open', '["a"]', 1],
      ['open', '["a",0]', 2],
      ['leaf', '["a",0,"b"]', 3],
      ['close', '["a",0]:close', 2],
      ['leaf', '["a",1]', 2],
      ['close', '["a"]:close', 1],
      ['empty', '["c"]', 1],
      ['close', '[]:close', 0],
    ]);

    // Open rows are flagged expanded; every other row reports expanded: false.
    rows.forEach((row) => {
      if (row.kind === 'open') expect(row.expanded).toBe(true);
      else expect(row.expanded).toBe(false);
    });

    // Every row references its node; close rows reference the container they close.
    expect(rows[0].node).toBe(tree.nodes[0]);
    expect(rows[4].node).toBe(findNode(tree, '["a",0]'));
    expect(rows[8].node).toBe(tree.nodes[0]);
    expect(rows[7].node).toBe(findNode(tree, '["c"]'));

    // rowIndexMap maps every rowId to its index.
    const map = rowIndexMap(rows);
    expect(map).toBeInstanceOf(Map);
    expect(map.size).toBe(rows.length);
    rows.forEach((row, i) => expect(map.get(row.rowId)).toBe(i));
    expect(map.get('["a"]:close')).toBe(6);

    // A primitive root flattens to a single leaf row.
    const primRows = flattenVisibleRows(buildJsonTree('hi'), createExpansion('expanded'), null);
    expect(rowSummary(primRows)).toEqual([['leaf', '[]', 0]]);

    // An empty container root flattens to a single empty row.
    const emptyRows = flattenVisibleRows(buildJsonTree({}), createExpansion('expanded'), null);
    expect(rowSummary(emptyRows)).toEqual([['empty', '[]', 0]]);
  });

  it('UT-005 flattenVisibleRows (mode collapsed) yields only the root open row with expanded:false', () => {
    const tree = buildJsonTree(SAMPLE);
    const expansion = createExpansion('collapsed');
    expect(expansion.mode).toBe('collapsed');
    expect(expansion.overrides).toBeInstanceOf(Set);
    expect(expansion.overrides.size).toBe(0);

    const rows = flattenVisibleRows(tree, expansion, null);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'open', rowId: '[]', depth: 0, expanded: false });
    expect(rows[0].node).toBe(tree.nodes[0]);
    expect(isNodeExpanded(tree.nodes[0], expansion, null)).toBe(false);
  });

  it('UT-006 toggleNode flips one id via overrides (B3) and never mutates its input', () => {
    const tree = buildJsonTree(SAMPLE);
    const nodeA = findNode(tree, '["a"]');
    const nodeA0 = findNode(tree, '["a",0]');

    // Expanded mode: one toggle collapses that node only.
    const exp = createExpansion('expanded');
    expect(exp.mode).toBe('expanded');
    const exp2 = toggleNode(exp, '["a"]');
    expect(exp2).not.toBe(exp);
    expect(exp2.mode).toBe('expanded');
    expect(exp2.overrides.has('["a"]')).toBe(true);
    expect(exp2.overrides).not.toBe(exp.overrides);
    // Input untouched.
    expect(exp.overrides.size).toBe(0);
    expect(isNodeExpanded(nodeA, exp, null)).toBe(true);

    expect(isNodeExpanded(nodeA, exp2, null)).toBe(false);
    expect(isNodeExpanded(nodeA0, exp2, null)).toBe(true); // only the toggled id changes
    expect(rowSummary(flattenVisibleRows(tree, exp2, null))).toEqual([
      ['open', '[]', 0],
      ['open', '["a"]', 1],
      ['empty', '["c"]', 1],
      ['close', '[]:close', 0],
    ]);
    expect(flattenVisibleRows(tree, exp2, null)[1].expanded).toBe(false);

    // Toggling the same id again removes the override and restores the base state.
    const exp3 = toggleNode(exp2, '["a"]');
    expect(exp3.overrides.has('["a"]')).toBe(false);
    expect(exp2.overrides.has('["a"]')).toBe(true); // exp2 not mutated
    expect(isNodeExpanded(nodeA, exp3, null)).toBe(true);
    expect(flattenVisibleRows(tree, exp3, null)).toHaveLength(9);

    // Collapsed mode: one toggle expands that node only.
    const col = createExpansion('collapsed');
    const col2 = toggleNode(col, '[]');
    expect(col.overrides.size).toBe(0);
    expect(col2.mode).toBe('collapsed');
    expect(isNodeExpanded(tree.nodes[0], col2, null)).toBe(true);
    expect(isNodeExpanded(nodeA, col2, null)).toBe(false);
    expect(rowSummary(flattenVisibleRows(tree, col2, null))).toEqual([
      ['open', '[]', 0],
      ['open', '["a"]', 1],
      ['empty', '["c"]', 1],
      ['close', '[]:close', 0],
    ]);

    const col3 = toggleNode(col2, '["a"]');
    expect(col2.overrides.has('["a"]')).toBe(false); // col2 not mutated
    expect(rowSummary(flattenVisibleRows(tree, col3, null))).toEqual([
      ['open', '[]', 0],
      ['open', '["a"]', 1],
      ['open', '["a",0]', 2],
      ['leaf', '["a",1]', 2],
      ['close', '["a"]:close', 1],
      ['empty', '["c"]', 1],
      ['close', '[]:close', 0],
    ]);
    expect(flattenVisibleRows(tree, col3, null)[2].expanded).toBe(false);
  });

  it('UT-007 forcedIds expand forced ancestors under collapsed mode; siblings stay collapsed; an override on a forced id collapses it', () => {
    const value = { a: [{ b: 1 }, 2], c: { d: { e: 3 } } };
    const tree = buildJsonTree(value);
    const nodeA = findNode(tree, '["a"]');
    const nodeC = findNode(tree, '["c"]');
    const nodeCD = findNode(tree, '["c","d"]');

    const forced = new Set(ancestorIds('["c","d","e"]'));
    expect([...forced]).toEqual(['[]', '["c"]', '["c","d"]']);

    const expansion = createExpansion('collapsed');

    expect(isNodeExpanded(tree.nodes[0], expansion, forced)).toBe(true);
    expect(isNodeExpanded(nodeC, expansion, forced)).toBe(true);
    expect(isNodeExpanded(nodeCD, expansion, forced)).toBe(true);
    expect(isNodeExpanded(nodeA, expansion, forced)).toBe(false);

    const rows = flattenVisibleRows(tree, expansion, forced);
    expect(rowSummary(rows)).toEqual([
      ['open', '[]', 0],
      ['open', '["a"]', 1],
      ['open', '["c"]', 1],
      ['open', '["c","d"]', 2],
      ['leaf', '["c","d","e"]', 3],
      ['close', '["c","d"]:close', 2],
      ['close', '["c"]:close', 1],
      ['close', '[]:close', 0],
    ]);
    expect(rows[1].expanded).toBe(false);
    expect(rows[2].expanded).toBe(true);
    expect(rows.some((r) => r.rowId === '["a",0]')).toBe(false);

    // Override on a forced id collapses it (expanded = overrides.has(id) ? !base : base).
    const overridden = toggleNode(expansion, '["c"]');
    expect(isNodeExpanded(nodeC, overridden, forced)).toBe(false);
    expect(rowSummary(flattenVisibleRows(tree, overridden, forced))).toEqual([
      ['open', '[]', 0],
      ['open', '["a"]', 1],
      ['open', '["c"]', 1],
      ['close', '[]:close', 0],
    ]);

    // Override on a non-forced sibling expands it while the forced set is active.
    const siblingOpen = toggleNode(expansion, '["a"]');
    expect(isNodeExpanded(nodeA, siblingOpen, forced)).toBe(true);
    expect(flattenVisibleRows(tree, siblingOpen, forced).some((r) => r.rowId === '["a",0]')).toBe(true);

    // With no forced set the collapsed mode collapses everything again.
    expect(flattenVisibleRows(tree, expansion, null)).toHaveLength(1);
    // Under expanded mode a forced set changes nothing.
    expect(flattenVisibleRows(tree, createExpansion('expanded'), forced)).toHaveLength(
      flattenVisibleRows(tree, createExpansion('expanded'), null).length,
    );
  });

  it('UT-008 nodeToJsonText produces the exact copy text per type (B6)', () => {
    const value = {
      obj: { a: 1, b: [1, 2] },
      arr: [{ x: 'y' }, null],
      str: 'he said "hi"\nnext',
      int: 42,
      neg: -7,
      float: 3.5,
      yes: true,
      no: false,
      nothing: null,
      u: undefined,
      n: NaN,
      emptyObj: {},
      emptyArr: [],
    };
    const tree = buildJsonTree(value);
    const text = (id) => nodeToJsonText(findNode(tree, id));

    expect(text('[]')).toBe(JSON.stringify(value, null, 2));
    expect(text('["obj"]')).toBe(JSON.stringify(value.obj, null, 2));
    expect(text('["obj"]')).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
    expect(text('["arr"]')).toBe(JSON.stringify(value.arr, null, 2));
    expect(text('["str"]')).toBe('"he said \\"hi\\"\\nnext"');
    expect(text('["int"]')).toBe('42');
    expect(text('["neg"]')).toBe('-7');
    expect(text('["float"]')).toBe('3.5');
    expect(text('["yes"]')).toBe('true');
    expect(text('["no"]')).toBe('false');
    expect(text('["nothing"]')).toBe('null');
    expect(text('["u"]')).toBe('undefined');
    expect(text('["n"]')).toBe('NaN');
    expect(text('["emptyObj"]')).toBe('{}');
    expect(text('["emptyArr"]')).toBe('[]');
    expect(text('["obj","b",0]')).toBe('1');
    expect(text('["arr",0,"x"]')).toBe('"y"');
  });

  it('UT-009 perf budget (B9): ~10 MB body builds + flattens in < 1000 ms with > 100000 rows; no recursion crash at depth 20000', () => {
    const MIN_BYTES = 10 * 1024 * 1024;
    const LOREM = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore';

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

    const records = [];
    let size = '{"records":[]}'.length;
    for (let i = 0; size < MIN_BYTES + 64 * 1024; i++) {
      const rec = makeRecord(i);
      records.push(rec);
      size += JSON.stringify(rec).length + 1;
    }
    const body = { records };
    expect(JSON.stringify(body).length).toBeGreaterThanOrEqual(10485760);

    const start = performance.now();
    const tree = buildJsonTree(body);
    const rows = flattenVisibleRows(tree, createExpansion('expanded'), null);
    const elapsed = performance.now() - start;

    expect(rows.length).toBeGreaterThan(100000);
    expect(tree.nodes.length).toBeGreaterThan(100000);
    expect(elapsed).toBeLessThan(1000);

    // The last row closes the root; the first opens it.
    expect(rows[0]).toMatchObject({ kind: 'open', rowId: '[]', depth: 0, expanded: true });
    expect(rows[rows.length - 1]).toMatchObject({ kind: 'close', rowId: '[]:close', depth: 0 });

    // rowIndexMap over the full row set stays cheap and complete.
    const mapStart = performance.now();
    const map = rowIndexMap(rows);
    expect(performance.now() - mapStart).toBeLessThan(1000);
    expect(map.size).toBe(rows.length);

    // No recursion: a 20000-deep nested array must not throw RangeError.
    let deep = [];
    for (let i = 0; i < 20000; i++) deep = [deep];
    let deepTree;
    let deepRows;
    expect(() => {
      deepTree = buildJsonTree(deep);
      deepRows = flattenVisibleRows(deepTree, createExpansion('expanded'), null);
    }).not.toThrow();
    expect(deepTree.nodes).toHaveLength(20001);
    expect(deepTree.nodes[deepTree.nodes.length - 1].depth).toBe(20000);
    expect(deepTree.nodes[deepTree.nodes.length - 1].type).toBe('array');
    expect(deepTree.nodes[deepTree.nodes.length - 1].childCount).toBe(0);
    // 20000 open rows + 1 empty row + 20000 close rows.
    expect(deepRows).toHaveLength(40001);
    expect(deepRows[20000]).toMatchObject({ kind: 'empty', depth: 20000 });
    expect(() => flattenVisibleRows(deepTree, createExpansion('collapsed'), null)).not.toThrow();
  }, 60000);
});
