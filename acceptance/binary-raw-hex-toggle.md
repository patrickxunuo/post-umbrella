# Acceptance Spec: Preview / Raw / Hex Toggle for Image and PDF

## Problem
HTML responses have a Preview / Raw toggle. Image and PDF responses have only one view (rendered) — there's no way to inspect the bytes. Users debugging "why isn't this rendering?" or copying base64 fixtures into tests need a Raw and Hex view.

## Scope
- `src/components/ResponseViewer.jsx`
- `src/styles/response-viewer.css`
- New tiny component `src/components/BinaryViewToggle.jsx` (segmented [Preview | Raw | Hex] control)

Out of scope:
- Adding the toggle to HTML preview (HTML already has a Preview / Raw of its own; not changing it).
- Other binary types (audio, video) — separate follow-up.
- Editing the raw view (read-only).

## Interface Contract

### New component: `src/components/BinaryViewToggle.jsx`
```jsx
import { Eye, FileText, Hash } from 'lucide-react';

export function BinaryViewToggle({ value, onChange, testIdPrefix }) {
  return (
    <div className="option-selector binary-view-toggle" data-testid={`${testIdPrefix}-view-toggle`}>
      <button
        className={value === 'preview' ? 'active' : ''}
        onClick={() => onChange('preview')}
        data-testid={`${testIdPrefix}-preview-btn`}
      >
        <Eye size={12} /> Preview
      </button>
      <button
        className={value === 'raw' ? 'active' : ''}
        onClick={() => onChange('raw')}
        data-testid={`${testIdPrefix}-raw-btn`}
      >
        <FileText size={12} /> Raw
      </button>
      <button
        className={value === 'hex' ? 'active' : ''}
        onClick={() => onChange('hex')}
        data-testid={`${testIdPrefix}-hex-btn`}
      >
        <Hash size={12} /> Hex
      </button>
    </div>
  );
}
```

### Hex dump helper (place in `ResponseViewer.jsx` or a small util)
```js
const HEX_VIEW_BYTE_CAP = 1024 * 1024; // 1 MB

// Decode body (base64 string OR raw-binary string) → Uint8Array
function decodeToBytes(body) {
  if (typeof body !== 'string' || !body) return new Uint8Array();
  const cleaned = body.replace(/\s+/g, '');
  // base64?
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned) && cleaned.length % 4 === 0) {
    try {
      const bin = atob(cleaned);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch { /* fall through */ }
  }
  // Raw-binary string fallback (each char is a byte)
  const out = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i++) out[i] = body.charCodeAt(i) & 0xff;
  return out;
}

// Render up to `byteLimit` bytes as `addr | hex | ascii` rows.
// Returns { text, truncated, totalBytes }.
function buildHexDump(bytes, byteLimit = HEX_VIEW_BYTE_CAP) {
  const total = bytes.length;
  const cap = Math.min(total, byteLimit);
  const lines = [];
  for (let off = 0; off < cap; off += 16) {
    const slice = bytes.subarray(off, Math.min(off + 16, cap));
    const addr = off.toString(16).padStart(8, '0');
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ');
    const ascii = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    lines.push(`${addr}  ${hex}  ${ascii}`);
  }
  return { text: lines.join('\n'), truncated: total > cap, totalBytes: total };
}
```

### State (in `ResponseViewer`)
```js
const [imageViewMode, setImageViewMode] = useState('preview');
const [pdfViewMode, setPdfViewMode] = useState('preview');
const [hexShowAll, setHexShowAll] = useState(false);

// Reset on response change
useEffect(() => {
  setImageViewMode('preview');
  setPdfViewMode('preview');
  setHexShowAll(false);
}, [displayResponse]);
```

### Updated render branches

**Image branch:**
```jsx
) : isImageBody ? (
  <>
    <BinaryViewToggle value={imageViewMode} onChange={setImageViewMode} testIdPrefix="image" />
    {imageViewMode === 'preview' && (
      <div className="image-preview-container" data-testid="image-preview-container">
        <img className="image-preview" src={buildBinaryDataUrl(displayResponse?.body, imageMimeType)} alt="Response image" data-testid="image-preview" onError={(e) => { e.currentTarget.dataset.failed = 'true'; }} />
      </div>
    )}
    {imageViewMode === 'raw' && (
      <pre className="binary-raw-view" data-testid="image-raw-body">{displayResponse?.body}</pre>
    )}
    {imageViewMode === 'hex' && (
      <HexView body={displayResponse?.body} showAll={hexShowAll} onShowAll={() => setHexShowAll(true)} testId="image-hex-body" />
    )}
  </>
```

**PDF branch:** identical structure, swapping image with the `<object>` from F1 and using `pdfViewMode` / `testIdPrefix="pdf"`.

### `HexView` sub-component
```jsx
function HexView({ body, showAll, onShowAll, testId }) {
  const { text, truncated, totalBytes } = useMemo(() => {
    const bytes = decodeToBytes(body);
    return buildHexDump(bytes, showAll ? Infinity : HEX_VIEW_BYTE_CAP);
  }, [body, showAll]);
  return (
    <div className="binary-hex-view-wrapper">
      <pre className="binary-hex-view" data-testid={testId}>{text}</pre>
      {truncated && (
        <div className="binary-hex-truncated">
          Showing first {HEX_VIEW_BYTE_CAP.toLocaleString()} bytes of {totalBytes.toLocaleString()}.{' '}
          <button className="link-button" onClick={onShowAll} data-testid={`${testId}-show-all`}>Show all</button>
        </div>
      )}
    </div>
  );
}
```

### CSS additions
```css
.binary-view-toggle {
  margin-bottom: var(--space-2);
}
.binary-raw-view,
.binary-hex-view {
  font-family: var(--font-mono);
  font-size: 12px;
  white-space: pre;
  overflow: auto;
  padding: var(--space-3);
  background: var(--bg-secondary);
  color: var(--text-primary);
  margin: 0;
  height: 100%;
}
.binary-raw-view {
  white-space: pre-wrap;
  word-break: break-all;
}
.binary-hex-view-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.binary-hex-truncated {
  padding: var(--space-2) var(--space-3);
  color: var(--text-secondary);
  font-size: 12px;
  border-top: 1px solid var(--border-primary);
  background: var(--bg-tertiary);
}
.link-button {
  background: none;
  border: none;
  color: var(--accent-primary);
  cursor: pointer;
  padding: 0;
  font: inherit;
  text-decoration: underline;
}
```

## Acceptance Criteria

### AC1 — Image branch shows the toggle
For an image response, `[data-testid="image-view-toggle"]` is visible with three buttons (Preview / Raw / Hex). Default selection is Preview.

### AC2 — Image Raw view
Clicking `[data-testid="image-raw-btn"]` swaps the `<img>` for `[data-testid="image-raw-body"]` containing the base64 body string. The `<img>` is gone.

### AC3 — Image Hex view
Clicking `[data-testid="image-hex-btn"]` swaps to `[data-testid="image-hex-body"]` containing rows in `addr  hex  ascii` format. Each row begins with an 8-digit hex address.

### AC4 — PDF branch shows the toggle (depends on PDF F1)
For a PDF response, `[data-testid="pdf-view-toggle"]` is visible. Same Preview / Raw / Hex behavior.

### AC5 — Switching views does not re-fetch
Switching Preview ↔ Raw ↔ Hex updates the body content area without refetching the request (no network call).

### AC6 — Hex truncation at 1MB
For a body whose decoded size exceeds 1MB, Hex view shows the first 1MB and a `[data-testid="<prefix>-hex-body-show-all"]` button. Clicking it expands to the full dump.

### AC7 — View resets on new response
After sending a fresh request, the view toggle resets to `Preview` (so the user always lands on the visual view first).

### AC8 — Toggle visual matches existing `.option-selector`
Same pill-segmented style as `.html-view-toggle`. Reuses `.option-selector` base class.

### AC9 — Regressions
- HTML preview Preview / Raw toggle unchanged
- JSON, plain text, examples, and the desktop-agent banner branch unchanged
- `e2e/image-preview.spec.ts` and `e2e/html-preview.spec.ts` still pass (the image-preview test only asserts the `<img>` shows when in Preview mode — the default — so it continues to pass)

## Test Plan

### E2E — extend `e2e/image-preview.spec.ts` and `e2e/pdf-preview.spec.ts`

1. **image-view-toggle-raw** — Send image request; click Raw button; assert `[data-testid="image-raw-body"]` visible with non-empty text content; assert `[data-testid="image-preview"]` not visible.
2. **image-view-toggle-hex** — Click Hex; assert `[data-testid="image-hex-body"]` visible; assert text matches `/^[0-9a-f]{8}\s+[0-9a-f]{2}/i` for the first row.
3. **image-view-toggle-back-to-preview** — Click Hex then Preview; assert `[data-testid="image-preview"]` visible again with non-empty src.
4. **pdf-view-toggle-raw / hex** — same as 1 & 2 for PDF.

### Regression
- `e2e/image-preview.spec.ts` JPEG test still passes (Preview is default).
- `e2e/html-preview.spec.ts` unchanged.
