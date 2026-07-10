/**
 * case-server — MCP server exposing role-scoped immigration case tools (§11.1).
 * Built with the TypeScript SDK per the mcp-builder skill: zod input schemas,
 * tool annotations (readOnlyHint / destructiveHint), snake_case names with the
 * `case_` prefix, and authorization enforced INSIDE every tool.
 *
 * Transport: stdio for local; swap to streamable HTTP for remote. The caller's
 * verified user id arrives via the transport/session (here read from an env/header
 * shim) and is resolved to a Principal server-side — never a client-supplied role.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { serviceClient } from '@hr/db';
import { resolvePrincipal, guard, ok, err } from '@hr/mcp-shared';
import {
  caseCheckEligibility,
  caseCheckEligibilityInput,
  caseGetStatus,
  caseGetStatusInput,
  caseListDeadlines,
  caseListDeadlinesInput,
  caseListRequiredDocs,
  caseListRequiredDocsInput,
  caseRecordTransition,
  caseRecordTransitionInput,
} from './tools.js';

export function buildServer(sql = serviceClient(), getUserId: () => string | undefined = () => process.env.MCP_USER_ID) {
  const server = new McpServer({ name: 'case-server', version: '0.1.0' });

  async function principalOrThrow() {
    const uid = getUserId();
    if (!uid) throw new Error('no authenticated identity on the MCP session');
    const p = await resolvePrincipal(sql, uid);
    if (!p) throw new Error('identity not found');
    return p;
  }

  server.registerTool(
    'case_get_status',
    {
      description: "Get a case's current work-authorization status. Read-only; returns only cases the caller may see.",
      inputSchema: caseGetStatusInput.shape,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => guard(async () => ok(await caseGetStatus(sql, await principalOrThrow(), args))),
  );

  server.registerTool(
    'case_list_deadlines',
    {
      description: 'List all tracked immigration deadlines for a case, earliest first.',
      inputSchema: caseListDeadlinesInput.shape,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => guard(async () => ok(await caseListDeadlines(sql, await principalOrThrow(), args))),
  );

  server.registerTool(
    'case_check_transition_eligibility',
    {
      description:
        'Evaluate which status transitions the case is eligible for, missing documents, and deadline findings. Composes the versioned rules, case dates, and collected documents. Flags counsel-pending values.',
      inputSchema: caseCheckEligibilityInput.shape,
      annotations: { readOnlyHint: true },
    },
    async (args) => guard(async () => ok(await caseCheckEligibility(sql, await principalOrThrow(), args))),
  );

  server.registerTool(
    'case_list_required_documents',
    {
      description: 'List the documents required for the case\'s current status and which are still missing (adaptive intake).',
      inputSchema: caseListRequiredDocsInput.shape,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => guard(async () => ok(await caseListRequiredDocs(sql, await principalOrThrow(), args))),
  );

  server.registerTool(
    'case_record_transition',
    {
      description:
        'Record a status transition on a case (writes history and advances status). Requires update permission on case internals — employees cannot advance their own case.',
      inputSchema: caseRecordTransitionInput.shape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async (args) => guard(async () => {
      const r = await caseRecordTransition(sql, await principalOrThrow(), args);
      return r.ok ? ok(r) : err(r.error ?? 'failed');
    }),
  );

  return server;
}

// Local stdio entry.
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = buildServer();
  const transport = new StdioServerTransport();
  server.connect(transport).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { z };
