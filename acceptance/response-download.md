# Acceptance Spec: Response Download Button

## Problem
Users who get a response (any type — image, PDF, zip, JSON, HTML, XML, plain text, etc.) have no first-class way to save it to disk. The only paths today are:
- PDF-specific `<a download>` link inside the `<object>` fallback at `ResponseViewer.jsx:414-418` (only visible when the inline viewer fails)
- Manual select-all + copy-paste out of the Raw view
- For binary content, copying the base64 string

Expose a single Download button in the response toolbar that works across all body types.

## Scope
- `src/components/ResponseViewer.jsx` — add toolbar button, wire click handler, remove the inline PDF fallback `<a download>` link (replaced by the toolbar button)
- `src/utils/downloadResponse.js` — new helper module (filename derivation, MIME→extension mapping, browser vs Tauri dispatch, binary vs text routing)
- `src/styles/response-viewer.css` — styles for the new toolbar button
- `src-tauri/src/lib.rs` — new `write_binary_file` Tauri command that accepts a base64 payload and writes raw bytes; registered in `invoke_handler`
- `e2e/response-download.spec.ts` — new E2E test covering JSON / image / text download + button-hidden states

Out of scope:
- `.har` export (request+response pair as a file).
- Example-editing mode download (the button is not rendered when `isExample` is true).
- Downloading headers separately.
- Custom filename input UI (browser `<a download>` is one-click, Tauri dialog allows rename).

## Interface Contract

### `src/utils/downloadResponse.js`

All functions are pure except `downloadResponse`, which has the I/O side-effect.

```js
/**
 * Map a MIME type to a file extension (without the dot).
 * Unknown text-like → 'txt'; unknown binary-like → 'bin'; unknown/missing → 'bin'.
 */
export function mimeToExtension(mime) { /* ... */ }

/**
 * True if the MIME indicates binary content (image/*, audio/*, video/*, application/pdf,
 * application/zip, application/octet-stream, application/x-*, application/vnd.*) — body
 * is expected to be a base64 string.
 */
export function isBinaryMime(mime) { /* ... */ }

/**
 * Extract the filename portion from a Content-Disposition header.
 * Supports `filename="..."` (quoted), `filename=...` (unquoted), and the RFC 5987
 * `filename*=UTF-8''percent-encoded` form. Returns null if none found.
 */
export function parseContentDispositionFilename(contentDisposition) { /* ... */ }

/**
 * Strip characters that are illegal on Windows / macOS / Linux from a filename.
 * Removes: / \ : * ? " < > | and control chars. Trims whitespace and dots at ends.
 * Returns 'response' if the sanitized result is empty.
 */
export function sanitizeFilename(name) { /* ... */ }

/**
 * Derive the final filename.
 * Priority:
 *   1. Content-Disposition filename (sanitized; extension preserved if present, else appended from mime)
 *   2. URL's last non-empty path segment, with extension appended from mime if missing
 *   3. `response.<ext>` fallback
 */
export function deriveFilename({ contentDisposition, url, mime }) { /* ... */ }

/**
 * Trigger the download. Detects Tauri via `__TAURI_INTERNALS__` and branches:
 *
 *   Browser:
 *     - Build a Blob (text content directly; base64 body → Uint8Array for binary)
 *     - URL.createObjectURL → <a download> click → revokeObjectURL
 *
 *   Tauri:
 *     - dialog.save({ defaultPath: filename, filters: [{ name, extensions }] })
 *     - If user cancels → return { ok: false, cancelled: true }
 *     - Text/JSON → invoke('write_text_file', { path, contents })
 *     - Binary   → invoke('write_binary_file', { path, contentsBase64 })
 *
 * @param {Object} arg
 * @param {string|object} arg.body — base64 string, raw text, or parsed JSON object
 * @param {Array<{key,value}>} arg.headers
 * @param {string} [arg.url] — original request URL (for filename fallback)
 * @returns {Promise<{ ok: boolean, filename?: string, cancelled?: boolean, error?: string }>}
 */
export async function downloadResponse({ body, headers, url }) { /* ... */ }
```

### MIME → extension table (minimum coverage)

Binary:
- `image/png` → `png`, `image/jpeg` → `jpg`, `image/gif` → `gif`, `image/webp` → `webp`, `image/svg+xml` → `svg`, `image/avif` → `avif`, `image/bmp` → `bmp`, `image/x-icon` → `ico`, `image/*` (unknown) → `bin`
- `application/pdf` → `pdf`
- `application/zip` → `zip`, `application/x-zip-compressed` → `zip`
- `application/gzip` → `gz`, `application/x-tar` → `tar`
- `application/octet-stream` → `bin`
- `audio/mpeg` → `mp3`, `audio/wav` → `wav`, `audio/ogg` → `ogg`, `audio/*` (unknown) → `bin`
- `video/mp4` → `mp4`, `video/webm` → `webm`, `video/*` (unknown) → `bin`

JSON:
- `application/json` → `json`, `application/ld+json` → `json`, anything matching `/\+json$/` → `json`

Text family:
- `text/html` → `html`, `text/css` → `css`, `text/javascript` → `js`, `text/plain` → `txt`, `text/xml` → `xml`, `text/csv` → `csv`, `text/markdown` → `md`, `text/*` (unknown) → `txt`
- `application/xml` → `xml`, `application/xhtml+xml` → `html`, `application/javascript` → `js`, `application/ecmascript` → `js`

Unknown/missing MIME → `bin`.

### Binary MIME predicate

Return `true` for:
- `image/*`, `audio/*`, `video/*`
- `application/pdf`, `application/zip`, `application/gzip`, `application/x-tar`, `application/octet-stream`
- `application/x-*` (except when the subtype matches a known text type like `x-www-form-urlencoded` — but that's a request body type, not a response MIME we'd see here, so the blanket prefix is safe for our uses)
- `application/vnd.*` (office documents, etc.)

Return `false` for `application/json`, `application/*+json`, `application/xml`, `application/xhtml+xml`, `application/javascript`, `application/ecmascript`, and everything `text/*`.

### `ResponseViewer.jsx` changes

1. **Import:**
   - `Download` icon is already imported from `lucide-react` on line 2 — reuse.
   - Add `import { downloadResponse } from '../utils/downloadResponse';`
   - Add `import { useToast } from './Toast';` if not already present (for error/success toasts).

2. **Toolbar button** — insert into `.response-toolbar` after `.response-meta`, only when `!isExample && displayResponse?.body`:

   ```jsx
   {!isExample && displayResponse?.body && (
     <button
       className="btn-icon response-download-btn"
       onClick={handleDownload}
       title="Download response"
       data-testid="response-download-btn"
     >
       <Download size={14} />
     </button>
   )}
   ```

3. **Handler** — `handleDownload` calls `downloadResponse({ body, headers, url: displayResponse.resolvedUrl || requestUrl })`. On failure (`!result.ok && !result.cancelled`) show a toast error; on success show a success toast with the filename. On cancel, do nothing.

4. **PDF fallback cleanup** — delete the `<a href={...} download="response.pdf">Download PDF</a>` link (and its wrapping `<div className="pdf-preview-fallback">` if it becomes empty) at `ResponseViewer.jsx:411-419`. Replace with a simple text fallback: `"Your browser cannot display this PDF inline. Use the Download button above to save it."`

### `src-tauri/src/lib.rs` changes

Add alongside `write_text_file`:

```rust
use base64::{engine::general_purpose::STANDARD, Engine as _};

#[tauri::command]
fn write_binary_file(path: String, contents_base64: String) -> Result<(), String> {
    let bytes = STANDARD.decode(contents_base64.trim()).map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}
```

Register it in `invoke_handler![..., write_binary_file]`.

### CSS (append to `src/styles/response-viewer.css`)

```css
.response-download-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  background: transparent;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
  margin-left: var(--space-2);
}

.response-download-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--border-secondary);
}

.response-download-btn:active {
  transform: scale(0.96);
}
```

## Acceptance Criteria

**AC1 — Button visibility**
- Button is rendered when `displayResponse?.body` is truthy and `isExample` is false.
- Button is NOT rendered when `loading === true`.
- Button is NOT rendered when there is no response (`!displayResponse`).
- Button is NOT rendered in example mode (`isExample === true`).

**AC2 — JSON download**
- Given a response with `Content-Type: application/json` and a parsed-object or JSON-string body, clicking the button downloads a file whose content is the body `JSON.stringify(..., null, 2)` and whose name ends in `.json`.

**AC3 — Binary (image) download**
- Given a response with `Content-Type: image/jpeg` and a base64 body, clicking the button downloads a file whose content is the decoded bytes and whose name ends in `.jpg`.

**AC4 — Text download**
- Given a response with `Content-Type: text/html`, clicking the button downloads an `.html` file with the raw source.
- Given `Content-Type: application/xml`, downloads `.xml`. Given `text/plain`, downloads `.txt`.

**AC5 — Filename from Content-Disposition**
- When the response headers include `Content-Disposition: attachment; filename="report.pdf"`, the downloaded filename is exactly `report.pdf` (sanitized).
- When the header has `filename=report.pdf` (unquoted), same result.
- Filename is preserved as-is even if the MIME extension table would have picked a different extension.

**AC6 — Filename from URL**
- When no `Content-Disposition` header is present and the URL is `https://picsum.photos/200/300`, the filename is `300.jpg` (last path segment `300` + extension derived from `image/jpeg`).
- When the URL's last segment already has an extension (e.g. `/data.json`), it is preserved.

**AC7 — Fallback filename**
- When no `Content-Disposition` and the URL has no usable last segment (e.g. `https://api.example.com/`), filename is `response.<ext>` where `<ext>` comes from the MIME (`response.json`, `response.pdf`, etc.).

**AC8 — Filename sanitization**
- Illegal characters (`/ \ : * ? " < > |` and control chars) are stripped.
- Trailing whitespace and dots are trimmed.
- A fully-stripped result yields `response.<ext>`.

**AC9 — Tauri Save As**
- In Tauri (detected via `__TAURI_INTERNALS__`), clicking invokes `dialog.save` with `defaultPath: filename` and matching `filters`. Confirming writes to the chosen path via `write_text_file` for text/JSON or `write_binary_file` for binary. Cancelling is a silent no-op.
- New Rust command `write_binary_file(path, contentsBase64)` decodes and writes bytes successfully.

**AC10 — PDF inline fallback replaced**
- The existing `<a download="response.pdf">Download PDF</a>` link inside the PDF `<object>` fallback is removed. A plain text hint "Use the Download button above to save it" replaces it. The toolbar button is visible whenever the PDF body is present, regardless of whether the inline `<object>` rendered.

**AC11 — Error handling**
- If decoding / writing fails, a toast error is shown; no file is produced. App does not crash.

**AC12 — Helper unit behavior (Agent A may verify directly)**
- `mimeToExtension('image/png')` → `'png'`
- `mimeToExtension('application/vnd.api+json')` → `'json'`
- `mimeToExtension('')` → `'bin'`
- `isBinaryMime('application/pdf')` → `true`
- `isBinaryMime('application/json')` → `false`
- `parseContentDispositionFilename('attachment; filename="a b.pdf"')` → `'a b.pdf'`
- `sanitizeFilename('a/b:c?.txt')` → `'abc.txt'`

## Test Plan

**E2E tests** (`e2e/response-download.spec.ts`):

1. **JSON download** — Send a request returning `application/json` (e.g., `https://httpbin.org/json` via proxy, OR a fixture collection with a saved example that returns JSON — prefer fixture for stability). Click Download. Assert that Playwright's `page.waitForEvent('download')` fires, the suggested filename ends in `.json`, and the saved content when read parses back to the expected object.

2. **Button hidden before response** — Open a request tab with no response yet. Assert `[data-testid="response-download-btn"]` has zero count.

3. **Button hidden in example mode** — Open a saved example. Assert `[data-testid="response-download-btn"]` has zero count.

4. **Text download** — Send a request returning `text/plain` (httpbin `/html` returns HTML but for stability use a fixture or the Supabase proxy with a mock). Click Download. Assert filename ends in `.html` (or `.txt` depending on fixture) and the downloaded body matches the raw text.

5. **Unit-like coverage via dev-only test harness** — Optional: since there's no Jest/Vitest setup, Agent A may include the helper unit-assertions as a small `*.test.js` file only if a test runner is configured. If not, these checks go inline in the E2E via `page.evaluate()` calling `window.__test_downloadResponse_helpers` (exposed dev-only). Prefer the E2E download events over reaching into module internals.

**Tauri-specific coverage** — out of automated scope. Manual smoke per the Completion checklist:
- Run `npm run tauri:dev`
- Send a request returning an image
- Click Download → native Save As dialog appears with `.jpg` default → save → verify the saved file opens

**Regression smoke:**
- PDF preview still renders (the `<object>` and container remain unchanged except the fallback link)
- Image preview toggle (Preview/Raw/Hex) still works
- HTML preview toggle still works
- Non-binary responses (JSON) still render in the JsonView tree

## Implementation Order

1. `src/utils/downloadResponse.js` (Agent B scaffolds helper + all pure functions)
2. `src-tauri/src/lib.rs` (`write_binary_file` + register)
3. `src/components/ResponseViewer.jsx` (button + handler + PDF-fallback cleanup)
4. `src/styles/response-viewer.css` (button styles)
5. `e2e/response-download.spec.ts` (Agent A)

## Risks & Notes
- **Windows path length** — Tauri's `save()` dialog handles full paths; no special handling needed for our sanitized filenames (which are just the basename).
- **Base64 in the Tauri bridge** — passing the full base64 string over IPC is fine for response bodies up to a few hundred MB. Larger payloads (multi-GB video) are an edge case not worth optimizing for in P2.
- **Content-Disposition `filename*`** — RFC 5987 percent-encoded form is supported by the parser. Rare but worth handling.
- **Blob memory** — always call `URL.revokeObjectURL` after click to free the blob.
