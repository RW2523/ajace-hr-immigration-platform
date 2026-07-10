import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { LifeBuoy, Plus, CheckCircle2, MessageSquare, ArrowRight, AlertOctagon } from 'lucide-react';
import { getPrincipal, primaryRole, db } from '@/lib/session';
import { myEmployee } from '@/lib/data';
import { requirePermission } from '@hr/shared';
import { Card, Pill, StatCard, EmptyState } from '@/components/ui';

async function openTicket(formData: FormData) {
  'use server';
  const principal = await getPrincipal();
  if (!principal) return;
  requirePermission(principal, { resource: 'helpdesk', action: 'create' });
  const emp = await myEmployee(principal);
  const sql = db();
  const [t] = await sql`
    insert into app.helpdesk_tickets (org_id, employee_id, opened_by, subject, body, status, scope, priority, category)
    values (${principal.orgId}, ${emp?.id ?? null}, ${principal.userId}, ${String(formData.get('subject'))}, ${String(formData.get('body'))}, 'open', 'own', ${String(formData.get('priority') ?? 'normal')}, ${String(formData.get('category') ?? 'general')})
    returning id`;
  // Notify the org's HR + employer that a new ticket was raised.
  const staff = await sql<{ id: string }[]>`
    select distinct u.id from app.user_roles ur join app.roles r on r.id = ur.role_id join app.users u on u.id = ur.user_id
    where ur.org_id = ${principal.orgId} and r.key in ('hr','employer','admin')`;
  for (const s of staff) {
    await sql`insert into app.notifications (org_id, recipient_user_id, channel, type, status, dedupe_key)
              values (${principal.orgId}, ${s.id}, 'in_app', 'helpdesk_new_ticket', 'pending', ${'ticket:' + (t!.id as string) + ':new:' + s.id})
              on conflict (dedupe_key) do nothing`;
  }
  redirect(`/hr/helpdesk/${t!.id}`);
}

const PRIO_TONE: Record<string, 'neutral' | 'warn' | 'danger' | 'brand'> = { low: 'neutral', normal: 'brand', high: 'warn', urgent: 'danger' };
const STATUS_TONE: Record<string, 'brand' | 'warn' | 'ok' | 'neutral'> = { open: 'brand', pending: 'warn', resolved: 'ok', closed: 'neutral' };

export default async function HelpdeskPage() {
  const principal = (await getPrincipal())!;
  const role = primaryRole(principal);
  const isStaff = role !== 'employee';
  const sql = db();
  const tickets = await sql<{ id: string; subject: string; status: string; priority: string; category: string; created_at: string; opener: string | null; assignee: string | null; replies: number }[]>`
    select t.id, t.subject, t.status, t.priority, t.category, to_char(t.created_at,'YYYY-MM-DD') as created_at,
      u.full_name as opener, a.full_name as assignee,
      (select count(*)::int from app.helpdesk_messages m where m.ticket_id = t.id) as replies
    from app.helpdesk_tickets t
    left join app.users u on u.id = t.opened_by
    left join app.users a on a.id = t.assignee_user_id
    where ${isStaff ? sql`t.org_id = ${principal.orgId}` : sql`t.opened_by = ${principal.userId}`}
    order by case t.status when 'open' then 0 when 'pending' then 1 else 2 end,
      case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, t.created_at desc`;
  const open = tickets.filter((t) => t.status === 'open' || t.status === 'pending').length;

  return (
    <div>
      <div className="page-head between">
        <div><div className="page-title">Help Desk</div><div className="page-sub">{isStaff ? 'Support requests from your people — assign, reply, and resolve.' : 'Raise a request and track HR responses in one place.'}</div></div>
      </div>

      <div className="stats" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <StatCard icon={<LifeBuoy size={19} />} value={open} label="Open / in progress" color="var(--brand-600)" bg="var(--brand-50)" />
        <StatCard icon={<AlertOctagon size={19} />} value={tickets.filter((t) => t.priority === 'urgent' && t.status !== 'closed' && t.status !== 'resolved').length} label="Urgent" color="var(--danger)" bg="var(--danger-bg)" />
        <StatCard icon={<CheckCircle2 size={19} />} value={tickets.filter((t) => t.status === 'resolved' || t.status === 'closed').length} label="Resolved" color="var(--ok)" bg="var(--ok-bg)" />
        <StatCard icon={<MessageSquare size={19} />} value={tickets.length} label="Total tickets" />
      </div>

      {!isStaff && (
        <Card title="Raise a ticket" icon={<Plus size={18} />}>
          <form action={openTicket} style={{ display: 'grid', gap: 12 }}>
            <div><label className="input-label">Subject</label><input name="subject" className="input" placeholder="e.g. Question about my STEM OPT reporting" required /></div>
            <div className="fgrid">
              <div><label className="input-label">Category</label>
                <select name="category" className="input select"><option value="immigration">Immigration</option><option value="payroll">Payroll</option><option value="benefits">Benefits</option><option value="it">IT / Access</option><option value="general">General</option></select></div>
              <div><label className="input-label">Priority</label>
                <select name="priority" className="input select" defaultValue="normal"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
            </div>
            <div><label className="input-label">Details</label><textarea name="body" className="input" rows={4} style={{ resize: 'vertical' }} placeholder="Describe your question or issue…" required /></div>
            <button className="btn btn-primary" style={{ justifySelf: 'start' }}>Submit ticket</button>
          </form>
        </Card>
      )}

      <Card title={isStaff ? 'All tickets' : 'My tickets'} icon={<LifeBuoy size={18} />}>
        {tickets.length === 0 ? <EmptyState icon={<LifeBuoy size={22} />} title="No tickets yet" sub={isStaff ? undefined : 'Raise one above and HR will follow up here.'} /> : (
          <div className="wrap-scroll"><table className="tbl">
            <thead><tr><th>Subject</th><th>Category</th><th>Priority</th>{isStaff && <th>From</th>}<th>Assignee</th><th>Status</th><th></th></tr></thead>
            <tbody>{tickets.map((t) => (
              <tr key={t.id}>
                <td><Link href={`/hr/helpdesk/${t.id}`} style={{ fontWeight: 650, color: 'var(--ink)' }}>{t.subject}</Link>
                  {t.replies > 0 && <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}><MessageSquare size={11} style={{ verticalAlign: -1 }} /> {t.replies}</span>}
                  <div className="muted" style={{ fontSize: 12 }}>{t.created_at}</div></td>
                <td style={{ textTransform: 'capitalize' }} className="muted">{t.category}</td>
                <td><Pill tone={PRIO_TONE[t.priority] ?? 'neutral'}>{t.priority}</Pill></td>
                {isStaff && <td className="muted">{t.opener ?? '—'}</td>}
                <td className="muted">{t.assignee ?? <span style={{ color: 'var(--faint)' }}>Unassigned</span>}</td>
                <td><Pill tone={STATUS_TONE[t.status] ?? 'neutral'}>{t.status}</Pill></td>
                <td style={{ textAlign: 'right' }}><Link href={`/hr/helpdesk/${t.id}`} className="btn btn-ghost btn-sm">Open <ArrowRight size={13} /></Link></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
