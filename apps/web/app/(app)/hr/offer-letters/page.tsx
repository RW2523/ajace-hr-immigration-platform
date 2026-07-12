import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { FileSignature, Send, CheckCircle2 } from 'lucide-react';
import { getPrincipal, db } from '@/lib/session';
import { scopedEmployees } from '@/lib/data';
import { requirePermission, hasStaffScope } from '@hr/shared';
import { generateOfferLetter } from '@hr/hr';
import { Card, Pill, EmptyState } from '@/components/ui';

async function generate(formData: FormData) {
  'use server';
  const principal = await getPrincipal();
  if (!principal) return;
  const employeeId = String(formData.get('employee_id'));
  const sql = db();
  // Authorize against the target employee's real org/identity, not just the action.
  const [emp] = await sql<{ id: string; org_id: string; user_id: string | null }[]>`
    select id, org_id, user_id from app.employees where id = ${employeeId}`;
  if (!emp) return;
  requirePermission(principal, {
    resource: 'hr_items', action: 'create', requireContext: true,
    context: { orgId: emp.org_id, employeeId: emp.id, ownerUserId: emp.user_id ?? undefined },
  });
  await generateOfferLetter(db(), employeeId, {
    employee_name: String(formData.get('employee_name')),
    role_title: String(formData.get('role_title')),
    employment_type: String(formData.get('employment_type')) as 'placement' | 'direct_hire',
    start_date: String(formData.get('start_date')),
    compensation: String(formData.get('compensation')),
    work_location: String(formData.get('work_location')),
    employer_name: 'AJACE Inc',
  });
  revalidatePath('/hr/offer-letters');
}

export default async function OfferLettersPage() {
  const principal = (await getPrincipal())!;
  // Offer letters are staff-only. The nav hides this page; the server enforces it.
  if (!hasStaffScope(principal, 'hr_items', 'read')) {
    return <Card><div className="muted">You don't have access to offer letters.</div></Card>;
  }
  const sql = db();
  const people = await scopedEmployees(principal);
  const scopedIds = people.map((p) => p.id);
  const letters = scopedIds.length ? await sql<{ id: string; employee_name: string; role_title: string; esign_status: string; created_at: string }[]>`
    select o.id, e.full_name as employee_name, o.variables->>'role_title' as role_title, o.esign_status, to_char(o.created_at,'YYYY-MM-DD') as created_at
    from app.offer_letters o join app.employees e on e.id = o.employee_id
    where o.org_id = ${principal.orgId} and o.employee_id = any(${scopedIds}::uuid[]) order by o.created_at desc limit 30` : [];

  return (
    <div>
      <div className="page-head"><div className="page-title">Offer Letters</div><div className="page-sub">Generate and track offer letters.</div></div>

      <Card title="Generate an offer letter" icon={<FileSignature size={18} />}>
        <form action={generate}>
          <div className="fgrid">
            <div><label className="input-label">Employee</label>
              <select name="employee_id" className="input select" required>
                {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select></div>
            <div><label className="input-label">Full name (as on letter)</label><input name="employee_name" className="input" defaultValue={people[0]?.full_name} required /></div>
            <div><label className="input-label">Role title</label><input name="role_title" className="input" placeholder="Senior Consultant" required /></div>
            <div><label className="input-label">Employment type</label><select name="employment_type" className="input select"><option value="placement">Placement</option><option value="direct_hire">Direct hire</option></select></div>
            <div><label className="input-label">Start date</label><input name="start_date" type="date" className="input" required /></div>
            <div><label className="input-label">Compensation</label><input name="compensation" className="input" placeholder="$150,000 / year" required /></div>
            <div><label className="input-label">Work location</label><input name="work_location" className="input" placeholder="Client site, Austin TX" required /></div>
          </div>
          <button className="btn btn-primary" style={{ marginTop: 16 }}><Send size={16} /> Generate offer letter</button>
        </form>
      </Card>

      <Card title="Recent offer letters" icon={<FileSignature size={18} />}>
        {letters.length === 0 ? <EmptyState icon={<FileSignature size={22} />} title="No offer letters yet" /> : (
          <div className="wrap-scroll"><table className="tbl"><thead><tr><th>Employee</th><th>Role</th><th>Created</th><th>Status</th><th></th></tr></thead>
            <tbody>{letters.map((l) => (
              <tr key={l.id}><td style={{ fontWeight: 650 }}>{l.employee_name}</td><td>{l.role_title ?? '—'}</td><td className="muted">{l.created_at}</td>
                <td><Pill tone={l.esign_status === 'signed' ? 'ok' : l.esign_status === 'sent' ? 'brand' : 'neutral'}>{l.esign_status === 'signed' && <CheckCircle2 size={12} />}{l.esign_status}</Pill></td>
                <td><Link href={`/hr/offer-letters/${l.id}`} className="btn btn-ghost btn-sm">View</Link></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
