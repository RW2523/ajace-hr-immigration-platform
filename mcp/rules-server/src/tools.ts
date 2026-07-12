/**
 * rules-server tool logic (§11.1) — read-only queries over the versioned rules and
 * the pure validator. Rules are reference data (global-read to any authenticated
 * caller), but EVERY result carries the counsel-confirmation flag so the assistant
 * can surface the §14 "as-of / confirmed-by-counsel" indicator and never present an
 * unratified seed value as a legal conclusion.
 */
import type postgres from 'postgres';
import { z } from 'zod';
import type { RuleRow } from '@hr/shared';
import { RuleIndex, loadRuleData, validateCase, type CaseSnapshot } from '@hr/rules-engine';

async function allRules(sql: postgres.Sql): Promise<RuleRow[]> {
  const rows = await sql<RuleRow[]>`
    select rule_id, status_or_transition_key, attribute, value, value_type,
      to_char(effective_date,'YYYY-MM-DD') as effective_date, source_url, source_citation,
      confirmed_by_counsel, superseded_by, to_char(last_verified,'YYYY-MM-DD') as last_verified, notes
    from app.rules`;
  return rows as unknown as RuleRow[];
}

// ── rules_get (by status/transition) ────────────────────────────────────────
export const rulesGetInput = z.object({
  status_or_transition_key: z.string(),
  as_of: z.string().optional(),
});
export async function rulesGet(sql: postgres.Sql, input: z.infer<typeof rulesGetInput>) {
  const asOf = input.as_of ?? new Date().toISOString().slice(0, 10);
  const index = new RuleIndex(await allRules(sql));
  const active = index.activeFor(input.status_or_transition_key, asOf);
  return {
    key: input.status_or_transition_key,
    as_of: asOf,
    any_counsel_pending: active.some((r) => !r.provenance.confirmedByCounsel),
    rules: active.map((r) => ({
      value: r.value,
      value_type: r.valueType,
      rule_id: r.provenance.ruleId,
      effective_date: r.provenance.effectiveDate,
      confirmed_by_counsel: r.provenance.confirmedByCounsel,
      source_citation: r.provenance.sourceCitation,
    })),
  };
}

// ── rules_validate_case ─────────────────────────────────────────────────────
export const rulesValidateInput = z.object({
  current_status: z.string(),
  dates: z.record(z.string()).optional(),
  collected_documents: z.array(z.string()).optional(),
  unemployment_days_used: z.number().optional(),
  as_of: z.string().optional(),
});
export async function rulesValidate(sql: postgres.Sql, input: z.infer<typeof rulesValidateInput>) {
  const asOf = input.as_of ?? new Date().toISOString().slice(0, 10);
  const data = await loadRuleData(sql);
  const snapshot: CaseSnapshot = {
    currentStatus: input.current_status,
    dates: input.dates ?? {},
    collectedDocuments: input.collected_documents ?? [],
    attributes: {},
    unemploymentDaysUsed: input.unemployment_days_used,
  };
  const result = validateCase(data, snapshot, asOf);
  return {
    as_of: asOf,
    counsel_pending: result.anyCounselPending,
    eligible: result.eligibleTransitions.map((t) => t.toStatus),
    // Blocked only by unconfirmable legal preconditions — surfaced separately so
    // callers never treat these as eligible (Bug 1).
    needs_counsel_review: result.needsCounselReviewTransitions.map((t) => ({
      to: t.toStatus,
      unconfirmed_preconditions: t.unconfirmedPreconditions,
    })),
    findings: result.findings,
  };
}

// ── rules_list_effective ────────────────────────────────────────────────────
export const rulesListEffectiveInput = z.object({ as_of: z.string().optional(), domain: z.string().optional() });
export async function rulesListEffective(sql: postgres.Sql, input: z.infer<typeof rulesListEffectiveInput>) {
  const asOf = input.as_of ?? new Date().toISOString().slice(0, 10);
  const rows = await allRules(sql);
  const active = rows.filter((r) => r.superseded_by === null && (!r.effective_date || r.effective_date <= asOf));
  return {
    as_of: asOf,
    count: active.length,
    counsel_confirmed: active.filter((r) => r.confirmed_by_counsel).length,
    counsel_pending: active.filter((r) => !r.confirmed_by_counsel).length,
  };
}
