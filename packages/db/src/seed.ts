/**
 * Seed loader (idempotent). Loads:
 *   1. roles / permissions / role_permissions from @hr/shared DEFAULT_ROLES
 *   2. immigration reference data from data/immigration-seed/*.json
 *
 * Rules load with confirmed_by_counsel=false (§0.4, §7.5). Re-running upserts by
 * natural key, so a refreshed seed file re-loads cleanly.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_ROLES,
  permissionKey,
  documentRequirementRowSchema,
  ruleRowSchema,
  statusRowSchema,
  transitionRowSchema,
} from '@hr/shared';
import { serviceClient } from './client.js';

const here = dirname(fileURLToPath(import.meta.url));
const seedDir = join(here, '..', '..', '..', 'data', 'immigration-seed');

function readJson(file: string): any {
  return JSON.parse(readFileSync(join(seedDir, file), 'utf8'));
}

const RULE_FILES = [
  'rules_f1.json',
  'rules_capgap.json',
  'rules_h1b_cap.json',
  'rules_h1b_mobility.json',
  'rules_greencard.json',
  'rules_i9_everify.json',
  'uscis_fees.json',
];

async function main() {
  const sql = serviceClient();
  try {
    // ── 1. roles + permissions ──────────────────────────────────────────────
    console.log('→ seeding roles & permissions…');
    for (const role of DEFAULT_ROLES) {
      const roleRows = await sql`
        insert into app.roles (key, label, description, rank, is_system)
        values (${role.key}, ${role.label}, ${role.description}, ${role.rank}, true)
        on conflict (key) do update set
          label = excluded.label, description = excluded.description, rank = excluded.rank
        returning id`;
      const roleId = roleRows[0]!.id as string;

      for (const perm of role.permissions) {
        const permRows = await sql`
          insert into app.permissions (resource, action, scope)
          values (${perm.resource}, ${perm.action}, ${perm.scope})
          on conflict (resource, action, scope) do update set resource = excluded.resource
          returning id`;
        const permId = permRows[0]!.id as string;
        await sql`
          insert into app.role_permissions (role_id, permission_id)
          values (${roleId}, ${permId})
          on conflict do nothing`;
      }
      console.log(`  · ${role.key}: ${role.permissions.length} grants (${role.permissions.map(permissionKey).length} keys)`);
    }

    // ── 2. statuses ───────────────────────────────────────────────────────────
    console.log('→ seeding statuses…');
    const statuses = readJson('statuses.json').statuses.map((s: unknown) => statusRowSchema.parse(s));
    for (const s of statuses) {
      await sql`
        insert into app.statuses (key, label, track, sponsorship_required, work_authorized,
          work_authorization_evidence, is_overlay, placeholder, grace_period_days, notes)
        values (${s.key}, ${s.label}, ${s.track}, ${s.sponsorship_required}, ${s.work_authorized},
          ${sql.json(s.work_authorization_evidence)}, ${s.is_overlay}, ${s.placeholder},
          ${s.grace_period_days ?? null}, ${s.notes})
        on conflict (key) do update set
          label = excluded.label, track = excluded.track,
          sponsorship_required = excluded.sponsorship_required,
          work_authorized = excluded.work_authorized,
          work_authorization_evidence = excluded.work_authorization_evidence,
          is_overlay = excluded.is_overlay, placeholder = excluded.placeholder,
          grace_period_days = excluded.grace_period_days, notes = excluded.notes`;
    }
    console.log(`  · ${statuses.length} statuses`);

    // ── 3. transitions ────────────────────────────────────────────────────────
    console.log('→ seeding transitions…');
    const transitions = readJson('transitions.json').transitions.map((t: unknown) => transitionRowSchema.parse(t));
    let skippedTr = 0;
    for (const t of transitions) {
      // Only load transitions whose endpoints exist as statuses (skip edge-only branches).
      const known = statuses.some((s: any) => s.key === t.from_status) && statuses.some((s: any) => s.key === t.to_status);
      if (!known) { skippedTr++; continue; }
      await sql`
        insert into app.transitions (key, from_status, to_status, transition_type, preconditions,
          required_documents, timing_window, responsible_parties, notification_date_types,
          edge_branches, spec_ref)
        values (${t.key}, ${t.from_status}, ${t.to_status}, ${t.transition_type},
          ${sql.json(t.preconditions)}, ${sql.json(t.required_documents)}, ${sql.json(t.timing_window ?? {})},
          ${sql.json(t.responsible_parties)}, ${sql.json(t.notification_date_types)},
          ${sql.json(t.edge_branches)}, ${t.spec_ref})
        on conflict (key) do update set
          from_status = excluded.from_status, to_status = excluded.to_status,
          transition_type = excluded.transition_type, preconditions = excluded.preconditions,
          required_documents = excluded.required_documents, timing_window = excluded.timing_window,
          responsible_parties = excluded.responsible_parties,
          notification_date_types = excluded.notification_date_types,
          edge_branches = excluded.edge_branches, spec_ref = excluded.spec_ref`;
    }
    console.log(`  · ${transitions.length - skippedTr} transitions loaded${skippedTr ? ` (${skippedTr} edge-only skipped)` : ''}`);

    // ── 4. document requirements ──────────────────────────────────────────────
    console.log('→ seeding document requirements…');
    const reqs = readJson('document_requirements.json').requirements.map((r: unknown) => documentRequirementRowSchema.parse(r));
    for (const r of reqs) {
      await sql`
        insert into app.document_requirements (key, label, applies_to_statuses, applies_to_transitions,
          required, uploader, verifier, sensitive_pii, retention_note, notes)
        values (${r.key}, ${r.label}, ${sql.json(r.applies_to_statuses)}, ${sql.json(r.applies_to_transitions)},
          ${r.required}, ${r.uploader}, ${r.verifier}, ${r.sensitive_pii}, ${r.retention_note}, ${r.notes})
        on conflict (key) do update set
          label = excluded.label, applies_to_statuses = excluded.applies_to_statuses,
          applies_to_transitions = excluded.applies_to_transitions, required = excluded.required,
          uploader = excluded.uploader, verifier = excluded.verifier,
          sensitive_pii = excluded.sensitive_pii, retention_note = excluded.retention_note,
          notes = excluded.notes`;
    }
    console.log(`  · ${reqs.length} document requirements`);

    // ── 5. versioned rules (confirmed_by_counsel=false) ───────────────────────
    console.log('→ seeding versioned rules (counsel-pending)…');
    let ruleCount = 0;
    for (const file of RULE_FILES) {
      const parsed = readJson(file);
      const domain = parsed.domain ?? file.replace('.json', '');
      const rows = parsed.rules.map((r: unknown) => ruleRowSchema.parse(r));
      for (const r of rows) {
        await sql`
          insert into app.rules (rule_id, status_or_transition_key, attribute, value, value_type,
            effective_date, source_url, source_citation, confirmed_by_counsel, superseded_by,
            last_verified, notes, domain)
          values (${r.rule_id}, ${r.status_or_transition_key}, ${r.attribute}, ${sql.json(r.value)},
            ${r.value_type}, ${nullableDate(r.effective_date)}, ${r.source_url}, ${r.source_citation},
            false, ${r.superseded_by}, ${nullableDate(r.last_verified)}, ${r.notes}, ${domain})
          on conflict (rule_id) do update set
            status_or_transition_key = excluded.status_or_transition_key,
            attribute = excluded.attribute, value = excluded.value, value_type = excluded.value_type,
            effective_date = excluded.effective_date, source_url = excluded.source_url,
            source_citation = excluded.source_citation, superseded_by = excluded.superseded_by,
            last_verified = excluded.last_verified, notes = excluded.notes, domain = excluded.domain`;
        ruleCount++;
      }
      console.log(`  · ${file}: ${rows.length} rules`);
    }
    console.log(`✓ seed complete — ${ruleCount} rule rows (all confirmed_by_counsel=false)`);
  } finally {
    await sql.end();
  }
}

/** Accept 'YYYY-MM-DD' or loose date strings; null when unparseable. */
function nullableDate(v: string | undefined): string | null {
  if (!v) return null;
  const m = /^\d{4}-\d{2}-\d{2}/.exec(v);
  return m ? m[0] : null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
