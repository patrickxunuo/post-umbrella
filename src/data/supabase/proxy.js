// HTTP Proxy — send requests via Edge Function or Tauri
import { supabase, PROXY_FUNCTION_URL } from './client.js';

// Proxy - send HTTP request via Edge Function
export const sendRequest = async (data, { signal } = {}) => {
  // In Tauri app, all requests go direct (Tauri HTTP plugin bypasses CORS at the system level)
  if ('__TAURI_INTERNALS__' in window) {
    return sendDirectRequest(data, signal);
  }

  // Check if URL points to a local/private address (should bypass remote proxy)
  const isLocal = (url) => {
    try {
      let urlToParse = url;
      if (!url.match(/^https?:\/\//i)) {
        urlToParse = 'http://' + url;
      }
      const parsed = new URL(urlToParse);
      const h = parsed.hostname;
      // Explicit localhost
      if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
      // Local TLDs (Herd, Valet, dnsmasq, etc.)
      if (/\.(test|local|localhost|invalid|example|wip|ddev\.site)$/i.test(h)) return true;
      // Private IP ranges
      if (/^10\./.test(h) || /^192\.168\./.test(h)) return true;
      if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
      return false;
    } catch (e) {
      return false;
    }
  };

  if (isLocal(data.url)) {
    return sendDirectRequest(data);
  }

  // Get session and check if token needs refresh
  let { data: { session } } = await supabase.auth.getSession();

  // Check if token is expired or about to expire (within 60 seconds)
  const isTokenExpired = () => {
    if (!session?.expires_at) return true;
    const expiresAt = session.expires_at * 1000; // Convert to ms
    return Date.now() > expiresAt - 60000; // 60 second buffer
  };
  console.log('is exipired: ', isTokenExpired())

  // Refresh if no session or token is expired/expiring
  if (!session || isTokenExpired()) {
    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshData.session) {
      throw new Error('Session expired. Please log in again.');
    }
    session = refreshData.session;
  }

  const accessToken = session.access_token;

  // Send via Edge Function proxy
  const response = await fetch(PROXY_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify(data),
    signal,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Proxy request failed');
  }

  return response.json();
};

// Send request via custom Tauri command (pure reqwest, no Origin header, no CORS)
const sendTauriRequest = async (url, method, headersArr, bodyBytes, timeout) => {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke('http_request', {
    method,
    url,
    headers: headersArr,
    body: bodyBytes,
    timeoutMs: timeout || 30000,
  });
};

// Direct request (uses Tauri IPC in desktop app, browser fetch otherwise)
const sendDirectRequest = async (data, signal) => {
  const { method, headers, body, bodyType, formData, timeout } = data;
  let url = data.url;
  if (!url.match(/^https?:\/\//i)) {
    url = 'http://' + url;
  }
  const startTime = Date.now();

  try {
    const headersArr = [];
    if (Array.isArray(headers)) {
      headers.forEach(h => {
        if (h.key && h.enabled !== false) {
          headersArr.push([h.key, String(h.value ?? '')]);
        }
      });
    }

    let bodyBytes = null;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method?.toUpperCase())) {
      if (bodyType === 'form-data' && Array.isArray(formData)) {
        // Build multipart body via browser FormData + Request
        const form = new FormData();
        for (const field of formData) {
          if (!field.key || field.enabled === false) continue;
          if (field.type === 'file' && field.value) {
            const byteString = atob(field.value);
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) {
              ia[i] = byteString.charCodeAt(i);
            }
            const blob = new Blob([ab], { type: field.fileType || 'application/octet-stream' });
            form.append(field.key, blob, field.fileName || 'file');
          } else {
            form.append(field.key, field.value || '');
          }
        }
        const tmpReq = new Request('http://localhost', { method: 'POST', body: form });
        const buf = await tmpReq.arrayBuffer();
        bodyBytes = Array.from(new Uint8Array(buf));
        // Get the multipart content-type with boundary
        const ct = tmpReq.headers.get('content-type');
        if (ct && !headersArr.some(([k]) => k.toLowerCase() === 'content-type')) {
          headersArr.push(['Content-Type', ct]);
        }
      } else if (body) {
        bodyBytes = Array.from(new TextEncoder().encode(body));
      }
    }

    // Use custom Tauri command in desktop app (pure reqwest, no Origin header)
    if ('__TAURI_INTERNALS__' in window) {
      const tauriPromise = sendTauriRequest(url, method || 'GET', headersArr, bodyBytes, timeout);
      // Race against abort signal so UI unblocks immediately on cancel
      const res = signal
        ? await Promise.race([
            tauriPromise,
            new Promise((_, reject) => {
              if (signal.aborted) reject(new DOMException('The operation was aborted.', 'AbortError'));
              signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true });
            }),
          ])
        : await tauriPromise;
      const endTime = Date.now();

      const responseHeaders = (res.headers || []).map(([key, value]) => ({ key, value }));
      const contentType = responseHeaders.find(h => h.key.toLowerCase() === 'content-type')?.value || '';

      let responseBody;
      if (contentType.includes('application/json')) {
        try { responseBody = JSON.parse(res.body); } catch { responseBody = res.body; }
      } else {
        responseBody = res.body;
      }

      return {
        status: res.status,
        statusText: res.status_text,
        headers: responseHeaders,
        body: responseBody,
        time: endTime - startTime,
        size: res.body.length,
      };
    }

    // Browser path
    const headersObj = {};
    headersArr.forEach(([k, v]) => { headersObj[k] = v; });
    const config = { method: method || 'GET', headers: headersObj };
    if (bodyBytes && bodyType !== 'form-data') {
      config.body = body;
    } else if (bodyType === 'form-data') {
      // Rebuild FormData for browser
      const form = new FormData();
      for (const field of (formData || [])) {
        if (!field.key || field.enabled === false) continue;
        if (field.type === 'file' && field.value) {
          const byteString = atob(field.value);
          const ab = new ArrayBuffer(byteString.length);
          const ia = new Uint8Array(ab);
          for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
          const blob = new Blob([ab], { type: field.fileType || 'application/octet-stream' });
          form.append(field.key, blob, field.fileName || 'file');
        } else {
          form.append(field.key, field.value || '');
        }
      }
      config.body = form;
      delete config.headers['Content-Type'];
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout || 30000);
    // If an external signal is provided, abort when it fires
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    config.signal = controller.signal;

    const response = await window.fetch(url, config);
    clearTimeout(timeoutId);

    const endTime = Date.now();
    let responseBody;
    const contentType = response.headers.get('content-type') || '';
    const isBinary = /^\s*(image\/|audio\/|video\/|application\/(octet-stream|pdf|zip|x-.+))/i.test(contentType);
    // SVG is an image but text-encoded — keep it as text.
    const isSvg = /^\s*image\/svg\+xml/i.test(contentType);
    if (contentType.includes('application/json')) {
      responseBody = await response.json();
    } else if (isBinary && !isSvg) {
      const buf = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
      responseBody = btoa(binary);
    } else {
      responseBody = await response.text();
    }
    const responseHeaders = [];
    response.headers.forEach((value, key) => { responseHeaders.push({ key, value }); });

    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: responseBody,
      time: endTime - startTime,
      size: JSON.stringify(responseBody).length,
    };
  } catch (error) {
    const endTime = Date.now();

    if (error?.name === 'AbortError') {
      // If cancelled by external signal, re-throw so the caller can handle it
      if (signal?.aborted) throw error;
      return {
        status: 0,
        statusText: 'Timeout',
        headers: [],
        body: `Request timed out after ${timeout || 30000}ms`,
        time: endTime - startTime,
        size: 0,
        error: true,
      };
    }

    return {
      status: 0,
      statusText: 'Error',
      headers: [],
      body: error?.message || String(error) || 'Unknown error',
      time: endTime - startTime,
      size: 0,
      error: true,
    };
  }
};


