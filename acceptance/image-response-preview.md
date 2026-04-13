# Acceptance Spec: Image Response Preview

## Problem
When an API returns an image (e.g., `Content-Type: image/png`), `ResponseViewer` falls through to the raw-text `<pre>` branch, which displays unreadable binary / base64 garbage. Users want to *see* the image inline (like Postman does).

## Scope
Change `src/components/ResponseViewer.jsx` and related CSS only. No change to the Edge Function proxy or the request execution pipeline — those already return the raw body string.

Out of scope:
- Saving/exporting the image (user can right-click the rendered `<img>` in the browser).
- Editing an example response to be an image (examples are user-authored JSON; keep as-is).
- Server-side content-type sniffing — trust the response `Content-Type` header.

## Interface Contract

### Content-type detection helper
Add alongside `isHtmlResponse`:
```js
// Matches image/png, image/jpeg, image/gif, image/webp, image/svg+xml, image/bmp, image/x-icon, image/avif, etc.
const getImageMimeType = (headers) => {
  if (!Array.isArray(headers)) return null;
  const ct = headers.find(h => h.key?.toLowerCase() === 'content-type')?.value;
  if (!ct) return null;
  const match = ct.match(/^\s*(image\/[^;\s]+)/i);
  return match ? match[1].toLowerCase() : null;
};
```

### Detection memo
```js
const imageMimeType = useMemo(() => {
  if (isExample) return null;
  return getImageMimeType(displayResponse?.headers);
}, [isExample, displayResponse?.headers]);
const isImageBody = !!imageMimeType;
```
Place detection ordering so image is checked **before** `isJsonBody` (a binary image should never be mistaken for JSON — but `JSON.parse` on a binary string will fail anyway, so correctness is preserved; ordering is just for render-branch priority).

### Render branch
Add a new branch in the body render block, placed between the `isHtmlBody` branch and the `isJsonBody` branch (or immediately after `isHtmlBody`):

```jsx
) : isImageBody ? (
  <div className="image-preview-container" data-testid="image-preview-container">
    <img
      className="image-preview"
      src={buildImageSrc(displayResponse?.body, imageMimeType)}
      alt="Response image"
      data-testid="image-preview"
      onError={(e) => { e.currentTarget.dataset.failed = 'true'; }}
    />
  </div>
) : isJsonBody ? (
  ...existing...
```

### Image src builder
```js
// body may be: a data URL already, a plain URL string, a base64 string, or a raw binary string.
// The proxy returns a string; treat it as:
//   - If it already starts with "data:image/" → use as-is
//   - Else treat as base64 (strip whitespace/newlines) and wrap in data URL
function buildImageSrc(body, mimeType) {
  if (typeof body !== 'string' || !mimeType) return '';
  if (body.startsWith('data:')) return body;
  const cleaned = body.replace(/\s+/g, '');
  return `data:${mimeType};base64,${cleaned}`;
}
```

(If the proxy currently returns raw binary strings that aren't base64, this will display a broken image — that's acceptable failure mode shown by the browser's broken-image icon. Document via the `onError` data attribute so tests can detect failure. We are NOT changing the proxy in this feature; if we discover it doesn't return base64 for binary, we file a follow-up.)

### CSS (append to `src/styles/response-viewer.css` if it exists; otherwise `src/App.css`)
```css
.image-preview-container {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  background: var(--bg-secondary);
  min-height: 200px;
  height: 100%;
  overflow: auto;
}
.image-preview {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  background: repeating-conic-gradient(var(--bg-tertiary) 0% 25%, transparent 0% 50%) 50% / 16px 16px;
  border-radius: var(--radius-sm);
}
```
The checkerboard background is standard for image viewers (shows transparency).

## Acceptance Criteria

### AC1 — PNG renders as image
Given a response with `Content-Type: image/png` and a base64-encoded PNG body, the body tab MUST render an `<img>` inside `[data-testid="image-preview-container"]` and MUST NOT render the raw `<pre>` body.

### AC2 — JPEG, GIF, WebP, SVG render
Same as AC1 for `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`.

### AC3 — Content-Type with charset/parameters still detected
`Content-Type: image/png; charset=binary` MUST be detected as image (regex tolerates trailing `;`).

### AC4 — data: URLs render as-is
If body is already `data:image/png;base64,iVBOR...`, it is rendered unchanged (no double-wrapping).

### AC5 — Non-image responses unaffected
JSON, HTML, and plain-text responses continue to render via their existing branches. No regression to `html-preview.spec.ts` or JSON rendering.

### AC6 — Headers tab still works
Clicking Headers tab shows the response headers unchanged.

### AC7 — Example tab unaffected
Examples (`isExample = true`) never route to the image branch (guarded in `imageMimeType` memo).

### AC8 — Image branch takes precedence over fallback `<pre>`
If `Content-Type` is `image/*` and body is unparseable as JSON, the image branch wins (not the raw `<pre>` fallback).

## Test Plan

### E2E test — `e2e/image-preview.spec.ts` (new file)
Scenarios:
1. **image-preview-png** — Create a request to a known public PNG endpoint (e.g., `https://httpbin.org/image/png` or a fixture data URL baked into a local mock collection if available), send, wait for response, assert `[data-testid="image-preview"]` is visible and `<img>` has a `src` starting with `data:image/png;base64,` (or the proxied equivalent).
2. **image-preview-jpeg** — Same for `/image/jpeg`.
3. **image-preview-fallback-not-image** — Send a plain JSON request; assert `[data-testid="image-preview"]` is NOT present and the existing JSON view is.

If `httpbin.org` is unreliable in CI, use any stable small image URL, or request an asset from the project's own website. Tests must run against the real backend per project convention.

### Regression
- `e2e/html-preview.spec.ts` — must still pass.
- `e2e/request-editor.spec.ts` — must still pass.
