'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard, FolderOpen, UserRound, FileText, Sparkles, Users,
  Scale, ScrollText, ChevronsLeft, ChevronsRight, LogOut,
  ClipboardList, CalendarDays, HeartPulse, GraduationCap, Star, BookCheck,
  LifeBuoy, FileSignature, BadgeCheck, UserMinus, ShieldCheck,
  Clock, Briefcase,
} from 'lucide-react';

interface NavItem { href: string; label: string; icon: React.ReactNode; }

export function Sidebar({
  role, userName, email, initials, onSignOut, canProcurement,
}: {
  role: string; userName: string; email: string; initials: string;
  onSignOut: () => void; canProcurement: boolean;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem('sb-collapsed') === '1');
  }, []);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('sb-collapsed', next ? '1' : '0');
  };

  const isStaff = role === 'hr' || role === 'employer' || role === 'admin';
  const main: NavItem[] = [
    { href: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { href: '/cases', label: isStaff ? 'Cases' : 'My Cases', icon: <FolderOpen size={18} /> },
    ...(isStaff ? [{ href: '/people', label: 'People', icon: <Users size={18} /> }] : []),
    { href: '/profile', label: 'My Profile', icon: <UserRound size={18} /> },
    { href: '/documents', label: 'Documents', icon: <FileText size={18} /> },
    { href: '/assistant', label: 'Assistant', icon: <Sparkles size={18} /> },
    { href: '/security', label: 'Security', icon: <ShieldCheck size={18} /> },
  ];
  // Platform modules. Timesheets is for everyone; Procurement is shown only to users
  // whose role grants it (admin / employer / procurement) — "limited users".
  const modules: NavItem[] = [
    { href: '/timesheets', label: 'Timesheets', icon: <Clock size={18} /> },
    ...(canProcurement ? [{ href: '/procurement', label: 'Procurement', icon: <Briefcase size={18} /> }] : []),
  ];
  const hr: NavItem[] = [
    { href: '/hr/onboarding', label: 'Onboarding', icon: <ClipboardList size={18} /> },
    { href: '/hr/leave', label: 'Time Off', icon: <CalendarDays size={18} /> },
    { href: '/hr/benefits', label: 'Benefits', icon: <HeartPulse size={18} /> },
    { href: '/hr/training', label: 'Training', icon: <GraduationCap size={18} /> },
    { href: '/hr/reviews', label: 'Reviews', icon: <Star size={18} /> },
    { href: '/hr/policies', label: 'Policies', icon: <BookCheck size={18} /> },
    { href: '/hr/helpdesk', label: 'Help Desk', icon: <LifeBuoy size={18} /> },
    ...(isStaff
      ? [
          { href: '/hr/offer-letters', label: 'Offer Letters', icon: <FileSignature size={18} /> },
          { href: '/hr/i9-w4', label: 'I-9 / W-4', icon: <BadgeCheck size={18} /> },
          { href: '/hr/offboarding', label: 'Offboarding', icon: <UserMinus size={18} /> },
        ]
      : []),
  ];
  const admin: NavItem[] = role === 'admin'
    ? [
        { href: '/admin/rules', label: 'Rules Engine', icon: <Scale size={18} /> },
        { href: '/admin/audit', label: 'Audit Log', icon: <ScrollText size={18} /> },
      ]
    : [];

  const active = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="brand">
        <div className="brand-mark"><Scale size={19} /></div>
        <div className="brand-text">
          <div className="brand-name">Ajace</div>
          <div className="brand-sub">Immigration · HR</div>
        </div>
        <button className="collapse-btn" onClick={toggle} title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
        </button>
      </div>

      <nav className="nav">
        <div className="nav-section">Workspace</div>
        {main.map((it) => (
          <Link key={it.href} href={it.href} className={`nav-item${active(it.href) ? ' active' : ''}`} title={it.label}>
            {it.icon}
            <span className="nav-label">{it.label}</span>
          </Link>
        ))}
        <div className="nav-section">Modules</div>
        {modules.map((it) => (
          <Link key={it.href} href={it.href} className={`nav-item${active(it.href) ? ' active' : ''}`} title={it.label}>
            {it.icon}
            <span className="nav-label">{it.label}</span>
          </Link>
        ))}
        <div className="nav-section">HR Lifecycle</div>
        {hr.map((it) => (
          <Link key={it.href} href={it.href} className={`nav-item${active(it.href) ? ' active' : ''}`} title={it.label}>
            {it.icon}
            <span className="nav-label">{it.label}</span>
          </Link>
        ))}
        {admin.length > 0 && (
          <>
            <div className="nav-section">Administration</div>
            {admin.map((it) => (
              <Link key={it.href} href={it.href} className={`nav-item${active(it.href) ? ' active' : ''}`} title={it.label}>
                {it.icon}
                <span className="nav-label">{it.label}</span>
              </Link>
            ))}
          </>
        )}
      </nav>

      <div className="side-foot">
        <div className="side-user">
          <div className="avatar" style={{ width: 34, height: 34, fontSize: 12, flex: '0 0 34px' }}>{initials}</div>
          <div className="side-foot-text">
            <div className="side-foot-name">{userName}</div>
            <div className="side-foot-role">{role}</div>
          </div>
          <button className="collapse-btn" title="Sign out" onClick={onSignOut} style={{ marginLeft: 'auto' }}>
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}
