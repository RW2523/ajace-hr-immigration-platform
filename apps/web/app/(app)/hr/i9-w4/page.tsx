import { revalidatePath } from 'next/cache';
import { BadgeCheck, FileText, CheckCircle2, Clock, ShieldCheck, UserCheck } from 'lucide-react';
import { getPrincipal, primaryRole, db } from '@/lib/session';
import { myEmployee, scopedEmployees } from '@/lib/data';
import { hasStaffScope } from '@hr/shared';
import {
  PgAuditSink, storeW4, computeI9Timeline,
  openI9Record, completeI9Section1, completeI9Section2, recordEverifyCase,
} from '@hr/hr';
import { Card, Pill, Field, StatCard, EmptyState } from '@/components/ui';

const today = () => new Date().toISOString().slice(0, 10);

async function submitW4(formData: FormData) {
  'use server';
  const principal = await getPrincipal();
  if (!principal) return;
  const emp = await myEmployee(principal);
  if (!emp) return;
  const sql = db();
  await storeW4(sql, new PgAuditSink(sql), principal, emp.id, {
    filing_status: String(formData.get('filing_status')),
    dependents: Number(formData.get('dependents') ?? 0),
    extra_withholding: Number(formData.get('extra_withholding') ?? 0),
  }, 2026);
  revalidatePath('/hr/i9-w4');
}

// ── Staff I-9 actions (authorized inside the @hr/hr services) ────────────────
async function openI9(formData: FormData) {
  'use server';
  const principal = await getPrincipal();
  if (!principal) return;
  const sql = db();
  const employeeId = String(formData.get('employee_id'));
  const [emp] = await sql<{ hire_date: string | null }[]>`
    select to_char(hire_date,'YYYY-MM-DD') as hire_date from app.employees where id = ${employeeId}`;
  const hireDate = emp?.hire_date ?? today();
  const listType = String(formData.get('list_type'));
  const docs = listType === 'A'
    ? { listADoc: String(formData.get('list_a_doc') || 'List A document') }
    : { listBDoc: String(formData.get('list_b_doc') || 'List B document'), listCDoc: String(formData.get('list_c_doc') || 'List C document') };
  // openI9Record loads the employee, authorizes (requireContext), and writes the
  // Section 2 / E-Verify deadlines to app.case_dates for the notification scan.
  await openI9Record(sql, new PgAuditSink(sql), principal, { employeeId, hireDate, ...docs }, today());
  revalidatePath('/hr/i9-w4');
}

async function section2(formData: FormData) {
  'use server';
  const principal = await getPrincipal();
  if (!principal) return;
  await completeI9Section2(db(), new PgAuditSink(db()), principal, String(formData.get('i9_id')));
  revalidatePath('/hr/i9-w4');
}

async function everify(formData: FormData) {
  'use server';
  const principal = await getPrincipal();
  if (!principal) return;
  await recordEverifyCase(db(), new PgAuditSink(db()), principal, String(formData.get('i9_id')), String(formData.get('everify_case_id')));
  revalidatePath('/hr/i9-w4');
}

async function section1(formData: FormData) {
  'use server';
  const principal = await getPrincipal();
  if (!principal) return;
  // Employee attests Section 1 on their own record (authorized inside the service).
  await completeI9Section1(db(), new PgAuditSink(db()), principal, String(formData.get('i9_id')));
  revalidatePath('/hr/i9-w4');
}

interface I9Row {
  id: string; employee_id: string; employee_name: string;
  section1_completed_at: string | null; section2_completed_at: string | null;
  section2_due: string | null; everify_case_id: string | null; everify_due: string | null;
}

export default async function I9W4Page() {
  const principal = (await getPrincipal())!;
  const role = primaryRole(principal);
  const sql = db();
  const emp = await myEmployee(principal);
  const staff = hasStaffScope(principal, 'hr_items', 'read');

  // Staff without an employee record → management view.
  if (!emp && staff && role !== 'employee') {
    const people = await scopedEmployees(principal);
    const ids = people.map((p) => p.id);
    const records = ids.length ? await sql<I9Row[]>`
      select i.id, i.employee_id, e.full_name as employee_name,
        to_char(i.section1_completed_at,'YYYY-MM-DD') as section1_completed_at,
        to_char(i.section2_completed_at,'YYYY-MM-DD') as section2_completed_at,
        to_char(i.section2_due,'YYYY-MM-DD') as section2_due, i.everify_case_id,
        to_char(i.everify_due,'YYYY-MM-DD') as everify_due
      from app.i9_records i join app.employees e on e.id = i.employee_id
      where i.employee_id = any(${ids}::uuid[]) order by i.created_at desc` : [];
    const withRecord = new Set(records.map((r) => r.employee_id));
    const openable = people.filter((p) => !withRecord.has(p.id));

    return (
      <div>
        <div className="page-head"><div className="page-title">I-9 / E-Verify</div><div className="page-sub">Employment eligibility verification across your people.</div></div>
        <div className="callout callout-warn"><Clock size={18} className="ic" /><div>I-9 Section 2 must be completed within <strong>3 business days</strong> of the start date, and the E-Verify case created in the same window. Deadlines flow to the reminder engine automatically.</div></div>

        <Card title="Open a new I-9" icon={<BadgeCheck size={18} />}>
          {openable.length === 0 ? <div className="muted">Every scoped employee already has an I-9 record.</div> : (
            <form action={openI9}>
              <div className="fgrid">
                <div><label className="input-label">Employee</label>
                  <select name="employee_id" className="input select" required>
                    {openable.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                  </select></div>
                <div><label className="input-label">Document basis</label>
                  <select name="list_type" className="input select"><option value="A">List A (identity + work authorization)</option><option value="BC">List B + List C</option></select></div>
                <div><label className="input-label">List A document</label><input name="list_a_doc" className="input" placeholder="U.S. Passport" /></div>
                <div><label className="input-label">List B document</label><input name="list_b_doc" className="input" placeholder="Driver's license" /></div>
                <div><label className="input-label">List C document</label><input name="list_c_doc" className="input" placeholder="Social Security card" /></div>
              </div>
              <button className="btn btn-primary" style={{ marginTop: 16 }}><BadgeCheck size={16} /> Open I-9 record</button>
            </form>
          )}
        </Card>

        <Card title="I-9 records" icon={<BadgeCheck size={18} />}>
          {records.length === 0 ? <EmptyState icon={<BadgeCheck size={22} />} title="No I-9 records yet" /> : (
            <div className="wrap-scroll"><table className="tbl"><thead><tr><th>Employee</th><th>Section 1</th><th>Section 2</th><th>Section 2 due</th><th>E-Verify</th><th>Actions</th></tr></thead>
              <tbody>{records.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 650 }}>{r.employee_name}</td>
                  <td>{r.section1_completed_at ? <Pill tone="ok"><CheckCircle2 size={12} /> {r.section1_completed_at}</Pill> : <Pill tone="warn">pending</Pill>}</td>
                  <td>{r.section2_completed_at ? <Pill tone="ok"><CheckCircle2 size={12} /> {r.section2_completed_at}</Pill> : <Pill tone="warn">pending</Pill>}</td>
                  <td><Pill tone="warn"><Clock size={12} /> {r.section2_due ?? '—'}</Pill></td>
                  <td>{r.everify_case_id ? <Pill tone="ok"><ShieldCheck size={12} /> {r.everify_case_id}</Pill> : <Pill tone="warn">{r.everify_due ?? '—'}</Pill>}</td>
                  <td>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      {!r.section2_completed_at && (
                        <form action={section2}><input type="hidden" name="i9_id" value={r.id} /><button className="btn btn-ghost btn-sm"><UserCheck size={13} /> Complete Section 2</button></form>
                      )}
                      {!r.everify_case_id && (
                        <form action={everify} className="row" style={{ gap: 6 }}><input type="hidden" name="i9_id" value={r.id} /><input name="everify_case_id" className="input" placeholder="E-Verify case #" style={{ maxWidth: 150 }} required /><button className="btn btn-ghost btn-sm"><ShieldCheck size={13} /> Record</button></form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      </div>
    );
  }
  if (!emp) return <div><div className="page-head"><div className="page-title">I-9 / W-4</div></div><Card><div className="muted">No employee record linked.</div></Card></div>;

  const [i9] = await sql<{ id: string; section1_completed_at: string | null; section2_completed_at: string | null; section2_due: string | null; everify_case_id: string | null; everify_due: string | null }[]>`
    select id, to_char(section1_completed_at,'YYYY-MM-DD') as section1_completed_at, to_char(section2_completed_at,'YYYY-MM-DD') as section2_completed_at, to_char(section2_due,'YYYY-MM-DD') as section2_due, everify_case_id, to_char(everify_due,'YYYY-MM-DD') as everify_due
    from app.i9_records where employee_id = ${emp.id} limit 1`;
  const [hire] = await sql<{ hire_date: string | null }[]>`select to_char(hire_date,'YYYY-MM-DD') as hire_date from app.employees where id = ${emp.id}`;
  const timeline = hire?.hire_date ? await computeI9Timeline(sql, hire.hire_date, null, today()) : null;
  const [w4] = await sql<{ n: number }[]>`select count(*)::int n from app.w4_records where employee_id = ${emp.id}`;

  return (
    <div>
      <div className="page-head"><div className="page-title">I-9 / W-4</div><div className="page-sub">Employment eligibility &amp; tax withholding.</div></div>

      <div className="stats" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <StatCard icon={<BadgeCheck size={19} />} value={i9?.section2_completed_at ? 'Verified' : 'Pending'} label="I-9 status"
          color={i9?.section2_completed_at ? 'var(--ok)' : 'var(--warn)'} bg={i9?.section2_completed_at ? 'var(--ok-bg)' : 'var(--warn-bg)'} />
        <StatCard icon={<ShieldCheck size={19} />} value={i9?.everify_case_id ? 'Confirmed' : 'Pending'} label="E-Verify"
          color={i9?.everify_case_id ? 'var(--ok)' : 'var(--warn)'} bg={i9?.everify_case_id ? 'var(--ok-bg)' : 'var(--warn-bg)'} />
        <StatCard icon={<FileText size={19} />} value={(w4?.n ?? 0) > 0 ? 'Submitted' : 'Not filed'} label="W-4"
          color={(w4?.n ?? 0) > 0 ? 'var(--ok)' : 'var(--muted)'} bg={(w4?.n ?? 0) > 0 ? 'var(--ok-bg)' : 'var(--bg-soft)'} />
      </div>

      <Card title="Form I-9 — Employment Eligibility" icon={<BadgeCheck size={18} />}>
        <div className="fgrid">
          <Field label="Section 1 attested" value={i9?.section1_completed_at ?? '—'} />
          <Field label="Section 2 due" value={i9?.section2_due ?? timeline?.section2Due} />
          <Field label="Section 2 completed" value={i9?.section2_completed_at ?? '—'} />
          <Field label="E-Verify case" value={i9?.everify_case_id ?? '—'} />
        </div>
        {i9 && !i9.section1_completed_at && (
          <form action={section1} style={{ marginTop: 14 }}>
            <input type="hidden" name="i9_id" value={i9.id} />
            <button className="btn btn-primary"><UserCheck size={16} /> Attest &amp; complete Section 1</button>
          </form>
        )}
        {!i9 && <div className="callout callout-info" style={{ marginTop: 14, marginBottom: 0 }}><ShieldCheck size={16} className="ic" /><div>Your HR coordinator opens your I-9 record and completes Section 2 using the identity documents you upload under <strong>Documents</strong>.</div></div>}
        {i9?.section1_completed_at && <div className="callout callout-info" style={{ marginTop: 14, marginBottom: 0 }}><ShieldCheck size={16} className="ic" /><div>Section 1 attested. Your HR coordinator completes Section 2 and creates the E-Verify case.</div></div>}
      </Card>

      <Card title="Form W-4 — Tax Withholding" icon={<FileText size={18} />} sub="Stored encrypted (AES-256-GCM); access is audited">
        <form action={submitW4}>
          <div className="fgrid">
            <div><label className="input-label">Filing status</label><select name="filing_status" className="input select"><option value="single">Single or married filing separately</option><option value="married">Married filing jointly</option><option value="head">Head of household</option></select></div>
            <div><label className="input-label">Dependents</label><input name="dependents" type="number" min={0} defaultValue={0} className="input" /></div>
            <div><label className="input-label">Extra withholding ($ / paycheck)</label><input name="extra_withholding" type="number" min={0} defaultValue={0} className="input" /></div>
          </div>
          <button className="btn btn-primary" style={{ marginTop: 16 }}>{(w4?.n ?? 0) > 0 ? 'Update W-4' : 'Submit W-4'}</button>
        </form>
      </Card>
    </div>
  );
}
