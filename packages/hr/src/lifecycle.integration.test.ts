/**
 * End-to-end lifecycle integration tests (DB-backed, like pii.integration.test.ts):
 *
 *   I-9:  open a record → deadlines land in app.case_dates (the notification scan's
 *         sole input) → employee attests Section 1 → employer completes Section 2 →
 *         E-Verify case recorded, with cross-org / other-employee authz denials.
 *
 *   Offer letter: generate → real rendered HTML persisted → staff sends → employee
 *         signs their own, with cross-org / other-employee authz denials.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serviceClient } from '@hr/db';
import { AuthorizationError, generateKey, roleByKey, type Principal } from '@hr/shared';
import {
  PgAuditSink,
  openI9Record,
  completeI9Section1,
  completeI9Section2,
  recordEverifyCase,
  generateOfferLetter,
  getOfferLetter,
  sendOfferLetter,
  signOfferLetter,
} from './index.js';

process.env.PII_ENCRYPTION_KEY ??= generateKey();
const sql = serviceClient();
const audit = new PgAuditSink(sql);

const ids = {
  orgA: crypto.randomUUID(),
  orgB: crypto.randomUUID(),
  uEmp: crypto.randomUUID(),
  uOther: crypto.randomUUID(),
  uHr: crypto.randomUUID(),
  uEmployer: crypto.randomUUID(),
  emp: crypto.randomUUID(),
  other: crypto.randomUUID(),
};

function principal(userId: string, roleKey: string, orgId: string, over: Partial<Principal> = {}): Principal {
  return {
    userId,
    orgId,
    assignedEmployeeIds: over.assignedEmployeeIds ?? [],
    permissions: roleByKey(roleKey)!.permissions,
    roleKeys: [roleKey],
    ...over,
  };
}

const HIRE = '2026-07-06'; // Monday → Section 2 / E-Verify due Thursday 2026-07-09

beforeAll(async () => {
  const stale = sql`select id from app.organizations where name in ('Life Org A','Life Org B')`;
  await sql`delete from app.case_dates where org_id in (${stale})`;
  await sql`delete from app.offer_letters where org_id in (${stale})`;
  await sql`delete from app.i9_records where org_id in (${stale})`;
  await sql`delete from app.immigration_cases where org_id in (${stale})`;
  await sql`delete from app.audit_log where org_id in (${stale})`;
  await sql`delete from app.users where email like '%@life.test'`;
  await sql`delete from app.organizations where name in ('Life Org A','Life Org B')`;
  await sql`insert into app.organizations (id, name) values (${ids.orgA}, 'Life Org A'), (${ids.orgB}, 'Life Org B')`;
  await sql`insert into app.users (id, org_id, email, full_name) values
    (${ids.uEmp}, ${ids.orgA}, 'emp@life.test', 'Emp'),
    (${ids.uOther}, ${ids.orgA}, 'other@life.test', 'Other'),
    (${ids.uHr}, ${ids.orgA}, 'hr@life.test', 'Hr'),
    (${ids.uEmployer}, ${ids.orgA}, 'employer@life.test', 'Boss')`;
  await sql`insert into app.employees (id, org_id, user_id, full_name, employment_type, hire_date, work_authorization_category)
    values
    (${ids.emp}, ${ids.orgA}, ${ids.uEmp}, 'Emp', 'direct_hire', date '2026-07-06', 'us_citizen'),
    (${ids.other}, ${ids.orgA}, ${ids.uOther}, 'Other', 'direct_hire', date '2026-07-06', 'us_citizen')`;
});

afterAll(async () => {
  await sql`delete from app.case_dates where org_id in (${ids.orgA}, ${ids.orgB})`;
  await sql`delete from app.immigration_cases where org_id in (${ids.orgA}, ${ids.orgB})`;
  await sql`delete from app.audit_log where org_id in (${ids.orgA}, ${ids.orgB})`;
  await sql`delete from app.offer_letters where org_id in (${ids.orgA}, ${ids.orgB})`;
  await sql`delete from app.i9_records where org_id in (${ids.orgA}, ${ids.orgB})`;
  await sql`delete from app.users where org_id in (${ids.orgA}, ${ids.orgB})`;
  await sql`delete from app.organizations where id in (${ids.orgA}, ${ids.orgB})`;
  await sql.end();
});

describe('I-9 completable end-to-end + deadlines reach the notification scan', () => {
  let i9Id: string;
  let caseId: string;

  it('unassigned/cross-org staff cannot open an I-9 record', async () => {
    // Employer of a DIFFERENT org acting on orgA's employee → org-scope denial.
    await expect(
      openI9Record(sql, audit, principal(crypto.randomUUID(), 'employer', ids.orgB),
        { employeeId: ids.emp, hireDate: HIRE, listADoc: 'us_passport' }, HIRE),
    ).rejects.toBeInstanceOf(AuthorizationError);
    // HR assigned to nobody → assigned-scope denial.
    await expect(
      openI9Record(sql, audit, principal(ids.uHr, 'hr', ids.orgA),
        { employeeId: ids.emp, hireDate: HIRE, listADoc: 'us_passport' }, HIRE),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('an authorized employer opens the I-9 and its deadlines are written to app.case_dates', async () => {
    const res = await openI9Record(
      sql, audit, principal(ids.uEmployer, 'employer', ids.orgA),
      { employeeId: ids.emp, hireDate: HIRE, listADoc: 'us_passport' }, HIRE,
    );
    i9Id = res.id;
    caseId = res.caseId;
    expect(res.timeline.section2Due).toBe('2026-07-09');
    expect(res.timeline.everifyDue).toBe('2026-07-09');

    // The scan (run-scan.ts) reads ONLY app.case_dates; assert the I-9 deadlines
    // landed there with the trigger date_types it recognises.
    const dates = await sql<{ date_type: string; value: string }[]>`
      select date_type, to_char(value,'YYYY-MM-DD') as value
      from app.case_dates where case_id = ${caseId} order by date_type`;
    const byType = Object.fromEntries(dates.map((d) => [d.date_type, d.value]));
    expect(byType['i9_section2_deadline']).toBe('2026-07-09');
    expect(byType['everify_case_deadline']).toBe('2026-07-09');
  });

  it('re-opening replaces the derived case_dates rows idempotently (no duplicates)', async () => {
    await openI9Record(
      sql, audit, principal(ids.uEmployer, 'employer', ids.orgA),
      { employeeId: ids.emp, hireDate: HIRE, listADoc: 'us_passport' }, HIRE,
    );
    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from app.case_dates
      where case_id = ${caseId} and date_type in ('i9_section2_deadline','everify_case_deadline')`;
    expect(rows[0]!.n).toBe(2);
  });

  it('only the owning employee can attest Section 1', async () => {
    await expect(
      completeI9Section1(sql, audit, principal(ids.uOther, 'employee', ids.orgA), i9Id),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await completeI9Section1(sql, audit, principal(ids.uEmp, 'employee', ids.orgA), i9Id);
    const [row] = await sql<{ done: boolean }[]>`
      select section1_completed_at is not null as done from app.i9_records where id = ${i9Id}`;
    expect(row!.done).toBe(true);
  });

  it('an employee cannot complete Section 2 (employer attestation); the employer can', async () => {
    await expect(
      completeI9Section2(sql, audit, principal(ids.uEmp, 'employee', ids.orgA), i9Id),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await completeI9Section2(sql, audit, principal(ids.uEmployer, 'employer', ids.orgA), i9Id, { listADoc: 'us_passport' });
    const [row] = await sql<{ done: boolean }[]>`
      select section2_completed_at is not null as done from app.i9_records where id = ${i9Id}`;
    expect(row!.done).toBe(true);
  });

  it('records the E-Verify case id (staff only)', async () => {
    await recordEverifyCase(sql, audit, principal(ids.uEmployer, 'employer', ids.orgA), i9Id, 'E-VERIFY-2026-0001');
    const [row] = await sql<{ everify_case_id: string }[]>`select everify_case_id from app.i9_records where id = ${i9Id}`;
    expect(row!.everify_case_id).toBe('E-VERIFY-2026-0001');
  });
});

describe('Offer letter generates a real, viewable, signable document', () => {
  let letterId: string;

  it('generates a real letter body (rendered HTML, at-will + acceptance) and persists it', async () => {
    const res = await generateOfferLetter(sql, ids.emp, {
      employee_name: 'Emp Example',
      role_title: 'Senior Consultant',
      employment_type: 'direct_hire',
      start_date: '2026-08-01',
      compensation: '$150,000 / year',
      work_location: 'Austin, TX',
      employer_name: 'AJACE Inc',
    });
    letterId = res.id;
    expect(res.html).toContain('Emp Example');
    expect(res.html).toContain('Senior Consultant');
    expect(res.html.toLowerCase()).toContain('at will');
    expect(res.html.toLowerCase()).toContain('acceptance');

    const view = await getOfferLetter(sql, letterId);
    expect(view!.renderedHtml).toContain('Senior Consultant');
    expect(view!.esignStatus).toBe('draft');
  });

  it('cross-org staff cannot send it; the owning org staff can (draft → sent)', async () => {
    await expect(
      sendOfferLetter(sql, principal(crypto.randomUUID(), 'employer', ids.orgB), letterId),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await sendOfferLetter(sql, principal(ids.uEmployer, 'employer', ids.orgA), letterId);
    expect((await getOfferLetter(sql, letterId))!.esignStatus).toBe('sent');
  });

  it('a different employee cannot sign it; the owning employee can (sent → signed)', async () => {
    await expect(
      signOfferLetter(sql, principal(ids.uOther, 'employee', ids.orgA), letterId),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await signOfferLetter(sql, principal(ids.uEmp, 'employee', ids.orgA), letterId);
    const view = await getOfferLetter(sql, letterId);
    expect(view!.esignStatus).toBe('signed');
    expect(view!.signerUserId).toBe(ids.uEmp);
    expect(view!.signedAt).not.toBeNull();
  });

  it('cannot sign a letter that has not been sent', async () => {
    const draft = await generateOfferLetter(sql, ids.emp, {
      employee_name: 'Emp Example', role_title: 'Analyst', employment_type: 'placement',
      start_date: '2026-09-01', compensation: '$120,000 / year', work_location: 'Remote', employer_name: 'AJACE Inc',
    });
    await expect(
      signOfferLetter(sql, principal(ids.uEmp, 'employee', ids.orgA), draft.id),
    ).rejects.toThrow(/must be sent/);
  });
});
