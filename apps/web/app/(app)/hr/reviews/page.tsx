import { revalidatePath } from 'next/cache';
import { Star, MessageSquare, CheckCircle2 } from 'lucide-react';
import { getPrincipal, primaryRole, db } from '@/lib/session';
import { myEmployee, scopedEmployeeIds } from '@/lib/data';
import { requirePermission } from '@hr/shared';
import { Card, Pill, EmptyState } from '@/components/ui';

const CURRENT_CYCLE = '2026 Mid-Year';

async function submitSelf(formData: FormData) {
  'use server';
  const principal = await getPrincipal();
  if (!principal) return;
  const emp = await myEmployee(principal);
  if (!emp) return;
  requirePermission(principal, { resource: 'hr_items', action: 'create', context: { employeeId: emp.id, ownerUserId: principal.userId, orgId: emp.org_id } });
  const summary = String(formData.get('summary') ?? '');
  const rating = String(formData.get('rating') ?? '');
  const sql = db();
  const [existing] = await sql`select id from app.performance_reviews where employee_id = ${emp.id} and cycle = ${CURRENT_CYCLE}`;
  if (existing) {
    await sql`update app.performance_reviews set self_input = ${sql.json({ summary, rating } as never)}, status = 'submitted', updated_at = now() where id = ${existing.id}`;
  } else {
    await sql`insert into app.performance_reviews (org_id, employee_id, cycle, self_input, status) values (${emp.org_id}, ${emp.id}, ${CURRENT_CYCLE}, ${sql.json({ summary, rating } as never)}, 'submitted')`;
  }
  revalidatePath('/hr/reviews');
}

export default async function ReviewsPage() {
  const principal = (await getPrincipal())!;
  const role = primaryRole(principal);
  const sql = db();
  const emp = await myEmployee(principal);

  if (!emp && role !== 'employee') {
    const ids = await scopedEmployeeIds(principal);
    const rows = ids.length ? await sql<{ employee_name: string; cycle: string; rating: string | null; status: string }[]>`
      select e.full_name as employee_name, r.cycle, r.rating, r.status from app.performance_reviews r join app.employees e on e.id = r.employee_id where r.employee_id = any(${ids}::uuid[]) order by r.created_at desc` : [];
    return (
      <div><div className="page-head"><div className="page-title">Performance Reviews</div><div className="page-sub">Review cycles across your team.</div></div>
        <Card title="Review cycles" icon={<Star size={18} />}>
          {rows.length === 0 ? <EmptyState icon={<Star size={22} />} title="No reviews in progress" /> : (
            <div className="wrap-scroll"><table className="tbl"><thead><tr><th>Employee</th><th>Cycle</th><th>Rating</th><th>Status</th></tr></thead>
              <tbody>{rows.map((r, i) => <tr key={i}><td style={{ fontWeight: 650 }}>{r.employee_name}</td><td>{r.cycle}</td><td>{r.rating ?? '—'}</td><td><Pill tone={r.status === 'signed_off' ? 'ok' : r.status === 'submitted' ? 'brand' : 'warn'}>{r.status}</Pill></td></tr>)}</tbody>
            </table></div>
          )}
        </Card>
      </div>
    );
  }

  const [mine] = await sql<{ self_input: { summary?: string; rating?: string } | null; manager_input: { summary?: string } | null; status: string }[]>`
    select self_input, manager_input, status from app.performance_reviews where employee_id = ${emp!.id} and cycle = ${CURRENT_CYCLE}`;

  return (
    <div>
      <div className="page-head between">
        <div><div className="page-title">Performance Reviews</div><div className="page-sub">Current cycle: {CURRENT_CYCLE}</div></div>
        <Pill tone={mine?.status === 'signed_off' ? 'ok' : mine?.status === 'submitted' ? 'brand' : 'warn'}>{mine?.status ?? 'not started'}</Pill>
      </div>

      <Card title={`Self-assessment · ${CURRENT_CYCLE}`} icon={<Star size={18} />}>
        <form action={submitSelf}>
          <label className="input-label">Overall self-rating</label>
          <select name="rating" defaultValue={mine?.self_input?.rating} className="input select" style={{ maxWidth: 260, marginBottom: 14 }}>
            <option value="Exceeds expectations">Exceeds expectations</option>
            <option value="Meets expectations">Meets expectations</option>
            <option value="Developing">Developing</option>
          </select>
          <label className="input-label">Summary of accomplishments</label>
          <textarea name="summary" defaultValue={mine?.self_input?.summary} rows={5} className="input" style={{ resize: 'vertical' }} placeholder="Key achievements, goals met, and areas of growth this cycle…" />
          <button className="btn btn-primary" style={{ marginTop: 14 }}>{mine ? 'Update self-assessment' : 'Submit self-assessment'}</button>
        </form>
      </Card>

      {mine?.manager_input?.summary && (
        <Card title="Manager feedback" icon={<MessageSquare size={18} />}>
          <div style={{ fontSize: 14, lineHeight: 1.6 }}>{mine.manager_input.summary}</div>
        </Card>
      )}
    </div>
  );
}
