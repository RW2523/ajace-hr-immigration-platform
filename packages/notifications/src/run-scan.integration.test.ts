/**
 * End-to-end deadline scan against the DB: seeds a case with a near-term OPT EAD
 * expiry, runs the scan under a simulated clock, and asserts the right reminders
 * are persisted to the correct recipients — and that a second scan is idempotent.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serviceClient } from '@hr/db';
import { ConsoleChannel } from './channels.js';
import { runScan } from './run-scan.js';

const sql = serviceClient();
const ids = {
  org: crypto.randomUUID(),
  uEmp: crypto.randomUUID(),
  uHr: crypto.randomUUID(),
  uBoss: crypto.randomUUID(),
  emp: crypto.randomUUID(),
  kase: crypto.randomUUID(),
};

beforeAll(async () => {
  await sql`delete from app.users where email like '%@notif.test'`;
  await sql`delete from app.organizations where name = 'Notif Org'`;
  await sql`insert into app.organizations (id, name) values (${ids.org}, 'Notif Org')`;
  await sql`insert into app.users (id, org_id, email, full_name) values
    (${ids.uEmp}, ${ids.org}, 'emp@notif.test', 'Emp'),
    (${ids.uHr}, ${ids.org}, 'hr@notif.test', 'Hr'),
    (${ids.uBoss}, ${ids.org}, 'boss@notif.test', 'Boss')`;
  await sql`insert into app.employees (id, org_id, user_id, full_name, employment_type)
    values (${ids.emp}, ${ids.org}, ${ids.uEmp}, 'Emp', 'direct_hire')`;
  await sql`insert into app.immigration_cases (id, org_id, employee_id, current_status)
    values (${ids.kase}, ${ids.org}, ${ids.emp}, 'f1_opt')`;
  // assign HR to this employee, and an employer (counsel fallback)
  const hrRole = (await sql`select id from app.roles where key='hr'`)[0]!.id;
  const bossRole = (await sql`select id from app.roles where key='employer'`)[0]!.id;
  await sql`insert into app.user_roles (user_id, role_id, org_id, scope) values
    (${ids.uHr}, ${hrRole}, ${ids.org}, ${sql.json({ assigned_employee_ids: [ids.emp] } as never)})`;
  await sql`insert into app.user_roles (user_id, role_id, org_id) values
    (${ids.uBoss}, ${bossRole}, ${ids.org})`;
  // OPT EAD expires in 14 days from the simulated 'today'
  await sql`insert into app.case_dates (org_id, case_id, date_type, value)
    values (${ids.org}, ${ids.kase}, 'ead_expiry', date '2026-11-01')`;
});

afterAll(async () => {
  await sql`delete from app.notifications where org_id = ${ids.org}`;
  await sql`delete from app.users where org_id = ${ids.org}`;
  await sql`delete from app.organizations where id = ${ids.org}`;
  await sql.end();
});

describe('DB-backed scan', () => {
  it('at 14 days out, notifies employee + HR + counsel and persists rows', async () => {
    const email = new ConsoleChannel('email');
    const inApp = new ConsoleChannel('in_app');
    const report = await runScan(sql, '2026-10-18', { email, in_app: inApp }); // 14 days before 2026-11-01

    expect(report.due).toBeGreaterThan(0);
    expect(report.inserted).toBeGreaterThan(0);

    const rows = await sql<{ recipient_user_id: string; escalation_level: number; offset_days: number }[]>`
      select recipient_user_id, escalation_level, offset_days from app.notifications
      where related_case_id = ${ids.kase} and offset_days = 14`;
    const recipients = new Set(rows.map((r) => r.recipient_user_id));
    // employee, hr, and counsel-fallback (boss) all reached at the 14-day mark
    expect(recipients.has(ids.uEmp)).toBe(true);
    expect(recipients.has(ids.uHr)).toBe(true);
    expect(recipients.has(ids.uBoss)).toBe(true);
  });

  it('is idempotent: a second scan on the same day inserts nothing new', async () => {
    const before = (await sql`select count(*)::int as n from app.notifications where org_id=${ids.org}`)[0]!.n;
    const report = await runScan(sql, '2026-10-18', { email: new ConsoleChannel('email'), in_app: new ConsoleChannel('in_app') });
    const after = (await sql`select count(*)::int as n from app.notifications where org_id=${ids.org}`)[0]!.n;
    expect(report.inserted).toBe(0);
    expect(after).toBe(before);
  });
});
