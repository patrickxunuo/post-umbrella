import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { get, run } from '../db.js';

const router = Router();

// Session duration: 30 days
const SESSION_DURATION = 30 * 24 * 60 * 60;

// Optional email domain restriction from env
const EMAIL_DOMAIN = process.env.EMAIL_DOMAIN || '';

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate email domain if restriction is set
    if (EMAIL_DOMAIN && (!email || !email.toLowerCase().endsWith(EMAIL_DOMAIN))) {
      return res.status(401).json({ error: `Email must end with ${EMAIL_DOMAIN}` });
    }

    // Validate password is 7777
    if (password !== '7777') {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const normalizedEmail = email.toLowerCase();

    // Check if user exists
    let user = await get('SELECT * FROM users WHERE email = ?', [normalizedEmail]);

    // Create user if doesn't exist
    if (!user) {
      const userId = uuidv4();
      await run(
        'INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)',
        [userId, normalizedEmail, Math.floor(Date.now() / 1000)]
      );
      user = await get('SELECT * FROM users WHERE id = ?', [userId]);
    }

    // Generate session token and store in database
    const token = uuidv4();
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + SESSION_DURATION;

    await run(
      'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      [token, user.id, now, expiresAt]
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Logout
router.post('/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      await run('DELETE FROM sessions WHERE token = ?', [token]);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get current user (verify token)
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const now = Math.floor(Date.now() / 1000);

    // Find session and check expiry
    const session = await get(
      'SELECT s.*, u.email FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > ?',
      [token, now]
    );

    if (!session) {
      return res.status(401).json({ error: 'Session expired or invalid' });
    }

    res.json({
      id: session.user_id,
      email: session.email,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Auth middleware
export async function authMiddleware(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const now = Math.floor(Date.now() / 1000);

    // Find session and check expiry
    const session = await get(
      'SELECT s.*, u.email FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > ?',
      [token, now]
    );

    if (!session) {
      return res.status(401).json({ error: 'Session expired or invalid' });
    }

    req.user = {
      id: session.user_id,
      email: session.email,
    };
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export default router;
