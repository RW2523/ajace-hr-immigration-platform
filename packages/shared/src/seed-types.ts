/**
 * Types + zod validators for the immigration seed data in `data/immigration-seed/`.
 * These validate the JSON at load time so a malformed seed file fails loudly
 * rather than silently loading garbage into the rules table.
 */
import { z } from 'zod';

export const valueTypeSchema = z.enum([
  'count_days',
  'business_days', // calendar-distinct: durations denominated in business/working days
  'count',
  'duration_months',
  'duration_years',
  'date',
  'money_usd',
  'percent',
  'boolean',
  'text',
  'window_days',
]);
export type ValueType = z.infer<typeof valueTypeSchema>;

export const ruleRowSchema = z.object({
  rule_id: z.string().min(1),
  status_or_transition_key: z.string().min(1),
  attribute: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  value_type: valueTypeSchema,
  effective_date: z.string().nullable().optional().default(null),
  source_url: z.string().optional().default(''),
  source_citation: z.string().optional().default(''),
  confirmed_by_counsel: z.boolean(),
  superseded_by: z.string().nullable(),
  last_verified: z.string().nullable().optional().default(null),
  notes: z.string().optional().default(''),
});
export type RuleRow = z.infer<typeof ruleRowSchema>;

export const rulesFileSchema = z.object({
  domain: z.string(),
  generated_at: z.string(),
  rules: z.array(ruleRowSchema),
});

export const statusRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  track: z.string(),
  sponsorship_required: z.boolean(),
  work_authorized: z.boolean(),
  work_authorization_evidence: z.array(z.string()).optional().default([]),
  is_overlay: z.boolean().optional().default(false),
  placeholder: z.boolean().optional().default(false),
  grace_period_days: z.number().nullable().optional(),
  notes: z.string().optional().default(''),
});
export type StatusRow = z.infer<typeof statusRowSchema>;

export const transitionRowSchema = z.object({
  key: z.string(),
  from_status: z.string(),
  to_status: z.string(),
  transition_type: z.string(),
  preconditions: z
    .array(z.object({ description: z.string(), rule_ref: z.string().nullable() }))
    .optional()
    .default([]),
  required_documents: z.array(z.string()).optional().default([]),
  timing_window: z.record(z.unknown()).optional(),
  responsible_parties: z.array(z.string()).optional().default([]),
  notification_date_types: z.array(z.string()).optional().default([]),
  edge_branches: z.array(z.string()).optional().default([]),
  spec_ref: z.string().optional().default(''),
});
export type TransitionRow = z.infer<typeof transitionRowSchema>;

export const documentRequirementRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  applies_to_statuses: z.array(z.string()).optional().default([]),
  applies_to_transitions: z.array(z.string()).optional().default([]),
  required: z.boolean().optional().default(true),
  uploader: z.string().optional().default('employee'),
  verifier: z.string().optional().default('hr'),
  sensitive_pii: z.boolean().optional().default(false),
  retention_note: z.string().optional().default(''),
  notes: z.string().optional().default(''),
});
export type DocumentRequirementRow = z.infer<typeof documentRequirementRowSchema>;

export const notificationTriggerRowSchema = z.object({
  date_type: z.string(),
  label: z.string(),
  applies_to_statuses: z.array(z.string()).optional().default([]),
  default_offsets_days: z.array(z.number()),
  escalation: z.array(
    z.object({
      level: z.number(),
      recipient: z.string(),
      at_offsets: z.array(z.number()),
    }),
  ),
  channels: z.array(z.string()).optional().default(['email', 'in_app']),
  spec_ref: z.string().optional().default(''),
});
export type NotificationTriggerRow = z.infer<typeof notificationTriggerRowSchema>;
