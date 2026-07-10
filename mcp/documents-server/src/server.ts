/**
 * documents-server — MCP server for role-scoped document access (§11.1).
 * Signed time-limited URLs only; sensitive-document downloads are audited.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { serviceClient } from '@hr/db';
import { PgAuditSink } from '@hr/hr';
import { resolvePrincipal, guard, ok, err } from '@hr/mcp-shared';
import {
  docsCheckRequirements,
  docsCheckReqInput,
  docsGetSignedUrl,
  docsSignedUrlInput,
  docsListForCase,
  docsListInput,
  docsRequestUpload,
  docsRequestUploadInput,
} from './tools.js';

export function buildServer(sql = serviceClient(), getUserId: () => string | undefined = () => process.env.MCP_USER_ID) {
  const server = new McpServer({ name: 'documents-server', version: '0.1.0' });
  const audit = new PgAuditSink(sql);

  async function requireIdentity() {
    const uid = getUserId();
    if (!uid) throw new Error('no authenticated identity on the MCP session');
    const p = await resolvePrincipal(sql, uid);
    if (!p) throw new Error('identity not found');
    return p;
  }

  server.registerTool(
    'docs_list_for_case',
    {
      description: 'List documents attached to a case. Sensitive documents (I-9, passport) appear only to callers with sensitive-PII access.',
      inputSchema: docsListInput.shape,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => guard(async () => ok(await docsListForCase(sql, await requireIdentity(), args))),
  );

  server.registerTool(
    'docs_get_signed_url',
    {
      description: 'Mint a signed, time-limited download URL for a document. Sensitive downloads are audited. No permanent links.',
      inputSchema: docsSignedUrlInput.shape,
      annotations: { readOnlyHint: true, idempotentHint: false },
    },
    async (args) => guard(async () => ok(await docsGetSignedUrl(sql, audit, await requireIdentity(), Date.now(), args))),
  );

  server.registerTool(
    'docs_request_upload',
    {
      description: 'Create an upload slot for a required document on a case; returns the storage key and expected uploader.',
      inputSchema: docsRequestUploadInput.shape,
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async (args) => guard(async () => {
      const r = await docsRequestUpload(sql, await requireIdentity(), args);
      return r.ok ? ok(r) : err(r.error ?? 'failed');
    }),
  );

  server.registerTool(
    'docs_check_requirements',
    {
      description: 'List required documents for a case\'s current status and which are still missing (adaptive intake).',
      inputSchema: docsCheckReqInput.shape,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => guard(async () => ok(await docsCheckRequirements(sql, await requireIdentity(), args))),
  );

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildServer().connect(new StdioServerTransport()).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
