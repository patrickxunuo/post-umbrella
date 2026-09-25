// A native cursor-drag selection of the JSON tree is one row per line. The
// decorative pieces (item-count badges, collapsed ellipsis) are user-select:none
// so they normally never reach the clipboard, but strip them here as well so a
// leaked badge can never corrupt the copied JSON.

const BADGE_LINE = /^\d+\s+items?$/;
const TRAILING_BADGE = /\s+\d+\s+items?(?=,?$)/;
// Only the collapsed-container shapes the tree renders, anchored to the row
// shape (line start or `: ` before, optional `,` then end after) so a "\u2026"
// inside a string value or key is never touched.
const COLLAPSED_OBJECT = /(^|: )\{\u2026\}(?=,?$)/;
const COLLAPSED_ARRAY = /(^|: )\[\u2026\](?=,?$)/;

function cleanCopiedText(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || BADGE_LINE.test(line)) continue;
    const cleaned = line
      .replace(TRAILING_BADGE, '')
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
