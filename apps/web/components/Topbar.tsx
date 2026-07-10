'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, ChevronRight, Search } from 'lucide-react';

const LABELS: Record<string, string> = {
  dashboard: 'Dashboard', cases: 'Cases', people: 'People', profile: 'My Profile',
  documents: 'Documents', assistant: 'Assistant', intake: 'Intake', admin: 'Admin',
  rules: 'Rules Engine', audit: 'Audit Log',
};

export function Topbar({ initials, alerts = 0 }: { initials: string; alerts?: number }) {
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
      <div className="topbar-search">
        <Search size={15} />
        <input placeholder="Search cases, people, documents…" />
      </div>
      <Link href="/hr/helpdesk" className="icon-btn" title={alerts > 0 ? `${alerts} new notification${alerts > 1 ? 's' : ''}` : 'Notifications'}>
        <Bell size={17} />
        {alerts > 0 && <span className="badge-count">{alerts > 9 ? '9+' : alerts}</span>}
      </Link>
      <div className="avatar" title="Account">{initials}</div>
    </div>
  );
}
