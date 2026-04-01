# HTML Response Auto-Preview - Acceptance Criteria

## Description (client-readable)
When a response has HTML content, the Response Viewer automatically shows a rendered preview using a sandboxed iframe. Users can toggle between Preview and Raw views. Existing JSON and text rendering is unaffected.

## Interface Contract
This is the shared agreement between the Test Writer and the Implementer.

### Detection Logic
- Check `displayResponse.headers` array for an entry where `key` (case-insensitive) equals `content-type` and `value` contains `text/html`
- Helper function: `isHtmlResponse(headers)` — returns boolean
- **Priority rule**: JSON detection (`isJsonBody`) takes precedence over HTML detection. If the body parses as valid JSON, render as JSON tree even if Content-Type says `text/html`.
- HTML detection only applies in non-example mode (when `isExample` is false)

### UI Components

#### Preview/Raw Toggle (within Body tab)
- Only visible when response is detected as HTML (and not example mode)
- Two buttons: "Preview" and "Raw"
- Default selection: "Preview"
- Location: inside the response-content area, above the body content
- `data-testid="html-view-toggle"` on the toggle container
- `data-testid="html-preview-btn"` on the Preview button
- `data-testid="html-raw-btn"` on the Raw button
- Active button gets class `active`

#### HTML Preview (iframe)
- Rendered via `<iframe>` with `srcDoc` attribute set to the response body string
- `sandbox=""` attribute (most restrictive — no scripts, no forms, no same-origin)
- `data-testid="html-preview-frame"` on the iframe
- Iframe fills the response content area (width: 100%, flex: 1)
- White background (regardless of app theme) for accurate HTML rendering
- No border on iframe

#### Raw View
- Same as current non-JSON rendering: `<pre className="response-body">`
- `data-testid="html-raw-body"` on the pre element
- Shows the raw HTML source string

### CSS Classes
- `.html-view-toggle` — container for Preview/Raw buttons
- `.html-view-toggle button` — individual toggle button
- `.html-view-toggle button.active` — active state
- `.html-preview-frame` — iframe styling
- Style toggle buttons to match existing `.response-tabs` button pattern

### Business Rules
1. HTML detection is based solely on Content-Type header containing `text/html`
2. JSON takes priority: if body parses as JSON, show JSON tree view regardless of Content-Type
3. Default to Preview mode when HTML is first detected
4. Toggle state resets when a new response is received (defaults back to Preview)
5. Example mode always uses JsonEditor — HTML preview never applies to examples
6. The iframe sandbox attribute must be the empty string `""` for maximum security
7. Non-HTML, non-JSON responses continue rendering as raw `<pre>` text

## Frontend Acceptance Tests
| ID | User Action | Expected Result |
|----|------------|----------------|
| FE-001 | Send request that returns Content-Type: text/html with HTML body | Response body area shows rendered HTML in an iframe; Preview button is active |
| FE-002 | Click "Raw" button on an HTML response | Iframe is hidden, raw HTML source shown in pre element |
| FE-003 | Click "Preview" button after switching to Raw | Iframe re-appears with rendered HTML, Raw view hidden |
| FE-004 | Send request that returns Content-Type: application/json | JSON tree view shown, no Preview/Raw toggle visible |
| FE-005 | Send request that returns Content-Type: text/html but body is valid JSON | JSON tree view shown (JSON priority), no Preview/Raw toggle |
| FE-006 | View an example with HTML body | JsonEditor shown (example mode), no iframe preview |

## Test Status
- [ ] FE-001: Pending
- [ ] FE-002: Pending
- [ ] FE-003: Pending
- [ ] FE-004: Pending
- [ ] FE-005: Pending
- [ ] FE-006: Pending
