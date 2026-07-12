import { describe, expect, it } from 'vitest';
import { AuthorizationError } from '@hr/shared';
import { ok, err, guard } from './tool-result.js';

describe('MCP tool-result helpers', () => {
  it('ok() carries structured content and a text summary', () => {
    const r = ok({ a: 1 }, 'done');
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toEqual({ a: 1 });
    expect(r.content[0]!.text).toBe('done');
  });

  it('err() marks the result as an error', () => {
    const r = err('nope');
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toBe('nope');
  });

  it('guard() turns an AuthorizationError into a clean, non-leaky error', async () => {
    const r = await guard(async () => {
      throw new AuthorizationError({ resource: 'sensitive_pii', action: 'read' }, 'secret internal reason');
    });
    expect(r.isError).toBe(true);
    // The internal reason must NOT leak; only the action/resource is surfaced.
    expect(r.content[0]!.text).toBe('Not authorized to read sensitive_pii.');
    expect(r.content[0]!.text).not.toContain('secret internal reason');
  });

  it('guard() passes through a successful result', async () => {
    const r = await guard(async () => ok({ ok: true }, 'yes'));
    expect(r.isError).toBeUndefined();
    expect(r.content[0]!.text).toBe('yes');
  });
});
