import { linter } from '@codemirror/lint';
import jsonlint from 'jsonlint-mod';

export function createJsonLinter() {
  return linter((view) => {
    const doc = view.state.doc;
    const text = doc.toString();
    if (!text.trim()) return [];

    const envVarRegex = /"?\{\{([^}]+)\}\}"?/g;
    let safeText = text.replace(envVarRegex, (match) => {
      const len = match.length;
      if (len < 2) return match;
      return '"' + 'a'.repeat(len - 2) + '"';
    });

    // Strip comments (JSON5 supports them, but jsonlint doesn't)
    // Match strings first to skip them, then replace comments with spaces to preserve positions
    safeText = safeText.replace(/"(?:[^"\\]|\\.)*"|\/\/.*$|\/\*[\s\S]*?\*\//gm, (match) => {
      if (match.startsWith('"')) return match;
      return match.replace(/[^\n]/g, ' ');
    });

    try {
      jsonlint.parse(safeText);
      return [];
    } catch (e) {
      const errMsg = e.message || '';
      const lines = errMsg.split('\n');

      // Extract line number: "Parse error on line N:"
      const lineMatch = errMsg.match(/line (\d+)/);
      // Extract "Expecting ..., got ..." message
      const expectingLine = lines.find(l => /^Expecting\s/.test(l));
      // Extract column from caret pointer line
      const ptrLine = lines.find(l => l.includes('^'));
      const errorCol = ptrLine ? ptrLine.indexOf('^') : 0;

      let message = errMsg.split('\n')[0];
      if (expectingLine) {
        const gotMatch = expectingLine.match(/got\s+'([^']+)'/);
        const got = gotMatch ? gotMatch[1] : '';
        const tokenNames = { STRING: 'string', NUMBER: 'number', NULL: 'null', TRUE: 'true', FALSE: 'false', EOF: 'end of input', undefined: 'unexpected token' };
        const gotLabel = tokenNames[got] || `'${got}'`;
        const expected = [];
        const tokenRegex = /'([^']*)'/g;
        const expectPart = expectingLine.replace(/,\s*got\s+.*$/, '');
        let m;
        while ((m = tokenRegex.exec(expectPart)) !== null) {
          if (m[1] !== 'EOF') expected.push(m[1]);
        }
        const isValue = (t) => ['STRING', 'NUMBER', 'NULL', 'TRUE', 'FALSE', '{', '['].includes(t);
        const has = (t) => expected.includes(t);

        if (has(',') && has(':')) message = got === 'STRING' ? 'Expected comma' : "Expected ':' after property name";
        else if (has(',')) message = 'Expected comma';
        else if (has(':')) message = "Expected ':' after property name";
        else if (has('STRING') && has('}') && !has('NUMBER')) message = got === ',' ? 'Unexpected comma' : `Expected property name or '}'`;
        else if (expected.some(isValue) && (got === '}' || got === ']')) message = 'Trailing comma is not allowed';
        else if (expected.some(isValue)) message = `Expected a value, got ${gotLabel}`;
        else message = `Unexpected ${gotLabel}`;
      }

      if (!lineMatch) return [];
      const errorLine = parseInt(lineMatch[1], 10);

      if (errorLine < 1 || errorLine > doc.lines) {
        const lastLine = doc.line(doc.lines);
        const trimmed = lastLine.text.trimEnd();
        const from = lastLine.from + Math.max(0, trimmed.length - 1);
        const to = lastLine.from + Math.max(trimmed.length, 1);
        return [{ from, to: Math.min(to, doc.length), severity: 'error', message }];
      }

      const line = doc.line(errorLine);
      const from = line.from + Math.min(errorCol, line.length);

      let to = line.from + line.text.trimEnd().length;
      if (to <= from) to = Math.min(from + 1, line.to);
      to = Math.min(to, doc.length);

      return [{ from, to, severity: 'error', message }];
    }
  }, { delay: 300 });
}
