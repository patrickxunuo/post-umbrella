import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { initDb } from './db.js';

import authRouter, { authMiddleware } from './routes/auth.js';
import collectionsRouter from './routes/collections.js';
import requestsRouter from './routes/requests.js';
import examplesRouter from './routes/examples.js';
import proxyRouter from './routes/proxy.js';
import syncRouter from './routes/sync.js';
import environmentsRouter from './routes/environments.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Store connected clients
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('Client connected. Total clients:', clients.size);

  ws.on('close', () => {
    clients.delete(ws);
    console.log('Client disconnected. Total clients:', clients.size);
  });
});

// Broadcast function to notify all clients
export function broadcast(event, data) {
  const message = JSON.stringify({ event, data });
  clients.forEach((client) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(message);
    }
  });
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Public routes (no auth required)
app.use('/api/auth', authRouter);

// Protected routes (auth required)
app.use('/api/collections', authMiddleware, collectionsRouter);
app.use('/api/requests', authMiddleware, requestsRouter);
app.use('/api/examples', authMiddleware, examplesRouter);
app.use('/api/proxy', authMiddleware, proxyRouter);
app.use('/api/sync', authMiddleware, syncRouter);
app.use('/api/environments', authMiddleware, environmentsRouter);

const PORT = process.env.PORT || 3001;

// Initialize database before starting server
initDb().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`WebSocket server running on ws://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
