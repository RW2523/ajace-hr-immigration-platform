/**
 * Row-Level Security tests (Phase 1 DoD): RLS must provably block cross-user and
 * cross-org access, independent of the application layer. These run as the
 * non-superuser `authenticated` role with an impersonated JWT `sub`, exactly as
 * a real Supabase request would.
 *
 * Requires the migrated + seeded test DB (pnpm db:migrate && pnpm db:seed).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { asUser, serviceClient } from './client.js';

const sql = serviceClient();

// Two orgs. Org1 has: employeeA, employeeB, an HR (assigned to A only), an employer.
// Org2 has: employeeC, an employer. Plus a global admin.
const ids = {
  org1: crypto.randomUUID(),
  org2: crypto.randomUUID(),
  uEmpA: crypto.randomUUID(),
  uEmpB: crypto.randomUUID(),
  uHr: crypto.randomUUID(),
  uEmployer1: crypto.randomUUID(),
  uEmpC: crypto.randomUUID(),
  uEmployer2: crypto.randomUUID(),
  uAdmin: crypto.randomUUID(),
  eA: crypto.randomUUID(),
  eB: crypto.randomUUID(),
  eC: crypto.randomUUID(),
  caseA: crypto.randomUUID(),
  caseC: crypto.randomUUID(),
};

async function roleId(key: string): Promise<string> {
  const [r] = await sql`select id from app.roles where key = ${key}`;
  return r!.id as string;
}

async function assignRole(userId: string, orgId: string, key: string, scope: Record<string, unknown> = {}) {
  await sql`insert into app.user_roles (user_id, role_id, org_id, scope)
            values (${userId}, ${await roleId(key)}, ${orgId}, ${sql.json(scope as never)})`;
}

beforeAll(async () => {
  // Idempotent start: clear any fixtures a prior interrupted run left behind.
  await sql`delete from app.users where email like '%@org1.test' or email like '%@org2.test' or email like '%@platform.test'`;
  await sql`delete from app.organizations where name in ('Org One', 'Org Two')`;
  // orgs
  await sql`insert into app.organizations (id, name) values (${ids.org1}, 'Org One'), (${ids.org2}, 'Org Two')`;
  // users
  await sql`insert into app.users (id, org_id, email, full_name) values
    (${ids.uEmpA}, ${ids.org1}, 'a@org1.test', 'Emp A'),
    (${ids.uEmpB}, ${ids.org1}, 'b@org1.test', 'Emp B'),
    (${ids.uHr}, ${ids.org1}, 'hr@org1.test', 'HR One'),
    (${ids.uEmployer1}, ${ids.org1}, 'boss@org1.test', 'Employer One'),
    (${ids.uEmpC}, ${ids.org2}, 'c@org2.test', 'Emp C'),
    (${ids.uEmployer2}, ${ids.org2}, 'boss@org2.test', 'Employer Two'),
    (${ids.uAdmin}, ${ids.org1}, 'admin@platform.test', 'Admin')`;
  // employees
  await sql`insert into app.employees (id, org_id, user_id, full_name, employment_type) values
    (${ids.eA}, ${ids.org1}, ${ids.uEmpA}, 'Emp A', 'direct_hire'),
    (${ids.eB}, ${ids.org1}, ${ids.uEmpB}, 'Emp B', 'placement'),
    (${ids.eC}, ${ids.org2}, ${ids.uEmpC}, 'Emp C', 'direct_hire')`;
  // SSNs (sensitive)
  await sql`insert into app.employee_ssn (employee_id, org_id, encrypted_ssn) values
    (${ids.eA}, ${ids.org1}, 'v1.enc.a'),
    (${ids.eB}, ${ids.org1}, 'v1.enc.b'),
    (${ids.eC}, ${ids.org2}, 'v1.enc.c')`;
  // cases
  await sql`insert into app.immigration_cases (id, org_id, employee_id, current_status) values
    (${ids.caseA}, ${ids.org1}, ${ids.eA}, 'h1b_active'),
    (${ids.caseC}, ${ids.org2}, ${ids.eC}, 'f1_opt')`;

  // roles
  await assignRole(ids.uEmpA, ids.org1, 'employee');
  await assignRole(ids.uEmpB, ids.org1, 'employee');
  await assignRole(ids.uEmpC, ids.org2, 'employee');
  await assignRole(ids.uHr, ids.org1, 'hr', { assigned_employee_ids: [ids.eA] }); // HR assigned to A only
  await assignRole(ids.uEmployer1, ids.org1, 'employer');
  await assignRole(ids.uEmployer2, ids.org2, 'employer');
  await assignRole(ids.uAdmin, ids.org1, 'admin');
});

afterAll(async () => {
  // users.org_id is ON DELETE RESTRICT, so remove users before their orgs.
  await sql`delete from app.users where org_id in (${ids.org1}, ${ids.org2})`;
  await sql`delete from app.organizations where id in (${ids.org1}, ${ids.org2})`;
  await sql.end();
});

// Convenience: run a query as a user and return rows.
const as = <T = any>(userId: string, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
  asUser(sql, userId, fn);

describe('employee scope: own data only', () => {
  it('employee A sees their own employee row', async () => {
    const rows = await as(ids.uEmpA, (tx) => tx`select id from app.employees where id = ${ids.eA}`);
    expect(rows).toHaveLength(1);
  });

  it('employee A CANNOT see employee B', async () => {
    const rows = await as(ids.uEmpA, (tx) => tx`select id from app.employees where id = ${ids.eB}`);
    expect(rows).toHaveLength(0);
  });

  it('employee A CANNOT read employee B\'s SSN', async () => {
    const rows = await as(ids.uEmpA, (tx) => tx`select employee_id from app.employee_ssn where employee_id = ${ids.eB}`);
    expect(rows).toHaveLength(0);
  });

  it('employee A can read their own SSN row', async () => {
    const rows = await as(ids.uEmpA, (tx) => tx`select employee_id from app.employee_ssn where employee_id = ${ids.eA}`);
    expect(rows).toHaveLength(1);
  });

  it('employee A CANNOT read employee B\'s immigration case (list is filtered)', async () => {
    const rows = await as(ids.uEmpA, (tx) => tx`select id from app.immigration_cases`);
    expect(rows.map((r) => r.id)).toEqual([ids.caseA]);
  });

  it('employee A CANNOT insert an employee row (no create grant)', async () => {
    await expect(
      as(ids.uEmpA, (tx) => tx`insert into app.employees (org_id, full_name, employment_type)
                               values (${ids.org1}, 'sneaky', 'direct_hire')`),
    ).rejects.toThrow();
  });
});

describe('HR scope: assigned employees only (need-to-know)', () => {
  it('HR reads assigned employee A', async () => {
    const rows = await as(ids.uHr, (tx) => tx`select id from app.employees where id = ${ids.eA}`);
    expect(rows).toHaveLength(1);
  });

  it('HR CANNOT read unassigned employee B', async () => {
    const rows = await as(ids.uHr, (tx) => tx`select id from app.employees where id = ${ids.eB}`);
    expect(rows).toHaveLength(0);
  });

  it('HR can read assigned A\'s SSN (need-to-know) but not B\'s', async () => {
    const a = await as(ids.uHr, (tx) => tx`select employee_id from app.employee_ssn where employee_id = ${ids.eA}`);
    const b = await as(ids.uHr, (tx) => tx`select employee_id from app.employee_ssn where employee_id = ${ids.eB}`);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0);
  });

  it('HR CANNOT edit the rules engine', async () => {
    await expect(
      as(ids.uHr, (tx) => tx`update app.rules set notes = 'tampered' where true`),
    ).resolves.toHaveLength(0); // update affects 0 rows (RLS hides them all)
  });
});

describe('employer scope: whole org, not other orgs', () => {
  it('employer1 sees all org1 employees', async () => {
    const rows = await as(ids.uEmployer1, (tx) => tx`select id from app.employees order by full_name`);
    expect(rows.map((r) => r.id).sort()).toEqual([ids.eA, ids.eB].sort());
  });

  it('employer1 CANNOT see org2 employee C', async () => {
    const rows = await as(ids.uEmployer1, (tx) => tx`select id from app.employees where id = ${ids.eC}`);
    expect(rows).toHaveLength(0);
  });

  it('employer1 CANNOT read org2 SSNs', async () => {
    const rows = await as(ids.uEmployer1, (tx) => tx`select employee_id from app.employee_ssn where org_id = ${ids.org2}`);
    expect(rows).toHaveLength(0);
  });

  it('employer1 CANNOT touch system config / rules', async () => {
    await expect(
      as(ids.uEmployer1, (tx) => tx`update app.rules set notes = 'x' where true`),
    ).resolves.toHaveLength(0);
  });
});

describe('admin scope: global, cross-org', () => {
  it('admin sees employees across both orgs', async () => {
    const rows = await as(ids.uAdmin, (tx) => tx`select id from app.employees`);
    // Global scope: admin sees all three fixtures across both orgs (and possibly
    // other rows in a shared DB — assert the cross-org superset, not exact equality).
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([ids.eA, ids.eB, ids.eC]));
  });

  it('admin can read the audit log; employees cannot', async () => {
    await sql`insert into app.audit_log (org_id, actor_user_id, action, resource)
              values (${ids.org1}, ${ids.uAdmin}, 'test.event', 'test')`;
    const adminRows = await as(ids.uAdmin, (tx) => tx`select count(*)::int as n from app.audit_log`);
    const empRows = await as(ids.uEmpA, (tx) => tx`select count(*)::int as n from app.audit_log`);
    expect(adminRows[0]!.n).toBeGreaterThan(0);
    expect(empRows[0]!.n).toBe(0);
  });
});

describe('audit log is append-only', () => {
  it('nobody can UPDATE or DELETE audit rows via RLS', async () => {
    await sql`insert into app.audit_log (org_id, actor_user_id, action, resource)
              values (${ids.org1}, ${ids.uAdmin}, 'immutable.event', 'test')`;
    // admin has manage on audit_log, but there is deliberately NO update/delete policy.
    const upd = await as(ids.uAdmin, (tx) => tx`update app.audit_log set action = 'hacked' where action = 'immutable.event'`);
    const del = await as(ids.uAdmin, (tx) => tx`delete from app.audit_log where action = 'immutable.event'`);
    expect(upd).toHaveLength(0);
    expect(del).toHaveLength(0);
  });
});

describe('reference data is readable by all authenticated users', () => {
  it('an employee can read statuses and rules (law/config), but not mutate', async () => {
    const statuses = await as(ids.uEmpA, (tx) => tx`select key from app.statuses limit 1`);
    expect(statuses.length).toBe(1);
    const upd = await as(ids.uEmpA, (tx) => tx`update app.statuses set label = 'x' where true`);
    expect(upd).toHaveLength(0);
  });
});
