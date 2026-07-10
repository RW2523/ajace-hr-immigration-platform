/**
 * Emits idempotent seed SQL for the `app` schema (roles/permissions, statuses,
 * transitions, document_requirements, rules) so it can be applied to a remote
 * Supabase project via the management API. Splits output into numbered chunks to
 * stay within per-statement size limits.
 *
 * Run: tsx scripts/gen-seed-sql.ts <outDir>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ROLES } from '../packages/shared/src/roles.ts';

const here = dirname(fileURLToPath(import.meta.url));
const seedDir = join(here, '..', 'data', 'immigration-seed');
const outDir = process.argv[2] ?? join(here, '..', 'scratch-seed');

const q = (s: unknown) => `'${String(s ?? '').replace(/'/g, "''")}'`;
const jsonb = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`;
const dateOrNull = (v: unknown) => {
  if (!v || typeof v !== 'string') return 'null';
  const m = /^\d{4}-\d{2}-\d{2}/.exec(v);
  return m ? q(m[0]) : 'null';
};
const readJson = (f: string) => JSON.parse(readFileSync(join(seedDir, f), 'utf8'));

// ── roles / permissions / role_permissions ──────────────────────────────────
const roleSql: string[] = [];
for (const role of DEFAULT_ROLES) {
  roleSql.push(
    `insert into app.roles (key,label,description,rank,is_system) values (${q(role.key)},${q(role.label)},${q(role.description)},${role.rank},true) on conflict (key) do update set label=excluded.label,description=excluded.description,rank=excluded.rank;`,
  );
  for (const p of role.permissions) {
    roleSql.push(
      `insert into app.permissions (resource,action,scope) values (${q(p.resource)},${q(p.action)},${q(p.scope)}) on conflict (resource,action,scope) do update set resource=excluded.resource;`,
    );
    roleSql.push(
      `insert into app.role_permissions (role_id,permission_id) select r.id,pm.id from app.roles r, app.permissions pm where r.key=${q(role.key)} and pm.resource=${q(p.resource)} and pm.action=${q(p.action)} and pm.scope=${q(p.scope)} on conflict do nothing;`,
    );
  }
}

// ── statuses ─────────────────────────────────────────────────────────────────
const statuses = readJson('statuses.json').statuses;
const statusSql = statuses.map((s: any) =>
  `insert into app.statuses (key,label,track,sponsorship_required,work_authorized,work_authorization_evidence,is_overlay,placeholder,grace_period_days,notes) values (${q(s.key)},${q(s.label)},${q(s.track)},${!!s.sponsorship_required},${!!s.work_authorized},${jsonb(s.work_authorization_evidence ?? [])},${!!s.is_overlay},${!!s.placeholder},${s.grace_period_days ?? 'null'},${q(s.notes ?? '')}) on conflict (key) do update set label=excluded.label,track=excluded.track,sponsorship_required=excluded.sponsorship_required,work_authorized=excluded.work_authorized,work_authorization_evidence=excluded.work_authorization_evidence,is_overlay=excluded.is_overlay,placeholder=excluded.placeholder,grace_period_days=excluded.grace_period_days,notes=excluded.notes;`,
);

// ── transitions (only those whose endpoints are known statuses) ──────────────
const statusKeys = new Set(statuses.map((s: any) => s.key));
const transitions = readJson('transitions.json').transitions.filter(
  (t: any) => statusKeys.has(t.from_status) && statusKeys.has(t.to_status),
);
const transitionSql = transitions.map((t: any) =>
  `insert into app.transitions (key,from_status,to_status,transition_type,preconditions,required_documents,timing_window,responsible_parties,notification_date_types,edge_branches,spec_ref) values (${q(t.key)},${q(t.from_status)},${q(t.to_status)},${q(t.transition_type)},${jsonb(t.preconditions ?? [])},${jsonb(t.required_documents ?? [])},${jsonb(t.timing_window ?? {})},${jsonb(t.responsible_parties ?? [])},${jsonb(t.notification_date_types ?? [])},${jsonb(t.edge_branches ?? [])},${q(t.spec_ref ?? '')}) on conflict (key) do update set from_status=excluded.from_status,to_status=excluded.to_status,transition_type=excluded.transition_type,preconditions=excluded.preconditions,required_documents=excluded.required_documents,timing_window=excluded.timing_window,responsible_parties=excluded.responsible_parties,notification_date_types=excluded.notification_date_types,edge_branches=excluded.edge_branches,spec_ref=excluded.spec_ref;`,
);

// ── document_requirements ────────────────────────────────────────────────────
const reqs = readJson('document_requirements.json').requirements;
const reqSql = reqs.map((r: any) =>
  `insert into app.document_requirements (key,label,applies_to_statuses,applies_to_transitions,required,uploader,verifier,sensitive_pii,retention_note,notes) values (${q(r.key)},${q(r.label)},${jsonb(r.applies_to_statuses ?? [])},${jsonb(r.applies_to_transitions ?? [])},${r.required !== false},${q(r.uploader ?? 'employee')},${q(r.verifier ?? 'hr')},${!!r.sensitive_pii},${q(r.retention_note ?? '')},${q(r.notes ?? '')}) on conflict (key) do update set label=excluded.label,applies_to_statuses=excluded.applies_to_statuses,applies_to_transitions=excluded.applies_to_transitions,required=excluded.required,uploader=excluded.uploader,verifier=excluded.verifier,sensitive_pii=excluded.sensitive_pii,retention_note=excluded.retention_note,notes=excluded.notes;`,
);

// ── rules (confirmed_by_counsel=false) ───────────────────────────────────────
const RULE_FILES = ['rules_f1.json','rules_capgap.json','rules_h1b_cap.json','rules_h1b_mobility.json','rules_greencard.json','rules_i9_everify.json','uscis_fees.json'];
const ruleSql: string[] = [];
for (const f of RULE_FILES) {
  const parsed = readJson(f);
  const domain = parsed.domain ?? f.replace('.json', '');
  for (const r of parsed.rules) {
    ruleSql.push(
      `insert into app.rules (rule_id,status_or_transition_key,attribute,value,value_type,effective_date,source_url,source_citation,confirmed_by_counsel,superseded_by,last_verified,notes,domain) values (${q(r.rule_id)},${q(r.status_or_transition_key)},${q(r.attribute)},${jsonb(r.value)},${q(r.value_type)},${dateOrNull(r.effective_date)},${q(r.source_url ?? '')},${q(r.source_citation ?? '')},false,${r.superseded_by ? q(r.superseded_by) : 'null'},${dateOrNull(r.last_verified)},${q(r.notes ?? '')},${q(domain)}) on conflict (rule_id) do update set status_or_transition_key=excluded.status_or_transition_key,attribute=excluded.attribute,value=excluded.value,value_type=excluded.value_type,effective_date=excluded.effective_date,source_url=excluded.source_url,source_citation=excluded.source_citation,superseded_by=excluded.superseded_by,last_verified=excluded.last_verified,notes=excluded.notes,domain=excluded.domain;`,
    );
  }
}

// Write granular files so the essential (small) reference data can be applied
// cheaply, and the bulky rules loaded separately.
function write(name: string, stmts: string[]) {
  const body = stmts.join('\n');
  writeFileSync(join(outDir, name), body);
  return { name, stmts: stmts.length, bytes: Buffer.byteLength(body) };
}
const manifest = [
  write('seed_a_roles.sql', roleSql),
  write('seed_b_statuses.sql', statusSql),
  write('seed_c_transitions.sql', transitionSql),
  write('seed_d_docreqs.sql', reqSql),
];
// rules in 3 parts
const third = Math.ceil(ruleSql.length / 3);
manifest.push(write('seed_e_rules_1.sql', ruleSql.slice(0, third)));
manifest.push(write('seed_f_rules_2.sql', ruleSql.slice(third, 2 * third)));
manifest.push(write('seed_g_rules_3.sql', ruleSql.slice(2 * third)));

console.log(JSON.stringify(manifest, null, 0));
