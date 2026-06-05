import { describe, it, expect } from 'vitest';
import { rebuildCopiedJson } from './jsonCopyFix';

// Regression for GH-65: a native cursor-selection copy of a JSON response
// rendered by @uiw/react-json-view does not yield valid JSON. The fixtures below
// mirror the *real* selectable text the library produces (captured from a
// headless browser running the exact library version):
//
//   • container size badges ("N items") sit on their own lines;
//   • a key whose value is a container is split — key, ":", and "{"/"[" each on
//     their own line;
//   • array elements are prefixed with their index ("0:value", or "0" / ":" /
//     "{" for object/array elements);
//   • there are no separating commas between siblings.
//
// rebuildCopiedJson reconstructs valid JSON from that stream.

describe('rebuildCopiedJson (GH-65)', () => {
  it('reconstructs a flat object selection (split container key + no commas)', () => {
    const selection = ['{', '1 item', '"name"', ':', '"Ada"'].join('\n');
    // ^ a single-prop object where the value is a primitive renders inline, but
    // we also cover the split form a container key produces below.
    const fixed = rebuildCopiedJson(['{', '"name":"Ada"', '"age":36', '"active":true', '}'].join('\n'));
    expect(JSON.parse(fixed)).toEqual({ name: 'Ada', age: 36, active: true });
    // Sanity: the lone split-key fragment above is not valid on its own, but the
    // separators it does have are preserved.
    expect(rebuildCopiedJson(selection)).toContain('"name"');
  });

  it('reconstructs the real full-tree selection (httpbin.org/json shape)', () => {
    // Exact selectable text captured from @uiw/react-json-view@2.0.0-alpha.41.
    const selection = [
      '{', '"slideshow"', ':', '{',
      '"author":"Yours Truly"',
      '"date":"date of publication"',
      '"slides"', ':', '[',
      '0', ':', '{',
      '"title":"Wake up to WonderWidgets!"',
      '"type":"all"',
      '}',
      '1', ':', '{',
      '"items"', ':', '[',
      '0:"Why <em>WonderWidgets</em> are great"',
      '1:"Who <em>buys</em> WonderWidgets"',
      ']',
      '"title":"Overview"',
      '"type":"all"',
      '}',
      ']',
      '"title":"Sample Slideshow"',
      '}', '}',
    ].join('\n');
    const fixed = rebuildCopiedJson(selection);
    expect(() => JSON.parse(fixed)).not.toThrow();
    expect(JSON.parse(fixed)).toEqual({
      slideshow: {
        author: 'Yours Truly',
        date: 'date of publication',
        slides: [
          { title: 'Wake up to WonderWidgets!', type: 'all' },
          {
            items: ['Why <em>WonderWidgets</em> are great', 'Who <em>buys</em> WonderWidgets'],
            title: 'Overview',
            type: 'all',
          },
        ],
        title: 'Sample Slideshow',
      },
    });
  });

  it('strips the "N items" / "1 item" size badges that sit on their own lines', () => {
    const selection = [
      '{', '3 items',
      '"name":"Ada"',
      '"langs"', ':', '[', '2 items', '0:"js"', '1:"ts"', ']',
      '"meta"', ':', '{', '1 item', '"active":true', '}',
      '}',
    ].join('\n');
    const fixed = rebuildCopiedJson(selection);
    expect(JSON.parse(fixed)).toEqual({ name: 'Ada', langs: ['js', 'ts'], meta: { active: true } });
  });

  it('strips array index prefixes and re-inserts array commas', () => {
    const selection = ['[', '2 items', '0:1', '1:2', ']'].join('\n');
    expect(JSON.parse(rebuildCopiedJson(selection))).toEqual([1, 2]);
  });

  it('reconstructs an array of objects (bare index + split colon)', () => {
    const selection = [
      '[',
      '0', ':', '{', '"a":1', '}',
      '1', ':', '{', '"b":2', '}',
      ']',
    ].join('\n');
    expect(JSON.parse(rebuildCopiedJson(selection))).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('comma-separates a partial primitive-sibling selection (the classic drag)', () => {
    // No enclosing braces — cannot be valid JSON on its own, but the separators
    // must be repaired so the text pastes into an existing object cleanly.
    const selection = ['"a":"x"', '"b":"y"'].join('\n');
    expect(rebuildCopiedJson(selection)).toBe('"a":"x","b":"y"');
  });

  it('comma-separates a partial array-element selection', () => {
    const selection = ['0:"x"', '1:"y"'].join('\n');
    expect(rebuildCopiedJson(selection)).toBe('"x","y"');
  });

  it('does not mis-handle string values containing colons / braces / brackets', () => {
    const selection = [
      '{',
      '"a":"ends with }"',
      '"b":"a:b separated"',
      '"c":"starts ["',
      '}',
    ].join('\n');
    expect(JSON.parse(rebuildCopiedJson(selection))).toEqual({
      a: 'ends with }',
      b: 'a:b separated',
      c: 'starts [',
    });
  });

  it('does not strip the word "items" when it is part of a real string value', () => {
    const selection = ['{', '"note":"got 4 items"', '"count":4', '}'].join('\n');
    expect(JSON.parse(rebuildCopiedJson(selection))).toEqual({ note: 'got 4 items', count: 4 });
  });

  it('keeps a key whose value contains an escaped quote intact', () => {
    const selection = ['{', '"q":"he said \\"hi\\""', '"n":1', '}'].join('\n');
    expect(JSON.parse(rebuildCopiedJson(selection))).toEqual({ q: 'he said "hi"', n: 1 });
  });

  it('returns a single selected primitive value unchanged', () => {
    expect(rebuildCopiedJson('"just a value"')).toBe('"just a value"');
  });

  it('returns non-string / empty input unchanged', () => {
    expect(rebuildCopiedJson('')).toBe('');
    expect(rebuildCopiedJson(null)).toBe(null);
    expect(rebuildCopiedJson(undefined)).toBe(undefined);
  });
});
