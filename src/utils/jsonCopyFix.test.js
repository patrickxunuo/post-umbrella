import { describe, it, expect } from 'vitest';
import { normalizeCopiedJson } from './jsonCopyFix';

// GH-70 (supersedes the GH-65 rebuildCopiedJson tests): the virtualized tree
// lays every row out as its own block with real, selectable commas, so a native
// cursor-selection copy already yields comma-separated text. normalizeCopiedJson
// only has to tidy that stream:
//   1. split on \n, trim, drop blank lines, drop badge-only lines (/^\d+\s+items?$/),
//      strip a trailing badge (/\s+\d+\s+items?$/), collapse the "{…}" / "[…]"
//      shapes of a collapsed container to "{}" / "[]" (a "…" inside a string stays);
//   2. join with \n; if JSON.parse succeeds return JSON.stringify(parsed, null, 2);
//   3. else if the text ends with "," drop it and retry step 2;
//   4. else return the cleaned text. Non-string / empty input is returned unchanged.

const pretty = (value) => JSON.stringify(value, null, 2);
const lines = (...parts) => parts.join('\n');

describe('normalizeCopiedJson (UT-010)', () => {
  it('UT-010 full-tree selection text with commas becomes pretty JSON', () => {
    const text = '{\n"a": 1,\n"b": {\n"c": true\n}\n}';
    const out = normalizeCopiedJson(text);
    expect(out).toBe(pretty({ a: 1, b: { c: true } }));
    expect(JSON.parse(out)).toEqual({ a: 1, b: { c: true } });
  });

  it('UT-010 full-tree selection of a mixed-type object round-trips exactly', () => {
    const fixture = {
      str: 'hello',
      int: 42,
      float: 3.14,
      neg: -7,
      yes: true,
      no: false,
      nothing: null,
      emptyObj: {},
      emptyArr: [],
      nested: { a: { b: { c: 'deep' } } },
      list: [1, 2, 3],
    };
    // One row per line, exactly as the tree's selectable text reads.
    const text = lines(
      '{',
      '"str": "hello",',
      '"int": 42,',
      '"float": 3.14,',
      '"neg": -7,',
      '"yes": true,',
      '"no": false,',
      '"nothing": null,',
      '"emptyObj": {},',
      '"emptyArr": [],',
      '"nested": {',
      '"a": {',
      '"b": {',
      '"c": "deep"',
      '}',
      '}',
      '},',
      '"list": [',
      '1,',
      '2,',
      '3',
      ']',
      '}',
    );
    const out = normalizeCopiedJson(text);
    expect(JSON.parse(out)).toEqual(fixture);
    expect(out).toBe(pretty(fixture));
  });

  it('UT-010 drops badge-only lines ("N items" / "1 item")', () => {
    const text = lines('{', '2 items', '"a": 1,', '"b": [', '1 item', '2', ']', '}');
    expect(normalizeCopiedJson(text)).toBe(pretty({ a: 1, b: [2] }));

    const padded = lines('{', '   12 items   ', '"a": 1', '}');
    expect(normalizeCopiedJson(padded)).toBe(pretty({ a: 1 }));
  });

  it('UT-010 strips a trailing badge from a line', () => {
    const text = lines('{', '"list": [ 3 items', '1,', '2,', '3', '],', '"nested": { 1 item', '"x": null', '}', '}');
    expect(normalizeCopiedJson(text)).toBe(pretty({ list: [1, 2, 3], nested: { x: null } }));
  });

  it('UT-010 collapses "{…}" / "[…]" of a collapsed-row selection to empty containers', () => {
    const text = lines('{', '"nested": {…},', '"list": […]', '}');
    expect(normalizeCopiedJson(text)).toBe(pretty({ nested: {}, list: [] }));

    const out = normalizeCopiedJson('[…]');
    expect(out).toBe('[]');
    expect(out).not.toContain('…');
  });

  it('UT-010 keeps a "…" that is part of a string value or key', () => {
    const text = lines('{', '"title": "Loading…",', '"a…b": ["x…"],', '"more": {…}', '}');
    expect(normalizeCopiedJson(text)).toBe(pretty({ title: 'Loading…', 'a…b': ['x…'], more: {} }));

    // Even the exact collapsed shape survives inside a string or key.
    const literal = lines('{', '"tpl": "{…}",', '"a{…}b": "[…]",', '"{…}": 1,', '"list": […]', '}');
    expect(normalizeCopiedJson(literal)).toBe(pretty({ tpl: '{…}', 'a{…}b': '[…]', '{…}': 1, list: [] }));
  });

  it('UT-010 partial selection ending with a trailing comma becomes valid pretty JSON', () => {
    const objectSelection = lines('{', '"c": true', '},');
    expect(normalizeCopiedJson(objectSelection)).toBe(pretty({ c: true }));

    const arraySelection = lines('[', '1,', '2', '],');
    expect(normalizeCopiedJson(arraySelection)).toBe(pretty([1, 2]));

    const primitiveSelection = '"only",';
    expect(normalizeCopiedJson(primitiveSelection)).toBe('"only"');
  });

  it('UT-010 unbalanced fragment is returned cleaned (trimmed, blank and badge lines dropped)', () => {
    const fragment = '  "a": 1,\n\n  2 items\n  "b": [ 2 items\n';
    expect(normalizeCopiedJson(fragment)).toBe('"a": 1,\n"b": [');

    const twoProps = '"a": 1,\n"b": 2';
    expect(normalizeCopiedJson(twoProps)).toBe('"a": 1,\n"b": 2');

    // A fragment that ends with "," and still fails to parse after dropping the
    // comma: the contract only says "return the cleaned text", so either the
    // comma-less or comma-bearing cleaned form is accepted here.
    const trailing = '"a": 1,\n"b": 2,';
    expect(['"a": 1,\n"b": 2', '"a": 1,\n"b": 2,']).toContain(normalizeCopiedJson(trailing));
  });

  it('UT-010 non-string / empty input is returned unchanged', () => {
    expect(normalizeCopiedJson('')).toBe('');
    expect(normalizeCopiedJson(null)).toBe(null);
    expect(normalizeCopiedJson(undefined)).toBe(undefined);
    expect(normalizeCopiedJson(42)).toBe(42);
    const obj = { a: 1 };
    expect(normalizeCopiedJson(obj)).toBe(obj);
  });

  it('UT-010 does not strip the word "items" when it is part of a real string value', () => {
    const text = lines('{', '"note": "got 4 items",', '"count": 4', '}');
    expect(normalizeCopiedJson(text)).toBe(pretty({ note: 'got 4 items', count: 4 }));
  });

  it('UT-010 tolerates CRLF line endings and surrounding whitespace', () => {
    expect(normalizeCopiedJson('{\r\n"a": 1\r\n}')).toBe(pretty({ a: 1 }));
    expect(normalizeCopiedJson('\n\n  {\n"a": 1\n}\n\n')).toBe(pretty({ a: 1 }));
  });

  it('UT-010 a single selected primitive value is returned as its JSON token', () => {
    expect(normalizeCopiedJson('"just a value"')).toBe('"just a value"');
    expect(normalizeCopiedJson('42')).toBe('42');
    expect(normalizeCopiedJson('null')).toBe('null');
  });
});
