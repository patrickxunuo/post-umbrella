import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { all, get, run } from '../db.js';
import { broadcast } from '../index.js';

const router = Router();

// Get all requests (optionally filtered by collection)
router.get('/', async (req, res) => {
  try {
    const { collection_id } = req.query;

    let requests;
    if (collection_id) {
      requests = await all('SELECT * FROM requests WHERE collection_id = ? ORDER BY sort_order ASC, created_at ASC', [collection_id]);
    } else {
      requests = await all('SELECT * FROM requests ORDER BY sort_order ASC, created_at ASC');
    }

    res.json(requests.map(r => ({
      ...r,
      headers: JSON.parse(r.headers || '[]'),
      form_data: JSON.parse(r.form_data || '[]'),
      params: JSON.parse(r.params || '[]'),
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single request with examples
router.get('/:id', async (req, res) => {
  try {
    const request = await get('SELECT * FROM requests WHERE id = ?', [req.params.id]);
    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const examples = await all('SELECT * FROM examples WHERE request_id = ? ORDER BY created_at DESC', [req.params.id]);

    res.json({
      ...request,
      headers: JSON.parse(request.headers || '[]'),
      form_data: JSON.parse(request.form_data || '[]'),
      params: JSON.parse(request.params || '[]'),
      examples: examples.map(e => ({
        ...e,
        request_data: JSON.parse(e.request_data || '{}'),
        response_data: JSON.parse(e.response_data || '{}'),
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create request
router.post('/', async (req, res) => {
  try {
    const { collection_id, name, method, url, headers, body, body_type, form_data, auth_type, auth_token, params, pre_script, post_script } = req.body;
    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    // Get max sort_order for this collection
    const maxOrderResult = await get(
      'SELECT MAX(sort_order) as max_order FROM requests WHERE collection_id = ?',
      [collection_id]
    );
    const sortOrder = (maxOrderResult?.max_order ?? -1) + 1;

    await run(
      `INSERT INTO requests (id, collection_id, name, method, url, headers, body, body_type, form_data, auth_type, auth_token, params, pre_script, post_script, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        collection_id,
        name || 'New Request',
        method || 'GET',
        url || '',
        JSON.stringify(headers || []),
        body || '',
        body_type || 'none',
        JSON.stringify(form_data || []),
        auth_type || 'none',
        auth_token || '',
        JSON.stringify(params || []),
        pre_script || '',
        post_script || '',
        sortOrder,
        now,
        now
      ]
    );

    const request = await get('SELECT * FROM requests WHERE id = ?', [id]);

    broadcast('request:create', {
      ...request,
      headers: JSON.parse(request.headers || '[]'),
      form_data: JSON.parse(request.form_data || '[]'),
      params: JSON.parse(request.params || '[]'),
    });

    res.status(201).json({
      ...request,
      headers: JSON.parse(request.headers || '[]'),
      form_data: JSON.parse(request.form_data || '[]'),
      params: JSON.parse(request.params || '[]'),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update request
router.put('/:id', async (req, res) => {
  try {
    const { name, method, url, headers, body, body_type, form_data, collection_id, auth_type, auth_token, params, pre_script, post_script } = req.body;
    const now = Math.floor(Date.now() / 1000);

    const existing = await get('SELECT * FROM requests WHERE id = ?', [req.params.id]);
    if (!existing) {
      return res.status(404).json({ error: 'Request not found' });
    }

    await run(
      `UPDATE requests
       SET name = ?, method = ?, url = ?, headers = ?, body = ?, body_type = ?, form_data = ?, collection_id = ?, auth_type = ?, auth_token = ?, params = ?, pre_script = ?, post_script = ?, updated_at = ?
       WHERE id = ?`,
      [
        name ?? existing.name,
        method ?? existing.method,
        url ?? existing.url,
        headers ? JSON.stringify(headers) : existing.headers,
        body ?? existing.body,
        body_type ?? existing.body_type,
        form_data ? JSON.stringify(form_data) : existing.form_data,
        collection_id ?? existing.collection_id,
        auth_type ?? existing.auth_type,
        auth_token ?? existing.auth_token,
        params ? JSON.stringify(params) : existing.params,
        pre_script ?? existing.pre_script,
        post_script ?? existing.post_script,
        now,
        req.params.id
      ]
    );

    const request = await get('SELECT * FROM requests WHERE id = ?', [req.params.id]);

    broadcast('request:update', {
      ...request,
      headers: JSON.parse(request.headers || '[]'),
      form_data: JSON.parse(request.form_data || '[]'),
      params: JSON.parse(request.params || '[]'),
    });

    res.json({
      ...request,
      headers: JSON.parse(request.headers || '[]'),
      form_data: JSON.parse(request.form_data || '[]'),
      params: JSON.parse(request.params || '[]'),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete request
router.delete('/:id', async (req, res) => {
  try {
    // Delete examples first
    await run('DELETE FROM examples WHERE request_id = ?', [req.params.id]);
    // Delete request
    await run('DELETE FROM requests WHERE id = ?', [req.params.id]);

    broadcast('request:delete', { id: req.params.id });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reorder requests within a collection
router.post('/reorder', async (req, res) => {
  try {
    const { collection_id, request_ids } = req.body;

    // Update sort_order for each request
    for (let i = 0; i < request_ids.length; i++) {
      await run(
        'UPDATE requests SET sort_order = ? WHERE id = ? AND collection_id = ?',
        [i, request_ids[i], collection_id]
      );
    }

    broadcast('request:reorder', { collection_id, request_ids });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Move request to a different collection
router.post('/:id/move', async (req, res) => {
  try {
    const { id } = req.params;
    const { collection_id } = req.body;

    // Get the max sort_order in the target collection
    const maxOrderResult = await get(
      'SELECT MAX(sort_order) as max_order FROM requests WHERE collection_id = ?',
      [collection_id]
    );
    const newSortOrder = (maxOrderResult?.max_order ?? -1) + 1;

    // Update the request's collection_id and sort_order
    await run(
      'UPDATE requests SET collection_id = ?, sort_order = ?, updated_at = ? WHERE id = ?',
      [collection_id, newSortOrder, Date.now(), id]
    );

    // Get the updated request
    const request = await get('SELECT * FROM requests WHERE id = ?', [id]);

    broadcast('request:move', request);
    res.json(request);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
