import { revalidatePath } from 'next/cache';
import { HeartPulse, Stethoscope, Eye, Smile, PiggyBank, CheckCircle2 } from 'lucide-react';
import { getPrincipal, db } from '@/lib/session';
import { myEmployee } from '@/lib/data';
import { requirePermission } from '@hr/shared';
import { Card, Pill } from '@/components/ui';

const PLANS = [
  { key: 'medical', label: 'Medical', icon: <Stethoscope size={18} />, options: ['Waive', 'PPO — Employee', 'PPO — Family', 'HDHP + HSA'] },
  { key: 'dental', label: 'Dental', icon: <Smile size={18} />, options: ['Waive', 'Basic', 'Premium'] },
  { key: 'vision', label: 'Vision', icon: <Eye size={18} />, options: ['Waive', 'Standard'] },
  { key: 'retirement', label: '401(k)', icon: <PiggyBank size={18} />, options: ['0%', '3%', '5%', '6% (max match)'] },
];

async function enroll(formData: FormData) {
  'use server';
  const principal = await getPrincipal();
  if (!principal) return;
  const emp = await myEmployee(principal);
  if (!emp) return;
  requirePermission(principal, { resource: 'hr_items', action: 'create', context: { employeeId: emp.id, ownerUserId: principal.userId, orgId: emp.org_id } });
  const selections: Record<string, string> = {};
  for (const p of PLANS) selections[p.key] = String(formData.get(p.key) ?? PLANS.find((x) => x.key === p.key)!.options[0]);
  const sql = db();
  await sql`insert into app.benefits_enrollments (org_id, employee_id, plan_selections, status)
            values (${emp.org_id}, ${emp.id}, ${sql.json(selections as never)}, 'enrolled')`;
  revalidatePath('/hr/benefits');
}

export default async function BenefitsPage() {
  const principal = (await getPrincipal())!;
  const emp = await myEmployee(principal);
  if (!emp) return <div><div className="page-head"><div className="page-title">Benefits</div></div><Card><div className="muted">Benefits enrollment is available to employees.</div></Card></div>;
  const [current] = await db()<{ plan_selections: Record<string, string>; status: string }[]>`
    select plan_selections, status from app.benefits_enrollments where employee_id = ${emp.id} order by created_at desc limit 1`;

  return (
    <div>
      <div className="page-head between">
        <div><div className="page-title">Benefits</div><div className="page-sub">Choose your coverage. Open enrollment guidance included.</div></div>
        {current ? <Pill tone="ok"><CheckCircle2 size={13} /> {current.status}</Pill> : <Pill tone="warn">Not enrolled</Pill>}
      </div>

      <div className="callout callout-info"><HeartPulse size={18} className="ic" /><div>Not sure what to pick? The <strong>PPO — Employee</strong> plan balances cost and coverage for most consultants, and a <strong>6% 401(k)</strong> contribution captures the full company match.</div></div>

      <Card title="Enrollment" icon={<HeartPulse size={18} />}>
        <form action={enroll}>
          <div style={{ display: 'grid', gap: 12 }}>
            {PLANS.map((p) => (
              <div key={p.key} className="between" style={{ padding: '14px 16px', background: 'var(--surface-2)', border: '1px solid var(--border-2)', borderRadius: 'var(--r-sm)' }}>
                <div className="row"><div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--brand-50)', color: 'var(--brand-600)', display: 'grid', placeItems: 'center' }}>{p.icon}</div><span style={{ fontWeight: 650 }}>{p.label}</span></div>
                <select name={p.key} defaultValue={current?.plan_selections?.[p.key]} className="input select" style={{ width: 220 }}>
                  {p.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            ))}
          </div>
          <button className="btn btn-primary" style={{ marginTop: 16 }}>{current ? 'Update elections' : 'Confirm enrollment'}</button>
        </form>
      </Card>
    </div>
  );
}
