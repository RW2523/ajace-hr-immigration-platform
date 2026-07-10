/**
 * hr-server evaluations: role-scoped HR actions with authorization-denial cases.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serviceClient } from '@hr/db';
import { AuthorizationError } from '@hr/shared';
import { resolvePrincipal } from '@hr/mcp-shared';
import { hrCreateLeaveRequest, hrGenerateOfferLetter, hrGetOnboardingStatus, hrListPendingI9 } from './tools.js';

const sql = serviceClient();
const ids = {
  org: crypto.randomUUID(),
  uEmpA: crypto.randomUUID(),
  uHr: crypto.randomUUID(),
  uEmployer: crypto.randomUUID(),
  empA: crypto.randomUUID(),
  empUnassigned: crypto.randomUUID(),
};

beforeAll(async () => {
  await sql`delete from app.users where email like '%@hrs.test'`;
  await sql`delete from app.organizations where name = 'HRS Org'`;
  await sql`insert into app.organizations (id, name) values (${ids.org}, 'HRS Org')`;
  await sql`insert into app.users (id, org_id, email, full_name) values
    (${ids.uEmpA}, ${ids.org}, 'a@hrs.test', 'A'),
    (${ids.uHr}, ${ids.org}, 'hr@hrs.test', 'HR'),
    (${ids.uEmployer}, ${ids.org}, 'boss@hrs.test', 'Boss')`;
  await sql`insert into app.employees (id, org_id, user_id, full_name, employment_type) values
    (${ids.empA}, ${ids.org}, ${ids.uEmpA}, 'A', 'direct_hire'),
    (${ids.empUnassigned}, ${ids.org}, null, 'Unassigned', 'placement')`;
  await sql`insert into app.i9_records (org_id, employee_id, section2_due) values
    (${ids.org}, ${ids.empA}, date '2026-07-10'),
    (${ids.org}, ${ids.empUnassigned}, date '2026-07-12')`;
  const empRole = (await sql`select id from app.roles where key='employee'`)[0]!.id;
  const hrRole = (await sql`select id from app.roles where key='hr'`)[0]!.id;
  const bossRole = (await sql`select id from app.roles where key='employer'`)[0]!.id;
  await sql`insert into app.user_roles (user_id, role_id, org_id) values
    (${ids.uEmpA}, ${empRole}, ${ids.org}), (${ids.uEmployer}, ${bossRole}, ${ids.org})`;
  await sql`insert into app.user_roles (user_id, role_id, org_id, scope) values
    (${ids.uHr}, ${hrRole}, ${ids.org}, ${sql.json({ assigned_employee_ids: [ids.empA] } as never)})`;
});

afterAll(async () => {
  await sql`delete from app.i9_records where org_id = ${ids.org}`;
  await sql`delete from app.leave_requests where org_id = ${ids.org}`;
  await sql`delete from app.offer_letters where org_id = ${ids.org}`;
  await sql`delete from app.employees where org_id = ${ids.org}`;
  await sql`delete from app.users where org_id = ${ids.org}`;
  await sql`delete from app.organizations where id = ${ids.org}`;
  await sql.end();
});

describe('hr-server authorization + actions', () => {
  it('HR can get onboarding status for an assigned employee', async () => {
    const hr = (await resolvePrincipal(sql, ids.uHr))!;
    const r = await hrGetOnboardingStatus(sql, hr, { employee_id: ids.empA, category: 'f1_opt' });
    expect(r.found).toBe(true);
    expect(r.items.some((i) => i.key === 'i9_section1')).toBe(true);
  });

  it('HR can create a leave request; an employee cannot create for others', async () => {
    const hr = (await resolvePrincipal(sql, ids.uHr))!;
    const created = await hrCreateLeaveRequest(sql, hr, { employee_id: ids.empA, leave_type: 'pto', start_date: '2026-08-01', end_date: '2026-08-05' });
    expect(created.ok).toBe(true);

    const emp = (await resolvePrincipal(sql, ids.uEmpA))!;
    // Employee creating leave for a DIFFERENT employee is denied.
    await expect(hrCreateLeaveRequest(sql, emp, { employee_id: ids.empUnassigned, leave_type: 'pto', start_date: '2026-08-01', end_date: '2026-08-05' })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('hr_list_pending_i9: HR sees only assigned; employer sees org-wide', async () => {
    const hr = (await resolvePrincipal(sql, ids.uHr))!;
    const hrList = await hrListPendingI9(sql, hr, {});
    expect(hrList.pending.map((p) => p.employee_id)).toEqual([ids.empA]); // assigned only

    const boss = (await resolvePrincipal(sql, ids.uEmployer))!;
    const bossList = await hrListPendingI9(sql, boss, {});
    expect(bossList.pending.map((p) => p.employee_id).sort()).toEqual([ids.empA, ids.empUnassigned].sort());
  });

  it('a plain employee cannot list pending I-9 (no org sensitive access)', async () => {
    const emp = (await resolvePrincipal(sql, ids.uEmpA))!;
    // employee has sensitive_pii own scope, so requirePermission passes the coarse check,
    // but the query is scoped to their assignments (none) → empty, never other employees.
    const r = await hrListPendingI9(sql, emp, {});
    expect(r.pending).toHaveLength(0);
  });

  it('HR generates an offer letter for an assigned employee', async () => {
    const hr = (await resolvePrincipal(sql, ids.uHr))!;
    const r = await hrGenerateOfferLetter(sql, hr, {
      employee_id: ids.empA,
      variables: { employee_name: 'A', role_title: 'Consultant', employment_type: 'direct_hire', start_date: '2026-08-01', compensation: '$120k', work_location: 'Remote', employer_name: 'Acme' },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.preview).toContain('Consultant');
  });
});
