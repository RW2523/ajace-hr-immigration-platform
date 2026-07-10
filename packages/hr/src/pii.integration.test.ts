/**
 * Sensitive-PII integration test (§12): proves the SSN/W-4 path encrypts at rest,
 * enforces authorization, and writes an audit row on every access. Also proves the
 * I-9 deadline computation reads business-day rules from the seeded data.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serviceClient } from '@hr/db';
import {
  AuthorizationError,
  generateKey,
  roleByKey,
  type Principal,
} from '@hr/shared';
import { PgAuditSink, computeI9Timeline, createI9Record, readSSN, storeSSN, storeW4, readW4 } from './index.js';

process.env.PII_ENCRYPTION_KEY ??= generateKey();
const sql = serviceClient();
const audit = new PgAuditSink(sql);

const ids = {
  org: crypto.randomUUID(),
  uEmp: crypto.randomUUID(),
  uOther: crypto.randomUUID(),
  uHr: crypto.randomUUID(),
  emp: crypto.randomUUID(),
};

function principal(userId: string, roleKey: string, over: Partial<Principal> = {}): Principal {
  return {
    userId,
    orgId: ids.org,
    assignedEmployeeIds: over.assignedEmployeeIds ?? [],
    permissions: roleByKey(roleKey)!.permissions,
    roleKeys: [roleKey],
    ...over,
  };
}

beforeAll(async () => {
  await sql`delete from app.users where email like '%@pii.test'`;
  await sql`delete from app.organizations where name = 'PII Org'`;
  await sql`insert into app.organizations (id, name) values (${ids.org}, 'PII Org')`;
  await sql`insert into app.users (id, org_id, email, full_name) values
    (${ids.uEmp}, ${ids.org}, 'emp@pii.test', 'Emp'),
    (${ids.uOther}, ${ids.org}, 'other@pii.test', 'Other'),
    (${ids.uHr}, ${ids.org}, 'hr@pii.test', 'Hr')`;
  await sql`insert into app.employees (id, org_id, user_id, full_name, employment_type, hire_date)
    values (${ids.emp}, ${ids.org}, ${ids.uEmp}, 'Emp', 'direct_hire', date '2026-07-06')`;
});

afterAll(async () => {
  await sql`delete from app.audit_log where org_id = ${ids.org}`;
  await sql`delete from app.users where org_id = ${ids.org}`;
  await sql`delete from app.organizations where id = ${ids.org}`;
  await sql.end();
});

describe('SSN encryption + authorization + audit', () => {
  it('stores an SSN encrypted (ciphertext at rest, not plaintext)', async () => {
    await storeSSN(sql, audit, principal(ids.uEmp, 'employee'), ids.emp, '123-45-6789');
    const [row] = await sql<{ encrypted_ssn: string }[]>`select encrypted_ssn from app.employee_ssn where employee_id = ${ids.emp}`;
    expect(row!.encrypted_ssn).not.toContain('123-45-6789');
    expect(row!.encrypted_ssn.startsWith('v1.')).toBe(true);
  });

  it('the owning employee can read their own SSN (decrypted) and it is audited', async () => {
    const before = (await sql`select count(*)::int as n from app.audit_log where action='sensitive_pii.read' and resource=${'employee_ssn:' + ids.emp}`)[0]!.n;
    const ssn = await readSSN(sql, audit, principal(ids.uEmp, 'employee'), ids.emp);
    expect(ssn).toBe('123-45-6789');
    const after = (await sql`select count(*)::int as n from app.audit_log where action='sensitive_pii.read' and resource=${'employee_ssn:' + ids.emp}`)[0]!.n;
    expect(after).toBe(before + 1);
  });

  it('a different employee is DENIED (AuthorizationError) and no plaintext returned', async () => {
    await expect(readSSN(sql, audit, principal(ids.uOther, 'employee'), ids.emp)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('unassigned HR is denied; assigned HR (need-to-know) is allowed', async () => {
    await expect(readSSN(sql, audit, principal(ids.uHr, 'hr'), ids.emp)).rejects.toBeInstanceOf(AuthorizationError);
    const ok = await readSSN(sql, audit, principal(ids.uHr, 'hr', { assignedEmployeeIds: [ids.emp] }), ids.emp);
    expect(ok).toBe('123-45-6789');
  });
});

describe('W-4 encrypted storage', () => {
  it('round-trips encrypted W-4 data for an authorized reader', async () => {
    await storeW4(sql, audit, principal(ids.uEmp, 'employee'), ids.emp, { filing_status: 'single', dependents: 0 }, 2026);
    const data = await readW4(sql, audit, principal(ids.uEmp, 'employee'), ids.emp, 2026);
    expect(data).toEqual({ filing_status: 'single', dependents: 0 });
    const [row] = await sql<{ encrypted_payload: string }[]>`select encrypted_payload from app.w4_records where employee_id = ${ids.emp}`;
    expect(row!.encrypted_payload).not.toContain('single');
  });
});

describe('I-9 timing from versioned rules (§8, A.8)', () => {
  it('computes Section 2 and E-Verify business-day deadlines + retention', async () => {
    const timeline = await computeI9Timeline(sql, '2026-07-06', null, '2026-07-06'); // Monday
    // 3 business days from Monday 2026-07-06 → Thursday 2026-07-09
    expect(timeline.section2Due).toBe('2026-07-09');
    expect(timeline.everifyDue).toBe('2026-07-09');
    expect(timeline.retentionUntil).toBe('2029-07-06');
  });

  it('enforces the List A XOR List B+C document rule', async () => {
    await expect(createI9Record(sql, { employeeId: ids.emp, hireDate: '2026-07-06' }, '2026-07-06')).rejects.toThrow(/List A/);
    await expect(
      createI9Record(sql, { employeeId: ids.emp, hireDate: '2026-07-06', listADoc: 'passport', listBDoc: 'dl' }, '2026-07-06'),
    ).rejects.toThrow(/EITHER/);
  });

  it('rejects the alternative remote procedure without E-Verify good standing', async () => {
    await expect(
      createI9Record(
        sql,
        { employeeId: ids.emp, hireDate: '2026-07-06', listADoc: 'passport', alternativeProcedure: true, employerEverifyGoodStanding: false },
        '2026-07-06',
      ),
    ).rejects.toThrow(/E-Verify employer in good standing/);
  });
});
