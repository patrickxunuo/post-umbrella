import { Router } from 'express';
import axios from 'axios';
import FormData from 'form-data';

const router = Router();

// Proxy endpoint to forward requests (avoids CORS issues)
router.post('/', async (req, res) => {
  const { method, url, headers, body, bodyType, formData, timeout } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const startTime = Date.now();

  try {
    // Convert headers array to object
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
      url,
      headers: headersObj,
      timeout: timeout || 30000,
      validateStatus: () => true, // Don't throw on any status code
      maxRedirects: 5,
    };

    // Add body for methods that support it
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method?.toUpperCase())) {
      if (bodyType === 'form-data' && Array.isArray(formData)) {
        // Build multipart form data
        const form = new FormData();

        for (const field of formData) {
          if (!field.key || field.enabled === false) continue;

          if (field.type === 'file' && field.value) {
            // File field - value is base64 encoded
            const buffer = Buffer.from(field.value, 'base64');
            form.append(field.key, buffer, {
              filename: field.fileName || 'file',
              contentType: field.fileType || 'application/octet-stream',
            });
          } else {
            // Text field
            form.append(field.key, field.value || '');
          }
        }

        config.data = form;
        // Merge form-data headers (includes Content-Type with boundary)
        Object.assign(config.headers, form.getHeaders());
      } else if (body) {
        config.data = body;
      }
    }

    const response = await axios(config);
    const endTime = Date.now();

    // Convert response headers to array format
    const responseHeaders = Object.entries(response.headers || {}).map(([key, value]) => ({
      key,
      value: String(value),
    }));

    res.json({
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: response.data,
      time: endTime - startTime,
      size: JSON.stringify(response.data).length,
    });
  } catch (error) {
    const endTime = Date.now();

    if (error.code === 'ECONNABORTED') {
      return res.json({
        status: 0,
        statusText: 'Timeout',
        headers: [],
        body: `Request timed out after ${timeout || 30000}ms`,
        time: endTime - startTime,
        size: 0,
        error: true,
      });
    }

    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return res.json({
        status: 0,
        statusText: error.code,
        headers: [],
        body: `Could not connect to ${url}: ${error.message}`,
        time: endTime - startTime,
        size: 0,
        error: true,
      });
    }

    res.json({
      status: 0,
      statusText: 'Error',
      headers: [],
      body: error.message,
      time: endTime - startTime,
      size: 0,
      error: true,
    });
  }
});

export default router;
