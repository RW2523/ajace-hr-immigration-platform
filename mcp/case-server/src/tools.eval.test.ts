/**
 * case-server evaluations (§11.2, mcp-builder eval guide). The critical checks are
 * the AUTHORIZATION-DENIAL cases: every tool must authorize inside itself and never
 * return data the caller isn't permitted to see, regardless of arguments passed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serviceClient } from '@hr/db';
import { AuthorizationError } from '@hr/shared';
import { resolvePrincipal } from '@hr/mcp-shared';
import {
  caseCheckEligibility,
  caseGetStatus,
  caseListDeadlines,
  caseRecordTransition,
} from './tools.js';

const sql = serviceClient();
const ids = {
  org: crypto.randomUUID(),
  uEmpA: crypto.randomUUID(),
  uEmpB: crypto.randomUUID(),
  uHr: crypto.randomUUID(),
  empA: crypto.randomUUID(),
  empB: crypto.randomUUID(),
  caseA: crypto.randomUUID(),
};

beforeAll(async () => {
  await sql`delete from app.users where email like '%@mcp.test'`;
  await sql`delete from app.organizations where name = 'MCP Org'`;
  await sql`insert into app.organizations (id, name) values (${ids.org}, 'MCP Org')`;
  await sql`insert into app.users (id, org_id, email, full_name) values
    (${ids.uEmpA}, ${ids.org}, 'a@mcp.test', 'A'),
    (${ids.uEmpB}, ${ids.org}, 'b@mcp.test', 'B'),
    (${ids.uHr}, ${ids.org}, 'hr@mcp.test', 'HR')`;
  await sql`insert into app.employees (id, org_id, user_id, full_name, employment_type) values
    (${ids.empA}, ${ids.org}, ${ids.uEmpA}, 'A', 'direct_hire'),
    (${ids.empB}, ${ids.org}, ${ids.uEmpB}, 'B', 'direct_hire')`;
  await sql`insert into app.immigration_cases (id, org_id, employee_id, current_status)
    values (${ids.caseA}, ${ids.org}, ${ids.empA}, 'h1b_active')`;
  await sql`insert into app.case_dates (org_id, case_id, date_type, value)
    values (${ids.org}, ${ids.caseA}, 'h1b_validity_expiry', date '2027-01-01')`;
  const hrRole = (await sql`select id from app.roles where key='hr'`)[0]!.id;
  const empRole = (await sql`select id from app.roles where key='employee'`)[0]!.id;
  await sql`insert into app.user_roles (user_id, role_id, org_id) values
    (${ids.uEmpA}, ${empRole}, ${ids.org}), (${ids.uEmpB}, ${empRole}, ${ids.org})`;
  await sql`insert into app.user_roles (user_id, role_id, org_id, scope) values
    (${ids.uHr}, ${hrRole}, ${ids.org}, ${sql.json({ assigned_employee_ids: [ids.empA] } as never)})`;
});

afterAll(async () => {
  await sql`delete from app.case_dates where org_id = ${ids.org}`;
  await sql`delete from app.immigration_cases where org_id = ${ids.org}`;
  await sql`delete from app.users where org_id = ${ids.org}`;
  await sql`delete from app.organizations where id = ${ids.org}`;
  await sql.end();
});

describe('case-server tools authorize inside every tool', () => {
  it('employee A reads their own case status', async () => {
    const p = (await resolvePrincipal(sql, ids.uEmpA))!;
    const r = await caseGetStatus(sql, p, { case_id: ids.caseA });
    expect(r.found).toBe(true);
    if (r.found) expect(r.current_status).toBe('h1b_active');
  });

  it('employee B is DENIED reading employee A\'s case (even with the id)', async () => {
    const p = (await resolvePrincipal(sql, ids.uEmpB))!;
    await expect(caseGetStatus(sql, p, { case_id: ids.caseA })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(caseListDeadlines(sql, p, { case_id: ids.caseA })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(caseCheckEligibility(sql, p, { case_id: ids.caseA })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('employee A CANNOT advance their own case (no update grant)', async () => {
    const p = (await resolvePrincipal(sql, ids.uEmpA))!;
    await expect(caseRecordTransition(sql, p, { case_id: ids.caseA, to_status: 'perm_filed' })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('assigned HR CAN read and advance the case', async () => {
    const p = (await resolvePrincipal(sql, ids.uHr))!;
    const status = await caseGetStatus(sql, p, { case_id: ids.caseA });
    expect(status.found).toBe(true);
    const elig = await caseCheckEligibility(sql, p, { case_id: ids.caseA, as_of: '2026-07-06' });
    expect(elig.found).toBe(true);
    if (elig.found) expect(elig.counsel_pending).toBe(true); // seed unratified
    const rec = await caseRecordTransition(sql, p, { case_id: ids.caseA, to_status: 'h1b_extension_pending', filed_on: '2026-07-06' });
    expect(rec.ok).toBe(true);
  });

  it('case_check_transition_eligibility composes rules + dates + docs', async () => {
    const p = (await resolvePrincipal(sql, ids.uHr))!;
    const r = await caseCheckEligibility(sql, p, { case_id: ids.caseA, as_of: '2026-07-06' });
    expect(r.found).toBe(true);
    if (r.found) {
      expect(Array.isArray(r.eligible_transitions)).toBe(true);
      expect(Array.isArray(r.findings)).toBe(true);
    }
  });
});
