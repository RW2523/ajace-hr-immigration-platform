import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getPrincipal, primaryRole, signOut, db } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase/server';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'U';
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const principal = await getPrincipal();
  if (!principal) redirect('/login');

  // Enforce MFA step-up: if the account has a verified authenticator, the whole
  // workspace requires aal2 — a password-only (aal1) session is bounced to the
  // one-time-code screen and cannot reach any app route by direct navigation.
  const { data: aal } = await (await supabaseServer()).auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === 'aal2' && aal.currentLevel === 'aal1') redirect('/login/mfa');

  const [u] = await db()<{ full_name: string; email: string }[]>`
    select full_name, email from app.users where id = ${principal.userId}`;
  const name = u?.full_name || u?.email || 'User';
  const role = primaryRole(principal);
  const notices = await db()<{ id: string; title: string | null; body: string | null; link: string | null; type: string | null; created_at: string }[]>`
    select id, title, body, link, type, to_char(created_at,'Mon DD, HH24:MI') as created_at
    from app.notifications
    where recipient_user_id = ${principal.userId} and channel = 'in_app' and read_at is null
    order by created_at desc limit 20`;

  async function doSignOut() {
    'use server';
    await signOut();
    redirect('/login');
  }

  async function markAllRead() {
    'use server';
    const p = await getPrincipal();
    if (!p) return;
    await db()`update app.notifications set read_at = now()
      where recipient_user_id = ${p.userId} and channel = 'in_app' and read_at is null`;
    revalidatePath('/', 'layout');
  }

  return (
    <div className="shell">
      <Sidebar role={role} userName={name} email={u?.email ?? ''} initials={initialsOf(name)} onSignOut={doSignOut} />
      <div className="main">
        <Topbar initials={initialsOf(name)} notices={notices} markAllRead={markAllRead} />
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
