import Link from 'next/link';
import {
  FolderOpen, CalendarClock, FileWarning, ShieldCheck, Users, ClipboardCheck,
  Sparkles, ArrowRight, AlertTriangle, CheckCircle2, Clock,
} from 'lucide-react';
import { getPrincipal, primaryRole, db } from '@/lib/session';
import { pendingI9, rulesSummary, scopedCases, scopedEmployees, scopedUpcomingDeadlines } from '@/lib/data';
import { Card, Pill, StatCard, EmptyState } from '@/components/ui';

function daysUntil(iso: string): number {
  return Math.round((new Date(iso + 'T00:00:00Z').getTime() - Date.now()) / 86400000);
}
function humanType(t: string) { return t.replace(/_/g, ' '); }

export default async function Dashboard() {
  const principal = (await getPrincipal())!;
  const role = primaryRole(principal);
  const isStaff = role === 'hr' || role === 'employer' || role === 'admin';

  const [u] = await db()<{ full_name: string }[]>`select full_name from app.users where id = ${principal.userId}`;
  const [employees, cases, deadlines] = await Promise.all([
    scopedEmployees(principal),
    scopedCases(principal),
    scopedUpcomingDeadlines(principal, 365),
  ]);
  const i9 = isStaff ? await pendingI9(principal) : [];
  const nextDeadline = deadlines[0];

  return (
    <div>
      <div className="page-head between">
        <div>
          <div className="page-title">Welcome back, {(u?.full_name ?? 'there').split(' ')[0]}</div>
          <div className="page-sub">Here's what needs your attention today.</div>
        </div>
        <Pill tone="brand">{role} workspace</Pill>
      </div>

      {/* Stats */}
      <div className="stats">
        {isStaff ? (
          <>
            <StatCard icon={<Users size={19} />} value={employees.length} label="People in scope" />
            <StatCard icon={<FolderOpen size={19} />} value={cases.length} label="Active cases" color="#7c3aed" bg="#f3e8ff" />
            <StatCard icon={<ClipboardCheck size={19} />} value={i9.length} label="I-9 / E-Verify pending"
              color={i9.length ? 'var(--warn)' : 'var(--ok)'} bg={i9.length ? 'var(--warn-bg)' : 'var(--ok-bg)'} />
            <StatCard icon={<CalendarClock size={19} />} value={deadlines.filter((d) => daysUntil(d.value) <= 30).length} label="Deadlines in 30 days"
              color="var(--danger)" bg="var(--danger-bg)" />
          </>
        ) : (
          <>
            <StatCard icon={<FolderOpen size={19} />} value={cases.length} label="Active cases" />
            <StatCard icon={<CalendarClock size={19} />} value={nextDeadline ? `${daysUntil(nextDeadline.value)}d` : '—'} label="To next deadline"
              color="var(--warn)" bg="var(--warn-bg)" />
            <StatCard icon={<FileWarning size={19} />} value={deadlines.length} label="Upcoming deadlines" color="#7c3aed" bg="#f3e8ff" />
            <StatCard icon={<ShieldCheck size={19} />} value={employees[0]?.work_authorization_category ? humanType(employees[0].work_authorization_category) : '—'}
              label="Work authorization" color="var(--ok)" bg="var(--ok-bg)" />
          </>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 18, alignItems: 'start' }}>
        <div>
          {/* Cases */}
          <Card title={isStaff ? 'Cases in scope' : 'My immigration cases'} icon={<FolderOpen size={18} />}
            actions={<Link href="/cases" className="btn btn-ghost btn-sm">View all <ArrowRight size={14} /></Link>}>
            {cases.length === 0 ? (
              <EmptyState icon={<FolderOpen size={22} />} title="No cases yet" sub="Start intake to open your first immigration case." />
            ) : (
              <div className="wrap-scroll">
                <table className="tbl">
                  <thead><tr><th>{isStaff ? 'Employee' : 'Case'}</th><th>Status</th><th>Country</th><th></th></tr></thead>
                  <tbody>
                    {cases.slice(0, 6).map((c) => (
                      <tr key={c.id}>
                        <td style={{ fontWeight: 650 }}>{c.employee_name}</td>
                        <td><Pill tone="brand">{humanType(c.current_status)}</Pill></td>
                        <td className="muted">—</td>
                        <td style={{ textAlign: 'right' }}><Link href={`/cases/${c.id}`} className="btn btn-soft btn-sm">Details</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {isStaff && (
            <Card title="I-9 / E-Verify pending" icon={<ClipboardCheck size={18} />} sub="Time-sensitive employment verification">
              {i9.length === 0 ? (
                <div className="row" style={{ color: 'var(--ok)', fontWeight: 600, fontSize: 13 }}><CheckCircle2 size={16} /> All caught up.</div>
              ) : (
                <div className="wrap-scroll"><table className="tbl">
                  <thead><tr><th>Employee</th><th>Section 2 due</th><th>E-Verify due</th></tr></thead>
                  <tbody>{i9.map((r, i) => (
                    <tr key={i}><td style={{ fontWeight: 650 }}>{r.employee_name}</td>
                      <td><Pill tone="warn"><Clock size={12} /> {r.section2_due ?? '—'}</Pill></td>
                      <td><Pill tone="warn"><Clock size={12} /> {r.everify_due ?? '—'}</Pill></td></tr>
                  ))}</tbody>
                </table></div>
              )}
            </Card>
          )}
        </div>

        <div>
          {/* Deadlines timeline */}
          <Card title="Upcoming deadlines" icon={<CalendarClock size={18} />}>
            {deadlines.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>No tracked deadlines in the next year.</div>
            ) : (
              <div className="timeline">
                {deadlines.slice(0, 6).map((d, i) => {
                  const dl = daysUntil(d.value);
                  const tone = dl <= 14 ? 'danger' : dl <= 45 ? 'warn' : '';
                  return (
                    <div className="tl-item" key={i}>
                      <span className={`tl-dot ${tone}`} />
                      <div className="tl-date">{d.value} · <span style={{ color: dl <= 14 ? 'var(--danger)' : 'var(--muted)' }}>{dl}d</span></div>
                      <div className="tl-label">{humanType(d.date_type)}</div>
                      <div className="tl-meta">{d.employee_name}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Assistant CTA */}
          <Link href="/assistant" style={{ display: 'block' }}>
            <div className="card" style={{ background: 'var(--brand-grad)', color: '#fff', border: 0, boxShadow: 'var(--sh-brand)' }}>
              <div className="row" style={{ marginBottom: 8 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,.2)', display: 'grid', placeItems: 'center' }}><Sparkles size={19} /></div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Ask the assistant</div>
              </div>
              <div style={{ fontSize: 13, opacity: .9, lineHeight: 1.5 }}>Get instant answers about your status, deadlines, and required documents. Legal questions route to counsel.</div>
              <div className="row" style={{ marginTop: 12, fontWeight: 650, fontSize: 13 }}>Start a chat <ArrowRight size={15} /></div>
            </div>
          </Link>

          {role === 'admin' && <AdminMini />}
        </div>
      </div>

      <div className="callout callout-warn" style={{ marginTop: 6 }}>
        <AlertTriangle size={18} className="ic" />
        <div>Immigration rule values shown across the platform are <strong>seed data pending counsel review</strong>. This is a status-and-deadline tracker, not legal advice.</div>
      </div>
    </div>
  );
}

async function AdminMini() {
  const s = await rulesSummary();
  return (
    <Card title="Rules engine" icon={<ShieldCheck size={18} />}>
      <div className="between" style={{ marginBottom: 10 }}>
        <div><div className="stat-value" style={{ fontSize: 22 }}>{s.total}</div><div className="stat-label">active rules · {s.domains} domains</div></div>
        <div style={{ textAlign: 'right' }}>
          <Pill tone="ok">{s.confirmed} confirmed</Pill><div style={{ height: 6 }} /><Pill tone="warn">{s.pending} pending</Pill>
        </div>
      </div>
      <Link href="/admin/rules" className="btn btn-ghost btn-sm" style={{ width: '100%' }}>Review rules <ArrowRight size={14} /></Link>
    </Card>
  );
}
