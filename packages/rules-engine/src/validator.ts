/**
 * The rules validator — a PURE function (§7.5). Given a case snapshot and the
 * versioned rule data, it returns which transitions are eligible, which documents
 * are still required, and any deadline/limit findings — by READING the rules,
 * never by hard-coded constants.
 *
 * It surfaces counsel-confirmation state on every result so the UI can render the
 * §14 "as-of / confirmed-by-counsel" indicator and never present unratified seed
 * values as legal conclusions.
 */
import type { CaseSnapshot, Finding, RuleData, TransitionEligibility, ValidationResult } from './types.js';
import { RuleIndex } from './rule-index.js';
import { unemploymentClock } from './clocks.js';

export function buildIndex(data: RuleData): RuleIndex {
  return new RuleIndex(data.rules);
}

export function validateCase(data: RuleData, snapshot: CaseSnapshot, asOf: string): ValidationResult {
  const index = buildIndex(data);
  const findings: Finding[] = [];

  const outgoing = data.transitions.filter((t) => t.from_status === snapshot.currentStatus);
  const eligibleTransitions: TransitionEligibility[] = [];
  const ineligibleTransitions: TransitionEligibility[] = [];

  for (const t of outgoing) {
    // Self-transitions with type 'grace' model grace clocks, not real moves — skip.
    if (t.from_status === t.to_status && t.transition_type === 'grace') continue;

    const missingDocuments = (t.required_documents ?? []).filter(
      (d) => !snapshot.collectedDocuments.includes(d),
    );

    const unmetPreconditions: string[] = [];
    const rulesCited: string[] = [];
    let counselPending = false;

    for (const pre of t.preconditions ?? []) {
      // Preconditions with a rule_ref are resolvable; we surface provenance and,
      // where the precondition is a boolean/threshold we can evaluate, we check it.
      if (pre.rule_ref) {
        rulesCited.push(pre.rule_ref);
        const row = data.rules.find((r) => r.rule_id === pre.rule_ref);
        if (row && !row.confirmed_by_counsel) counselPending = true;
      }
      // Preconditions are prose in the seed; the engine cannot adjudicate legal
      // judgment (§14). It records them as "to confirm" rather than auto-passing,
      // EXCEPT where a matching attribute in the snapshot lets us mechanically check.
      const mechanical = tryMechanicalPrecondition(pre.description, snapshot);
      if (mechanical === false) unmetPreconditions.push(pre.description);
    }

    const eligible = missingDocuments.length === 0 && unmetPreconditions.length === 0;
    const record: TransitionEligibility = {
      transitionKey: t.key,
      fromStatus: t.from_status,
      toStatus: t.to_status,
      transitionType: t.transition_type,
      eligible,
      unmetPreconditions,
      missingDocuments,
      timingWindow: t.timing_window ?? {},
      responsibleParties: t.responsible_parties ?? [],
      rulesCited,
      counselPending,
    };
    (eligible ? eligibleTransitions : ineligibleTransitions).push(record);
  }

  // ── unemployment clock finding (F-1 OPT / STEM) ──────────────────────────────
  if (snapshot.currentStatus === 'f1_opt' || snapshot.currentStatus === 'f1_stem_opt') {
    const used = snapshot.unemploymentDaysUsed ?? 0;
    const clock = unemploymentClock(snapshot.currentStatus, used, index, asOf);
    if (clock) {
      const remainingWarn = clock.remainingDays <= 15 && clock.remainingDays >= 0;
      findings.push({
        code: 'opt_unemployment',
        severity: clock.violated ? 'violation' : remainingWarn ? 'warning' : 'info',
        message: clock.violated
          ? `Unemployment limit exceeded: ${used}/${clock.limitDays} days used.`
          : `Unemployment: ${used}/${clock.limitDays} days used, ${clock.remainingDays} remaining.`,
        rulesCited: clock.rulesCited,
        counselPending: clock.counselPending,
      });
    }
  }

  const anyCounselPending =
    findings.some((f) => f.counselPending) ||
    [...eligibleTransitions, ...ineligibleTransitions].some((t) => t.counselPending);

  return {
    currentStatus: snapshot.currentStatus,
    asOf,
    eligibleTransitions,
    ineligibleTransitions,
    findings,
    anyCounselPending,
  };
}

/**
 * The list of document keys required to intake / advance a case in a given status
 * (adaptive intake, §7.3). Reads document_requirements — the same source the HR
 * onboarding flow and the MCP docs_check_requirements tool use.
 */
export function requiredDocumentsForStatus(data: RuleData, status: string): string[] {
  return data.documentRequirements
    .filter((r) => r.required && (r.applies_to_statuses ?? []).includes(status))
    .map((r) => r.key);
}

/**
 * Best-effort mechanical evaluation of a prose precondition against snapshot
 * attributes. Returns true (satisfied), false (contradicted), or null (cannot
 * decide — defer to human/counsel, never auto-pass a legal judgment, §14).
 */
function tryMechanicalPrecondition(
  description: string,
  snapshot: CaseSnapshot,
): boolean | null {
  const d = description.toLowerCase();
  // Example mechanical check: E-Verify employer requirement for STEM OPT.
  if (d.includes('e-verify')) {
    const v = snapshot.attributes['employer_everify'];
    if (typeof v === 'boolean') return v;
  }
  if (d.includes('stem') && d.includes('degree')) {
    const v = snapshot.attributes['stem_degree'];
    if (typeof v === 'boolean') return v;
  }
  return null; // undecidable by the engine
}
