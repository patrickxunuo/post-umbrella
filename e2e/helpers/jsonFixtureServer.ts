/**
 * Local JSON fixture server for the virtualized-tree E2E suite (GH-70).
 *
 * Bound to 127.0.0.1 on a free port. The app's transport treats 127.0.0.1 as a
 * local address and fetches it straight from the browser (no Supabase proxy),
 * so the server only has to answer CORS.
 *
 * Routes:
 *   GET /large.json  deterministic body, serialized size >= 10 MiB
 *   GET /types.json  TYPES_FIXTURE
 *   GET /deep.json   DEEP_FIXTURE (httpbin.org/json shape)
 *   GET /plain.txt   text/plain 'hello plain text'
 *   OPTIONS *        204
 *   anything else    404
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export const MIN_LARGE_BYTES = 10 * 1024 * 1024;

export const TYPES_FIXTURE = {
  str: 'hello',
  int: 42,
  float: 3.14,
  neg: -7,
  yes: true,
  no: false,
  nothing: null,
  emptyObj: {},
  emptyArr: [],
  long: 'abcdefghij'.repeat(200),
  nested: { a: { b: { c: 'deep' } } },
  list: [1, 2, 3],
};

export const DEEP_FIXTURE = {
  slideshow: {
    author: 'Yours Truly',
    date: 'date of publication',
    slides: [
      { title: 'Wake up to WonderWidgets!', type: 'all' },
      {
        items: ['Why WonderWidgets are great', 'Who buys WonderWidgets'],
        title: 'Overview',
        type: 'all',
      },
    ],
    title: 'Sample Slide Show',
  },
};

export const PLAIN_TEXT_FIXTURE = 'hello plain text';

export interface LargeRecord {
  id: number;
  uuid: string;
  name: string;
  description: string;
  score: number;
  ratio: number;
  count: number;
  active: boolean;
  verified: boolean;
  note: string | null;
  tags: [string, string, number];
  meta: {
    level: number;
    weight: number;
    flags: { alpha: boolean; beta: boolean };
    parent: null;
  };
  empty: Record<string, never>;
  none: never[];
}

const LOREM = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore';

/** One deterministic record: strings, ints, floats, booleans, nulls, nested object, array, empty object, empty array. */
export function makeLargeRecord(i: number): LargeRecord {
  return {
    id: i,
    uuid: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    name: `Record ${i} ${LOREM}`,
    description: `${LOREM} ${LOREM} #${i}`,
    score: i + 0.25,
    ratio: -((i % 97) + 0.5),
    count: i * 3,
    active: i % 2 === 0,
    verified: i % 3 === 0,
    note: i % 5 === 0 ? null : `note-${i}`,
    tags: [`tag-${i % 7}`, `tag-${(i + 3) % 7}`, i % 11],
    meta: {
      level: i % 10,
      weight: (i % 100) / 100 + 0.005,
      flags: { alpha: true, beta: false },
      parent: null,
    },
    empty: {},
    none: [],
  };
}

/**
 * Builds `{ records: [...] }` until its serialized size is at least `minBytes`
 * (plus a small margin). Deterministic: the same input always yields the same body.
 */
export function buildLargeFixture(minBytes: number = MIN_LARGE_BYTES): { records: LargeRecord[] } {
  const records: LargeRecord[] = [];
  let size = '{"records":[]}'.length;
  for (let i = 0; size < minBytes + 64 * 1024; i++) {
    const rec = makeLargeRecord(i);
    records.push(rec);
    size += JSON.stringify(rec).length + 1;
  }
  return { records };
}

let largeBodyCache: Buffer | null = null;

function largeBody(): Buffer {
  if (!largeBodyCache) {
    largeBodyCache = Buffer.from(JSON.stringify(buildLargeFixture()), 'utf8');
    if (largeBodyCache.length < MIN_LARGE_BYTES) {
      throw new Error(`large.json fixture is only ${largeBodyCache.length} bytes (< ${MIN_LARGE_BYTES})`);
    }
  }
  return largeBodyCache;
}

const JSON_TYPE = 'application/json; charset=utf-8';
const TEXT_TYPE = 'text/plain; charset=utf-8';

function send(res: ServerResponse, status: number, type: string, body: Buffer) {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export async function startJsonFixtureServer(): Promise<{ baseUrl: string; close(): Promise<void> }> {
  // Build every body once at startup so request handling is a plain buffer write.
  const bodies: Record<string, { type: string; body: Buffer }> = {
    '/large.json': { type: JSON_TYPE, body: largeBody() },
    '/types.json': { type: JSON_TYPE, body: Buffer.from(JSON.stringify(TYPES_FIXTURE), 'utf8') },
    '/deep.json': { type: JSON_TYPE, body: Buffer.from(JSON.stringify(DEEP_FIXTURE), 'utf8') },
    '/plain.txt': { type: TEXT_TYPE, body: Buffer.from(PLAIN_TEXT_FIXTURE, 'utf8') },
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const hit = bodies[pathname];
    if (!hit) {
      send(res, 404, TEXT_TYPE, Buffer.from('not found', 'utf8'));
      return;
    }
    send(res, 200, hit.type, hit.body);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    close: () =>
      new Promise<void>((resolve) => {
        // Chromium keeps keep-alive sockets open; drop them so close() returns promptly.
        (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
