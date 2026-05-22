# Acceptance Spec — GH-57 Cookie UI Polish

UI/layout polish for the Cookie Support epic. **No behavior changes** to cookie capture/send/storage/cURL. All existing `data-testid`s MUST be preserved.

## Interface Contract

### Files
- `src/components/ResponseViewer.jsx` — Cookies tab table (~line 1003)
- `src/styles/response-viewer.css` — `.response-cookies`
- `src/components/RequestEditor.jsx` — Auth-tab Cookies button (`.auth-cookie-entry`, line ~839)
- `src/components/CookieManagerModal.jsx` — tag/editor structure (lines ~276–345)
- `src/styles/cookie-manager.css` — dialog, tags, editor buttons

### Preserved test selectors (do NOT rename/remove)
`response-cookies`, `cookie-row`, `cookie-manager-modal`, `cookie-manager-body`, `cookie-tag`, `cookie-value-editor`, `cookie-value-save`, `cookie-value-cancel`, `open-cookie-manager`, `cookie-domain-item`, `cookie-add-domain`, `cookie-add-cookie`.

### New test selector
- `cookie-value-cell` — `data-testid` on the **Value** `<td>` in the response Cookies table.

## Acceptance Criteria

### 1. Response Cookies table — Value column cap
- The Value `<td>` carries `data-testid="cookie-value-cell"`.
- By default the Value cell renders on a **single line, truncated with `…`** and has a **max-width** (e.g. ~280px) so a long value does NOT widen the table or force horizontal scroll.
- On **hover OR click**, the full value is revealed by **wrapping onto multiple lines** (line breaks), NOT by widening the column. Clicking toggles a persistent expanded state; the cell still respects the max-width while wrapping.
- Other columns (Name/Domain/Path/etc.) are unchanged.

### 2. Request editor — smaller Cookies button
- The Auth-tab Cookies button (`data-testid="open-cookie-manager"`) is visibly **smaller/more compact** than a standard `btn-secondary compact` (reduced padding and font-size). Icon + "Cookies" label remain.

### 3. Cookie Manager dialog — fixed size
- `.cookie-manager-modal` has a **fixed width (wider, ~720px)** and **fixed height (~560px)**, both capped to the viewport (`max-width`/`max-height` so it never overflows small screens).
- Height is NOT determined by content: with 0 cookies and with many cookies the dialog frame is the same size.
- `.cookie-manager-body` **scrolls internally** (`overflow-y: auto`) when the domain/cookie list overflows.

### 4. Cookie Manager — tag/editor layout (structural)
- Within a domain item, all cookie key tags render first as a row/wrap in `.cookie-tag-list` (`data-testid="cookie-tag"` each).
- When a tag is selected, a **single editor block** (`.cookie-value-edit` containing `data-testid="cookie-value-editor"`) renders **below the tag list**, NOT inside any tag's wrapper.
- The editor `<textarea>` (`cookie-value-textarea`) is **full width** of its container.
- Opening/closing the editor does **NOT change the width or count** of the cookie key tags.
- Exactly **one** `cookie-value-editor` exists in the DOM at a time; it is never a descendant of `[data-testid="cookie-tag"]`.
- Editing a value and clicking Save still persists (existing behavior unchanged).

### 5. Cookie Manager — tag + button styling
- `.cookie-tag` border-radius is **reduced** (less rounded — not a pill `999px`; use a small radius token).
- `.cookie-value-actions` Cancel/Save buttons are **more compact** (smaller padding/font).

## Out of Scope
Cookie capture, send/inject, storage format, cURL import/export (tracked under #43).
