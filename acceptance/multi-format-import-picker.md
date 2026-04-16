# Acceptance Spec: Multi-Format Importer — Format Picker + Insomnia + Normalization + Validation (PR #2 of 3 for #30)

## Problem
Today the Import Collection flow accepts any `.json` file and sends it straight to the Postman-shaped Edge Function. Files from other tools (Insomnia v4) silently pass their own templating syntax through into auth tokens and URLs (`{% response ... %}` is the real-world bug that triggered this work), and malformed JSON / wrong-schema files corrupt the DB instead of erroring clearly. This PR replaces the "guess and submit" flow with an explicit format picker, per-format parsers that normalize to Postman v2.1 (the Edge Function's contract), a schema-validation gate that fails loudly on bad input, and a normalization layer that neutralizes foreign templating before it lands in the database.

## Scope

### In
- New UI: **Import modal** with format picker + file picker + preview pane (replaces the current single-click "Collection File" flow).
- `src/utils/import/` (new):
  - `index.js` — orchestrator: `runImport(format, rawText) → { normalized, warnings }`
  - `shapeCheck.js` — per-format shape sniffer (fast, syntactic)
  - `schemaValidate.js` — `ajv`-backed validator using bundled schemas
  - `schemas/` — bundled JSON schemas (Postman v2.1, Postman v2.0, Insomnia v4, Post Umbrella v1)
  - `postman.js` — passthrough parser (v2.0 → v2.1 migration if needed)
  - `insomnia.js` — Insomnia v4 → Postman v2.1 normalizer
  - `selfFormat.js` — Post Umbrella own export passthrough
  - `normalize.js` — foreign templating detection + rewrites (runs on every parser's output)
- `src/components/ImportModal.jsx` (new, replaces the current implicit flow)
- `src/components/ImportDropdown.jsx` — rework: "Import" button opens the new modal; "From cURL" stays as a separate item
- `src/hooks/useRequestActions.js handleImport` — rewritten to consume `runImport`'s result before calling `data.importCollection`
- `package.json` — add `ajv@8`, `ajv-formats@3`
- `e2e/fixtures/imports/` — expanded with Insomnia + malformed + wrong-format fixtures
- `e2e/multi-format-import.spec.ts` (new)

### Out
- OpenAPI / Swagger (PR #3)
- Workflow export/import (no target format has an equivalent yet)
- Full Insomnia environment import (see decision 2 below — base env vars only, sub-envs warned)
- `{% prompt %}`, `{% base64 %}`, `{% uuid %}`, `{% timestamp %}` tags — these get `{{TODO_FIX_...}}` placeholders + warnings. Full implementation deferred.
- Postman dynamic vars beyond the top 5 (`$guid`, `$timestamp`, `$randomInt`, `$randomUUID`, `$isoTimestamp`) — unmapped ones become warnings.

## Architecture

```
User → ImportModal (FormatPicker → FilePicker → Preview → Commit)
         │
         ├── onCommit → runImport(format, rawText)
         │     │
         │     ├── shapeCheck(format, parsed)         → error OR pass
         │     ├── schemaValidate(format, parsed)     → error OR pass
         │     ├── parser[format](parsed)             → { postmanJson, warnings }
         │     └── normalize(postmanJson)             → { postmanJson', warnings' }
         │
         └── returns { normalized: postmanJson', warnings: [...all] }
                │
                └── handleImport → data.importCollection(normalized, workspaceId)
                       │
                       └── Edge Function (unchanged) → DB
```

Every parser outputs **Postman v2.1 JSON**. The Edge Function does not learn new formats.

## Interface Contract

### Parser signature
```js
// src/utils/import/postman.js, insomnia.js, selfFormat.js
// parsed: the JSON.parse-d raw text
// Returns a Postman v2.1 collection object + initial warnings (before normalize()).
export function parse(parsed): { postmanJson, warnings }
```

For Postman, `parse` is near-identity (v2.0 → v2.1 coercion if needed). For Insomnia, it walks `resources[]` and builds a Postman tree. For self-format, identity.

### Shape check
```js
// src/utils/import/shapeCheck.js
// Returns { ok: true } OR { ok: false, detected: 'postman-v2.1' | 'insomnia-v4' | 'openapi-3' | 'unknown', reason: '...' }
export function shapeCheck(format, parsed)
```

Rules:
- **Postman v2.1**: `parsed.info?.schema` matches the v2.1 URL
- **Postman v2.0**: `parsed.info?.schema` matches the v2.0 URL (acceptable — parser upgrades internally)
- **Insomnia v4**: `parsed._type === 'export'` AND `parsed.__export_format === 4`
- **Post Umbrella**: `parsed.info?._post_umbrella_version` is set
- Detected-format string returned on failure so the error toast can offer "Switch to Insomnia?" buttons.

### Schema validation
```js
// src/utils/import/schemaValidate.js
// Returns { ok: true } OR { ok: false, errors: [{ path, message, expected, actual }] }
export function validate(format, parsed)
```

Uses `ajv` with `allErrors: true` so users see every problem, not just the first. For Insomnia (no official schema), we author one and version it alongside our code.

### Normalization layer
```js
// src/utils/import/normalize.js
// Returns a NEW Postman JSON with foreign templating scrubbed + warnings appended.
export function normalize(postmanJson): { postmanJson, warnings }
```

Mutations performed (in order):
1. **Scan every string field** (request URL, header key/value, auth.bearer token, body.raw, variable values, script exec lines) for foreign templating.
2. **Insomnia `{% response 'body', 'req_<id>', 'b64::<jsonpath>::<hash>', ... %}`**:
   - Decode the middle segment (`<jsonpath>`) from base64.
   - Find the referenced producing request in the same bundle by its Insomnia `req_<id>` (embedded in `_postman_id` during the Insomnia parser step).
   - If found: **generate a post-response script** on the producing request that extracts the path with `pm.response.json()` and writes it to a collection variable named `<slug>_token` (slug = sanitized from the producing request name). Replace the tag with `{{<slug>_token}}`.
   - If not found: replace with `{{TODO_FIX_insomnia_response}}` + warning.
3. **Insomnia `{% uuid %}` / `{% timestamp %}`**: replace with `{{$guid}}` / `{{$timestamp}}` (Postman dynamic var equivalents) + informational note.
4. **Insomnia `{% prompt %}` / `{% base64 %}` / other `{% ... %}`**: replace with `{{TODO_FIX_<kind>}}` + warning listing the original tag.
5. **Postman dynamics** — for each known top-5 (`$guid`, `$timestamp`, `$randomInt`, `$randomUUID`, `$isoTimestamp`): seed a matching collection variable with a note in its value like `"(auto-generated each request)"`. Leave the `{{$X}}` tokens in place — we don't execute them today, but the seeded variable lets users see them. Warn per unique key.
6. **Unrecognized `{{$...}}` or `{% ... %}`**: warning listing the literal, no rewrite.

Warning strings follow `"<request name>: <what happened>"` so the warnings modal (already shipped) is actionable.

### Orchestrator
```js
// src/utils/import/index.js
// format: 'postman-v2.1' | 'insomnia-v4' | 'post-umbrella'
// rawText: the file contents as a string
// Returns { ok, normalized?, warnings?, error? }
export async function runImport(format, rawText)
```

Flow:
1. `JSON.parse(rawText)` — catch and return friendly error on syntax failures.
2. `shapeCheck(format, parsed)` — if `!ok`, return error with `detected` for the UI's one-click swap.
3. `validate(format, parsed)` — if `!ok`, return error with the Ajv list.
4. `parser[format].parse(parsed)` — returns `{ postmanJson, warnings: [...parseWarnings] }`.
5. `normalize(postmanJson)` — returns `{ postmanJson: normalizedJson, warnings: [...normWarnings] }`.
6. Combine all warnings; return `{ ok: true, normalized: normalizedJson, warnings: [...] }`.

### UI: `ImportModal.jsx`

Props: `{ open, onClose, onCommit(normalizedJson) }`.

States:
- `step: 'format' | 'file' | 'preview' | 'error'`
- `format: 'postman-v2.1' | 'insomnia-v4' | 'post-umbrella' | 'openapi-3'` (openapi is a reserved/disabled option showing "Coming soon")
- `rawText`, `result` (from `runImport`), `error` (the friendly error object)

Layout:
- **Format step**: radio group with 4 options + descriptive subtitle per option. Last-used format from `userConfig.lastImportFormat` is preselected. Disabled OpenAPI row says "Coming soon".
- **File step**: drag-and-drop zone + file picker button. Accepts `.json` for all formats (YAML reserved for OpenAPI). Shows file name + size once picked.
- **Preview step**: runs `runImport`, shows summary like `"Will create collection 'X' with 3 folders, 12 requests, 5 variables. 2 warnings."` + a collapsible warnings list. Two buttons: **Cancel**, **Import**.
- **Error step**: shows the friendly error (malformed JSON, schema violations, wrong-format detection). If `detected` is set, render a **"Switch to {detected}"** button that resets to the file step with the new format.

Test IDs: `data-testid="import-modal"`, `"import-format-{format}"`, `"import-file-input"`, `"import-preview-summary"`, `"import-preview-warnings"`, `"import-commit"`, `"import-error"`, `"import-switch-format-{format}"`.

### Rewired `handleImport`

```js
// src/hooks/useRequestActions.js
async function handleImport(/* called via onCommit from ImportModal */) {
  // normalized is already-valid Postman v2.1 JSON by contract
  const result = await data.importCollection(normalized, activeWorkspace?.id);
  // ...existing server-warnings modal flow from PR #1 still fires...
  // Client-side warnings (from runImport) are merged into the same modal: PR #2 passes them
  // as an additional `clientWarnings` option that handleImport concatenates with result.warnings
  // before opening the ConfirmModal.
}
```

Client-side and server-side warnings merge into one modal. Deduplication on exact-string match.

### package.json

Add to `dependencies`:
```
"ajv": "^8.12.0",
"ajv-formats": "^3.0.1"
```

No YAML or swagger deps in this PR.

## Acceptance Criteria

### AC1 — Format picker replaces implicit detection
Clicking Import opens `[data-testid="import-modal"]` with 4 format options. The old "any .json → auto-detect" path no longer exists.

### AC2 — Last-used format persisted
Completing an import saves `userConfig.lastImportFormat`. Reopening the modal preselects that format.

### AC3 — Shape-check catches wrong format with swap suggestion
Picking "Insomnia" and uploading a Postman-shaped file shows `[data-testid="import-error"]` with the message mentioning both the chosen and detected formats, and a `[data-testid="import-switch-format-postman-v2.1"]` button. Clicking it re-runs validation as Postman and succeeds.

### AC4 — Schema validation fails loudly on malformed Postman
Uploading a Postman JSON with `info.name` missing produces an error modal listing the Ajv errors with a JSON pointer for each problem. No database write.

### AC5 — Insomnia basic import works
Uploading a clean Insomnia v4 export creates a collection with folders (from `request_group`), requests, auth, and collection variables (from the base environment). Sub-environments emit a warning.

### AC6 — Insomnia `{% response ... %}` is rewritten, not passed through
Importing an Insomnia file where request B's Bearer token references request A's response via `{% response 'body', 'req_A', 'b64::JC5pZF90b2tlbg==::46b' %}`:
- Request A gains a post-response script that extracts `$.id_token` and writes it to a collection variable `a_token` (or similar slug).
- Request B's `auth_token` becomes `{{a_token}}`.
- A warning is emitted: `"Request B: replaced {% response %} tag with {{a_token}}; post-response script added to Request A."`

### AC7 — Unresolvable Insomnia `{% response ... %}` yields a TODO placeholder
If the referenced `req_<id>` doesn't exist in the bundle, the token becomes `{{TODO_FIX_insomnia_response}}` and a warning names the original tag so the user can find and fix it.

### AC8 — Foreign auth fields are never written verbatim
No request's `auth_token`, URL, or body emitted by any parser may contain `{% ... %}` or unresolved Postman dynamic var patterns after normalization. (The warnings surface any residue.)

### AC9 — Postman dynamic var warnings
An imported Postman file containing `{{$guid}}` creates a collection variable `guid` with value `"(auto-generated each request)"` and emits an informational warning. Unrecognized `{{$other}}` emits a warning listing the literal.

### AC10 — Post Umbrella round-trip
Exporting from Post Umbrella → re-importing via the "Post Umbrella" format gives a byte-identical persisted state for auth/scripts/variables/hierarchy (same as AC9 in PR #1 but now through the format picker).

### AC11 — Preview pane shows the summary
Before commit, the preview shows collection name + folder/request/variable counts + warning count. Cancel dismisses the modal without importing. Commit triggers `data.importCollection` and closes the modal on success.

### AC12 — Warnings modal merges client + server warnings
If `runImport` emits warnings AND the Edge Function emits warnings, the post-import ConfirmModal shows a deduplicated union (same string = one entry).

### AC13 — No regression to cURL import
The "From cURL" flow is unchanged — still opens `ImportCurlModal`, still uses the existing cURL parser.

### AC14 — No regression to the Postman import path
The existing `e2e/import.spec.ts` Postman test continues to pass after being updated to go through the new format picker.

### AC15 — Dependencies land cleanly
`ajv` and `ajv-formats` are the only new deps. Bundle size delta under 50 KB gzipped (rough bound).

## Test Plan

### New E2E — `e2e/multi-format-import.spec.ts`
Scenarios mirror the ACs:
1. **format-picker-opens** — AC1.
2. **wrong-format-swap** — AC3: upload Postman under Insomnia → assert error + switch button → click → import succeeds.
3. **schema-validation-fails-loudly** — AC4: upload a malformed Postman fixture → assert error modal lists the path of the missing field.
4. **insomnia-basic-import** — AC5: `insomnia-v4-basic.json` (new fixture) imports cleanly with folders, requests, variables.
5. **insomnia-response-tag-rewrite** — AC6: `insomnia-v4-with-response-tag.json` (new fixture) — after import, assert producing request has a post-response script and consuming request's auth token is `{{<slug>_token}}`.
6. **insomnia-response-tag-unresolvable** — AC7: same as above but with the producing `req_<id>` missing → assert `{{TODO_FIX_insomnia_response}}` placeholder + warning.
7. **postman-dynamics-warning** — AC9: `postman-with-dynamics.json` (new fixture) — assert collection variable `guid` created + warning surfaces.
8. **self-format-roundtrip** — AC10: export a collection, re-import via Post Umbrella format → compare persisted state.
9. **preview-cancel** — AC11: reach preview step, click Cancel → no import happens.
10. **warnings-merge** — AC12: import something that yields both client + server warnings → assert one modal with deduplicated list.

### Updated — `e2e/import.spec.ts`
Rewire the existing Postman import test to go through the new format picker (picking "Postman v2.1"). Must still pass. No assertion changes beyond the setup path.

### Unit-ish (Ajv smoke tests, optional)
A small `schemaValidate` test that runs each bundled schema against its known-good fixture + a known-bad one. Optional because the E2E already exercises the validator.

### Regression
- `e2e/import-roundtrip.spec.ts` (PR #1) — Postman round-trip still passes after going through the new flow.
- `e2e/collection-auth.spec.ts`, `e2e/collection-variables.spec.ts` — still pass (no runtime-feature changes).
- Bundle-size check via `npm run build` — flag if total bundle grows by more than 100 KB gzipped (ajv is our only new runtime dep; this is a sanity check).

## Fixture inventory (new)

Under `e2e/fixtures/imports/`:
- `insomnia-v4-basic.json` — workspace + 1 folder + 3 requests + base env with 2 vars
- `insomnia-v4-with-response-tag.json` — 2 requests where B references A via `{% response ... %}`
- `insomnia-v4-unresolvable-response-tag.json` — same shape but the referenced req_<id> doesn't exist
- `postman-v2.1-malformed.json` — missing required `info.name` for schema-validation test
- `postman-v2.1-with-dynamics.json` — contains `{{$guid}}` and one unrecognized `{{$nope}}`
- `wrong-format-postman-under-insomnia.json` — actually Postman v2.1, used to test the swap suggestion
