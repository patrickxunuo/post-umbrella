// Regression tests for Postman v2.1 export URL serialization (GH-64).
//
// Bug: collections exported from Post Umbrella import into real Postman with an
// EMPTY URL. Root cause: parseUrl() relied on `new URL()`, which throws on
// template-variable URLs like `{{base_url}}/api/v1/parcels` (the dominant
// pattern in real collections), so the exported `url` object carried only
// `{ raw }` with no `host`/`path`. Real Postman rebuilds the displayed URL from
// the structured `host`/`path` arrays, so a missing host/path renders blank.
//
// The team's canonical shape (see e2e/fixtures/imports/postman-v2.1-roundtrip.json)
// is `{ raw: '{{base_url}}/bearer', host: ['{{base_url}}'], path: ['bearer'] }`.
import { describe, it, expect } from 'vitest';
import { parseUrl, buildPostmanRequest } from './sync.js';

const baseReq = {
  method: 'GET',
  headers: [],
  body: null,
  body_type: 'none',
  auth_type: 'inherit',
  name: 'Req',
};

describe('parseUrl — templated URLs (GH-64)', () => {
  it('splits a {{var}} URL into host + path instead of bare raw', () => {
    const out = parseUrl('{{base_url}}/api/v1/parcels');
    expect(out.host).toEqual(['{{base_url}}']);
    expect(out.path).toEqual(['api', 'v1', 'parcels']);
  });

  it('keeps a leading {{var}} host segment intact (no dot-splitting of the var)', () => {
    const out = parseUrl('{{base_url}}/bearer');
    expect(out.host).toEqual(['{{base_url}}']);
    expect(out.path).toEqual(['bearer']);
  });

  it('parses protocol + query out of a templated URL', () => {
    const out = parseUrl('https://{{host}}/order/{{orderId}}?status=active&page=2');
    expect(out.host).toEqual(['{{host}}']);
    expect(out.path).toEqual(['order', '{{orderId}}']);
    expect(out.protocol).toBe('https');
    expect(out.query).toEqual([
      { key: 'status', value: 'active' },
      { key: 'page', value: '2' },
    ]);
  });

  it('handles a host-only templated URL with no path', () => {
    const out = parseUrl('{{full_url}}');
    expect(out.host).toEqual(['{{full_url}}']);
    expect(out.path).toEqual([]);
  });

  it('splits a scheme-less plain host into dotted host segments', () => {
    const out = parseUrl('api.example.com/v1/orders');
    expect(out.host).toEqual(['api', 'example', 'com']);
    expect(out.path).toEqual(['v1', 'orders']);
  });
});

describe('parseUrl — fully-qualified URLs stay unchanged', () => {
  it('parses a standard https URL into structured parts', () => {
    const out = parseUrl('https://api.uniuni.com/v1/parcels');
    expect(out.protocol).toBe('https');
    expect(out.host).toEqual(['api', 'uniuni', 'com']);
    expect(out.path).toEqual(['v1', 'parcels']);
    expect(out.query).toEqual([]);
  });

  it('retains port and query for a localhost URL', () => {
    const out = parseUrl('http://localhost:3001/api/orders?status=active');
    expect(out.host).toEqual(['localhost']);
    expect(out.port).toBe('3001');
    expect(out.path).toEqual(['api', 'orders']);
    expect(out.query).toEqual([{ key: 'status', value: 'active' }]);
  });
});

describe('buildPostmanRequest — exported url object (GH-64)', () => {
  it('emits raw + host + path for a templated request URL', () => {
    const item = buildPostmanRequest({ ...baseReq, url: '{{base_url}}/api/v1/parcels' }, [], null);
    expect(item.request.url.raw).toBe('{{base_url}}/api/v1/parcels');
    // The core of the bug: host/path must be present so Postman renders the URL.
    expect(item.request.url.host).toEqual(['{{base_url}}']);
    expect(item.request.url.path).toEqual(['api', 'v1', 'parcels']);
  });

  it('emits raw + host + path for a fully-qualified request URL', () => {
    const item = buildPostmanRequest({ ...baseReq, url: 'https://api.uniuni.com/v1/parcels' }, [], null);
    expect(item.request.url.raw).toBe('https://api.uniuni.com/v1/parcels');
    expect(item.request.url.host).toEqual(['api', 'uniuni', 'com']);
    expect(item.request.url.path).toEqual(['v1', 'parcels']);
  });

  it('emits a structured url for a saved example originalRequest (templated)', () => {
    const example = {
      name: 'Example',
      request_data: { method: 'GET', headers: [], url: '{{base_url}}/api/v1/parcels' },
      response_data: { status: 200, statusText: 'OK', headers: [], body: '{}' },
    };
    const item = buildPostmanRequest({ ...baseReq, url: '{{base_url}}/api/v1/parcels' }, [example], null);
    const exUrl = item.response[0].originalRequest.url;
    expect(exUrl.raw).toBe('{{base_url}}/api/v1/parcels');
    expect(exUrl.host).toEqual(['{{base_url}}']);
    expect(exUrl.path).toEqual(['api', 'v1', 'parcels']);
  });
});
