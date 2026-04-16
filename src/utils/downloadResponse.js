// Helpers for the response Download button. Pure functions except `downloadResponse`,
// which performs the actual file-save I/O (browser Blob or Tauri dialog).

const TEXT_MIME_MAP = {
  'text/html': 'html',
  'text/css': 'css',
  'text/javascript': 'js',
  'text/plain': 'txt',
  'text/xml': 'xml',
  'text/csv': 'csv',
  'text/markdown': 'md',
  'application/xml': 'xml',
  'application/xhtml+xml': 'html',
  'application/javascript': 'js',
  'application/ecmascript': 'js',
};

const BINARY_MIME_MAP = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/gzip': 'gz',
  'application/x-tar': 'tar',
  'application/octet-stream': 'bin',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

function normalizeMime(mime) {
  if (!mime || typeof mime !== 'string') return '';
  return mime.split(';')[0].trim().toLowerCase();
}

/**
 * Map a MIME type to a file extension (without the dot).
 * Unknown/missing → 'bin'. Unknown text/* → 'txt'. application/*+json → 'json'.
 */
export function mimeToExtension(mime) {
  const m = normalizeMime(mime);
  if (!m) return 'bin';

  // JSON family
  if (m === 'application/json' || m === 'application/ld+json' || /\+json$/.test(m)) {
    return 'json';
  }

  if (TEXT_MIME_MAP[m]) return TEXT_MIME_MAP[m];
  if (BINARY_MIME_MAP[m]) return BINARY_MIME_MAP[m];

  // Unknown text/* → txt
  if (m.startsWith('text/')) return 'txt';

  // Unknown image/*, audio/*, video/* → bin
  if (m.startsWith('image/') || m.startsWith('audio/') || m.startsWith('video/')) return 'bin';

  // application/x-*, application/vnd.* → bin
  if (m.startsWith('application/x-') || m.startsWith('application/vnd.')) return 'bin';

  return 'bin';
}

/**
 * True if the MIME indicates binary content — body is expected to be a base64 string.
 */
export function isBinaryMime(mime) {
  const m = normalizeMime(mime);
  if (!m) return false;

  // Explicit text / JSON / XML / JS families: false
  if (m === 'application/json' || m === 'application/ld+json' || /\+json$/.test(m)) return false;
  if (m === 'application/xml' || m === 'application/xhtml+xml') return false;
  if (m === 'application/javascript' || m === 'application/ecmascript') return false;
  if (m.startsWith('text/')) return false;

  // SVG is an image but served as text-encoded XML — keep it on the text path.
  if (m === 'image/svg+xml') return false;

  if (m.startsWith('image/')) return true;
  if (m.startsWith('audio/')) return true;
  if (m.startsWith('video/')) return true;

  if (m === 'application/pdf') return true;
  if (m === 'application/zip' || m === 'application/x-zip-compressed') return true;
  if (m === 'application/gzip' || m === 'application/x-tar') return true;
  if (m === 'application/octet-stream') return true;

  if (m.startsWith('application/x-')) return true;
  if (m.startsWith('application/vnd.')) return true;

  return false;
}

/**
 * Extract a filename from a Content-Disposition header. Supports quoted, unquoted,
 * and RFC 5987 (`filename*=UTF-8''…`) forms. Returns null if none found.
 */
export function parseContentDispositionFilename(contentDisposition) {
  if (!contentDisposition || typeof contentDisposition !== 'string') return null;

  // RFC 5987: filename*=UTF-8''percent-encoded   (preferred when present)
  const starMatch = contentDisposition.match(/filename\*\s*=\s*([^'";]+)''([^;]+)/i);
  if (starMatch) {
    const encoded = starMatch[2].trim();
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }

  // Quoted form: filename="..."
  const quoted = contentDisposition.match(/filename\s*=\s*"([^"]*)"/i);
  if (quoted) return quoted[1];

  // Unquoted form: filename=foo.pdf
  const unquoted = contentDisposition.match(/filename\s*=\s*([^;]+)/i);
  if (unquoted) return unquoted[1].trim();

  return null;
}

/**
 * Strip illegal filename characters (/ \ : * ? " < > | and control chars).
 * Trims surrounding whitespace and dots. Returns 'response' if the result is empty.
 */
export function sanitizeFilename(name) {
  if (!name || typeof name !== 'string') return 'response';
  // Remove illegal characters and control chars (0x00-0x1F, 0x7F)
  // eslint-disable-next-line no-control-regex
  let cleaned = name.replace(/[\/\\:*?"<>|\x00-\x1F\x7F]/g, '');
  // Trim whitespace and dots at both ends
  cleaned = cleaned.replace(/^[\s.]+|[\s.]+$/g, '');
  return cleaned || 'response';
}

function splitNameAndExt(name) {
  const idx = name.lastIndexOf('.');
  if (idx <= 0 || idx === name.length - 1) return { base: name, ext: '' };
  return { base: name.slice(0, idx), ext: name.slice(idx + 1).toLowerCase() };
}

function ensureExtension(filename, mime) {
  const { ext } = splitNameAndExt(filename);
  if (ext) return filename;
  const derived = mimeToExtension(mime);
  return `${filename}.${derived}`;
}

function lastUrlSegment(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const u = new URL(url);
    const pathname = u.pathname || '';
    const segments = pathname.split('/').filter(Boolean);
    return segments.length ? segments[segments.length - 1] : '';
  } catch {
    // Not a full URL — try to infer a last segment manually.
    const cleaned = url.split('?')[0].split('#')[0];
    const segments = cleaned.split('/').filter(Boolean);
    return segments.length ? segments[segments.length - 1] : '';
  }
}

/**
 * Derive the final filename, in priority order:
 *   1) Content-Disposition filename (sanitized; extension appended from MIME if missing)
 *   2) URL last path segment (extension appended from MIME if missing)
 *   3) 'response.<ext>' fallback
 */
export function deriveFilename({ contentDisposition, url, mime }) {
  const fromHeader = parseContentDispositionFilename(contentDisposition);
  if (fromHeader) {
    const sanitized = sanitizeFilename(fromHeader);
    return ensureExtension(sanitized, mime);
  }

  const segment = lastUrlSegment(url);
  if (segment) {
    const sanitized = sanitizeFilename(segment);
    if (sanitized !== 'response') {
      return ensureExtension(sanitized, mime);
    }
  }

  const ext = mimeToExtension(mime);
  return `response.${ext}`;
}

function findHeader(headers, name) {
  if (!Array.isArray(headers)) return '';
  const target = name.toLowerCase();
  const match = headers.find((h) => (h?.key || '').toLowerCase() === target);
  return match?.value || '';
}

function base64ToBytes(base64) {
  const cleaned = String(base64).replace(/\s+/g, '');
  const bin = atob(cleaned);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bodyToText(body) {
  if (body == null) return '';
  if (typeof body === 'object') return JSON.stringify(body, null, 2);
  return String(body);
}

/**
 * Trigger the download. Detects Tauri via `__TAURI_INTERNALS__` and routes accordingly.
 *
 * @param {Object} arg
 * @param {string|object} arg.body — base64 string, raw text, or parsed JSON object
 * @param {Array<{key:string,value:string}>} arg.headers
 * @param {string} [arg.url]
 * @returns {Promise<{ ok: boolean, filename?: string, cancelled?: boolean, error?: string }>}
 */
export async function downloadResponse({ body, headers, url }) {
  try {
    const contentType = findHeader(headers, 'content-type');
    const contentDisposition = findHeader(headers, 'content-disposition');
    const mime = normalizeMime(contentType);
    const filename = deriveFilename({ contentDisposition, url, mime });
    const binary = isBinaryMime(mime);
    const isJson = !binary && (mime === 'application/json' || mime === 'application/ld+json' || /\+json$/.test(mime));

    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

    if (isTauri) {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { invoke } = await import('@tauri-apps/api/core');
      const { ext } = splitNameAndExt(filename);
      const filters = ext
        ? [{ name: ext.toUpperCase(), extensions: [ext] }]
        : [{ name: 'All Files', extensions: ['*'] }];

      const filePath = await save({ defaultPath: filename, filters });
      if (!filePath) return { ok: false, cancelled: true };

      if (binary) {
        const contentsBase64 = typeof body === 'string' ? body.replace(/\s+/g, '') : '';
        await invoke('write_binary_file', { path: filePath, contentsBase64 });
      } else {
        const contents = bodyToText(body);
        await invoke('write_text_file', { path: filePath, contents });
      }

      const savedName = String(filePath).split(/[/\\]/).pop() || filename;
      return { ok: true, filename: savedName };
    }

    // Browser branch
    let blob;
    if (binary) {
      const bytes = base64ToBytes(typeof body === 'string' ? body : '');
      blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
    } else if (isJson) {
      blob = new Blob([bodyToText(body)], { type: mime || 'application/json' });
    } else {
      blob = new Blob([bodyToText(body)], { type: mime || 'text/plain' });
    }

    const blobUrl = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }

    return { ok: true, filename };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}
