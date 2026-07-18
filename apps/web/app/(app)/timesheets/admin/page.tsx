import Link from 'next/link';
import { getPrincipal } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { Card, StatCard, Pill, EmptyState } from '@/components/ui';
import { ClipboardCheck, AlertOctagon, CheckCircle2, Clock } from 'lucide-react';

export const metadata = { title: 'Timesheet review · Ajace' };
export const dynamic = 'force-dynamic';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type TsRow = {
  id: string;
  user_id: string;
  year: number;
  month: number;
  employee_name: string | null;
  client: string | null;
  monthly_total: number | string | null;
  days_worked: number | null;
  ai_status: string | null;
  ai_confidence: number | string | null;
};
type Prof = { id: string; full_name: string | null; email: string | null; employer: string | null };

function hrs(n: number | string | null): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return '0';
  return v % 1 === 0 ? String(v) : v.toFixed(1);
}

function statusPill(s: string | null) {
  if (s === 'blocked') return <Pill tone="danger">Blocked</Pill>;
  if (s === 'auto_accepted') return <Pill tone="ok">Clean</Pill>;
  return <Pill tone="warn">Needs review</Pill>;
}

const filterLink: React.CSSProperties = { fontSize: 12.5, textDecoration: 'none', color: 'var(--muted, #64748b)', padding: '4px 10px', borderRadius: 999, border: '1px solid var(--border, #e2e8f0)' };

/**
 * Timesheet review console — lists every employee's submissions for triage, limited to
 * firm leadership (admin / employer). The permission is enforced HERE (server-side); the
 * service-role client then reads across all users. Corrections (ts_admin_edits) + source
 * preview are follow-on increments.
 */
export default async function TimesheetAdminPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const principal = await getPrincipal();
  const allowed = !!principal && principal.roleKeys.some((r) => r === 'admin' || r === 'employer');
  if (!allowed) {
    return (
      <Card>
        <div className="muted">Admin only — timesheet review is limited to firm leadership.</div>
      </Card>
    );
  }
  const admin = supabaseAdmin();
  if (!admin) {
    return (
      <Card>
        <div className="muted">Set SUPABASE_SERVICE_ROLE_KEY to enable the review console.</div>
      </Card>
    );
  }

  const { status } = await searchParams;
  const [{ data: tsData }, { data: profData }, { data: subData }] = await Promise.all([
    admin
      .from('ts_timesheets')
      .select('id,user_id,year,month,employee_name,client,monthly_total,days_worked,ai_status,ai_confidence')
      .order('year', { ascending: false })
      .order('month', { ascending: false })
      .limit(500),
    admin.from('ts_profiles').select('id,full_name,email,employer'),
    admin.from('ts_employee_edits').select('timesheet_id,submitted').eq('submitted', true),
  ]);

  const rows = (tsData ?? []) as TsRow[];
  const profiles = new Map(((profData ?? []) as Prof[]).map((p) => [p.id, p]));
  const submitted = new Set(((subData ?? []) as { timesheet_id: string }[]).map((s) => s.timesheet_id));

  const counts = { total: rows.length, needs: 0, blocked: 0, clean: 0 };
  for (const r of rows) {
    if (r.ai_status === 'blocked') counts.blocked++;
    else if (r.ai_status === 'auto_accepted') counts.clean++;
    else counts.needs++;
  }
  const filtered = status ? rows.filter((r) => (r.ai_status ?? 'needs_review') === status) : rows;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <ClipboardCheck size={22} />
        <h1 style={{ margin: 0, fontSize: 20 }}>Timesheet review</h1>
        <Link href="/timesheets" style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--muted, #64748b)', textDecoration: 'none' }}>
          ← My timesheets
        </Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <StatCard icon={<Clock size={18} />} value={String(counts.total)} label="Submissions" />
        <StatCard icon={<AlertOctagon size={18} />} value={String(counts.blocked)} label="Blocked" color="#b91c1c" bg="#fef2f2" />
        <StatCard icon={<ClipboardCheck size={18} />} value={String(counts.needs)} label="Needs review" color="#b45309" bg="#fffbeb" />
        <StatCard icon={<CheckCircle2 size={18} />} value={String(counts.clean)} label="Clean" color="#16a34a" bg="#f0fdf4" />
      </div>

      <Card title="All submissions">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <Link href="/timesheets/admin" style={{ ...filterLink, ...(status ? {} : { background: '#4f46e5', color: '#fff', borderColor: '#4f46e5' }) }}>All</Link>
          <Link href="/timesheets/admin?status=needs_review" style={{ ...filterLink, ...(status === 'needs_review' ? { background: '#4f46e5', color: '#fff', borderColor: '#4f46e5' } : {}) }}>Needs review</Link>
          <Link href="/timesheets/admin?status=blocked" style={{ ...filterLink, ...(status === 'blocked' ? { background: '#4f46e5', color: '#fff', borderColor: '#4f46e5' } : {}) }}>Blocked</Link>
          <Link href="/timesheets/admin?status=auto_accepted" style={{ ...filterLink, ...(status === 'auto_accepted' ? { background: '#4f46e5', color: '#fff', borderColor: '#4f46e5' } : {}) }}>Clean</Link>
        </div>
        {filtered.length === 0 ? (
          <EmptyState icon={<ClipboardCheck size={22} />} title="No submissions" sub="Employee timesheets will appear here as they're processed." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Client</th>
                <th>Month</th>
                <th>Total</th>
                <th>Days</th>
                <th>Conf</th>
                <th>Status</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const p = profiles.get(r.user_id);
                const name = r.employee_name || p?.full_name || p?.email || '—';
                return (
                  <tr key={r.id}>
                    <td>
                      {name}
                      {p?.employer ? <span className="muted" style={{ fontSize: 11.5 }}> · {p.employer}</span> : null}
                    </td>
                    <td>{r.client ?? '—'}</td>
                    <td>{MONTHS[r.month]} {r.year}</td>
                    <td><strong>{hrs(r.monthly_total)}</strong></td>
                    <td>{r.days_worked ?? '—'}</td>
                    <td>{r.ai_confidence != null ? `${Math.round(Number(r.ai_confidence) * 100)}%` : '—'}</td>
                    <td>{statusPill(r.ai_status)}</td>
                    <td>{submitted.has(r.id) ? <Pill tone="ok">Yes</Pill> : <Pill>—</Pill>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
