// GH-65: @uiw/react-json-view renders the separating commas between sibling
// properties / array elements as non-selectable (they are not part of the
// selectable DOM text). A native cursor-drag selection therefore copies every
// entry but none of the separators, yielding invalid JSON when pasted.
//
// reinsertJsonCommas repairs such comma-less selection text back into valid,
// comma-separated JSON. It works line-by-line, matching how the library lays
// out the tree: each property / element sits on its own line with brackets at
// line starts. A content line gains a trailing comma UNLESS it opens a
// container, already ends with a comma, or its next sibling line is a closing
// bracket (i.e. it is the last item in its container).

const isBlank = (line) => line.trim() === '';

// react-json-view appends a selectable "N items" / "1 item" size badge right
// after a container's opening bracket (displayObjectSize, default on). The CSS
// in response-viewer.css marks it user-select:none, but strip any that still
// leaks into the selection so the line reverts to a clean "…{" / "…[" opener.
const OBJECT_SIZE_BADGE = /([{[])\s*\d+\s+items?\s*$/;

const stripObjectSizeBadge = (line) => line.replace(OBJECT_SIZE_BADGE, '$1');

export function reinsertJsonCommas(text) {
  if (typeof text !== 'string' || text === '') return text;

  const lines = text.split('\n').map(stripObjectSizeBadge);
  const out = lines.slice();

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '') continue;

    // Lines that open a container or already end with a comma never get one.
    const last = trimmed[trimmed.length - 1];
    if (last === '{' || last === '[' || last === ',') continue;

    // Find the next non-blank line — the candidate sibling / closer.
    let j = i + 1;
    while (j < lines.length && isBlank(lines[j])) j++;
    if (j >= lines.length) continue; // last content line — no trailing comma

    // If the next non-blank line closes the current container, this line is the
    // last sibling and must not gain a comma.
    const nextFirst = lines[j].trim()[0];
    if (nextFirst === '}' || nextFirst === ']') continue;

    // Otherwise another sibling follows: insert the missing separator while
    // preserving any original leading indentation.
    out[i] = lines[i].replace(/\s*$/, '') + ',';
  }

  return out.join('\n');
}
