const API_BASE = '/api';

// Get auth token from localStorage
function getAuthToken() {
  return localStorage.getItem('auth_token');
}

// Set auth token in localStorage
export function setAuthToken(token) {
  if (token) {
    localStorage.setItem('auth_token', token);
  } else {
    localStorage.removeItem('auth_token');
  }
}

// Get current user from localStorage
export function getCurrentUser() {
  const user = localStorage.getItem('auth_user');
  return user ? JSON.parse(user) : null;
}

// Set current user in localStorage
export function setCurrentUser(user) {
  if (user) {
    localStorage.setItem('auth_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('auth_user');
  }
}

async function request(path, options = {}, requireAuth = true) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  // Add auth token if available
  const token = getAuthToken();
  if (token && requireAuth) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    headers,
    ...options,
  });

  // Handle 401 - unauthorized
  if (response.status === 401 && requireAuth) {
    setAuthToken(null);
    setCurrentUser(null);
    window.dispatchEvent(new CustomEvent('auth:logout'));
    throw new Error('Session expired. Please log in again.');
  }

  if (options.method === 'DELETE') {
    return null;
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

// Auth
export const login = async (email, password) => {
  const result = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  }, false);

  setAuthToken(result.token);
  setCurrentUser(result.user);

  return result;
};

export const logout = async () => {
  try {
    await request('/auth/logout', { method: 'POST' });
  } finally {
    setAuthToken(null);
    setCurrentUser(null);
  }
};

export const checkAuth = () => request('/auth/me');

// Collections
export const getCollections = () => request('/collections');
export const createCollection = (data) => request('/collections', { method: 'POST', body: JSON.stringify(data) });
export const updateCollection = (id, data) => request(`/collections/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteCollection = (id) => request(`/collections/${id}`, { method: 'DELETE' });

// Requests
export const getRequests = (collectionId) => request(`/requests${collectionId ? `?collection_id=${collectionId}` : ''}`);
export const getRequest = (id) => request(`/requests/${id}`);
export const createRequest = (data) => request('/requests', { method: 'POST', body: JSON.stringify(data) });
export const updateRequest = (id, data) => request(`/requests/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteRequest = (id) => request(`/requests/${id}`, { method: 'DELETE' });
export const reorderRequests = (collectionId, requestIds) => request('/requests/reorder', { method: 'POST', body: JSON.stringify({ collection_id: collectionId, request_ids: requestIds }) });
export const moveRequest = (requestId, collectionId) => request(`/requests/${requestId}/move`, { method: 'POST', body: JSON.stringify({ collection_id: collectionId }) });

// Examples
export const getExamples = (requestId) => request(`/examples${requestId ? `?request_id=${requestId}` : ''}`);
export const getExample = (id) => request(`/examples/${id}`);
export const createExample = (data) => request('/examples', { method: 'POST', body: JSON.stringify(data) });
export const updateExample = (id, data) => request(`/examples/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteExample = (id) => request(`/examples/${id}`, { method: 'DELETE' });

// Environments (collection-specific)
export const getEnvironments = (collectionId) => request(`/environments/collection/${collectionId}`);
export const getActiveEnvironment = (collectionId) => request(`/environments/active/${collectionId}`);
export const createEnvironment = (data) => request('/environments', { method: 'POST', body: JSON.stringify(data) });
export const updateEnvironment = (id, data) => request(`/environments/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const activateEnvironment = (id) => request(`/environments/${id}/activate`, { method: 'PUT' });
export const deactivateEnvironments = (collectionId) => request(`/environments/deactivate/${collectionId}`, { method: 'POST' });
export const deleteEnvironment = (id) => request(`/environments/${id}`, { method: 'DELETE' });

// Check if URL is localhost
const isLocalhost = (url) => {
  try {
    // Add protocol if missing for parsing
    let urlToParse = url;
    if (!url.match(/^https?:\/\//i)) {
      urlToParse = 'http://' + url;
    }
    const parsed = new URL(urlToParse);
    const result = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    console.log('[API] Parsed URL hostname:', parsed.hostname, '| isLocalhost:', result);
    return result;
  } catch (e) {
    console.log('[API] Failed to parse URL:', url, e.message);
    return false;
  }
};

// Send request directly from browser (for localhost)
const sendDirectRequest = async (data) => {
  const { method, headers, body, bodyType, formData, timeout } = data;
  // Add protocol if missing
  let url = data.url;
  if (!url.match(/^https?:\/\//i)) {
    url = 'http://' + url;
  }
  const startTime = Date.now();

  try {
    const headersObj = {};
    if (Array.isArray(headers)) {
      headers.forEach(h => {
        if (h.key && h.enabled !== false) {
          headersObj[h.key] = h.value;
        }
      });
    }

    const config = {
      method: method || 'GET',
      headers: headersObj,
    };

    // Add body for methods that support it
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method?.toUpperCase())) {
      if (bodyType === 'form-data' && Array.isArray(formData)) {
        const form = new FormData();
        for (const field of formData) {
          if (!field.key || field.enabled === false) continue;
          if (field.type === 'file' && field.fileData) {
            // Convert base64 to blob
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
        config.body = form;
      } else if (body) {
        config.body = body;
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout || 30000);
    config.signal = controller.signal;

    const response = await fetch(url, config);
    clearTimeout(timeoutId);

    const endTime = Date.now();

    // Get response body
    let responseBody;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      responseBody = await response.json();
    } else {
      responseBody = await response.text();
    }

    // Convert headers
    const responseHeaders = [];
    response.headers.forEach((value, key) => {
      responseHeaders.push({ key, value });
    });

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

    if (error.name === 'AbortError') {
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
      body: error.message,
      time: endTime - startTime,
      size: 0,
      error: true,
    };
  }
};

// Proxy (send request) - uses direct fetch for localhost, proxy for external
export const sendRequest = async (data) => {
  if (isLocalhost(data.url)) {
    console.log('[API] Using direct browser fetch for localhost:', data.url);
    return sendDirectRequest(data);
  }
  console.log('[API] Using server proxy for:', data.url);
  return request('/proxy', { method: 'POST', body: JSON.stringify(data) });
};

// Import/Export
export const exportCollections = () => request('/sync/export');
export const exportCollection = (id) => request(`/sync/export/${id}`);
export const importCollection = (data) => request('/sync/import', { method: 'POST', body: JSON.stringify(data) });
