/**
 * Postgres-backed audit sink (§12). Writes append-only rows to app.audit_log.
 * Every sensitive-PII access and every case/HR mutation routes through here.
 * Runs with the trusted connection so a failed authorization still gets logged.
 */
import type postgres from 'postgres';
import { auditEventSchema, type AuditEvent, type AuditSink } from '@hr/shared';

export class PgAuditSink implements AuditSink {
  constructor(private sql: postgres.Sql) {}

  async record(event: AuditEvent): Promise<void> {
    const e = auditEventSchema.parse(event);
    await this.sql`
      insert into app.audit_log (org_id, actor_user_id, action, resource, matched_permission, before, after, context)
      values (${e.orgId}, ${e.actorUserId}, ${e.action}, ${e.resource},
        ${e.matchedPermission ?? null}, ${this.sql.json((e.before ?? null) as never)},
        ${this.sql.json((e.after ?? null) as never)}, ${this.sql.json((e.context ?? {}) as never)})`;
  }
}
