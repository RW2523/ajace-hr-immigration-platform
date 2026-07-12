import { revalidatePath } from 'next/cache';
import { UserMinus, CalendarClock, CheckCircle2 } from 'lucide-react';
import { getPrincipal, db } from '@/lib/session';
import { scopedEmployees } from '@/lib/data';
import { requirePermission, hasStaffScope } from '@hr/shared';
import { OffboardingWorkflow } from '@hr/workflow';
import { Card, Pill, EmptyState } from '@/components/ui';

async function startOffboarding(formData: FormData) {
  'use server';
  const principal = await getPrincipal();
  if (!principal) return;
  const employeeId = String(formData.get('employee_id'));
  const lastDay = String(formData.get('last_day'));
  const sql = db();
  const [emp] = await sql<{ id: string; org_id: string; user_id: string | null }[]>`select id, org_id, user_id from app.employees where id = ${employeeId}`;
  if (!emp) return;
  requirePermission(principal, {
    resource: 'hr_items', action: 'update', requireContext: true,
    context: { orgId: emp.org_id, employeeId: emp.id, ownerUserId: emp.user_id ?? undefined },
  });
  const [ob] = await sql`insert into app.offboarding (org_id, employee_id, last_day, status) values (${emp.org_id}, ${employeeId}, ${lastDay}, 'in_progress') returning id`;
  // Completing triggers the immigration grace-period clock (H-1B 60-day / F-1 60-day).
  await new OffboardingWorkflow(sql).complete(ob!.id as string, lastDay);
  revalidatePath('/hr/offboarding');
}

export default async function OffboardingPage() {
  const principal = (await getPrincipal())!;
  // Offboarding is staff-only. The nav hides this page; the server enforces it.
  if (!hasStaffScope(principal, 'hr_items', 'update')) {
    return <Card><div className="muted">You don't have access to offboarding.</div></Card>;
  }
  const sql = db();
  const people = (await scopedEmployees(principal)).filter((p) => p.status !== 'offboarded');
  const scopedIds = people.map((p) => p.id);
  const records = scopedIds.length ? await sql<{ employee_name: string; last_day: string | null; status: string; grace: string | null }[]>`
    select e.full_name as employee_name, to_char(o.last_day,'YYYY-MM-DD') as last_day, o.status,
      (select to_char(cd.value,'YYYY-MM-DD') from app.case_dates cd join app.immigration_cases c on c.id = cd.case_id
       where c.employee_id = o.employee_id and cd.date_type like '%grace_period_end' order by cd.created_at desc limit 1) as grace
    from app.offboarding o join app.employees e on e.id = o.employee_id
    where o.org_id = ${principal.orgId} and o.employee_id = any(${scopedIds}::uuid[]) order by o.created_at desc limit 30` : [];

  return (
    <div>
      <div className="page-head"><div className="page-title">Offboarding</div><div className="page-sub">Complete a departure and start the immigration grace-period clock.</div></div>

      <div className="callout callout-warn"><CalendarClock size={18} className="ic" /><div>Completing offboarding for a sponsored employee automatically starts their grace-period clock (e.g. the <strong>H-1B 60-day grace</strong>) and notifies HR and counsel.</div></div>

      <Card title="Start offboarding" icon={<UserMinus size={18} />}>
        {people.length === 0 ? <div className="muted">No active employees to offboard.</div> : (
          <form action={startOffboarding} className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div><label className="input-label">Employee</label><select name="employee_id" className="input select" style={{ minWidth: 220 }}>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>
            <div><label className="input-label">Last working day</label><input name="last_day" type="date" className="input" required /></div>
            <button className="btn btn-danger">Complete offboarding</button>
          </form>
        )}
      </Card>

      <Card title="Offboarding history" icon={<UserMinus size={18} />}>
        {records.length === 0 ? <EmptyState icon={<UserMinus size={22} />} title="No offboarding records" /> : (
          <div className="wrap-scroll"><table className="tbl"><thead><tr><th>Employee</th><th>Last day</th><th>Grace period ends</th><th>Status</th></tr></thead>
            <tbody>{records.map((r, i) => (
              <tr key={i}><td style={{ fontWeight: 650 }}>{r.employee_name}</td><td className="muted">{r.last_day ?? '—'}</td>
                <td>{r.grace ? <Pill tone="warn"><CalendarClock size={12} /> {r.grace}</Pill> : <span className="muted">—</span>}</td>
                <td><Pill tone={r.status === 'complete' ? 'ok' : 'brand'}>{r.status === 'complete' && <CheckCircle2 size={12} />}{r.status}</Pill></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
