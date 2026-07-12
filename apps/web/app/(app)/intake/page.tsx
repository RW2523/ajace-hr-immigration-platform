import { redirect } from 'next/navigation';
import { FileCheck2, ClipboardList, ShieldQuestion } from 'lucide-react';
import { getPrincipal, db } from '@/lib/session';
import { requirePermission } from '@hr/shared';
import { CaseEngine } from '@hr/workflow';
import { Card, Pill } from '@/components/ui';

async function submitIntake(formData: FormData) {
  'use server';
  const principal = await getPrincipal();
  if (!principal) redirect('/login');
  const category = String(formData.get('category') ?? '');
  if (!category) return;
  const sql = db();
  const [emp] = await sql<{ id: string; org_id: string; user_id: string | null }[]>`select id, org_id, user_id from app.employees where user_id = ${principal!.userId}`;
  if (!emp) return;
  requirePermission(principal!, { resource: 'own_profile', action: 'update', requireContext: true, context: { ownerUserId: emp.user_id ?? undefined, orgId: emp.org_id } });
  await sql`update app.employees set work_authorization_category = ${category}, updated_at = now() where id = ${emp.id}`;
  const [existing] = await sql<{ id: string; current_status: string }[]>`select id, current_status from app.immigration_cases where employee_id = ${emp.id}`;
  let caseId: string;
  if (existing) {
    // Route the status change through the workflow engine so it is recorded in
    // case history. Intake is a self-declared correction, so it is a forced
    // (audited) transition rather than an eligibility-gated advance.
    if (existing.current_status !== category) {
      await new CaseEngine(sql).advance(
        { caseId: existing.id, toStatus: category, transitionKey: 'intake_declaration', initiatedBy: principal!.userId, force: true },
        new Date().toISOString().slice(0, 10),
      );
    }
    caseId = existing.id;
  } else {
    const [c] = await sql<{ id: string }[]>`insert into app.immigration_cases (org_id, employee_id, current_status) values (${emp.org_id}, ${emp.id}, ${category}) returning id`;
    caseId = c!.id;
  }
  redirect(`/cases/${caseId}`);
}

export default async function IntakePage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const principal = (await getPrincipal())!;
  const sql = db();
  const { category } = await searchParams;
  const statuses = await sql<{ key: string; label: string }[]>`select key, label from app.statuses where placeholder = false and is_overlay = false order by track, label`;
  const selected = category ?? statuses[0]?.key ?? '';
  const docs = selected
    ? await sql<{ key: string; label: string; required: boolean; sensitive_pii: boolean; uploader: string }[]>`
        select key, label, required, sensitive_pii, uploader from app.document_requirements where applies_to_statuses @> ${sql.json([selected] as never)} order by required desc, label`
    : [];

  return (
    <div>
      <div className="page-head">
        <div className="page-title">Immigration Intake</div>
        <div className="page-sub">Tell us your work-authorization category and we'll tailor the document checklist.</div>
      </div>

      <Card title="1 · Select your work-authorization category" icon={<ShieldQuestion size={18} />}>
        <form method="get" className="row" style={{ gap: 12 }}>
          <select name="category" defaultValue={selected} className="input select" style={{ maxWidth: 380 }}>
            {statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <button type="submit" className="btn btn-ghost">Show checklist</button>
        </form>
      </Card>

      <Card title={`2 · Documents for ${selected.replace(/_/g, ' ')}`} icon={<ClipboardList size={18} />}
        actions={<Pill tone="brand">{docs.filter((d) => d.required).length} required</Pill>}>
        {docs.length === 0 ? <div className="muted">No document requirements recorded for this category.</div> : (
          <div style={{ display: 'grid', gap: 8 }}>
            {docs.map((d) => (
              <div key={d.key} className="between" style={{ padding: '11px 14px', background: 'var(--surface-2)', border: '1px solid var(--border-2)', borderRadius: 'var(--r-sm)' }}>
                <div className="row"><FileCheck2 size={16} color="var(--brand-600)" /><span style={{ fontWeight: 600 }}>{d.label}</span></div>
                <div className="row" style={{ gap: 6 }}>
                  {d.sensitive_pii && <Pill tone="danger">sensitive</Pill>}
                  {d.required ? <Pill tone="warn">required</Pill> : <Pill tone="neutral">optional</Pill>}
                </div>
              </div>
            ))}
          </div>
        )}
        <form action={submitIntake} style={{ marginTop: 16 }}>
          <input type="hidden" name="category" value={selected} />
          <button type="submit" className="btn btn-primary"><FileCheck2 size={16} /> Confirm category &amp; open case</button>
        </form>
      </Card>
    </div>
  );
}
