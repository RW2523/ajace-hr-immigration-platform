/**
 * rules-server — MCP server for versioned rules/validator queries (§11.1).
 * Read-only tools; the caller identity is still resolved server-side so access is
 * gated to authenticated users, and every result carries counsel-confirmation state.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { serviceClient } from '@hr/db';
import { resolvePrincipal, guard, ok } from '@hr/mcp-shared';
import {
  rulesGet,
  rulesGetInput,
  rulesListEffective,
  rulesListEffectiveInput,
  rulesValidate,
  rulesValidateInput,
} from './tools.js';

export function buildServer(sql = serviceClient(), getUserId: () => string | undefined = () => process.env.MCP_USER_ID) {
  const server = new McpServer({ name: 'rules-server', version: '0.1.0' });

  async function requireIdentity() {
    const uid = getUserId();
    if (!uid) throw new Error('no authenticated identity on the MCP session');
    const p = await resolvePrincipal(sql, uid);
    if (!p) throw new Error('identity not found');
    return p;
  }

  server.registerTool(
    'rules_get',
    {
      description:
        'Get the active versioned rules for a status or transition key, as of a date. Every rule includes its counsel-confirmation state and citation. Reference data — not legal advice.',
      inputSchema: rulesGetInput.shape,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => guard(async () => { await requireIdentity(); return ok(await rulesGet(sql, args)); }),
  );

  server.registerTool(
    'rules_validate_case',
    {
      description:
        'Validate a case snapshot against the versioned rules: eligible transitions and deadline/limit findings. Flags counsel-pending values. Does not make legal determinations.',
      inputSchema: rulesValidateInput.shape,
      annotations: { readOnlyHint: true },
    },
    async (args) => guard(async () => { await requireIdentity(); return ok(await rulesValidate(sql, args)); }),
  );

  server.registerTool(
    'rules_list_effective',
    {
      description: 'Summarize the rules currently in effect as of a date, including how many are counsel-confirmed vs pending.',
      inputSchema: rulesListEffectiveInput.shape,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => guard(async () => { await requireIdentity(); return ok(await rulesListEffective(sql, args)); }),
  );

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = buildServer();
  server.connect(new StdioServerTransport()).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
