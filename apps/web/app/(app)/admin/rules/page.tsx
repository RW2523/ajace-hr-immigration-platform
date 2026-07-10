import { revalidatePath } from 'next/cache';
import { Scale, CheckCircle2, Clock } from 'lucide-react';
import { getPrincipal, db } from '@/lib/session';
import { requirePermission } from '@hr/shared';
import { Card, Pill, StatCard } from '@/components/ui';

async function ratify(formData: FormData) {
  'use server';
  const principal = await getPrincipal();
  if (!principal) return;
  requirePermission(principal, { resource: 'rules_engine', action: 'manage' });
  const ruleId = String(formData.get('rule_id') ?? '');
  const sql = db();
  await sql.begin(async (tx) => {
    await tx`update app.rules set confirmed_by_counsel = true, confirmed_by = ${principal.userId}, confirmed_at = now() where rule_id = ${ruleId}`;
    await tx`insert into app.audit_log (org_id, actor_user_id, action, resource, after) values (${principal.orgId}, ${principal.userId}, 'rule.ratify', ${'rules:' + ruleId}, ${tx.json({ confirmed_by_counsel: true } as never)})`;
  });
  revalidatePath('/admin/rules');
}

export default async function AdminRulesPage({ searchParams }: { searchParams: Promise<{ domain?: string }> }) {
  const principal = (await getPrincipal())!;
  try { requirePermission(principal, { resource: 'rules_engine', action: 'read' }); }
  catch { return <Card><div className="muted">Admin only.</div></Card>; }

  const { domain } = await searchParams;
  const sql = db();
  const [summary] = await sql<{ total: number; confirmed: number; pending: number; domains: number }[]>`
    select count(*)::int total, count(*) filter (where confirmed_by_counsel)::int confirmed, count(*) filter (where not confirmed_by_counsel)::int pending, count(distinct domain)::int domains
    from app.rules where superseded_by is null`;
  const domains = await sql<{ domain: string; n: number }[]>`select domain, count(*)::int n from app.rules where superseded_by is null group by domain order by domain`;
  const rules = await sql<{ rule_id: string; attribute: string; value: unknown; effective_date: string | null; confirmed_by_counsel: boolean; source_citation: string }[]>`
    select rule_id, attribute, value, to_char(effective_date,'YYYY-MM-DD') as effective_date, confirmed_by_counsel, source_citation
    from app.rules where superseded_by is null ${domain ? sql`and domain = ${domain}` : sql``}
    order by confirmed_by_counsel asc, attribute limit 250`;

  return (
    <div>
      <div className="page-head">
        <div className="page-title">Rules Engine</div>
        <div className="page-sub">Versioned immigration rules — counsel ratification gates user-facing use.</div>
      </div>

      <div className="stats" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <StatCard icon={<Scale size={19} />} value={summary?.total ?? 0} label={`active rules · ${summary?.domains ?? 0} domains`} />
        <StatCard icon={<CheckCircle2 size={19} />} value={summary?.confirmed ?? 0} label="confirmed by counsel" color="var(--ok)" bg="var(--ok-bg)" />
        <StatCard icon={<Clock size={19} />} value={summary?.pending ?? 0} label="pending review" color="var(--warn)" bg="var(--warn-bg)" />
      </div>

      <Card title="Domains" icon={<Scale size={18} />} flat>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <a href="/admin/rules" className={`suggest-chip${!domain ? ' active' : ''}`} style={!domain ? { borderColor: 'var(--brand-300)', background: 'var(--brand-50)', color: 'var(--brand-700)' } : undefined}>All</a>
          {domains.map((d) => <a key={d.domain} href={`/admin/rules?domain=${encodeURIComponent(d.domain)}`} className="suggest-chip" style={domain === d.domain ? { borderColor: 'var(--brand-300)', background: 'var(--brand-50)', color: 'var(--brand-700)' } : undefined}>{d.domain} · {d.n}</a>)}
        </div>
      </Card>

      <Card title={domain ? `Rules · ${domain}` : 'All active rules'} sub="Unratified first">
        <div className="wrap-scroll">
          <table className="tbl">
            <thead><tr><th>Attribute</th><th>Value</th><th>Effective</th><th>Citation</th><th>Counsel</th><th></th></tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.rule_id}>
                  <td style={{ fontWeight: 600 }}>{r.attribute}</td>
                  <td><code style={{ background: 'var(--bg-soft)', padding: '2px 6px', borderRadius: 5 }}>{JSON.stringify(r.value)}</code></td>
                  <td className="muted">{r.effective_date ?? '—'}</td>
                  <td className="muted" style={{ fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.source_citation || '—'}</td>
                  <td>{r.confirmed_by_counsel ? <Pill tone="ok">confirmed</Pill> : <Pill tone="warn">pending</Pill>}</td>
                  <td style={{ textAlign: 'right' }}>
                    {!r.confirmed_by_counsel && (
                      <form action={ratify}><input type="hidden" name="rule_id" value={r.rule_id} /><button className="btn btn-soft btn-sm">Ratify</button></form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
