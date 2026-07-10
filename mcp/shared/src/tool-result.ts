/**
 * Shared MCP tool-result helpers. Errors are actionable and never leak data the
 * caller isn't authorized to see (§11.2).
 */
import { AuthorizationError } from '@hr/shared';

export interface ToolTextResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  // MCP SDK CallToolResult permits arbitrary extra keys.
  [k: string]: unknown;
}

export function ok(structured: unknown, summary?: string): ToolTextResult {
  return {
    content: [{ type: 'text', text: summary ?? JSON.stringify(structured, null, 2) }],
    structuredContent: structured as Record<string, unknown>,
  };
}

export function err(message: string): ToolTextResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Wrap a tool handler so authorization failures become clean, non-leaky errors. */
export async function guard(fn: () => Promise<ToolTextResult>): Promise<ToolTextResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AuthorizationError) {
      return err(`Not authorized to ${e.request.action} ${e.request.resource}.`);
    }
    return err(`Tool error: ${(e as Error).message}`);
  }
}
