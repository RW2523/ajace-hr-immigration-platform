/**
 * rag-server — MCP server for access-scoped help-desk retrieval (§11.1, §10).
 * Retrieval is filtered by the caller's permissions server-side; generation is
 * guarded so the assistant never emits immigration legal advice (§14).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { serviceClient } from '@hr/db';
import { resolvePrincipal, guard, ok } from '@hr/mcp-shared';
import { ragAnswer, ragAnswerInput, ragSearch, ragSearchInput } from './tools.js';

export function buildServer(sql = serviceClient(), getUserId: () => string | undefined = () => process.env.MCP_USER_ID) {
  const server = new McpServer({ name: 'rag-server', version: '0.1.0' });

  async function requireIdentity() {
    const uid = getUserId();
    if (!uid) throw new Error('no authenticated identity on the MCP session');
    const p = await resolvePrincipal(sql, uid);
    if (!p) throw new Error('identity not found');
    return p;
  }

  server.registerTool(
    'rag_search',
    {
      description: 'Access-scoped semantic search over policies and the caller\'s own case documents. Returns only content the caller is permitted to see.',
      inputSchema: ragSearchInput.shape,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => guard(async () => ok(await ragSearch(sql, await requireIdentity(), args))),
  );

  server.registerTool(
    'rag_answer',
    {
      description: 'Answer a help-desk question using access-scoped retrieval. Tracks status/deadlines/policy; routes any legal-judgment question to counsel and never gives legal advice.',
      inputSchema: ragAnswerInput.shape,
      annotations: { readOnlyHint: true, idempotentHint: false },
    },
    async (args) => guard(async () => ok(await ragAnswer(sql, await requireIdentity(), args))),
  );

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildServer().connect(new StdioServerTransport()).catch((e) => { console.error(e); process.exit(1); });
}
