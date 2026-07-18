import { Card } from '@/components/ui';
import { Clock, ArrowUpRight } from 'lucide-react';

export const metadata = { title: 'Timesheets · Ajace' };

const TIMESHEET_URL = process.env.NEXT_PUBLIC_TIMESHEET_URL || 'https://ajace-timesheets.vercel.app';
const linkStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  marginTop: 8,
  color: 'var(--brand-600, #4f46e5)',
  fontWeight: 600,
  textDecoration: 'none',
} as const;

/**
 * Timesheets module — available to everyone (all consultants submit timesheets). The
 * (app) layout already requires an authenticated session. During the port it opens the
 * dedicated workspace; later it will host the timesheet UI in place.
 */
export default function TimesheetsPage() {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Clock size={22} />
        <h1 style={{ margin: 0, fontSize: 20 }}>Timesheets</h1>
      </div>
      <Card>
        <p>Upload monthly timesheets in any format — AI extracts and standardizes them for review and audit.</p>
        <a href={TIMESHEET_URL} target="_blank" rel="noreferrer" style={linkStyle}>
          Open Timesheets workspace <ArrowUpRight size={16} />
        </a>
        <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
          This module is being brought into the platform; for now it opens the dedicated workspace.
        </p>
      </Card>
    </div>
  );
}
