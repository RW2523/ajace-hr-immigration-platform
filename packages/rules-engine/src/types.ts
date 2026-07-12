/**
 * Core types for the immigration rules engine (§7). The validator is a PURE
 * function over these — no I/O — so it is identically reusable from server
 * actions, the MCP rules-server, and the nightly deadline scan, and is trivially
 * table-testable against the seed data.
 */
import type { RuleRow, StatusRow, TransitionRow, DocumentRequirementRow } from '@hr/shared';

/** The immutable inputs the validator reads (hydrated from the DB or a fixture). */
export interface RuleData {
  statuses: StatusRow[];
  transitions: TransitionRow[];
  rules: RuleRow[];
  documentRequirements: DocumentRequirementRow[];
}

/** A point-in-time snapshot of one case, as fed to the validator. */
export interface CaseSnapshot {
  currentStatus: string;
  /** date_type → ISO date (YYYY-MM-DD). e.g. { opt_ead_start: '2025-06-01' }. */
  dates: Record<string, string>;
  /** Document type keys already collected & verified for this case. */
  collectedDocuments: string[];
  /** Free attributes used by preconditions (country_of_birth, employment_type…). */
  attributes: Record<string, string | number | boolean | null>;
  /** Days of unemployment already accrued (from prior tracking), if known. */
  unemploymentDaysUsed?: number;
}

/** Provenance attached to every value the engine uses (§14 "as-of / confirmed"). */
export interface RuleProvenance {
  ruleId: string;
  effectiveDate: string | null;
  confirmedByCounsel: boolean;
  sourceUrl: string;
  sourceCitation: string;
  lastVerified: string | null;
}

export interface ResolvedRule<T = unknown> {
  value: T;
  valueType: string;
  provenance: RuleProvenance;
}

export type Severity = 'ok' | 'info' | 'warning' | 'violation';

export interface Finding {
  code: string;
  severity: Severity;
  message: string;
  /** Rule ids this finding was derived from (traceability, §7.5). */
  rulesCited: string[];
  /** True if ANY cited rule is not yet counsel-confirmed (UI must flag). */
  counselPending: boolean;
}

export interface TransitionEligibility {
  transitionKey: string;
  fromStatus: string;
  toStatus: string;
  transitionType: string;
  /** True ONLY when there are no missing docs, no contradicted preconditions, AND
   *  no preconditions the engine cannot mechanically confirm. Never true while a
   *  legal precondition is merely unconfirmed (that is needsCounselReview). */
  eligible: boolean;
  /** True when the transition is blocked SOLELY by preconditions the engine cannot
   *  mechanically decide (no missing docs, nothing contradicted). The UI should
   *  render "pending counsel review" rather than a green "eligible" (§14, Bug 1). */
  needsCounselReview: boolean;
  /** Preconditions the engine mechanically evaluated to false (contradicted). */
  unmetPreconditions: string[];
  /** Preconditions the engine cannot mechanically decide — legal judgment deferred
   *  to counsel; these are NOT auto-passed (§14, Bug 1). */
  unconfirmedPreconditions: string[];
  /** Required document keys still missing. */
  missingDocuments: string[];
  timingWindow: Record<string, unknown>;
  responsibleParties: string[];
  rulesCited: string[];
  counselPending: boolean;
}

export interface ValidationResult {
  currentStatus: string;
  asOf: string;
  /** Mechanically clear to advance (docs + confirmable preconditions all met). */
  eligibleTransitions: TransitionEligibility[];
  /** Hard-blocked by missing documents or a contradicted precondition. */
  ineligibleTransitions: TransitionEligibility[];
  /** Blocked only by preconditions the engine cannot confirm — route to counsel.
   *  A distinct third bucket so the UI never shows these as "eligible" (Bug 1).
   *  Disjoint from eligibleTransitions and ineligibleTransitions. */
  needsCounselReviewTransitions: TransitionEligibility[];
  findings: Finding[];
  /** True if any value used anywhere in this result is counsel-pending (§14). */
  anyCounselPending: boolean;
}
