# Acceptance Spec: PDF Response Preview

## Problem
Responses with `Content-Type: application/pdf` currently fall through to the raw `<pre>` branch in `ResponseViewer.jsx`, dumping a base64 string. Bytes are already delivered correctly (proxy + Tauri + browser-direct paths all base64-encode `application/pdf` since v0.1.12). Only the render branch is missing.

## Scope
Only `src/components/ResponseViewer.jsx` and `src/styles/response-viewer.css`. No data-layer or proxy changes.

Out of scope:
- A toggle (Preview / Raw / Hex) — that's F2 in the same issue.
- Editing PDF responses in the example editor.
- Custom JS-based PDF viewer (pdf.js, etc.). Use the browser's built-in renderer.

## Interface Contract

### MIME detection
```js
const isPdfResponse = (headers) => {
  if (!Array.isArray(headers)) return false;
  const ct = headers.find(h => h.key?.toLowerCase() === 'content-type')?.value;
  return !!ct && /^\s*application\/pdf/i.test(ct);
};
```

### Memo + flag (place near `imageMimeType`)
```js
const isPdfBody = useMemo(
  () => !isExample && isPdfResponse(displayResponse?.headers),
  [isExample, displayResponse?.headers]
);
```

### Data-URL builder
Mirror `buildImageSrc` — accept body that may already be a data URL, valid base64, or raw-binary string. Return `data:application/pdf;base64,...`. Refactor opportunity: rename `buildImageSrc` → `buildBinaryDataUrl(body, mimeType)` and reuse for both PDF and image. Pure refactor — same logic.

### Render branch
Insert between `isImageBody` and `isJsonBody` branches:
```jsx
) : isPdfBody ? (
  <div className="pdf-preview-container" data-testid="pdf-preview-container">
    <object
      className="pdf-preview-frame"
      data={buildBinaryDataUrl(displayResponse?.body, 'application/pdf')}
      type="application/pdf"
      data-testid="pdf-preview-frame"
    >
      <div className="pdf-preview-fallback" data-testid="pdf-preview-fallback">
        <p>Your browser cannot display this PDF inline.</p>
        <a
          href={buildBinaryDataUrl(displayResponse?.body, 'application/pdf')}
          download="response.pdf"
        >
          Download PDF
        </a>
      </div>
    </object>
  </div>
) : isJsonBody ? (
  ...existing
```

`<object>` chosen over `<iframe>` because it supports nested fallback content (the download link) that browsers without a PDF viewer will render automatically.

### CSS (append to `src/styles/response-viewer.css`)
```css
.pdf-preview-container {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 400px;
  background: var(--bg-secondary);
  overflow: hidden;
}
.pdf-preview-frame {
  flex: 1;
  width: 100%;
  height: 100%;
  border: none;
  background: var(--bg-tertiary);
}
.pdf-preview-fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-6);
  color: var(--text-secondary);
  text-align: center;
  width: 100%;
}
.pdf-preview-fallback a {
  color: var(--accent-primary);
  text-decoration: underline;
}
```

## Acceptance Criteria

### AC1 — `application/pdf` renders inline
Given a response with `Content-Type: application/pdf` and a base64 PDF body, the body tab MUST render `[data-testid="pdf-preview-container"]` containing an `<object data-testid="pdf-preview-frame">`. No raw `<pre>` of the base64 string.

### AC2 — Content-Type with parameters detected
`Content-Type: application/pdf; charset=binary` is detected as PDF.

### AC3 — Already-`data:` body passes through unchanged
If `body` already starts with `data:application/pdf`, the `<object data>` attribute uses it as-is (no double-wrapping).

### AC4 — Browsers without inline PDF support fall back
If the browser cannot render the PDF inline (e.g., macOS WKWebView in the Tauri desktop app), the nested fallback content (`[data-testid="pdf-preview-fallback"]`) becomes visible with a working download link. (Difficult to verify in E2E; covered by code review.)

### AC5 — Non-PDF responses unaffected
JSON, HTML, image, plain text, and example responses continue to render via their existing branches. No regression.

### AC6 — Refactored helper preserves image behavior
`buildImageSrc` rename to `buildBinaryDataUrl(body, mimeType)` — image preview uses the renamed function and still passes all `e2e/image-preview.spec.ts` cases.

## Test Plan

### E2E test — `e2e/pdf-preview.spec.ts` (new file)

1. **pdf-preview-renders** — Create a request to a stable PDF URL (e.g., `https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf` — a 13KB W3C-hosted dummy PDF; if unreliable, use `https://pdfobject.com/pdf/sample.pdf`). Send, assert `[data-testid="pdf-preview-container"]` visible, `<object data-testid="pdf-preview-frame">` has `data` attribute starting with `data:application/pdf;base64,`. Skip browser-PDF-renders assertion (object's internal rendering isn't introspectable in Playwright).
2. **pdf-preview-fallback-not-pdf** — Send a JSON request, assert `[data-testid="pdf-preview-container"]` is NOT visible.

### Regression
- `e2e/image-preview.spec.ts` — must still pass after the `buildImageSrc` → `buildBinaryDataUrl` rename.
- `e2e/html-preview.spec.ts` — unchanged path.
