import { revalidatePath } from 'next/cache';
import { CalendarDays, Check, X, Plus } from 'lucide-react';
import { getPrincipal, primaryRole, db } from '@/lib/session';
import { myEmployee, scopedEmployeeIds } from '@/lib/data';
import { requirePermission } from '@hr/shared';
import { Card, Pill, StatCard, EmptyState } from '@/components/ui';

async function requestLeave(formData: FormData) {
  'use server';
  const principal = await getPrincipal();
  if (!principal) return;
  const emp = await myEmployee(principal);
  if (!emp) return;
  requirePermission(principal, { resource: 'hr_items', action: 'create', context: { employeeId: emp.id, ownerUserId: principal.userId, orgId: emp.org_id } });
  const sql = db();
  await sql`insert into app.leave_requests (org_id, employee_id, leave_type, start_date, end_date, status)
            values (${emp.org_id}, ${emp.id}, ${String(formData.get('leave_type'))}, ${String(formData.get('start_date'))}, ${String(formData.get('end_date'))}, 'requested')`;
  revalidatePath('/hr/leave');
}

async function decide(formData: FormData) {
  'use server';
  const principal = await getPrincipal();
  if (!principal) return;
  requirePermission(principal, { resource: 'hr_items', action: 'update' });
  const id = String(formData.get('id'));
  const status = String(formData.get('status'));
  const sql = db();
  await sql`update app.leave_requests set status = ${status}, approver_user_id = ${principal.userId}, updated_at = now() where id = ${id}`;
  revalidatePath('/hr/leave');
}

export default async function LeavePage() {
  const principal = (await getPrincipal())!;
  const role = primaryRole(principal);
  const isStaff = role !== 'employee';
  const sql = db();
  const ids = await scopedEmployeeIds(principal);
  const rows = ids.length
    ? await sql<{ id: string; employee_name: string; leave_type: string; start_date: string; end_date: string; status: string }[]>`
      select l.id, e.full_name as employee_name, l.leave_type, to_char(l.start_date,'YYYY-MM-DD') as start_date, to_char(l.end_date,'YYYY-MM-DD') as end_date, l.status
      from app.leave_requests l join app.employees e on e.id = l.employee_id
      where l.employee_id = any(${ids}::uuid[]) order by l.created_at desc`
    : [];
  const mine = await myEmployee(principal);
  const tone = (s: string) => (s === 'approved' ? 'ok' : s === 'denied' ? 'danger' : s === 'cancelled' ? 'neutral' : 'warn');

  return (
    <div>
      <div className="page-head between">
        <div><div className="page-title">Time Off</div><div className="page-sub">Request leave and track approvals.</div></div>
      </div>

      <div className="stats" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <StatCard icon={<CalendarDays size={19} />} value={rows.filter((r) => r.status === 'requested').length} label="Pending approval" color="var(--warn)" bg="var(--warn-bg)" />
        <StatCard icon={<Check size={19} />} value={rows.filter((r) => r.status === 'approved').length} label="Approved" color="var(--ok)" bg="var(--ok-bg)" />
        <StatCard icon={<CalendarDays size={19} />} value={rows.length} label="Total requests" />
      </div>

      {mine && (
        <Card title="Request time off" icon={<Plus size={18} />}>
          <form action={requestLeave} className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div><label className="input-label">Type</label>
              <select name="leave_type" className="input select" style={{ width: 160 }}>
                <option value="pto">PTO</option><option value="sick">Sick</option><option value="unpaid">Unpaid</option><option value="parental">Parental</option>
              </select></div>
            <div><label className="input-label">Start</label><input name="start_date" type="date" className="input" required /></div>
            <div><label className="input-label">End</label><input name="end_date" type="date" className="input" required /></div>
            <button className="btn btn-primary">Submit request</button>
          </form>
        </Card>
      )}

      <Card title={isStaff ? 'Requests to review' : 'My requests'} icon={<CalendarDays size={18} />}>
        {rows.length === 0 ? <EmptyState icon={<CalendarDays size={22} />} title="No leave requests" /> : (
          <div className="wrap-scroll"><table className="tbl">
            <thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Status</th>{isStaff && <th></th>}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 650 }}>{r.employee_name}</td>
                <td style={{ textTransform: 'capitalize' }}>{r.leave_type}</td>
                <td className="muted">{r.start_date} → {r.end_date}</td>
                <td><Pill tone={tone(r.status)}>{r.status}</Pill></td>
                {isStaff && <td style={{ textAlign: 'right' }}>
                  {r.status === 'requested' && (
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      <form action={decide}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="approved" /><button className="btn btn-soft btn-sm"><Check size={13} /> Approve</button></form>
                      <form action={decide}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="denied" /><button className="btn btn-danger btn-sm"><X size={13} /> Deny</button></form>
                    </div>
                  )}
                </td>}
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
