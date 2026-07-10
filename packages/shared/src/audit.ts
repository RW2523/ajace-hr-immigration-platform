/**
 * Audit-log contract (§12). Every access to sensitive PII and every mutation of
 * case/HR data is recorded append-only. This module defines the shape; the DB
 * layer provides the append-only sink (INSERT-only grants, no UPDATE/DELETE).
 */
import { z } from 'zod';

export const auditEventSchema = z.object({
  actorUserId: z.string().uuid(),
  orgId: z.string().uuid().nullable(),
  action: z.string().min(1), // e.g. 'sensitive_pii.read', 'case.transition', 'document.download'
  resource: z.string().min(1), // e.g. 'employees:<id>', 'immigration_cases:<id>'
  /** Permission grant that authorized this action, for forensic traceability. */
  matchedPermission: z.string().nullable().optional(),
  /** Redacted before/after snapshots — never store raw SSNs here. */
  before: z.unknown().nullable().optional(),
  after: z.unknown().nullable().optional(),
  /** Free-form context (ip, user agent, request id). */
  context: z.record(z.unknown()).optional(),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

/** Actions that MUST be logged whenever they touch sensitive PII (§3.3, §12). */
export const SENSITIVE_ACTIONS = new Set([
  'sensitive_pii.read',
  'sensitive_pii.create',
  'sensitive_pii.update',
  'document.download',
  'i9.view',
  'w4.view',
]);

export interface AuditSink {
  record(event: AuditEvent): Promise<void>;
}
