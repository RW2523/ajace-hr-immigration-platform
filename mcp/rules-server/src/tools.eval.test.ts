/**
 * rules-server evaluations: read-only queries return counsel-pending state and the
 * validator composes correctly. (Reference data is global-read; the security focus
 * here is that unratified values are ALWAYS flagged, §14.)
 */
import { afterAll, describe, expect, it } from 'vitest';
import { serviceClient } from '@hr/db';
import { rulesGet, rulesListEffective, rulesValidate } from './tools.js';

const sql = serviceClient();
afterAll(async () => { await sql.end(); });

describe('rules-server tools', () => {
  it('rules_get returns active f1_opt rules flagged counsel-pending', async () => {
    const r = await rulesGet(sql, { status_or_transition_key: 'f1_opt', as_of: '2026-07-06' });
    expect(r.rules.length).toBeGreaterThan(0);
    expect(r.any_counsel_pending).toBe(true);
    expect(r.rules.every((x) => x.confirmed_by_counsel === false)).toBe(true);
  });

  it('rules_validate_case reports findings and counsel-pending', async () => {
    const r = await rulesValidate(sql, { current_status: 'f1_opt', unemployment_days_used: 200, as_of: '2026-07-06' });
    expect(r.counsel_pending).toBe(true);
    expect(r.findings.some((f) => f.code === 'opt_unemployment' && f.severity === 'violation')).toBe(true);
  });

  it('rules_list_effective summarizes confirmed vs pending', async () => {
    const r = await rulesListEffective(sql, { as_of: '2026-07-06' });
    expect(r.count).toBeGreaterThan(100);
    expect(r.counsel_pending).toBe(r.count - r.counsel_confirmed);
    // All seed is unratified → everything pending.
    expect(r.counsel_confirmed).toBe(0);
  });
});
