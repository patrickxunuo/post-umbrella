import { describe, it, expect } from 'vitest';
import { reinsertJsonCommas } from './jsonCopyFix';

// Regression for GH-65: a manual cursor-selection copy of a JSON response
// rendered by @uiw/react-json-view drops the separating commas (they are not
// part of the selectable DOM text), producing invalid JSON. reinsertJsonCommas
// repairs that comma-less text back into valid, comma-separated JSON.
//
// Each sample below mirrors the comma-less shape the library yields from a
// native selection: every entry on its own line, brackets at line starts, and
// NO separators between siblings.

describe('reinsertJsonCommas (GH-65)', () => {
  it('repairs a flat object selection into valid, comma-separated JSON', () => {
    const commaless = ['{', '"name": "Ada"', '"age": 36', '"active": true', '}'].join('\n');
    const fixed = reinsertJsonCommas(commaless);
    expect(() => JSON.parse(fixed)).not.toThrow();
    expect(JSON.parse(fixed)).toEqual({ name: 'Ada', age: 36, active: true });
  });

  it('repairs nested objects and arrays', () => {
    const commaless = [
      '{',
      '"name": "Ada"',
      '"langs": [',
      '"js"',
      '"ts"',
      ']',
      '"meta": {',
      '"active": true',
      '"score": 9.5',
      '}',
      '}',
    ].join('\n');
    const fixed = reinsertJsonCommas(commaless);
    expect(() => JSON.parse(fixed)).not.toThrow();
    expect(JSON.parse(fixed)).toEqual({
      name: 'Ada',
      langs: ['js', 'ts'],
      meta: { active: true, score: 9.5 },
    });
  });

  it('repairs a top-level array selection', () => {
    const commaless = ['[', '1', '2', '3', ']'].join('\n');
    const fixed = reinsertJsonCommas(commaless);
    expect(JSON.parse(fixed)).toEqual([1, 2, 3]);
  });

  it('separates a partial (multi-line) selection with commas', () => {
    // A user drags across two sibling properties only — no enclosing braces.
    const commaless = ['"a": "x"', '"b": "y"'].join('\n');
    const fixed = reinsertJsonCommas(commaless);
    expect(fixed).toBe(['"a": "x",', '"b": "y"'].join('\n'));
  });

  it('does not add a comma after a line that opens a container', () => {
    const commaless = ['{', '"a": 1', '}'].join('\n');
    const fixed = reinsertJsonCommas(commaless);
    // The opening "{" must not gain a comma.
    expect(fixed.split('\n')[0]).toBe('{');
    expect(JSON.parse(fixed)).toEqual({ a: 1 });
  });

  it('does not add a comma before a closing bracket (last sibling)', () => {
    const commaless = ['{', '"only": 1', '}'].join('\n');
    const fixed = reinsertJsonCommas(commaless);
    expect(fixed).not.toContain('1,');
    expect(JSON.parse(fixed)).toEqual({ only: 1 });
  });

  it('does not double up commas on already-valid text', () => {
    const valid = ['{', '"a": 1,', '"b": 2', '}'].join('\n');
    const fixed = reinsertJsonCommas(valid);
    expect(JSON.parse(fixed)).toEqual({ a: 1, b: 2 });
    expect(fixed).not.toContain('1,,');
  });

  it('does not mis-handle string values that contain brace/bracket characters', () => {
    const commaless = ['{', '"a": "ends with }"', '"b": "starts ["', '}'].join('\n');
    const fixed = reinsertJsonCommas(commaless);
    expect(JSON.parse(fixed)).toEqual({ a: 'ends with }', b: 'starts [' });
  });

  it('strips the react-json-view "N items" size badges from a real selection', () => {
    // What a native drag-select actually yields when displayObjectSize is on:
    // every container opener carries a "N items" / "1 item" badge after its bracket.
    const realSelection = [
      '{3 items',
      '"name": "Ada"',
      '"langs": [2 items',
      '"js"',
      '"ts"',
      ']',
      '"meta": {1 item',
      '"active": true',
      '}',
      '}',
    ].join('\n');
    const fixed = reinsertJsonCommas(realSelection);
    expect(() => JSON.parse(fixed)).not.toThrow();
    expect(JSON.parse(fixed)).toEqual({
      name: 'Ada',
      langs: ['js', 'ts'],
      meta: { active: true },
    });
  });

  it('does not strip the word "items" when it is part of a real string value', () => {
    const commaless = ['{', '"note": "got 4 items"', '"count": 4', '}'].join('\n');
    const fixed = reinsertJsonCommas(commaless);
    expect(JSON.parse(fixed)).toEqual({ note: 'got 4 items', count: 4 });
  });

  it('returns a single selected value unchanged (no spurious comma)', () => {
    expect(reinsertJsonCommas('"just a value"')).toBe('"just a value"');
  });

  it('returns non-string / empty input unchanged', () => {
    expect(reinsertJsonCommas('')).toBe('');
    expect(reinsertJsonCommas(null)).toBe(null);
    expect(reinsertJsonCommas(undefined)).toBe(undefined);
  });
});
