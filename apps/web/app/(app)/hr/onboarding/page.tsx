import Link from 'next/link';
import { ClipboardList, CheckCircle2, Circle, ArrowRight, User, FileSignature, BadgeCheck, FileText, BookCheck, HeartPulse } from 'lucide-react';
import { getPrincipal, primaryRole, db } from '@/lib/session';
import { myEmployee, scopedEmployees } from '@/lib/data';
import { Card, Pill, EmptyState } from '@/components/ui';

const ICONS: Record<string, React.ReactNode> = {
  profile: <User size={16} />, offer: <FileSignature size={16} />, i9: <BadgeCheck size={16} />,
  w4: <FileText size={16} />, policy: <BookCheck size={16} />, benefits: <HeartPulse size={16} />, immigration: <FileText size={16} />,
};

export default async function OnboardingPage() {
  const principal = (await getPrincipal())!;
  const role = primaryRole(principal);
  const sql = db();
  const emp = await myEmployee(principal);

  if (!emp) {
    // Staff view: onboarding progress across scoped employees.
    const people = await scopedEmployees(principal);
    const rows = await Promise.all(people.map(async (p) => {
      const docsRes = await sql<{ docs: number }[]>`select count(*)::int docs from app.documents where employee_id = ${p.id}`;
      const i9Res = await sql<{ i9: number }[]>`select count(*)::int i9 from app.i9_records where employee_id = ${p.id} and section2_completed_at is not null`;
      return { ...p, docs: docsRes[0]?.docs ?? 0, i9: i9Res[0]?.i9 ?? 0 };
    }));
    return (
      <div>
        <div className="page-head"><div className="page-title">Onboarding</div><div className="page-sub">New-hire progress across your people.</div></div>
        <Card title="Onboarding status" icon={<ClipboardList size={18} />}>
          {rows.length === 0 ? <EmptyState icon={<ClipboardList size={22} />} title="No people onboarding" /> : (
            <div className="wrap-scroll"><table className="tbl">
              <thead><tr><th>Employee</th><th>Documents</th><th>I-9 Section 2</th><th>Status</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}><td style={{ fontWeight: 650 }}>{r.full_name}</td>
                  <td>{r.docs} uploaded</td>
                  <td>{r.i9 ? <Pill tone="ok">complete</Pill> : <Pill tone="warn">pending</Pill>}</td>
                  <td>{r.status === 'offboarded' ? <Pill tone="danger">offboarded</Pill> : <Pill tone="ok">active</Pill>}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      </div>
    );
  }

  // Employee view: personal checklist.
  const status = emp.work_authorization_category ?? 'f1_opt';
  const docCount = (await sql<{ docCount: number }[]>`select count(*)::int "docCount" from app.documents where employee_id = ${emp.id}`)[0]?.docCount ?? 0;
  const reqCount = (await sql<{ reqCount: number }[]>`select count(*)::int "reqCount" from app.document_requirements where required and applies_to_statuses @> ${sql.json([status] as never)}`)[0]?.reqCount ?? 0;
  const [i9] = await sql<{ section2: boolean }[]>`select (section2_completed_at is not null) as section2 from app.i9_records where employee_id = ${emp.id} limit 1`;
  const [w4] = await sql<{ n: number }[]>`select count(*)::int n from app.w4_records where employee_id = ${emp.id}`;
  const [pol] = await sql<{ n: number }[]>`select count(*)::int n from app.policy_acknowledgments where employee_id = ${emp.id} and acknowledged_at is not null`;
  const [ben] = await sql<{ n: number }[]>`select count(*)::int n from app.benefits_enrollments where employee_id = ${emp.id} and status <> 'pending'`;

  const items = [
    { key: 'profile', label: 'Complete your profile', done: true, href: '/profile', cat: 'profile' },
    { key: 'immigration', label: `Upload required documents (${docCount}/${reqCount || '—'})`, done: reqCount > 0 && docCount >= reqCount, href: '/documents', cat: 'immigration' },
    { key: 'i9', label: 'Complete I-9 verification', done: !!i9?.section2, href: '/hr/i9-w4', cat: 'i9' },
    { key: 'w4', label: 'Submit W-4', done: (w4?.n ?? 0) > 0, href: '/hr/i9-w4', cat: 'w4' },
    { key: 'policy', label: 'Acknowledge company policies', done: (pol?.n ?? 0) > 0, href: '/hr/policies', cat: 'policy' },
    { key: 'benefits', label: 'Enroll in benefits', done: (ben?.n ?? 0) > 0, href: '/hr/benefits', cat: 'benefits' },
  ];
  const done = items.filter((i) => i.done).length;
  const pct = Math.round((done / items.length) * 100);

  return (
    <div>
      <div className="page-head between">
        <div><div className="page-title">Onboarding</div><div className="page-sub">Complete these steps to finish setting up.</div></div>
        <Pill tone={pct === 100 ? 'ok' : 'brand'}>{done}/{items.length} complete</Pill>
      </div>

      <Card flat>
        <div className="between" style={{ marginBottom: 10 }}><div style={{ fontWeight: 650, fontSize: 13 }}>Your progress</div><div className="muted" style={{ fontWeight: 650 }}>{pct}%</div></div>
        <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
      </Card>

      <Card title="Checklist" icon={<ClipboardList size={18} />}>
        <div style={{ display: 'grid', gap: 8 }}>
          {items.map((it) => (
            <Link key={it.key} href={it.href} className="between" style={{ padding: '13px 15px', background: it.done ? 'var(--ok-bg)' : 'var(--surface-2)', border: `1px solid ${it.done ? 'var(--ok-bd)' : 'var(--border-2)'}`, borderRadius: 'var(--r-sm)' }}>
              <div className="row">
                {it.done ? <CheckCircle2 size={20} color="var(--ok)" /> : <Circle size={20} color="var(--faint)" />}
                <div className="row" style={{ gap: 8 }}><span style={{ color: 'var(--muted)' }}>{ICONS[it.cat]}</span><span style={{ fontWeight: 600, color: 'var(--ink)', textDecoration: it.done ? 'line-through' : 'none', opacity: it.done ? .7 : 1 }}>{it.label}</span></div>
              </div>
              {!it.done && <span className="row" style={{ color: 'var(--brand-600)', fontWeight: 650, fontSize: 13 }}>Go <ArrowRight size={14} /></span>}
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
