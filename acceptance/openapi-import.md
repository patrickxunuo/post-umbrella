# Acceptance Spec: OpenAPI / Swagger Import (PR #3 of 3 for #30)

## Problem
PR #2 shipped the multi-format Import Modal with an OpenAPI option declared but disabled. This PR adds the actual parser so users can import OpenAPI 3.x (JSON or YAML) and Swagger 2.x specs into a fully-populated collection: tag-derived folders, parameterized URLs, request bodies from examples, and security-scheme-aware auth. Closes #30.

## Scope

### In
- `src/utils/import/openapi.js` — new parser (async), outputs Postman v2.1 shape
- `src/utils/import/shapeCheck.js` — add the `'openapi-3'` case (detection already exists in `detectFormat`, just needs the explicit shape-check branch)
- `src/utils/import/schemaValidate.js` — route `'openapi-3'` to `SwaggerParser.validate`, map errors to our `{path, message}` shape
- `src/utils/import/index.js` — YAML parse branch, dynamic-import the OpenAPI parser to defer its bundle cost
- `src/components/ImportModal.jsx` — enable the OpenAPI row, widen the file input `accept` to include `.yaml` / `.yml` when OpenAPI is picked, update subtitle to describe what's supported
- `package.json` — add `@apidevtools/swagger-parser` and `yaml`
- `e2e/fixtures/imports/` — 4 new fixtures (petstore JSON + YAML, bearer auth, oauth2)
- `e2e/openapi-import.spec.ts` — 4 new scenarios
- `CHANGELOG.md` — new entry under Unreleased

### Out
- OAuth 2.0 / OpenID Connect flow automation — warn + skip
- `http: basic` auth import — we don't natively model basic auth; warn + skip
- `apiKey in: cookie` — warn + skip
- Callbacks, webhooks, links, test codegen
- Round-tripping OpenAPI (export back to OpenAPI) — import-only
- YAML-based Postman or Insomnia files — YAML is OpenAPI-only in this PR

## Interface Contract

### Dynamic-imported parser — `src/utils/import/openapi.js`

```js
// Async because swagger-parser dereferences $ref via (mocked) I/O.
// Returns the same shape as the synchronous parsers: { postmanJson, warnings, idMap? }.
export async function parse(parsed)
```

Uses `@apidevtools/swagger-parser`:
```js
import SwaggerParser from '@apidevtools/swagger-parser';
const deref = await SwaggerParser.dereference(structuredClone(parsed));
```

Walk `deref`:

1. **Root collection info**: `info.title` → name; `info.description` → (store as a comment in the root collection's pre_script as `// ${description}` for now; we have no collection-description field). `info.version` appended in parentheses to the name.

2. **Servers → variables**: Take `deref.servers || []`.
   - 0 servers: warn, no `baseUrl` variable seeded; request URLs keep their raw `path` without prefix.
   - 1+ servers: seed root collection's `variable[]` with `{ key: 'baseUrl', value: servers[0].url }`. For each additional server, seed `baseUrl_1`, `baseUrl_2`, etc. Emit a warning listing alternates when there are 2+.
   - Each request URL becomes `{{baseUrl}}${path}`.

3. **Paths → requests**: iterate `deref.paths`. For each path string, for each HTTP method key (`get/put/post/delete/options/head/patch/trace`):
   - **Name**: `operation.operationId` if present, else `${METHOD} ${path}`.
   - **URL**: `{{baseUrl}}${path}`. Path parameters `{name}` → `{{name}}` in Postman convention. Also seed `{name}` as a collection variable if not already set (with the parameter's `example` or `default` as the value; empty string otherwise).
   - **Query/header parameters**: walk `operation.parameters || []`. For `in: 'query'`: add to the request's `url.query`. For `in: 'header'`: add to `header[]`. Use parameter's `example`/`default` as the default value. `in: 'cookie'` → warning, skipped.
   - **Request body**: `operation.requestBody?.content`. Pick the first JSON-ish content type (`application/json`, `application/*+json`). Use `example` or `examples` if provided, else synthesize a stub from `schema` (simple object with empty strings for required fields — best-effort, not exhaustive). Set `body.mode: 'raw'`, `body.options.raw.language: 'json'`, `body.raw: JSON.stringify(example, null, 2)`.
   - **Security**: resolve `operation.security ?? deref.security ?? []`. Take the first alternative (warn if there are more). Resolve it against `deref.components.securitySchemes`:
     - `{ type: 'http', scheme: 'bearer' }` → `auth_type='bearer'`, `auth_token='{{bearerToken}}'`; seed `bearerToken` collection variable.
     - `{ type: 'apiKey', in: 'header', name: X }` → add header `{ key: X, value: '{{apiKey}}' }`; seed `apiKey` variable. `auth_type` stays `'none'` (no native apiKey auth in our model; matches PR #1's apikey-header behavior).
     - `{ type: 'apiKey', in: 'query', name: X }` → add query param `{ key: X, value: '{{apiKey}}' }`; seed variable.
     - `{ type: 'apiKey', in: 'cookie' }` → warning; auth stays `'none'`.
     - `{ type: 'http', scheme: 'basic' }` → warning; auth stays `'none'`.
     - `{ type: 'oauth2' }` / `{ type: 'openIdConnect' }` → warning with the scheme name and a note that manual setup is required; auth stays `'none'`.
   - **Tag → folder assignment**: the first tag in `operation.tags` decides the folder. Requests without tags go to the root.

4. **Tags → folders**: iterate `deref.tags || []` + any tags seen on operations. Create one folder per tag under the root. Tag `description` ignored (we don't have folder descriptions).

5. **Response examples → Postman `response[]`**: for each `responses[status].content.<type>.example`, emit a Postman example (same shape PR #1 emits: `name`, `originalRequest`, `status`, `code`, `body`).

6. **Swagger 2.0 handling**: swagger-parser normalizes 2.x specs to a 3.x-shaped object on `bundle()`. Use `SwaggerParser.bundle()` to coerce before dereferencing. Emit an informational warning `"Swagger 2.0 converted on-the-fly — verify fields where 2.x and 3.x diverge."`.

### Orchestrator changes — `src/utils/import/index.js`

```js
// Existing:
//   parsed = JSON.parse(rawText);
// New:
async function parseRaw(format, rawText) {
  if (format === 'openapi-3') {
    try { return { ok: true, parsed: JSON.parse(rawText) }; } catch {}
    try {
      const YAML = (await import('yaml')).default;
      return { ok: true, parsed: YAML.parse(rawText) };
    } catch (e) {
      return { ok: false, error: { kind: 'parse', message: `Not valid JSON or YAML: ${e.message}` } };
    }
  }
  try { return { ok: true, parsed: JSON.parse(rawText) }; }
  catch (e) { return { ok: false, error: { kind: 'parse', message: `Invalid JSON: ${e.message}` } }; }
}
```

Parsers registry: lazy-load the OpenAPI module.
```js
const parsers = {
  'postman-v2.1': () => Promise.resolve(postmanParser),
  'postman-v2.0': () => Promise.resolve(postmanParser),
  'insomnia-v4': () => Promise.resolve(insomniaParser),
  'post-umbrella': () => Promise.resolve(selfParser),
  'openapi-3': () => import('./openapi.js'),
};
```

### Shape-check case — `src/utils/import/shapeCheck.js`

```js
if (format === 'openapi-3') {
  if (typeof parsed.openapi === 'string' && /^3\./.test(parsed.openapi)) return { ok: true };
  if (typeof parsed.swagger === 'string' && /^2\./.test(parsed.swagger)) return { ok: true };
  return {
    ok: false,
    detected,
    reason: `Expected an OpenAPI 3.x (parsed.openapi) or Swagger 2.x (parsed.swagger) version string.`,
  };
}
```

### Schema validation — `src/utils/import/schemaValidate.js`

```js
if (format === 'openapi-3') {
  const SwaggerParser = (await import('@apidevtools/swagger-parser')).default;
  try {
    await SwaggerParser.validate(structuredClone(parsed));
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      errors: [{ path: err.details?.[0]?.path?.join('.') || '(root)', message: err.message }],
    };
  }
}
// existing ajv path for other formats
```

`validate()` becomes async. The orchestrator already awaits it (it's in an async function), but double-check.

### UI changes — `src/components/ImportModal.jsx`

```diff
- { value: 'openapi-3', title: 'OpenAPI / Swagger', subtitle: 'Coming in a future release', disabled: true },
+ { value: 'openapi-3', title: 'OpenAPI / Swagger', subtitle: 'OpenAPI 3.x or Swagger 2.x (.json, .yaml, .yml)' },
```

File input `accept`:
```diff
- accept=".json"
+ accept={format === 'openapi-3' ? '.json,.yaml,.yml' : '.json'}
```

The drop zone's drag-and-drop path accepts any file; the orchestrator parses. No change needed.

### Dependencies

```json
{
  "@apidevtools/swagger-parser": "^10.1.0",
  "yaml": "^2.4.0"
}
```

Both production dependencies. Run `npm install` to populate the lockfile.

## Acceptance Criteria

### AC1 — OpenAPI row is enabled in the picker
`[data-testid="import-format-openapi-3"]` is visible, clickable (not disabled), and subtitle mentions YAML/JSON extensions.

### AC2 — JSON OpenAPI happy path
Importing `openapi-3.0-petstore.json`:
- Preview shows `N folders` where N = unique tag count, and `M requests` where M = sum of operations.
- On commit, the root collection appears in the sidebar.
- `baseUrl` collection variable seeded from `servers[0].url`.
- A specific request (`GET /pet/{petId}`) has URL `{{baseUrl}}/pet/{{petId}}` and `petId` seeded as a collection variable.

### AC3 — YAML OpenAPI import works
`openapi-3.0-petstore.yaml` imports with the same resulting structure as the JSON equivalent. Widens the file input accept and flows through `yaml.parse`.

### AC4 — Swagger 2.0 import is accepted with a warning
`swagger-2.0-minimal.json` imports successfully. The Import Warnings modal lists a line like `"Swagger 2.0 converted on-the-fly — verify fields where 2.x and 3.x diverge."`.

### AC5 — Bearer auth scheme → bearer token variable
`openapi-3.0-with-bearer-auth.yaml` produces requests with `auth_type='bearer'` and `auth_token='{{bearerToken}}'`. A `bearerToken` collection variable is seeded.

### AC6 — API Key auth (header) → header injection
An OpenAPI spec with `type: apiKey, in: header, name: X-API-Key` produces requests with an `X-API-Key: {{apiKey}}` header row. `auth_type='none'`. An `apiKey` collection variable is seeded. Warning is emitted naming the mapping.

### AC7 — OAuth2 / OpenID Connect → warning only
An OpenAPI spec with `oauth2` security scheme yields requests with `auth_type='none'` and a warning like `"Operation 'createOrder': oauth2 auth is not automated — configure manually."`.

### AC8 — Wrong-format swap works for OpenAPI
Picking `openapi-3` and uploading a Postman file shows the error step with a `[data-testid="import-switch-format-postman-v2.1"]` swap button that works. Already covered by the existing shape-check flow; just needs the new case.

### AC9 — Invalid YAML surfaces a parse error
Uploading a `.yaml` file with broken syntax shows an error like `"Not valid JSON or YAML: ..."` in the error panel and never reaches validation or the DB.

### AC10 — `$ref` resolution works
An OpenAPI spec with a schema referenced via `$ref: '#/components/schemas/Pet'` in a request body produces a body example with the fields resolved from the referenced schema. No literal `$ref` strings in the output.

### AC11 — Multiple servers produce numbered variables + warning
Spec with 3 `servers` seeds `baseUrl`, `baseUrl_1`, `baseUrl_2`. Warning lists the alternates.

### AC12 — No AI attribution / debug artifacts
Standard project hygiene.

### AC13 — Dynamic import defers the OpenAPI bundle
The OpenAPI parser module is imported lazily. Verifying this is hard in E2E; verify via a build-time check (e.g., `npm run build` produces a separate chunk for `openapi.js` / swagger-parser). Acceptable to demonstrate via a manual `vite build --report` or by checking the Rollup output contains `openapi` as a named chunk.

### AC14 — Regression
All existing import-related tests pass: `e2e/import.spec.ts`, `e2e/import-roundtrip.spec.ts`, `e2e/multi-format-import.spec.ts` (10 scenarios), `e2e/collection-*.spec.ts`. No change needed to those suites.

### AC15 — CHANGELOG entry added
New bullet under Unreleased / New section mentions OpenAPI + Swagger + YAML.

## Test Plan

### E2E — `e2e/openapi-import.spec.ts`

1. **openapi-json-petstore** — upload `openapi-3.0-petstore.json`, expect preview with tag-count folders + operation-count requests. Open a request; assert URL includes `{{baseUrl}}` and a path parameter as `{{...}}`. Open root collection → Variables tab; assert `baseUrl` is set to the spec's server URL.
2. **openapi-yaml-petstore** — same as #1 but upload the YAML version. Assert parse succeeds and final state matches.
3. **openapi-bearer-auth** — upload `openapi-3.0-with-bearer-auth.yaml`. Open a request; assert Bearer Token auth with token `{{bearerToken}}`. Variables tab has `bearerToken`.
4. **openapi-oauth2-warning** — upload `openapi-3.0-with-oauth2.yaml`. Warnings modal mentions oauth2. Open a request; assert `No Auth` is selected (auth dropped).
5. **openapi-swagger-2-accepted** — upload `swagger-2.0-minimal.json`. Warnings list mentions the on-the-fly conversion. Collection still landed.
6. **openapi-yaml-malformed** — upload malformed YAML. Error panel shown with a clear parse failure message. No collection created.

### Fixtures (new)
- `openapi-3.0-petstore.json` (trimmed subset — 2 tags, ~5 paths, minimal schemas)
- `openapi-3.0-petstore.yaml` (equivalent to the JSON)
- `openapi-3.0-with-bearer-auth.yaml`
- `openapi-3.0-with-oauth2.yaml`
- `swagger-2.0-minimal.json`
- `openapi-yaml-malformed.yaml`

### Regression
Playwright run against: `e2e/multi-format-import.spec.ts`, `e2e/import.spec.ts`, `e2e/import-roundtrip.spec.ts`, `e2e/collection.spec.ts`, `e2e/collection-auth.spec.ts`, `e2e/collection-variables.spec.ts`. All must pass unchanged.

### Build
Run `npm run build` after implementation and confirm the Rollup bundle output has `openapi` and `swagger-parser` as a separate async chunk (dynamic import worked).
