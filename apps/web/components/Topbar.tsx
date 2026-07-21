'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Search } from 'lucide-react';
import { NotificationsBell, type Notice } from './NotificationsBell';

const LABELS: Record<string, string> = {
  dashboard: 'Dashboard', cases: 'Cases', people: 'People', profile: 'My Profile',
  documents: 'Documents', assistant: 'Assistant', intake: 'Intake', admin: 'Admin',
  rules: 'Rules Engine', audit: 'Audit Log',
};

// Cross-app switcher (in-flow, part of the topbar). URLs come from NEXT_PUBLIC_*
// with the deployed defaults; the current app (Immigration) is the highlighted pill.
const PROCUREMENT_URL = process.env.NEXT_PUBLIC_PROCUREMENT_URL ?? 'https://pocu-wheat.vercel.app';
const TIMESHEET_URL = process.env.NEXT_PUBLIC_TIMESHEET_URL ?? 'https://ajace-timesheets.vercel.app';

function AppSwitch() {
  return (
    <nav className="appswitch" aria-label="AJACE apps">
      <Link href="/dashboard" className="cur" aria-current="page">Immigration</Link>
      <a href={PROCUREMENT_URL}>Procurement</a>
      <a href={TIMESHEET_URL}>Timesheets</a>
    </nav>
  );
}

export function Topbar({ initials, notices, markAllRead }: { initials: string; notices: Notice[]; markAllRead: () => Promise<void> }) {
  const pathname = usePathname();
  const parts = pathname.split('/').filter(Boolean);
  const crumbs = parts.map((p, i) => ({
    label: LABELS[p] ?? (p.length > 12 ? p.slice(0, 8) + '…' : p),
    href: '/' + parts.slice(0, i + 1).join('/'),
    last: i === parts.length - 1,
  }));

  return (
    <div className="topbar">
      <div className="crumbs">
        <Link href="/dashboard">Home</Link>
        {crumbs.map((c) => (
          <span key={c.href} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <ChevronRight size={13} className="sep" />
            {c.last ? <span className="cur">{c.label}</span> : <Link href={c.href}>{c.label}</Link>}
          </span>
        ))}
      </div>
      <div className="topbar-spacer" />
      <AppSwitch />
      <div className="topbar-search">
        <Search size={15} />
        <input placeholder="Search cases, people, documents…" />
      </div>
      <NotificationsBell notices={notices} markAllRead={markAllRead} />
      <div className="avatar" title="Account">{initials}</div>
    </div>
  );
}
