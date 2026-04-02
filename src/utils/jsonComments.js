export function extractComments(text) {
  const comments = [];
  const stripped = text.replace(/"(?:[^"\\]|\\.)*"|\/\/.*$|\/\*[\s\S]*?\*\//gm, (match, offset) => {
    if (match.startsWith('"')) return match;
    if (match.startsWith('//')) {
      const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
      const before = text.substring(lineStart, offset);
      // Find the JSON key this comment is associated with (nearest "key": on the same line)
      const keyMatch = before.match(/"([^"]+)"\s*:/);
      if (keyMatch) {
        comments.push({ key: keyMatch[1], text: match.trim() });
      } else if (/^\s*[\]}],?\s*$/.test(before)) {
        // Comment is on a closing bracket/brace line — find the key whose value just closed
        // Scan backward: first } or ] sets depth=1, find its matching { or [ at depth=0
        const textBefore = text.substring(0, offset);
        let depth = 0;
        let seenCloser = false;
        for (let i = textBefore.length - 1; i >= 0; i--) {
          const ch = textBefore[i];
          if (ch === '}' || ch === ']') { depth++; seenCloser = true; }
          else if (ch === '{' || ch === '[') depth--;
          if (seenCloser && depth === 0) {
            // Matched the opening bracket — look for the key before it
            const preceding = textBefore.substring(0, i);
            const ownerMatch = preceding.match(/"([^"]+)"\s*:\s*$/);
            if (ownerMatch) {
              comments.push({ key: ownerMatch[1], text: match.trim() });
            }
            break;
          }
        }
      }
      return ' '.repeat(match.length);
    }
    return ' '.repeat(match.length);
  });
  return { stripped, comments };
}

export function reinsertComments(formatted, comments) {
  if (comments.length === 0) return formatted;
  const lines = formatted.split('\n');
  for (const { key, text } of comments) {
    const keyPattern = `"${key}"`;
    const idx = lines.findIndex(l => l.includes(keyPattern));
    if (idx === -1) continue;
    // Check if value opens an array/object on this line
    const afterKey = lines[idx].substring(lines[idx].indexOf(keyPattern) + keyPattern.length);
    const opensBlock = /:\s*[\[{]\s*$/.test(afterKey);
    if (opensBlock) {
      // Find the matching closing bracket/brace
      const opener = afterKey.trim().slice(-1);
      const closer = opener === '[' ? ']' : '}';
      let depth = 1;
      for (let i = idx + 1; i < lines.length && depth > 0; i++) {
        for (const ch of lines[i]) {
          if (ch === opener) depth++;
          else if (ch === closer) depth--;
          if (depth === 0) { lines[i] = lines[i] + ' ' + text; break; }
        }
      }
    } else {
      lines[idx] = lines[idx] + ' ' + text;
    }
  }
  return lines.join('\n');
}
