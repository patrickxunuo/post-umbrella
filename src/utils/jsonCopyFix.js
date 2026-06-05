// GH-65: a native cursor-drag selection of a JSON response rendered by
// @uiw/react-json-view does NOT yield valid JSON. The library lays the tree out
// as a stream of one-token-per-line DOM nodes, and several pieces that JSON needs
// are either dropped from, or reshaped in, the selectable text:
//
//   • the separating commas between siblings are not selectable at all;
//   • a key whose value is a container is split across lines — `"k"`, then `:`,
//     then the opening `{`/`[` each sit on their own line;
//   • every array element is prefixed with its index as if it were a key
//     (`0:"x"`, or `0` / `:` / `{` for object/array elements);
//   • each container opener carries a non-JSON "N items" / "1 item" size badge.
//
// A naive "add the missing commas" pass is not enough (it would, for instance,
// insert a comma straight after a split container key — `"k",` — which is the
// very corruption GH-65's CI caught). rebuildCopiedJson instead walks the token
// stream with a small state machine that tracks the container stack, drops the
// array-index prefixes and size badges, re-joins split `key : value` triples, and
// re-inserts the separators — reconstructing valid JSON.
//
// When the reconstruction parses cleanly it is returned pretty-printed; an
// unbalanced partial selection (which cannot be valid JSON on its own) still
// comes back with its separators repaired so the text is usable when pasted.

// "N items" / "1 item" container size badge on its own (trimmed) line. CSS marks
// it user-select:none, but strip it here too so a leaked badge never corrupts.
const SIZE_BADGE = /^\d+\s+items?$/;

// An array element line carrying an inline primitive value: `0:"x"`, `12:true`.
const ARRAY_INLINE = /^(\d+):([\s\S]+)$/;
// A bare array index whose value is a container (the `:` and opener follow).
const ARRAY_INDEX = /^\d+$/;

// Scan a line that starts with a JSON string key and return the index just past
// its closing quote, honouring backslash escapes. Returns -1 if unterminated.
function keyStringEnd(line) {
  for (let i = 1; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '"') return i;
  }
  return -1;
}

export function rebuildCopiedJson(text) {
  if (typeof text !== 'string' || text === '') return text;

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !SIZE_BADGE.test(l));

  if (lines.length === 0) return text;

  const stack = []; // 'obj' | 'arr'
  let out = '';
  let pendingComma = false; // a sibling value was just emitted; comma needed next
  let dropColon = false; // next standalone ':' belongs to a dropped array index

  const inArray = () => stack[stack.length - 1] === 'arr';
  const comma = () => {
    if (pendingComma) out += ',';
    pendingComma = false;
  };

  for (const line of lines) {
    if (line === '{' || line === '[') {
      comma();
      out += line;
      stack.push(line === '{' ? 'obj' : 'arr');
      pendingComma = false;
      dropColon = false;
    } else if (line === '}' || line === ']') {
      out += line;
      stack.pop();
      pendingComma = true; // the closed container is a completed sibling
      dropColon = false;
    } else if (line === ':') {
      // Standalone colon: keep it for object keys, drop it for array indices.
      if (dropColon) {
        dropColon = false;
      } else {
        out += ':';
        pendingComma = false;
      }
    } else if (line[0] === '"') {
      // Object entry: a quoted key, optionally followed by an inline `:value`.
      const end = keyStringEnd(line);
      const rest = end === -1 ? '' : line.slice(end + 1);
      comma();
      if (rest.startsWith(':') && rest.length > 1) {
        out += line; // inline `"key":value` — already a valid pair
        pendingComma = true;
      } else {
        out += line.slice(0, end === -1 ? line.length : end + 1); // bare key
        pendingComma = false; // colon + value follow on later lines
      }
      dropColon = false;
    } else {
      // Array entry: `index:value` (inline) or a bare `index` (container value).
      const inline = line.match(ARRAY_INLINE);
      if (inline) {
        comma();
        out += inline[2]; // strip the index prefix, keep the value
        pendingComma = true;
        dropColon = false;
      } else if (ARRAY_INDEX.test(line)) {
        dropColon = true; // skip the index; its `:` and container opener follow
      } else {
        // A bare primitive (e.g. a partial selection of one value): keep it.
        comma();
        out += line;
        pendingComma = true;
        dropColon = false;
      }
    }
  }

  // A complete, balanced selection reconstructs to valid JSON — return it
  // pretty-printed. An unbalanced partial selection won't parse; return the
  // separator-repaired stream so a paste is at least comma-correct.
  try {
    return JSON.stringify(JSON.parse(out), null, 2);
  } catch {
    return out;
  }
}
