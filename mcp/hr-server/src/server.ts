/**
 * hr-server — MCP server for role-scoped HR lifecycle actions (§11.1).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { serviceClient } from '@hr/db';
import { resolvePrincipal, guard, ok, err } from '@hr/mcp-shared';
import {
  hrCreateLeaveRequest,
  hrLeaveInput,
  hrGenerateOfferLetter,
  hrOfferInput,
  hrGetOnboardingStatus,
  hrOnboardingInput,
  hrGetReviewCycle,
  hrReviewInput,
  hrListPendingI9,
  hrPendingI9Input,
} from './tools.js';

export function buildServer(sql = serviceClient(), getUserId: () => string | undefined = () => process.env.MCP_USER_ID) {
  const server = new McpServer({ name: 'hr-server', version: '0.1.0' });

  async function requireIdentity() {
    const uid = getUserId();
    if (!uid) throw new Error('no authenticated identity on the MCP session');
    const p = await resolvePrincipal(sql, uid);
    if (!p) throw new Error('identity not found');
    return p;
  }

  server.registerTool(
    'hr_get_onboarding_status',
    { description: 'Get the onboarding checklist for an employee, including adaptive immigration document items.', inputSchema: hrOnboardingInput.shape, annotations: { readOnlyHint: true } },
    async (args) => guard(async () => ok(await hrGetOnboardingStatus(sql, await requireIdentity(), args))),
  );
  server.registerTool(
    'hr_create_leave_request',
    { description: 'Create a leave request for an employee.', inputSchema: hrLeaveInput.shape, annotations: { readOnlyHint: false, idempotentHint: false } },
    async (args) => guard(async () => { const r = await hrCreateLeaveRequest(sql, await requireIdentity(), args); return r.ok ? ok(r) : err(r.error ?? 'failed'); }),
  );
  server.registerTool(
    'hr_get_review_cycle',
    { description: 'Get performance review cycles for an employee.', inputSchema: hrReviewInput.shape, annotations: { readOnlyHint: true, idempotentHint: true } },
    async (args) => guard(async () => ok(await hrGetReviewCycle(sql, await requireIdentity(), args))),
  );
  server.registerTool(
    'hr_list_pending_i9',
    { description: 'List employees with an incomplete I-9 Section 2 or missing E-Verify case, scoped to the caller. Requires sensitive-PII access.', inputSchema: hrPendingI9Input.shape, annotations: { readOnlyHint: true, idempotentHint: true } },
    async (args) => guard(async () => ok(await hrListPendingI9(sql, await requireIdentity(), args))),
  );
  server.registerTool(
    'hr_generate_offer_letter',
    { description: 'Generate an offer letter for an employee from a template and variables.', inputSchema: hrOfferInput.shape, annotations: { readOnlyHint: false, idempotentHint: false } },
    async (args) => guard(async () => { const r = await hrGenerateOfferLetter(sql, await requireIdentity(), args); return r.ok ? ok(r) : err(r.error ?? 'failed'); }),
  );

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildServer().connect(new StdioServerTransport()).catch((e) => { console.error(e); process.exit(1); });
}
