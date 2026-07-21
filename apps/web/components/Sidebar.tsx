'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard, FolderOpen, UserRound, FileText, Sparkles, Users,
  Scale, ScrollText, ChevronsLeft, ChevronsRight, ChevronDown, LogOut,
  ClipboardList, CalendarDays, HeartPulse, GraduationCap, Star, BookCheck,
  LifeBuoy, FileSignature, BadgeCheck, UserMinus, ShieldCheck,
  Clock, Briefcase,
} from 'lucide-react';

interface NavItem { href: string; label: string; icon: React.ReactNode; }
interface NavGroup { key: string; label: string; items: NavItem[]; defaultOpen: boolean; }

export function Sidebar({
  role, userName, email, initials, onSignOut, canProcurement,
}: {
  role: string; userName: string; email: string; initials: string;
  onSignOut: () => void; canProcurement: boolean;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  // Per-group open/closed prefs. undefined for a group ⇒ use its defaultOpen.
  const [openPref, setOpenPref] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setCollapsed(localStorage.getItem('sb-collapsed') === '1');
    try { setOpenPref(JSON.parse(localStorage.getItem('sb-groups') || '{}')); } catch { /* ignore */ }
  }, []);

  const toggleCollapse = () => {
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

  // Long, secondary sections start collapsed; core ones start open. The section
  // containing the current route is always shown so you never lose your place.
  const groups: NavGroup[] = [
    { key: 'workspace', label: 'Workspace', items: main, defaultOpen: true },
    { key: 'modules', label: 'Modules', items: modules, defaultOpen: true },
    { key: 'hr', label: 'HR Lifecycle', items: hr, defaultOpen: false },
    { key: 'admin', label: 'Administration', items: admin, defaultOpen: false },
  ];

  const active = (href: string) => pathname === href || pathname.startsWith(href + '/');
  const hasActive = (items: NavItem[]) => items.some((it) => active(it.href));
  const shown = (g: NavGroup) => hasActive(g.items) || (openPref[g.key] ?? g.defaultOpen);

  const toggleGroup = (g: NavGroup) => {
    setOpenPref((prev) => {
      const next = { ...prev, [g.key]: !(prev[g.key] ?? g.defaultOpen) };
      localStorage.setItem('sb-groups', JSON.stringify(next));
      return next;
    });
  };

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="brand">
        <div className="brand-mark"><Scale size={19} /></div>
        <div className="brand-text">
          <div className="brand-name">Ajace</div>
          <div className="brand-sub">Immigration · HR</div>
        </div>
        <button className="collapse-btn" onClick={toggleCollapse} title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
        </button>
      </div>

      <nav className="nav">
        {groups.map((g) => {
          if (g.items.length === 0) return null;
          const open = collapsed ? true : shown(g);
          return (
            <div className="nav-group" key={g.key}>
              {!collapsed && (
                <button className="nav-grouphead" onClick={() => toggleGroup(g)} aria-expanded={open}>
                  <span>{g.label}</span>
                  <ChevronDown size={14} className={`nav-chev${open ? ' open' : ''}`} />
                </button>
              )}
              {open && g.items.map((it) => (
                <Link key={it.href} href={it.href} className={`nav-item${active(it.href) ? ' active' : ''}`} title={it.label}>
                  {it.icon}
                  <span className="nav-label">{it.label}</span>
                </Link>
              ))}
            </div>
          );
        })}
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
