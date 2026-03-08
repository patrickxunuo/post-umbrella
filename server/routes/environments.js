import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { all, get, run } from '../db.js';
import { broadcast } from '../index.js';

const router = Router();

// Get environments for a specific collection
router.get('/collection/:collectionId', async (req, res) => {
  try {
    const { collectionId } = req.params;

    const environments = await all(
      `SELECT e.id, e.name, e.variables, e.collection_id, e.created_by, e.updated_by, e.created_at, e.updated_at, u.email as created_by_email
       FROM environments e
       LEFT JOIN users u ON e.created_by = u.id
       WHERE e.collection_id = ?
       ORDER BY e.name ASC`,
      [collectionId]
    );

    // Get active environment for current user + collection
    let activeEnv = null;
    try {
      activeEnv = await get(
        'SELECT `environment_id` FROM `user_active_environment` WHERE `user_id` = ? AND `collection_id` = ?',
        [req.user.id, collectionId]
      );
    } catch (err) {
      console.error('Error fetching active env:', err.message);
    }

    res.json(environments.map(e => ({
      ...e,
      variables: JSON.parse(e.variables || '[]'),
      is_active: activeEnv?.environment_id === e.id ? 1 : 0,
    })));
  } catch (error) {
    console.error('Error in GET /environments/collection/:id:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get active environment for current user + collection
router.get('/active/:collectionId', async (req, res) => {
  try {
    const { collectionId } = req.params;

    const activeEnv = await get(
      `SELECT e.id, e.name, e.variables, e.collection_id, e.created_by, e.updated_by, e.created_at, e.updated_at, u.email as created_by_email
       FROM user_active_environment uae
       JOIN environments e ON uae.environment_id = e.id
       LEFT JOIN users u ON e.created_by = u.id
       WHERE uae.user_id = ? AND uae.collection_id = ?`,
      [req.user.id, collectionId]
    );

    if (!activeEnv) {
      return res.json(null);
    }

    res.json({
      ...activeEnv,
      variables: JSON.parse(activeEnv.variables || '[]'),
      is_active: 1,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create environment for a collection
router.post('/', async (req, res) => {
  try {
    const { name, variables, collection_id } = req.body;

    if (!collection_id) {
      return res.status(400).json({ error: 'collection_id is required' });
    }

    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    await run(
      'INSERT INTO environments (id, name, variables, collection_id, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, name || 'New Environment', JSON.stringify(variables || []), collection_id, req.user.id, req.user.id, now, now]
    );

    const env = await get(
      `SELECT e.id, e.name, e.variables, e.collection_id, e.created_by, e.updated_by, e.created_at, e.updated_at, u.email as created_by_email
       FROM environments e
       LEFT JOIN users u ON e.created_by = u.id
       WHERE e.id = ?`,
      [id]
    );

    broadcast('environment:create', {
      ...env,
      variables: JSON.parse(env.variables || '[]'),
    });

    res.status(201).json({
      ...env,
      variables: JSON.parse(env.variables || '[]'),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update environment
router.put('/:id', async (req, res) => {
  try {
    const { name, variables } = req.body;
    const now = Math.floor(Date.now() / 1000);

    const existing = await get(
      'SELECT * FROM environments WHERE id = ?',
      [req.params.id]
    );

    if (!existing) {
      return res.status(404).json({ error: 'Environment not found' });
    }

    await run(
      'UPDATE environments SET name = ?, variables = ?, updated_by = ?, updated_at = ? WHERE id = ?',
      [
        name ?? existing.name,
        variables ? JSON.stringify(variables) : existing.variables,
        req.user.id,
        now,
        req.params.id
      ]
    );

    const env = await get(
      `SELECT e.id, e.name, e.variables, e.collection_id, e.created_by, e.updated_by, e.created_at, e.updated_at, u.email as created_by_email
       FROM environments e
       LEFT JOIN users u ON e.created_by = u.id
       WHERE e.id = ?`,
      [req.params.id]
    );

    broadcast('environment:update', {
      ...env,
      variables: JSON.parse(env.variables || '[]'),
    });

    res.json({
      ...env,
      variables: JSON.parse(env.variables || '[]'),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Set active environment for current user + collection
router.put('/:id/activate', async (req, res) => {
  try {
    const env = await get(
      'SELECT * FROM environments WHERE id = ?',
      [req.params.id]
    );

    if (!env) {
      return res.status(404).json({ error: 'Environment not found' });
    }

    const collectionId = env.collection_id;

    if (!collectionId) {
      return res.status(400).json({ error: 'Environment has no collection_id' });
    }

    // Upsert active environment for this user + collection
    await run(
      `INSERT INTO user_active_environment (user_id, collection_id, environment_id)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE environment_id = ?`,
      [req.user.id, collectionId, req.params.id, req.params.id]
    );

    const updated = await get(
      `SELECT e.id, e.name, e.variables, e.collection_id, e.created_by, e.updated_by, e.created_at, e.updated_at, u.email as created_by_email
       FROM environments e
       LEFT JOIN users u ON e.created_by = u.id
       WHERE e.id = ?`,
      [req.params.id]
    );

    broadcast('environment:activate', {
      ...updated,
      variables: JSON.parse(updated.variables || '[]'),
      userId: req.user.id,
      collectionId,
    });

    res.json({
      ...updated,
      variables: JSON.parse(updated.variables || '[]'),
      is_active: 1,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Deactivate environment for current user + collection
router.post('/deactivate/:collectionId', async (req, res) => {
  try {
    const { collectionId } = req.params;

    await run(
      'DELETE FROM user_active_environment WHERE user_id = ? AND collection_id = ?',
      [req.user.id, collectionId]
    );

    broadcast('environment:deactivate', { userId: req.user.id, collectionId });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete environment
router.delete('/:id', async (req, res) => {
  try {
    const env = await get(
      'SELECT * FROM environments WHERE id = ?',
      [req.params.id]
    );

    if (!env) {
      return res.status(404).json({ error: 'Environment not found' });
    }

    // Remove from any user's active environment
    await run('DELETE FROM user_active_environment WHERE environment_id = ?', [req.params.id]);

    // Delete the environment
    await run('DELETE FROM environments WHERE id = ?', [req.params.id]);

    broadcast('environment:delete', { id: req.params.id, collectionId: env.collection_id });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
