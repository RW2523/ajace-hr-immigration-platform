import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getPrincipal, primaryRole, signOut, db } from '@/lib/session';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'U';
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const principal = await getPrincipal();
  if (!principal) redirect('/login');

  const [u] = await db()<{ full_name: string; email: string }[]>`
    select full_name, email from app.users where id = ${principal.userId}`;
  const name = u?.full_name || u?.email || 'User';
  const role = primaryRole(principal);
  const alerts = (await db()<{ alerts: number }[]>`
    select count(*)::int as alerts from app.notifications
    where recipient_user_id = ${principal.userId} and channel = 'in_app' and status = 'pending'`)[0]?.alerts ?? 0;

  async function doSignOut() {
    'use server';
    await signOut();
    redirect('/login');
  }

  return (
    <div className="shell">
      <Sidebar role={role} userName={name} email={u?.email ?? ''} initials={initialsOf(name)} onSignOut={doSignOut} />
      <div className="main">
        <Topbar initials={initialsOf(name)} alerts={alerts ?? 0} />
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
