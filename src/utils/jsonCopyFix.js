// A native cursor-drag selection of the JSON tree is one row per line. The
// decorative pieces (item-count badges, collapsed ellipsis) are user-select:none
// so they normally never reach the clipboard, but strip them here as well so a
// leaked badge can never corrupt the copied JSON. A badge only ever follows a
// bracket, and a lone badge line only appears in multi-row selections, so a
// partial selection inside a string value ("has 3 items") is left intact.

const BADGE_LINE = /^\d+\s+items?$/;
const TRAILING_BADGE = /([{}[\]])\s+\d+\s+items?(?=,?$)/;
// Only the collapsed-container shapes the tree renders, anchored to the row
// shape (line start or `: ` before, optional `,` then end after) so a "\u2026"
// inside a string value or key is never touched.
const COLLAPSED_OBJECT = /(^|: )\{\u2026\}(?=,?$)/;
const COLLAPSED_ARRAY = /(^|: )\[\u2026\](?=,?$)/;

function cleanCopiedText(text) {
  const out = [];
  const lines = text.split('\n');
  const multiLine = lines.length > 1;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || (multiLine && BADGE_LINE.test(line))) continue;
    const cleaned = line
      .replace(TRAILING_BADGE, '$1')
      .replace(COLLAPSED_OBJECT, '$1{}')
      .replace(COLLAPSED_ARRAY, '$1[]')
      .trim();
    if (cleaned !== '') out.push(cleaned);
  }
  return out.join('\n');
}

function tryPretty(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

export function normalizeCopiedJson(text) {
  if (typeof text !== 'string' || text === '') return text;
  const cleaned = cleanCopiedText(text);
  const pretty = tryPretty(cleaned);
  if (pretty !== null) return pretty;
  if (cleaned.endsWith(',')) {
    const retry = tryPretty(cleaned.slice(0, -1));
    if (retry !== null) return retry;
  }
  return cleaned;
}
