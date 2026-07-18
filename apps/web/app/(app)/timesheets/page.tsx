import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { getPrincipal } from '@/lib/session';
import { Card, StatCard, Pill, EmptyState } from '@/components/ui';
import { Clock, Timer, Hourglass, CalendarDays, ArrowUpRight } from 'lucide-react';
import { UploadTimesheet } from '@/components/timesheets/UploadTimesheet';

export const metadata = { title: 'Timesheets · Ajace' };
export const dynamic = 'force-dynamic';

const TIMESHEET_URL = process.env.NEXT_PUBLIC_TIMESHEET_URL || 'https://ajace-timesheets.vercel.app';
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type Sheet = {
  id: string;
  year: number;
  month: number;
  client: string | null;
  monthly_regular: number | string | null;
  monthly_overtime: number | string | null;
  monthly_total: number | string | null;
  days_worked: number | null;
  ai_status: string | null;
};

function hrs(n: number | string | null): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return '0';
  return v % 1 === 0 ? String(v) : v.toFixed(1);
}

/**
 * Timesheets module — the employee's monthly records, rendered IN-PLACE in the platform
 * (rebuilt in the HR TS + design system) reading the shared ts_* tables under the signed-in
 * user's session (RLS-scoped to their own rows). Upload + AI extraction (Direct++) and the
 * admin review console are the next port increments; for now "Upload a timesheet" opens the
 * dedicated workspace.
 */
export default async function TimesheetsPage() {
  const supabase = await supabaseServer();
  const principal = await getPrincipal();
  const isTsAdmin = !!principal && principal.roleKeys.some((r) => r === 'admin' || r === 'employer');
  const [{ data: profileRows }, { data: sheetRows }, { data: editRows }] = await Promise.all([
    supabase.from('ts_profiles').select('full_name, job_title, client').limit(1),
    supabase
      .from('ts_timesheets')
      .select('id, year, month, client, monthly_regular, monthly_overtime, monthly_total, days_worked, ai_status')
      .order('year', { ascending: false })
      .order('month', { ascending: false })
      .limit(24),
    supabase.from('ts_employee_edits').select('timesheet_id, submitted').eq('submitted', true),
  ]);

  const profile = profileRows?.[0] as { full_name?: string; job_title?: string; client?: string } | undefined;
  const sheets = (sheetRows ?? []) as Sheet[];
  const submitted = new Set(((editRows ?? []) as { timesheet_id: string }[]).map((e) => e.timesheet_id));
  const latest = sheets[0];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Clock size={22} />
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 20 }}>Timesheets</h1>
          {profile && (
            <div className="muted" style={{ fontSize: 13 }}>
              {[profile.full_name, profile.job_title, profile.client && `@ ${profile.client}`].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        {isTsAdmin && (
          <Link
            href="/timesheets/admin"
            style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--brand-600, #4f46e5)', fontWeight: 600, textDecoration: 'none', fontSize: 13 }}
          >
            Admin review
          </Link>
        )}
        <a
          href={TIMESHEET_URL}
          target="_blank"
          rel="noreferrer"
          style={{ marginLeft: isTsAdmin ? undefined : 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--muted, #64748b)', fontWeight: 600, textDecoration: 'none', fontSize: 13 }}
          title="Legacy full workspace"
        >
          Full workspace <ArrowUpRight size={14} />
        </a>
      </div>

      {latest && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <StatCard icon={<Clock size={18} />} value={`${hrs(latest.monthly_total)} h`} label={`${MONTHS[latest.month]} ${latest.year} — Total`} />
          <StatCard icon={<Timer size={18} />} value={`${hrs(latest.monthly_regular)} h`} label="Regular" />
          <StatCard icon={<Hourglass size={18} />} value={`${hrs(latest.monthly_overtime)} h`} label="Overtime" />
          <StatCard icon={<CalendarDays size={18} />} value={String(latest.days_worked ?? 0)} label="Days worked" />
        </div>
      )}

      <Card title="Upload a monthly timesheet" sub="AI extracts hours, days, and totals from a PDF, image, Excel, email, or Word file.">
        <UploadTimesheet />
      </Card>

      <Card title="Your monthly timesheets">
        {sheets.length === 0 ? (
          <EmptyState icon={<Clock size={22} />} title="No timesheets yet" sub="Upload your first monthly timesheet from the workspace." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Month</th>
                <th>Client</th>
                <th>Regular</th>
                <th>OT</th>
                <th>Total</th>
                <th>Days</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sheets.map((s) => (
                <tr key={s.id}>
                  <td>{MONTHS[s.month]} {s.year}</td>
                  <td>{s.client ?? '—'}</td>
                  <td>{hrs(s.monthly_regular)}</td>
                  <td>{hrs(s.monthly_overtime)}</td>
                  <td><strong>{hrs(s.monthly_total)}</strong></td>
                  <td>{s.days_worked ?? '—'}</td>
                  <td>{submitted.has(s.id) ? <Pill tone="ok">Submitted</Pill> : <Pill>{s.ai_status ?? 'Draft'}</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
