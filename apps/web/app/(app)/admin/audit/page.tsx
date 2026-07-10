import { ScrollText, ShieldAlert } from 'lucide-react';
import { getPrincipal, db } from '@/lib/session';
import { requirePermission } from '@hr/shared';
import { Card, Pill } from '@/components/ui';

export default async function AuditPage() {
  const principal = (await getPrincipal())!;
  try { requirePermission(principal, { resource: 'audit_log', action: 'read' }); }
  catch { return <Card><div className="muted">Admin only — the audit log is restricted.</div></Card>; }

  const rows = await db()<{ created_at: string; action: string; resource: string; actor: string | null }[]>`
    select to_char(a.created_at,'YYYY-MM-DD HH24:MI') as created_at, a.action, a.resource, u.email as actor
    from app.audit_log a left join app.users u on u.id = a.actor_user_id
    where a.org_id = ${principal.orgId} or a.org_id is null
    order by a.created_at desc limit 200`;

  const sensitive = (a: string) => a.includes('sensitive') || a.includes('download') || a.includes('upload');

  return (
    <div>
      <div className="page-head">
        <div className="page-title">Audit Log</div>
        <div className="page-sub">Append-only record of sensitive-PII access and case/HR mutations.</div>
      </div>
      <Card title="Recent activity" icon={<ScrollText size={18} />}>
        {rows.length === 0 ? <div className="muted">No audit events yet.</div> : (
          <div className="wrap-scroll">
            <table className="tbl">
              <thead><tr><th>When</th><th>Action</th><th>Resource</th><th>Actor</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="muted" style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{r.created_at}</td>
                    <td><Pill tone={sensitive(r.action) ? 'warn' : 'neutral'}>{sensitive(r.action) && <ShieldAlert size={12} />}{r.action}</Pill></td>
                    <td><code style={{ fontSize: 12 }}>{r.resource}</code></td>
                    <td className="muted">{r.actor ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
