/**
 * AJACE Inc demo seed (idempotent, fixed UUIDs that match the Supabase Auth users).
 * Restores the org, all role users, employees, cases + deadlines, encrypted PII
 * (passport/SEVIS/A-number), and the RAG knowledge base for local exploration.
 *
 * Run:  cd apps/web && pnpm exec tsx ../../scripts/ajace-seed.ts
 * (needs DATABASE_URL + PII_ENCRYPTION_KEY from apps/web/.env.local)
 */
import postgres from 'postgres';
import { encryptPII } from '@hr/shared';
import { ingestAll, defaultEmbedder } from '@hr/rag';

const sql = postgres(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:54329/hr', { max: 4, onnotice: () => {} });

const ORG = 'b0000000-0000-4000-8000-000000000001';
const U = {
  admin: 'a0000000-0000-4000-8000-000000000001',
  subashini: 'a0000000-0000-4000-8000-000000000002',
  richard: 'a0000000-0000-4000-8000-000000000003',
  johan: 'a0000000-0000-4000-8000-0000000000b1',
  anita: 'a0000000-0000-4000-8000-0000000000b2',
  sheryl: 'a0000000-0000-4000-8000-0000000000b3',
  meera: 'a0000000-0000-4000-8000-0000000000c1',
};
const E = { richard: 'c0000000-0000-4000-8000-000000000003', meera: 'c0000000-0000-4000-8000-0000000000c1' };
const C = { richard: 'd0000000-0000-4000-8000-000000000003', meera: 'd0000000-0000-4000-8000-0000000000c1' };

async function roleId(key: string): Promise<string> {
  const [r] = await sql<{ id: string }[]>`select id from app.roles where key = ${key} limit 1`;
  if (!r) throw new Error(`role ${key} not found — run the reference seed first`);
  return r.id;
}

async function main() {
  await sql`insert into app.organizations (id, name, status) values (${ORG}, 'AJACE Inc', 'active')
            on conflict (id) do update set name = excluded.name`;

  const users: [string, string, string][] = [
    [U.admin, 'admin@ajace.com', 'AJACE Admin'],
    [U.subashini, 'subashini@ajace.com', 'Subashini'],
    [U.richard, 'richard@ajace.com', 'Richard'],
    [U.johan, 'johan@ajace.com', 'Johan'],
    [U.anita, 'anita@ajace.com', 'Anita'],
    [U.sheryl, 'sheryl@ajace.com', 'Sheryl'],
    [U.meera, 'meera@ajace.com', 'Meera'],
  ];
  for (const [id, email, name] of users) {
    await sql`insert into app.users (id, email, org_id, status, full_name) values (${id}, ${email}, ${ORG}, 'active', ${name})
              on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, org_id = excluded.org_id`;
  }

  await sql`insert into app.employees (id, org_id, status, user_id, full_name, hire_date, employment_type, work_authorization_category)
            values (${E.richard}, ${ORG}, 'active', ${U.richard}, 'Richard', '2025-09-01', 'placement', 'f1_stem_opt')
            on conflict (id) do update set work_authorization_category = excluded.work_authorization_category, hire_date = excluded.hire_date`;
  await sql`insert into app.employees (id, org_id, status, user_id, full_name, hire_date, employment_type, work_authorization_category)
            values (${E.meera}, ${ORG}, 'active', ${U.meera}, 'Meera', '2025-06-01', 'placement', 'f1_opt')
            on conflict (id) do update set work_authorization_category = excluded.work_authorization_category, hire_date = excluded.hire_date`;

  // Role assignments (mapped by role KEY to the local role ids).
  const [admin, employee, employer, hr] = await Promise.all([roleId('admin'), roleId('employee'), roleId('employer'), roleId('hr')]);
  const grants: [string, string, Record<string, unknown>][] = [
    [U.admin, admin, {}],
    [U.richard, employee, {}],
    [U.meera, employee, {}],
    [U.johan, employer, {}],
    [U.anita, employer, {}],
    [U.subashini, hr, { assigned_employee_ids: [E.richard] }],
    [U.sheryl, hr, { assigned_employee_ids: [E.meera] }],
  ];
  for (const [userId, rid, scope] of grants) {
    await sql`insert into app.user_roles (org_id, user_id, role_id, scope) values (${ORG}, ${userId}, ${rid}, ${sql.json(scope as never)})
              on conflict (user_id, role_id, org_id) do update set scope = excluded.scope`;
  }

  await sql`insert into app.immigration_cases (id, org_id, employee_id, current_status, country_of_birth)
            values (${C.richard}, ${ORG}, ${E.richard}, 'f1_stem_opt', 'India')
            on conflict (id) do update set current_status = excluded.current_status`;
  await sql`insert into app.immigration_cases (id, org_id, employee_id, current_status, country_of_birth)
            values (${C.meera}, ${ORG}, ${E.meera}, 'f1_opt', 'India')
            on conflict (id) do update set current_status = excluded.current_status`;

  const dates: [string, string, string][] = [
    [C.richard, 'stem_ead_expiry', '2026-10-05'],
    [C.richard, 'stem_validation_12_month', '2026-07-27'],
    [C.richard, 'passport_expiry', '2026-12-14'],
    [C.richard, 'opt_ead_start', '2024-10-06'],
    [C.meera, 'opt_ead_expiry', '2026-08-22'],
    [C.meera, 'opt_unemployment_clock', '2026-08-07'],
  ];
  // Idempotent: clear this case's demo dates first so re-runs don't duplicate rows
  // (case_dates has no unique constraint on case_id+date_type by design).
  await sql`delete from app.case_dates where case_id in (${C.richard}, ${C.meera}) and source = 'demo'`;
  for (const [caseId, dt, val] of dates) {
    await sql`insert into app.case_dates (org_id, case_id, date_type, value, source) values (${ORG}, ${caseId}, ${dt}, ${val}, 'demo')`;
  }

  // §12: Richard's sensitive identifiers, app-layer-encrypted (never plaintext).
  const secure = { passport_number: 'Y6394906', passport_country: 'India', passport_issue: '2023-08-01', passport_expiry: '2026-12-14', sevis_number: 'N0031234567', alien_registration_number: 'A200456789' };
  await sql`insert into app.employee_secure_ids (employee_id, org_id, encrypted_payload) values (${E.richard}, ${ORG}, ${encryptPII(JSON.stringify(secure))})
            on conflict (employee_id) do update set encrypted_payload = excluded.encrypted_payload, updated_at = now()`;

  // Rebuild the RAG knowledge base (org rules/policies + per-employee facts).
  const rag = await ingestAll(sql, defaultEmbedder(), ORG);

  const [{ n: users_n }] = await sql<{ n: number }[]>`select count(*)::int n from app.users where org_id = ${ORG}`;
  console.log(`AJACE_SEED_OK users=${users_n} employees=2 cases=2 ragKnowledge=${rag.knowledge} ragFacts=${rag.facts}`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
