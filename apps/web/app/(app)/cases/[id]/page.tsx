import Link from 'next/link';
import { getPrincipal, db } from '@/lib/session';
import { requirePermission } from '@hr/shared';
import { loadRuleData, validateCase, type CaseSnapshot } from '@hr/rules-engine';
import { Card, Pill } from '@/components/ui';
import { CounselPendingBadge } from '@/components/CounselPendingBadge';
import { ArrowRight, CalendarClock, GitBranch, AlertTriangle, CheckCircle2, Check, FileText } from 'lucide-react';

const TRACKS: Record<string, string[]> = {
  f1: ['f1_studying', 'f1_opt', 'f1_stem_opt', 'h1b_active', 'perm_filed', 'i140_approved', 'i485_pending', 'permanent_resident'],
  h1b: ['h1b_active', 'perm_filed', 'i140_pending', 'i140_approved', 'i485_pending', 'permanent_resident'],
  gc_overlay: ['perm_filed', 'perm_approved', 'i140_pending', 'i140_approved', 'i485_pending', 'permanent_resident'],
};
function short(s: string) { return s.replace(/_/g, ' ').replace('permanent resident', 'LPR'); }

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const principal = (await getPrincipal())!;
  const sql = db();
  const [c] = await sql<{ org_id: string; employee_id: string; current_status: string; country_of_birth: string | null; user_id: string | null; employee_name: string; track: string }[]>`
    select c.org_id, c.employee_id, c.current_status, c.country_of_birth, e.user_id, e.full_name as employee_name, s.track
    from app.immigration_cases c join app.employees e on e.id = c.employee_id join app.statuses s on s.key = c.current_status
    where c.id = ${id}`;
  if (!c) return <div className="page-head"><div className="page-title">Case not found</div></div>;
  try {
    requirePermission(principal, { resource: 'case_internals', action: 'read', context: { employeeId: c.employee_id, ownerUserId: c.user_id ?? undefined, orgId: c.org_id } });
  } catch { return <Card><div className="muted">You don't have access to this case.</div></Card>; }

  const asOf = new Date().toISOString().slice(0, 10);
  const data = await loadRuleData(sql);
  const dateRows = await sql<{ date_type: string; value: string }[]>`select date_type, to_char(value,'YYYY-MM-DD') as value from app.case_dates where case_id = ${id} order by value`;
  const dates: Record<string, string> = {};
  for (const r of dateRows) dates[r.date_type] = r.value;
  const snapshot: CaseSnapshot = { currentStatus: c.current_status, dates, collectedDocuments: [], attributes: {} };
  const result = validateCase(data, snapshot, asOf);

  const path = TRACKS[c.track] ?? [c.current_status];
  const curIdx = path.indexOf(c.current_status);

  return (
    <div>
      <div className="page-head between">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <div className="page-title">{short(c.current_status)}</div>
            <CounselPendingBadge pending={result.anyCounselPending} asOf={asOf} />
          </div>
          <div className="page-sub">{c.employee_name}{c.country_of_birth ? ` · born ${c.country_of_birth}` : ''} · case {id.slice(0, 8)}…</div>
        </div>
        <Link href="/cases" className="btn btn-ghost">Back to cases</Link>
      </div>

      <Card title="Case progression" icon={<GitBranch size={18} />} sub={`${c.track.replace('_', ' ')} track`}>
        <div className="stepper">
          {path.map((s, i) => {
            const cls = i < curIdx ? 'done' : i === curIdx ? 'current' : '';
            return (
              <div key={s} className={`step ${cls}`}>
                <div className="step-node">{i < curIdx ? <Check size={15} /> : i + 1}</div>
                <div className="step-label">{short(s)}</div>
              </div>
            );
          })}
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, alignItems: 'start' }}>
        <Card title="Eligible next steps" icon={<ArrowRight size={18} />}>
          {result.eligibleTransitions.length === 0 ? (
            <div className="muted" style={{ fontSize: 13 }}>No transitions are available from the current status right now.</div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {result.eligibleTransitions.map((t) => (
                <div key={t.transitionKey} className="between" style={{ padding: '11px 13px', background: 'var(--surface-2)', border: '1px solid var(--border-2)', borderRadius: 'var(--r-sm)' }}>
                  <div className="row"><div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--brand-50)', color: 'var(--brand-600)', display: 'grid', placeItems: 'center' }}><ArrowRight size={15} /></div>
                    <span style={{ fontWeight: 650 }}>{short(t.toStatus)}</span></div>
                  <Pill tone="neutral">{t.transitionType.replace('_', ' ')}</Pill>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Tracked deadlines" icon={<CalendarClock size={18} />}>
          {dateRows.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>No dates on file yet.</div> : (
            <div className="timeline">
              {dateRows.map((d) => (
                <div className="tl-item" key={d.date_type}>
                  <span className="tl-dot" />
                  <div className="tl-date">{d.value}</div>
                  <div className="tl-label">{d.date_type.replace(/_/g, ' ')}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {result.findings.length > 0 && (
        <Card title="Findings" icon={<AlertTriangle size={18} />}>
          <div style={{ display: 'grid', gap: 10 }}>
            {result.findings.map((f) => (
              <div key={f.code} className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                {f.severity === 'violation' ? <AlertTriangle size={17} color="var(--danger)" style={{ marginTop: 1 }} />
                  : f.severity === 'warning' ? <AlertTriangle size={17} color="var(--warn)" style={{ marginTop: 1 }} />
                  : <CheckCircle2 size={17} color="var(--ok)" style={{ marginTop: 1 }} />}
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5, color: f.severity === 'violation' ? 'var(--danger)' : 'var(--ink)' }}>{f.message}</div>
                  <div style={{ marginTop: 3 }}><CounselPendingBadge pending={f.counselPending} /></div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Documents" icon={<FileText size={18} />} actions={<Link href="/documents" className="btn btn-soft btn-sm">Manage <ArrowRight size={14} /></Link>}>
        <DocsRow caseId={id} sql={sql} />
      </Card>
    </div>
  );
}

async function DocsRow({ caseId, sql }: { caseId: string; sql: ReturnType<typeof db> }) {
  const docs = await sql<{ document_type: string; filename: string | null }[]>`select document_type, filename from app.documents where case_id = ${caseId} order by created_at desc limit 8`;
  if (docs.length === 0) return <div className="muted" style={{ fontSize: 13 }}>No documents uploaded for this case yet.</div>;
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
      {docs.map((d, i) => (
        <div key={i} className="pill pill-neutral" style={{ padding: '6px 12px' }}><FileText size={13} /> {d.filename ?? d.document_type}</div>
      ))}
    </div>
  );
}
