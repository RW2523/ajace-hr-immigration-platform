import { revalidatePath } from 'next/cache';
import { BookCheck, CheckCircle2, ShieldCheck } from 'lucide-react';
import { getPrincipal, db } from '@/lib/session';
import { myEmployee } from '@/lib/data';
import { requirePermission } from '@hr/shared';
import { Card, Pill, EmptyState } from '@/components/ui';

const POLICIES = [
  { key: 'handbook', title: 'Employee Handbook', version: '2026.1', desc: 'Company policies, conduct, and expectations.' },
  { key: 'code_of_conduct', title: 'Code of Conduct', version: '2026.1', desc: 'Professional standards and ethical guidelines.' },
  { key: 'it_security', title: 'Information Security Policy', version: '2026.1', desc: 'Data handling, device, and access rules.' },
  { key: 'anti_harassment', title: 'Anti-Harassment & EEO', version: '2026.1', desc: 'A respectful, equal-opportunity workplace.' },
  { key: 'confidentiality', title: 'Confidentiality Agreement', version: '2026.1', desc: 'Client and company confidential information.' },
];

async function acknowledge(formData: FormData) {
  'use server';
  const principal = await getPrincipal();
  if (!principal) return;
  const emp = await myEmployee(principal);
  if (!emp) return;
  requirePermission(principal, { resource: 'hr_items', action: 'create', context: { employeeId: emp.id, ownerUserId: principal.userId, orgId: emp.org_id } });
  const key = String(formData.get('policy_key'));
  const version = String(formData.get('version'));
  await db()`insert into app.policy_acknowledgments (org_id, employee_id, policy_key, policy_version, acknowledged_at)
             values (${emp.org_id}, ${emp.id}, ${key}, ${version}, now())`;
  revalidatePath('/hr/policies');
}

export default async function PoliciesPage() {
  const principal = (await getPrincipal())!;
  const emp = await myEmployee(principal);
  if (!emp) return <div><div className="page-head"><div className="page-title">Policies</div></div><Card><div className="muted">Policy acknowledgment is available to employees.</div></Card></div>;

  const acks = await db()<{ policy_key: string; policy_version: string }[]>`
    select policy_key, policy_version from app.policy_acknowledgments where employee_id = ${emp.id} and acknowledged_at is not null`;
  const ackSet = new Set(acks.map((a) => `${a.policy_key}:${a.policy_version}`));
  const doneCount = POLICIES.filter((p) => ackSet.has(`${p.key}:${p.version}`)).length;

  return (
    <div>
      <div className="page-head between">
        <div><div className="page-title">Policies</div><div className="page-sub">Review and acknowledge company policies.</div></div>
        <Pill tone={doneCount === POLICIES.length ? 'ok' : 'brand'}>{doneCount}/{POLICIES.length} acknowledged</Pill>
      </div>
      <Card title="Company policies" icon={<BookCheck size={18} />}>
        <div style={{ display: 'grid', gap: 10 }}>
          {POLICIES.map((p) => {
            const done = ackSet.has(`${p.key}:${p.version}`);
            return (
              <div key={p.key} className="between" style={{ padding: '15px 16px', background: 'var(--surface-2)', border: '1px solid var(--border-2)', borderRadius: 'var(--r-sm)' }}>
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--brand-50)', color: 'var(--brand-600)', display: 'grid', placeItems: 'center', flex: '0 0 36px' }}><ShieldCheck size={18} /></div>
                  <div><div style={{ fontWeight: 700 }}>{p.title} <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>v{p.version}</span></div>
                    <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{p.desc}</div></div>
                </div>
                {done ? <Pill tone="ok"><CheckCircle2 size={13} /> Acknowledged</Pill> : (
                  <form action={acknowledge}><input type="hidden" name="policy_key" value={p.key} /><input type="hidden" name="version" value={p.version} /><button className="btn btn-primary btn-sm">I acknowledge</button></form>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
