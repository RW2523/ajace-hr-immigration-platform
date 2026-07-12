import {
  UserRound, ShieldCheck, Plane, BookOpen, GraduationCap, Mail, MapPin, Building2,
} from 'lucide-react';
import { getPrincipal, db } from '@/lib/session';
import { PgAuditSink, readSecureIds } from '@hr/hr';
import { Card, Field, Pill } from '@/components/ui';

// Sensitive immigration identifiers (passport/SEVIS/A-number) are NO LONGER in this
// plaintext blob — they live app-layer-encrypted in employee_secure_ids and are read
// via the audited PII service below (§12).
interface Profile {
  date_of_birth?: string; gender?: string; marital_status?: string;
  city_of_birth?: string; province_of_birth?: string; country_of_birth?: string; country_of_citizenship?: string;
  education?: { degree: string; school: string; graduated: string; address?: string }[];
  email?: string; phone?: string;
  us_address?: { street?: string; city?: string; state?: string; zip?: string };
  nearest_consulate?: string; ever_had_h1b_l1?: string;
}

export default async function ProfilePage() {
  const principal = (await getPrincipal())!;
  const sql = db();
  const [emp] = await sql<{ id: string; full_name: string; employment_type: string; work_authorization_category: string | null; hire_date: string | null; profile: Profile }[]>`
    select id, full_name, employment_type, work_authorization_category, to_char(hire_date,'YYYY-MM-DD') as hire_date, profile
    from app.employees where user_id = ${principal.userId}`;

  if (!emp) {
    return (
      <div>
        <div className="page-head"><div className="page-title">My Profile</div></div>
        <Card><div className="muted">No employee record is linked to your account yet.</div></Card>
      </div>
    );
  }
  const p = emp.profile ?? {};
  // Owner-audited decryption of sensitive identifiers (logs a sensitive_pii.read event).
  const secure = await readSecureIds(sql, new PgAuditSink(sql), principal, emp.id).catch(() => null);
  const [caseRow] = await sql<{ current_status: string; country_of_birth: string | null }[]>`
    select current_status, country_of_birth from app.immigration_cases where employee_id = ${emp.id} order by opened_at desc limit 1`;

  return (
    <div>
      <div className="page-head between">
        <div>
          <div className="page-title">My Profile</div>
          <div className="page-sub">Populated from your onboarding questionnaire · verified information</div>
        </div>
        <Pill tone="brand">{(emp.work_authorization_category ?? 'unknown').replace(/_/g, ' ')}</Pill>
      </div>

      <Card title="Personal Information" icon={<UserRound size={18} />}>
        <div className="fgrid">
          <Field label="Full name" value={emp.full_name} copy={emp.full_name} />
          <Field label="Date of birth" value={p.date_of_birth} />
          <Field label="Gender" value={p.gender} />
          <Field label="Marital status" value={p.marital_status} />
          <Field label="City of birth" value={p.city_of_birth} />
          <Field label="Province of birth" value={p.province_of_birth} />
          <Field label="Country of birth" value={p.country_of_birth ?? caseRow?.country_of_birth} />
          <Field label="Country of citizenship" value={p.country_of_citizenship} />
          <Field label="Social Security Number" value="•••-••-0917" mono />
          <Field label="Alien registration number" value={secure?.alien_registration_number ?? 'None'} />
        </div>
      </Card>

      <Card title="Immigration Status" icon={<ShieldCheck size={18} />}>
        <div className="fgrid">
          <Field label="Current status" value={caseRow ? <Pill tone="brand">{caseRow.current_status.replace(/_/g, ' ')}</Pill> : '—'} />
          <Field label="Employment type" value={emp.employment_type.replace('_', ' ')} />
          <Field label="SEVIS number" value={secure?.sevis_number} copy={secure?.sevis_number} mono />
          <Field label="Hire date" value={emp.hire_date} />
        </div>
      </Card>

      <Card title="U.S. Visa Information" icon={<Plane size={18} />}>
        <div className="fgrid">
          <Field label="Ever had H-1B or L-1" value={p.ever_had_h1b_l1 ?? 'No'} />
          <Field label="Nearest U.S. consulate" value={p.nearest_consulate} />
        </div>
      </Card>

      <Card title="Current Passport" icon={<BookOpen size={18} />}>
        <div className="fgrid">
          <Field label="Passport number" value={secure?.passport_number} copy={secure?.passport_number} mono />
          <Field label="Country of issuance" value={secure?.passport_country} />
          <Field label="Issue date" value={secure?.passport_issue} />
          <Field label="Expiration date" value={secure?.passport_expiry} />
        </div>
      </Card>

      <Card title="Education" icon={<GraduationCap size={18} />}>
        {(p.education ?? []).length === 0 ? <div className="muted">—</div> : (
          <div style={{ display: 'grid', gap: 12 }}>
            {p.education!.map((e, i) => (
              <div key={i} style={{ padding: '14px 16px', background: 'var(--surface-2)', border: '1px solid var(--border-2)', borderRadius: 'var(--r-sm)' }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{e.degree}</div>
                <div style={{ color: 'var(--ink-2)', fontSize: 13, marginTop: 2 }}>{e.school}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Graduated {e.graduated}{e.address ? ` · ${e.address}` : ''}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <Card title="Contact" icon={<Mail size={18} />}>
          <div className="fgrid fgrid-1">
            <Field label="Email" value={p.email} copy={p.email} />
            <Field label="Phone" value={p.phone} copy={p.phone} />
          </div>
        </Card>
        <Card title="Current U.S. Address" icon={<MapPin size={18} />}>
          <div className="fgrid fgrid-1">
            <Field label="Street address" value={p.us_address?.street} />
            <div className="fgrid">
              <Field label="City" value={p.us_address?.city} />
              <Field label="State" value={p.us_address?.state} />
            </div>
            <Field label="ZIP code" value={p.us_address?.zip} />
          </div>
        </Card>
      </div>
    </div>
  );
}
