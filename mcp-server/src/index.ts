import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { authRouter } from './auth/routes.js';
import { getAuthenticatedClient } from './lib/supabase.js';
import { registerWorkspaceTools } from './tools/workspaces.js';
import { registerCollectionTools } from './tools/collections.js';
import { registerRequestTools } from './tools/requests.js';
import { registerExampleTools } from './tools/examples.js';
import { registerSearchTools } from './tools/search.js';
import { registerEnvironmentLookupTools } from './tools/environmentLookup.js';
import type { SupabaseClient } from '@supabase/supabase-js';

const PORT = parseInt(process.env.PORT || '3100');
const BASE_URL = process.env.MCP_BASE_URL || `http://localhost:${PORT}`;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../../public');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(publicDir));

// Auth routes (OAuth discovery, authorize, token)
app.use(authRouter);

// Session management: maps MCP session ID → { server, transport, supabaseClient }
interface McpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  client: SupabaseClient;
}

const mcpSessions = new Map<string, McpSession>();

function createMcpServer(client: SupabaseClient): McpServer {
  const server = new McpServer({
    name: 'Post Umbrella',
    version: '1.0.0',
  });

  const getClient = () => client;

  registerWorkspaceTools(server, getClient);
  registerCollectionTools(server, getClient);
  registerRequestTools(server, getClient);
  registerExampleTools(server, getClient);
  registerSearchTools(server, getClient);
  registerEnvironmentLookupTools(server, getClient);

  return server;
}

// Extract Bearer token from Authorization header
function extractToken(req: express.Request): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  return auth.slice(7);
}

// MCP endpoint — Streamable HTTP transport
app.post('/mcp', async (req: express.Request, res: express.Response) => {
  const token = extractToken(req);

  // No token → 401 with resource metadata pointer
  if (!token) {
    res.status(401).set({
      'WWW-Authenticate': `Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`,
    }).json({ error: 'Authentication required' });
    return;
  }

  // Validate token and get Supabase client
  const authResult = await getAuthenticatedClient(token);
  if (!authResult) {
    res.status(401).set({
      'WWW-Authenticate': `Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`,
    }).json({ error: 'Invalid or expired token' });
    return;
  }

  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  // Existing session
  if (sessionId && mcpSessions.has(sessionId)) {
    const session = mcpSessions.get(sessionId)!;
    await session.transport.handleRequest(req, res, req.body);
    return;
  }

  // New session
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (newSessionId) => {
      const server = mcpSessions.get('__pending__');
      if (server) {
        mcpSessions.delete('__pending__');
        mcpSessions.set(newSessionId, server);
      }
    },
  });

  const server = createMcpServer(authResult.client);

  // Store temporarily until session ID is assigned
  mcpSessions.set('__pending__', { server, transport, client: authResult.client });

  transport.onclose = () => {
    const sid = [...mcpSessions.entries()].find(([, v]) => v.transport === transport)?.[0];
    if (sid) mcpSessions.delete(sid);
  };

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// SSE endpoint for server-initiated messages
app.get('/mcp', async (req: express.Request, res: express.Response) => {
  const token = extractToken(req);
  if (!token) {
    res.status(401).set({
      'WWW-Authenticate': `Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`,
    }).json({ error: 'Authentication required' });
    return;
  }

  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !mcpSessions.has(sessionId)) {
    res.status(400).json({ error: 'Invalid or missing session ID' });
    return;
  }

  const session = mcpSessions.get(sessionId)!;
  await session.transport.handleRequest(req, res);
});

// Session termination
app.delete('/mcp', async (req: express.Request, res: express.Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (sessionId && mcpSessions.has(sessionId)) {
    const session = mcpSessions.get(sessionId)!;
    await session.transport.close();
    mcpSessions.delete(sessionId);
  }
  res.status(202).send();
});

app.listen(PORT, () => {
  console.error(`Post Umbrella MCP server running on ${BASE_URL}`);
  console.error(`OAuth metadata: ${BASE_URL}/.well-known/oauth-authorization-server`);
  console.error(`MCP endpoint: ${BASE_URL}/mcp`);
});
