import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { all, get, run } from '../db.js';
import { broadcast } from '../index.js';

const router = Router();

// Get all collections with their requests
router.get('/', async (req, res) => {
  try {
    const collections = await all('SELECT * FROM collections ORDER BY created_at ASC');
    const requests = await all('SELECT * FROM requests ORDER BY created_at ASC');

    // Get example counts for all requests
    const exampleCounts = await all(`
      SELECT request_id, COUNT(*) as count
      FROM examples
      GROUP BY request_id
    `);
    const countMap = {};
    exampleCounts.forEach(ec => {
      countMap[ec.request_id] = ec.count;
    });

    // Build tree structure
    const collectionsWithRequests = collections.map(col => ({
      ...col,
      requests: requests.filter(r => r.collection_id === col.id).map(r => ({
        ...r,
        headers: JSON.parse(r.headers || '[]'),
        example_count: countMap[r.id] || 0,
      })),
    }));

    res.json(collectionsWithRequests);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single collection
router.get('/:id', async (req, res) => {
  try {
    const collection = await get('SELECT * FROM collections WHERE id = ?', [req.params.id]);
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }
    res.json(collection);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create collection
router.post('/', async (req, res) => {
  try {
    const { name, parent_id } = req.body;
    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    await run(
      'INSERT INTO collections (id, name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [id, name || 'New Collection', parent_id || null, now, now]
    );

    const collection = await get('SELECT * FROM collections WHERE id = ?', [id]);

    broadcast('collection:create', collection);
    res.status(201).json(collection);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update collection
router.put('/:id', async (req, res) => {
  try {
    const { name, parent_id } = req.body;
    const now = Math.floor(Date.now() / 1000);

    await run(
      'UPDATE collections SET name = ?, parent_id = ?, updated_at = ? WHERE id = ?',
      [name, parent_id, now, req.params.id]
    );

    const collection = await get('SELECT * FROM collections WHERE id = ?', [req.params.id]);

    broadcast('collection:update', collection);
    res.json(collection);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Recursively delete a collection and all its children
async function deleteCollectionRecursive(collectionId) {
  // Find child collections
  const childCollections = await all('SELECT id FROM collections WHERE parent_id = ?', [collectionId]);

  // Recursively delete children first
  for (const child of childCollections) {
    await deleteCollectionRecursive(child.id);
  }

  // Delete examples for requests in this collection
  const requests = await all('SELECT id FROM requests WHERE collection_id = ?', [collectionId]);
  for (const r of requests) {
    await run('DELETE FROM examples WHERE request_id = ?', [r.id]);
  }

  // Delete requests
  await run('DELETE FROM requests WHERE collection_id = ?', [collectionId]);

  // Delete collection
  await run('DELETE FROM collections WHERE id = ?', [collectionId]);
}

// Delete collection
router.delete('/:id', async (req, res) => {
  try {
    await deleteCollectionRecursive(req.params.id);

    broadcast('collection:delete', { id: req.params.id });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
