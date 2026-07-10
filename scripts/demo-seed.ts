/**
 * Demo data for exploring the app locally: one org, a user per role, employees, a
 * case with deadlines, and a couple of RAG chunks. Idempotent (fixed UUIDs).
 * Run: DATABASE_URL=... tsx scripts/demo-seed.ts
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:54329/hr', { max: 4, onnotice: () => {} });

const ID = {
  org: '11111111-1111-1111-1111-111111111111',
  admin: '22222222-2222-2222-2222-222222222201',
  employer: '22222222-2222-2222-2222-222222222202',
  hr: '22222222-2222-2222-2222-222222222203',
  emp: '22222222-2222-2222-2222-222222222204',
  empRec: '33333333-3333-3333-3333-333333333304',
  kase: '44444444-4444-4444-4444-444444444404',
};

async function roleId(key: string) {
  const [r] = await sql`select id from app.roles where key = ${key}`;
  return r!.id as string;
}

async function main() {
  await sql`insert into app.organizations (id, name) values (${ID.org}, 'Acme Staffing (demo)')
            on conflict (id) do nothing`;
  await sql`insert into app.users (id, org_id, email, full_name) values
    (${ID.admin}, ${ID.org}, 'admin@acme.demo', 'Ada Admin'),
    (${ID.employer}, ${ID.org}, 'owner@acme.demo', 'Ollie Owner'),
    (${ID.hr}, ${ID.org}, 'hr@acme.demo', 'Hana HR'),
    (${ID.emp}, ${ID.org}, 'consultant@acme.demo', 'Ravi Consultant')
    on conflict (id) do nothing`;
  await sql`insert into app.employees (id, org_id, user_id, full_name, employment_type, work_authorization_category, hire_date)
            values (${ID.empRec}, ${ID.org}, ${ID.emp}, 'Ravi Consultant', 'placement', 'f1_stem_opt', date '2025-09-01')
            on conflict (id) do nothing`;
  await sql`insert into app.immigration_cases (id, org_id, employee_id, current_status, country_of_birth)
            values (${ID.kase}, ${ID.org}, ${ID.empRec}, 'f1_stem_opt', 'India')
            on conflict (id) do nothing`;

  // Deadlines to populate the dashboard.
  const dates: [string, string][] = [
    ['stem_ead_expiry', addDays(90)],
    ['stem_validation_12_month', addDays(20)],
    ['passport_expiry', addDays(160)],
    ['i94_expiry', addDays(300)],
  ];
  for (const [type, value] of dates) {
    await sql`insert into app.case_dates (org_id, case_id, date_type, value, source)
              values (${ID.org}, ${ID.kase}, ${type}, ${value}, 'demo')
              on conflict do nothing`;
  }
  // I-9 pending (for HR dashboard)
  await sql`insert into app.i9_records (org_id, employee_id, section2_due, everify_due)
            values (${ID.org}, ${ID.empRec}, ${addDays(2)}, ${addDays(2)})
            on conflict do nothing`;

  // Roles
  await sql`insert into app.user_roles (user_id, role_id, org_id) values
    (${ID.admin}, ${await roleId('admin')}, ${ID.org}),
    (${ID.employer}, ${await roleId('employer')}, ${ID.org}),
    (${ID.emp}, ${await roleId('employee')}, ${ID.org})
    on conflict do nothing`;
  await sql`insert into app.user_roles (user_id, role_id, org_id, scope) values
    (${ID.hr}, ${await roleId('hr')}, ${ID.org}, ${sql.json({ assigned_employee_ids: [ID.empRec] } as never)})
    on conflict do nothing`;

  console.log('✓ demo data ready. Sign in at /login as any of:');
  console.log('  · admin@acme.demo (Admin)  · owner@acme.demo (Employer)');
  console.log('  · hr@acme.demo (HR)        · consultant@acme.demo (Employee)');
  await sql.end();
}

function addDays(n: number): string {
  const d = new Date(Date.now() + n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

main().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
