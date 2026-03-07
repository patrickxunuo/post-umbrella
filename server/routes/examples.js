import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { all, get, run } from '../db.js';
import { broadcast } from '../index.js';

const router = Router();

// Get examples for a request
router.get('/', async (req, res) => {
  try {
    const { request_id } = req.query;

    let examples;
    if (request_id) {
      examples = await all('SELECT * FROM examples WHERE request_id = ? ORDER BY created_at DESC', [request_id]);
    } else {
      examples = await all('SELECT * FROM examples ORDER BY created_at DESC');
    }

    res.json(examples.map(e => ({
      ...e,
      request_data: JSON.parse(e.request_data || '{}'),
      response_data: JSON.parse(e.response_data || '{}'),
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single example
router.get('/:id', async (req, res) => {
  try {
    const example = await get('SELECT * FROM examples WHERE id = ?', [req.params.id]);
    if (!example) {
      return res.status(404).json({ error: 'Example not found' });
    }

    res.json({
      ...example,
      request_data: JSON.parse(example.request_data || '{}'),
      response_data: JSON.parse(example.response_data || '{}'),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create example (save request/response pair)
router.post('/', async (req, res) => {
  try {
    const { request_id, name, request_data, response_data } = req.body;
    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    await run(
      'INSERT INTO examples (id, request_id, name, request_data, response_data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        id,
        request_id,
        name || 'Example',
        JSON.stringify(request_data || {}),
        JSON.stringify(response_data || {}),
        now
      ]
    );

    const example = await get('SELECT * FROM examples WHERE id = ?', [id]);

    broadcast('example:create', {
      ...example,
      request_data: JSON.parse(example.request_data || '{}'),
      response_data: JSON.parse(example.response_data || '{}'),
    });

    res.status(201).json({
      ...example,
      request_data: JSON.parse(example.request_data || '{}'),
      response_data: JSON.parse(example.response_data || '{}'),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update example
router.put('/:id', async (req, res) => {
  try {
    const { name, request_data, response_data } = req.body;

    const existing = await get('SELECT * FROM examples WHERE id = ?', [req.params.id]);
    if (!existing) {
      return res.status(404).json({ error: 'Example not found' });
    }

    await run(
      'UPDATE examples SET name = ?, request_data = ?, response_data = ? WHERE id = ?',
      [
        name ?? existing.name,
        request_data ? JSON.stringify(request_data) : existing.request_data,
        response_data ? JSON.stringify(response_data) : existing.response_data,
        req.params.id
      ]
    );

    const example = await get('SELECT * FROM examples WHERE id = ?', [req.params.id]);

    broadcast('example:update', {
      ...example,
      request_data: JSON.parse(example.request_data || '{}'),
      response_data: JSON.parse(example.response_data || '{}'),
    });

    res.json({
      ...example,
      request_data: JSON.parse(example.request_data || '{}'),
      response_data: JSON.parse(example.response_data || '{}'),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete example
router.delete('/:id', async (req, res) => {
  try {
    const example = await get('SELECT * FROM examples WHERE id = ?', [req.params.id]);

    await run('DELETE FROM examples WHERE id = ?', [req.params.id]);

    broadcast('example:delete', { id: req.params.id, request_id: example?.request_id });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
