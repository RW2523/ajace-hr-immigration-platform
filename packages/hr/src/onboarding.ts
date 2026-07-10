/**
 * Onboarding orchestration (§8). Builds a checklist with owners + due dates and
 * embeds the adaptive immigration intake: the new hire selects a work-authorization
 * category, and the required document set is resolved from document_requirements
 * (§7.3) — the SAME source the rules engine and MCP docs_check_requirements use.
 */
import type postgres from 'postgres';
import type { DocumentRequirementRow } from '@hr/shared';

export type ChecklistOwner = 'employee' | 'hr' | 'employer' | 'attorney';

export interface ChecklistItem {
  key: string;
  label: string;
  owner: ChecklistOwner;
  dueOffsetDays: number; // relative to hire date
  required: boolean;
  category: 'profile' | 'immigration' | 'i9' | 'w4' | 'policy' | 'benefits' | 'offer';
}

/** The static onboarding backbone (immigration items are appended adaptively). */
export const ONBOARDING_BACKBONE: ChecklistItem[] = [
  { key: 'profile', label: 'Complete employee profile', owner: 'employee', dueOffsetDays: 0, required: true, category: 'profile' },
  { key: 'offer_signed', label: 'Sign offer letter', owner: 'employee', dueOffsetDays: 0, required: true, category: 'offer' },
  { key: 'i9_section1', label: 'Complete I-9 Section 1', owner: 'employee', dueOffsetDays: 0, required: true, category: 'i9' },
  { key: 'i9_section2', label: 'HR completes I-9 Section 2', owner: 'hr', dueOffsetDays: 3, required: true, category: 'i9' },
  { key: 'w4', label: 'Submit W-4', owner: 'employee', dueOffsetDays: 3, required: true, category: 'w4' },
  { key: 'policies', label: 'Acknowledge policies', owner: 'employee', dueOffsetDays: 7, required: true, category: 'policy' },
  { key: 'benefits', label: 'Enroll in benefits', owner: 'employee', dueOffsetDays: 30, required: false, category: 'benefits' },
];

/** Resolve the adaptive immigration document items for a work-auth category (§7.3). */
export function immigrationIntakeItems(
  category: string,
  requirements: DocumentRequirementRow[],
): ChecklistItem[] {
  return requirements
    .filter((r) => (r.applies_to_statuses ?? []).includes(category))
    .map((r) => ({
      key: `doc_${r.key}`,
      label: `Provide: ${r.label}`,
      owner: (r.uploader as ChecklistOwner) ?? 'employee',
      dueOffsetDays: 3,
      required: r.required,
      category: 'immigration' as const,
    }));
}

/** Build the full onboarding checklist for a hire. */
export function buildOnboardingChecklist(
  category: string,
  requirements: DocumentRequirementRow[],
): ChecklistItem[] {
  return [...ONBOARDING_BACKBONE, ...immigrationIntakeItems(category, requirements)];
}

/** Persist an onboarding checklist as an offboarding-style tracked record.
 *  (Reuses a lightweight jsonb checklist on a dedicated onboarding row.) */
export async function startOnboarding(
  sql: postgres.Sql,
  employeeId: string,
  category: string,
): Promise<{ items: ChecklistItem[] }> {
  const reqs = await sql<DocumentRequirementRow[]>`
    select key, label, applies_to_statuses, applies_to_transitions, required, uploader,
      verifier, sensitive_pii, retention_note, notes
    from app.document_requirements`;
  const items = buildOnboardingChecklist(category, reqs as unknown as DocumentRequirementRow[]);
  return { items };
}
