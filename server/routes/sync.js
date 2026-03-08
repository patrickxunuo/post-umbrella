import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { all, get, run } from '../db.js';
import { broadcast } from '../index.js';

const router = Router();

// Import environment variables from Postman collection
async function importEnvironmentVariables(postmanData, userId, collectionId) {
  // Postman collections can have variables at the collection level
  const variables = postmanData.variable || [];

  if (variables.length === 0) {
    return null;
  }

  const envId = uuidv4();
  const envName = `${postmanData.info?.name || 'Imported'} Variables`;
  const now = Math.floor(Date.now() / 1000);

  // Convert Postman variable format to our format
  const envVariables = variables.map(v => ({
    key: v.key,
    value: v.value || '',
    enabled: !v.disabled,
  }));

  await run(
    'INSERT INTO environments (id, name, variables, collection_id, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [envId, envName, JSON.stringify(envVariables), collectionId, userId, userId, now, now]
  );

  return { id: envId, name: envName, variables: envVariables, collection_id: collectionId };
}

// Export all data as Postman Collection v2.1 format
router.get('/export', async (req, res) => {
  try {
    const collections = await all('SELECT * FROM collections ORDER BY created_at ASC');
    const requests = await all('SELECT * FROM requests ORDER BY created_at ASC');
    const examples = await all('SELECT * FROM examples ORDER BY created_at ASC');

    // Build Postman collection for each top-level collection
    const postmanCollections = collections
      .filter(c => !c.parent_id)
      .map(collection => buildPostmanCollection(collection, collections, requests, examples));

    // If single collection, return it directly; otherwise wrap in array
    if (postmanCollections.length === 1) {
      res.json(postmanCollections[0]);
    } else {
      res.json(postmanCollections);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export single collection
router.get('/export/:id', async (req, res) => {
  try {
    const collection = await get('SELECT * FROM collections WHERE id = ?', [req.params.id]);
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    const collections = await all('SELECT * FROM collections ORDER BY created_at ASC');
    const requests = await all('SELECT * FROM requests ORDER BY created_at ASC');
    const examples = await all('SELECT * FROM examples ORDER BY created_at ASC');

    const postmanCollection = buildPostmanCollection(collection, collections, requests, examples);
    res.json(postmanCollection);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Import Postman Collection v2.1
router.post('/import', async (req, res) => {
  const postmanData = req.body;

  if (!postmanData || !postmanData.info) {
    return res.status(400).json({ error: 'Invalid Postman collection format' });
  }

  const collectionName = postmanData.info?.name || 'Imported Collection';

  try {
    // Check if a collection with this name already exists (at root level)
    const existingCollection = await get(
      'SELECT id, name FROM collections WHERE name = ? AND parent_id IS NULL',
      [collectionName]
    );

    if (existingCollection) {
      return res.status(400).json({
        error: `A collection named "${collectionName}" already exists. Please rename or delete the existing collection before importing.`
      });
    }

    const result = await importPostmanCollection(postmanData);

    // Import environment variables if present (associated with the root collection)
    let environment = null;
    if (postmanData.variable && postmanData.variable.length > 0 && result.collections.length > 0) {
      const rootCollectionId = result.collections[0].id;
      environment = await importEnvironmentVariables(postmanData, req.user.id, rootCollectionId);
    }

    broadcast('sync:import', {
      collections: result.collections,
      requests: result.requests,
      environment,
    });

    res.json({ success: true, ...result, environment });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Helper: Build Postman Collection v2.1 format
function buildPostmanCollection(collection, allCollections, allRequests, allExamples) {
  const collectionRequests = allRequests.filter(r => r.collection_id === collection.id);
  const childCollections = allCollections.filter(c => c.parent_id === collection.id);

  const items = [
    // Add requests
    ...collectionRequests.map(req => {
      const reqExamples = allExamples.filter(e => e.request_id === req.id);
      return buildPostmanRequest(req, reqExamples);
    }),
    // Add child folders recursively
    ...childCollections.map(child => ({
      name: child.name,
      item: buildPostmanCollection(child, allCollections, allRequests, allExamples).item,
    })),
  ];

  return {
    info: {
      _postman_id: collection.id,
      name: collection.name,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: items,
  };
}

// Helper: Build Postman request format
function buildPostmanRequest(req, examples) {
  const headers = JSON.parse(req.headers || '[]');

  const request = {
    method: req.method,
    header: headers.map(h => ({
      key: h.key,
      value: h.value,
      disabled: h.enabled === false,
    })),
    url: {
      raw: req.url,
      ...parseUrl(req.url),
    },
  };

  if (req.body && req.body_type !== 'none') {
    request.body = {
      mode: req.body_type === 'json' ? 'raw' : req.body_type,
      raw: req.body,
      options: req.body_type === 'json' ? { raw: { language: 'json' } } : undefined,
    };
  }

  const item = {
    name: req.name,
    request,
    response: examples.map(ex => {
      const exReqData = JSON.parse(ex.request_data || '{}');
      const exResData = JSON.parse(ex.response_data || '{}');
      return {
        name: ex.name,
        originalRequest: {
          method: exReqData.method || req.method,
          header: (exReqData.headers || []).map(h => ({
            key: h.key,
            value: h.value,
          })),
          url: { raw: exReqData.url || req.url },
          body: exReqData.body ? { mode: 'raw', raw: exReqData.body } : undefined,
        },
        status: exResData.statusText || '',
        code: exResData.status || 200,
        header: (exResData.headers || []).map(h => ({
          key: h.key,
          value: h.value,
        })),
        body: typeof exResData.body === 'string' ? exResData.body : JSON.stringify(exResData.body, null, 2),
        _postman_previewlanguage: 'json',
      };
    }),
  };

  return item;
}

// Helper: Parse URL into Postman format
function parseUrl(urlString) {
  try {
    const url = new URL(urlString);
    return {
      protocol: url.protocol.replace(':', ''),
      host: url.hostname.split('.'),
      port: url.port || undefined,
      path: url.pathname.split('/').filter(Boolean),
      query: [...url.searchParams].map(([key, value]) => ({ key, value })),
    };
  } catch {
    return { raw: urlString };
  }
}

// Helper: Import Postman collection
async function importPostmanCollection(postmanData, parentId = null) {
  const collectionId = uuidv4();
  const collectionName = postmanData.info?.name || 'Imported Collection';
  const now = Math.floor(Date.now() / 1000);

  await run(
    'INSERT INTO collections (id, name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [collectionId, collectionName, parentId, now, now]
  );

  const result = {
    collections: [{ id: collectionId, name: collectionName }],
    requests: [],
  };

  if (postmanData.item) {
    for (const item of postmanData.item) {
      if (item.request) {
        // It's a request
        const req = await importPostmanRequest(item, collectionId);
        result.requests.push(req);
      } else if (item.item) {
        // It's a folder
        const subResult = await importPostmanCollection({ info: { name: item.name }, item: item.item }, collectionId);
        result.collections.push(...subResult.collections);
        result.requests.push(...subResult.requests);
      }
    }
  }

  return result;
}

// Helper: Import single request
async function importPostmanRequest(item, collectionId) {
  const requestId = uuidv4();
  const req = item.request;
  const now = Math.floor(Date.now() / 1000);

  // Parse headers
  const headers = (req.header || []).map(h => ({
    key: h.key,
    value: h.value,
    enabled: !h.disabled,
  }));

  // Parse URL
  let url = '';
  if (typeof req.url === 'string') {
    url = req.url;
  } else if (req.url?.raw) {
    url = req.url.raw;
  }

  // Parse body
  let body = '';
  let bodyType = 'none';
  if (req.body) {
    bodyType = req.body.mode || 'raw';
    if (bodyType === 'raw') {
      body = req.body.raw || '';
      if (req.body.options?.raw?.language === 'json') {
        bodyType = 'json';
      }
    }
  }

  await run(
    `INSERT INTO requests (id, collection_id, name, method, url, headers, body, body_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [requestId, collectionId, item.name, req.method || 'GET', url, JSON.stringify(headers), body, bodyType, now, now]
  );

  // Import examples (saved responses)
  if (item.response && item.response.length > 0) {
    for (const resp of item.response) {
      await importPostmanExample(resp, requestId);
    }
  }

  return { id: requestId, name: item.name };
}

// Helper: Import example
async function importPostmanExample(resp, requestId) {
  const exampleId = uuidv4();
  const now = Math.floor(Date.now() / 1000);

  const requestData = {
    method: resp.originalRequest?.method || 'GET',
    url: resp.originalRequest?.url?.raw || '',
    headers: (resp.originalRequest?.header || []).map(h => ({
      key: h.key,
      value: h.value,
      enabled: true,
    })),
    body: resp.originalRequest?.body?.raw || '',
  };

  const responseData = {
    status: resp.code || 200,
    statusText: resp.status || 'OK',
    headers: (resp.header || []).map(h => ({
      key: h.key,
      value: h.value,
    })),
    body: resp.body || '',
  };

  await run(
    'INSERT INTO examples (id, request_id, name, request_data, response_data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [exampleId, requestId, resp.name || 'Example', JSON.stringify(requestData), JSON.stringify(responseData), now]
  );
}

export default router;
