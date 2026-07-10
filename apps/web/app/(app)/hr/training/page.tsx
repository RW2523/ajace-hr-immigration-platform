import { revalidatePath } from 'next/cache';
import { GraduationCap, CheckCircle2, PlayCircle, Clock } from 'lucide-react';
import { getPrincipal, primaryRole, db } from '@/lib/session';
import { myEmployee, scopedEmployeeIds } from '@/lib/data';
import { requirePermission } from '@hr/shared';
import { Card, Pill, StatCard, EmptyState } from '@/components/ui';

const CATALOG = [
  { course: 'Security Awareness', months: 12 },
  { course: 'Anti-Harassment Training', months: 12 },
  { course: 'Data Privacy & GDPR', months: 24 },
  { course: 'Workplace Code of Conduct', months: 12 },
];

async function complete(formData: FormData) {
  'use server';
  const principal = await getPrincipal();
  if (!principal) return;
  const emp = await myEmployee(principal);
  if (!emp) return;
  requirePermission(principal, { resource: 'hr_items', action: 'create', context: { employeeId: emp.id, ownerUserId: principal.userId, orgId: emp.org_id } });
  const course = String(formData.get('course'));
  const months = Number(formData.get('months') ?? 12);
  const sql = db();
  await sql`insert into app.training_records (org_id, employee_id, course, completed_at, expires_at)
            values (${emp.org_id}, ${emp.id}, ${course}, current_date, current_date + ${months * 30})`;
  revalidatePath('/hr/training');
}

export default async function TrainingPage() {
  const principal = (await getPrincipal())!;
  const role = primaryRole(principal);
  const sql = db();
  const emp = await myEmployee(principal);

  if (!emp && role !== 'employee') {
    const ids = await scopedEmployeeIds(principal);
    const rows = ids.length ? await sql<{ employee_name: string; course: string; completed_at: string | null; expires_at: string | null }[]>`
      select e.full_name as employee_name, t.course, to_char(t.completed_at,'YYYY-MM-DD') as completed_at, to_char(t.expires_at,'YYYY-MM-DD') as expires_at
      from app.training_records t join app.employees e on e.id = t.employee_id where t.employee_id = any(${ids}::uuid[]) order by t.completed_at desc` : [];
    return (
      <div><div className="page-head"><div className="page-title">Training</div><div className="page-sub">Completion across your people.</div></div>
        <Card title="Training records" icon={<GraduationCap size={18} />}>
          {rows.length === 0 ? <EmptyState icon={<GraduationCap size={22} />} title="No training records yet" /> : (
            <div className="wrap-scroll"><table className="tbl"><thead><tr><th>Employee</th><th>Course</th><th>Completed</th><th>Expires</th></tr></thead>
              <tbody>{rows.map((r, i) => <tr key={i}><td style={{ fontWeight: 650 }}>{r.employee_name}</td><td>{r.course}</td><td className="muted">{r.completed_at ?? '—'}</td><td><Pill tone="neutral">{r.expires_at ?? '—'}</Pill></td></tr>)}</tbody>
            </table></div>
          )}
        </Card>
      </div>
    );
  }

  const records = await sql<{ course: string; completed_at: string | null; expires_at: string | null }[]>`
    select course, to_char(completed_at,'YYYY-MM-DD') as completed_at, to_char(expires_at,'YYYY-MM-DD') as expires_at from app.training_records where employee_id = ${emp!.id}`;
  const doneMap = new Map(records.map((r) => [r.course, r]));
  const done = CATALOG.filter((c) => doneMap.has(c.course)).length;

  return (
    <div>
      <div className="page-head between">
        <div><div className="page-title">Training</div><div className="page-sub">Complete your assigned courses.</div></div>
        <Pill tone={done === CATALOG.length ? 'ok' : 'brand'}>{done}/{CATALOG.length} complete</Pill>
      </div>
      <div className="stats" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <StatCard icon={<CheckCircle2 size={19} />} value={done} label="Completed" color="var(--ok)" bg="var(--ok-bg)" />
        <StatCard icon={<Clock size={19} />} value={CATALOG.length - done} label="Assigned / due" color="var(--warn)" bg="var(--warn-bg)" />
        <StatCard icon={<GraduationCap size={19} />} value={CATALOG.length} label="Total courses" />
      </div>
      <Card title="Assigned courses" icon={<GraduationCap size={18} />}>
        <div style={{ display: 'grid', gap: 10 }}>
          {CATALOG.map((c) => {
            const rec = doneMap.get(c.course);
            return (
              <div key={c.course} className="between" style={{ padding: '14px 16px', background: rec ? 'var(--ok-bg)' : 'var(--surface-2)', border: `1px solid ${rec ? 'var(--ok-bd)' : 'var(--border-2)'}`, borderRadius: 'var(--r-sm)' }}>
                <div className="row">{rec ? <CheckCircle2 size={20} color="var(--ok)" /> : <PlayCircle size={20} color="var(--brand-500)" />}
                  <div><div style={{ fontWeight: 650 }}>{c.course}</div>{rec && <div className="muted" style={{ fontSize: 12 }}>Completed {rec.completed_at} · valid to {rec.expires_at}</div>}</div></div>
                {rec ? <Pill tone="ok">Complete</Pill> : (
                  <form action={complete}><input type="hidden" name="course" value={c.course} /><input type="hidden" name="months" value={c.months} /><button className="btn btn-primary btn-sm">Mark complete</button></form>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
