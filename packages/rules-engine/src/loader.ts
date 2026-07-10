/**
 * DB-backed hydration of RuleData for the validator. Runs as a trusted service
 * (reference data is global-read anyway). Keeps the validator itself pure by
 * separating I/O here.
 */
import type postgres from 'postgres';
import type {
  RuleRow,
  StatusRow,
  TransitionRow,
  DocumentRequirementRow,
} from '@hr/shared';
import type { RuleData } from './types.js';

export async function loadRuleData(sql: postgres.Sql): Promise<RuleData> {
  const [statuses, transitions, rules, documentRequirements] = await Promise.all([
    sql<StatusRow[]>`select key, label, track, sponsorship_required, work_authorized,
        work_authorization_evidence, is_overlay, placeholder, grace_period_days, notes
      from app.statuses`,
    sql<TransitionRow[]>`select key, from_status, to_status, transition_type, preconditions,
        required_documents, timing_window, responsible_parties, notification_date_types,
        edge_branches, spec_ref
      from app.transitions`,
    sql<RuleRow[]>`select rule_id, status_or_transition_key, attribute, value, value_type,
        to_char(effective_date,'YYYY-MM-DD') as effective_date, source_url, source_citation,
        confirmed_by_counsel, superseded_by, to_char(last_verified,'YYYY-MM-DD') as last_verified, notes
      from app.rules`,
    sql<DocumentRequirementRow[]>`select key, label, applies_to_statuses, applies_to_transitions,
        required, uploader, verifier, sensitive_pii, retention_note, notes
      from app.document_requirements`,
  ]);

  return {
    statuses: statuses as unknown as StatusRow[],
    transitions: transitions as unknown as TransitionRow[],
    rules: rules as unknown as RuleRow[],
    documentRequirements: documentRequirements as unknown as DocumentRequirementRow[],
  };
}
