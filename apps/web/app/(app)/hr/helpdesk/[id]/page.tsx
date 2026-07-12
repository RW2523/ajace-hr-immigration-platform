import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  LifeBuoy, ArrowLeft, Send, UserCheck, Lock, CheckCircle2, Clock, MessageSquare,
} from 'lucide-react';
import { getPrincipal, db } from '@/lib/session';
import { requirePermission, hasStaffScope, type Principal } from '@hr/shared';
import { Card, Pill } from '@/components/ui';

const PRIO_TONE: Record<string, 'neutral' | 'warn' | 'danger' | 'brand'> = { low: 'neutral', normal: 'brand', high: 'warn', urgent: 'danger' };
const STATUS_TONE: Record<string, 'brand' | 'warn' | 'ok' | 'neutral'> = { open: 'brand', pending: 'warn', resolved: 'ok', closed: 'neutral' };

/** Load a ticket and enforce the caller may see it (own, or staff in-org). */
async function loadTicket(principal: Principal, id: string) {
  const sql = db();
  const [t] = await sql<{ id: string; org_id: string; employee_id: string | null; opened_by: string | null; subject: string; body: string; status: string; priority: string; category: string; created_at: string; opener: string | null; assignee: string | null; assignee_user_id: string | null }[]>`
    select t.id, t.org_id, t.employee_id, t.opened_by, t.subject, t.body, t.status, t.priority, t.category,
      to_char(t.created_at,'YYYY-MM-DD HH24:MI') as created_at, u.full_name as opener, a.full_name as assignee, t.assignee_user_id
    from app.helpdesk_tickets t left join app.users u on u.id = t.opened_by left join app.users a on a.id = t.assignee_user_id
    where t.id = ${id}`;
  if (!t) return null;
  const isStaff = hasStaffScope(principal, 'helpdesk', 'update');
  const ok = t.opened_by === principal.userId || (isStaff && t.org_id === principal.orgId);
  if (!ok) return null;
  return t;
}

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const principal = (await getPrincipal())!;
  const isStaff = hasStaffScope(principal, 'helpdesk', 'update');
  const t = await loadTicket(principal, id);
  if (!t) return <Card><div className="muted">Ticket not found or you don't have access.</div></Card>;
  const sql = db();

  // Messages (employees never see internal notes).
  const messages = await sql<{ id: string; author: string | null; author_id: string | null; body: string; internal: boolean; created_at: string; is_staff: boolean }[]>`
    select m.id, u.full_name as author, m.author_user_id as author_id, m.body, m.internal, to_char(m.created_at,'Mon DD, HH24:MI') as created_at,
      exists(select 1 from app.user_roles ur join app.roles r on r.id = ur.role_id where ur.user_id = m.author_user_id and r.key in ('hr','employer','admin')) as is_staff
    from app.helpdesk_messages m left join app.users u on u.id = m.author_user_id
    where m.ticket_id = ${id} ${isStaff ? sql`` : sql`and m.internal = false`}
    order by m.created_at asc`;

  async function reply(formData: FormData) {
    'use server';
    const p = await getPrincipal();
    if (!p) return;
    const tk = await loadTicket(p, id);
    if (!tk) return;
    const staff = hasStaffScope(p, 'helpdesk', 'update');
    requirePermission(p, {
      resource: 'helpdesk', action: p.userId === tk.opened_by ? 'create' : 'update', requireContext: true,
      context: { orgId: tk.org_id, employeeId: tk.employee_id ?? undefined, ownerUserId: tk.opened_by ?? undefined },
    });
    const body = String(formData.get('body') ?? '').trim();
    if (!body) return;
    const internal = formData.get('internal') === 'on' && staff;
    const s = db();
    await s`insert into app.helpdesk_messages (org_id, ticket_id, author_user_id, body, internal)
            values (${tk.org_id}, ${id}, ${p.userId}, ${body}, ${internal})`;
    // Staff reply → move to pending (awaiting employee); notify the other party.
    if (!internal) {
      if (staff && tk.status === 'open') {
        await s`update app.helpdesk_tickets set status = 'pending', updated_at = now() where id = ${id}`;
      }
      const recipient = p.userId === tk.opened_by ? tk.assignee_user_id : tk.opened_by;
      if (recipient) {
        await s`insert into app.notifications (org_id, recipient_user_id, channel, type, status, title, body, link, dedupe_key)
                values (${tk.org_id}, ${recipient}, 'in_app', 'helpdesk_reply', 'pending',
                        ${'New reply: ' + tk.subject}, ${body.slice(0, 140)}, ${'/hr/helpdesk/' + id},
                        ${'ticket:' + id + ':reply:' + Date.now()})
                on conflict (dedupe_key) do nothing`;
      }
    }
    revalidatePath(`/hr/helpdesk/${id}`);
  }

  async function assignToMe() {
    'use server';
    const p = await getPrincipal();
    if (!p) return;
    const tk = await loadTicket(p, id);
    if (!tk) return;
    requirePermission(p, {
      resource: 'helpdesk', action: 'update', requireContext: true,
      context: { orgId: tk.org_id, employeeId: tk.employee_id ?? undefined, ownerUserId: tk.opened_by ?? undefined },
    });
    await db()`update app.helpdesk_tickets set assignee_user_id = ${p.userId}, updated_at = now() where id = ${id} and org_id = ${tk.org_id}`;
    revalidatePath(`/hr/helpdesk/${id}`);
  }

  async function setStatus(formData: FormData) {
    'use server';
    const p = await getPrincipal();
    if (!p) return;
    const tk = await loadTicket(p, id);
    if (!tk) return;
    requirePermission(p, {
      resource: 'helpdesk', action: 'update', requireContext: true,
      context: { orgId: tk.org_id, employeeId: tk.employee_id ?? undefined, ownerUserId: tk.opened_by ?? undefined },
    });
    const status = String(formData.get('status'));
    if (!['open', 'pending', 'resolved', 'closed'].includes(status)) return;
    const s = db();
    await s`update app.helpdesk_tickets set status = ${status}, resolved_at = ${status === 'resolved' || status === 'closed' ? s`now()` : null}, updated_at = now() where id = ${id} and org_id = ${tk.org_id}`;
    if (tk.opened_by && (status === 'resolved' || status === 'closed')) {
      await s`insert into app.notifications (org_id, recipient_user_id, channel, type, status, title, body, link, dedupe_key)
              values (${tk.org_id}, ${tk.opened_by}, 'in_app', 'helpdesk_status', 'pending',
                      ${'Ticket ' + status + ': ' + tk.subject}, ${'Your help-desk ticket was marked ' + status + '.'}, ${'/hr/helpdesk/' + id},
                      ${'ticket:' + id + ':status:' + status})
              on conflict (dedupe_key) do nothing`;
    }
    revalidatePath(`/hr/helpdesk/${id}`);
  }

  const initials = (n: string | null) => (n ?? 'U').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div>
      <div className="page-head between">
        <div>
          <Link href="/hr/helpdesk" className="row" style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 6, width: 'fit-content' }}><ArrowLeft size={14} /> Back to Help Desk</Link>
          <div className="row" style={{ gap: 10 }}>
            <div className="page-title" style={{ fontSize: 22 }}>{t.subject}</div>
            <Pill tone={STATUS_TONE[t.status] ?? 'neutral'}>{t.status}</Pill>
          </div>
          <div className="page-sub">Opened by {t.opener ?? 'Unknown'} · {t.created_at} · <span style={{ textTransform: 'capitalize' }}>{t.category}</span></div>
        </div>
        <div className="row" style={{ gap: 8 }}><Pill tone={PRIO_TONE[t.priority] ?? 'neutral'}>{t.priority} priority</Pill></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isStaff ? '1.8fr 1fr' : '1fr', gap: 18, alignItems: 'start' }}>
        <div>
          <Card title="Conversation" icon={<MessageSquare size={18} />}>
            {/* Original message */}
            <div className="msg bot" style={{ maxWidth: '100%', marginBottom: 16 }}>
              <div className="msg-av me" style={{ background: 'var(--brand-grad)' }}>{initials(t.opener)}</div>
              <div className="bubble" style={{ maxWidth: '100%' }}>
                <div className="row between" style={{ marginBottom: 4 }}><span style={{ fontWeight: 700, fontSize: 13 }}>{t.opener}</span><span className="muted" style={{ fontSize: 11 }}>{t.created_at}</span></div>
                {t.body}
              </div>
            </div>

            {messages.map((m) => (
              <div key={m.id} className={`msg ${m.author_id === principal.userId ? 'user' : 'bot'}`} style={{ maxWidth: '100%', marginBottom: 14 }}>
                <div className={`msg-av ${m.is_staff ? 'bot' : 'me'}`} style={m.is_staff ? undefined : { background: 'var(--ink)' }}>{initials(m.author)}</div>
                <div className="bubble" style={{ maxWidth: '100%', ...(m.internal ? { background: 'var(--warn-bg)', border: '1px solid var(--warn-bd)', color: '#92400e' } : {}) }}>
                  <div className="row between" style={{ marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{m.author}{m.is_staff && <Pill tone="brand">staff</Pill>}{m.internal && <span className="row" style={{ color: 'var(--warn)', fontSize: 11, fontWeight: 700, marginLeft: 6 }}><Lock size={11} /> internal note</span>}</span>
                    <span className="muted" style={{ fontSize: 11 }}>{m.created_at}</span>
                  </div>
                  {m.body}
                </div>
              </div>
            ))}

            {(t.status === 'closed') ? (
              <div className="callout callout-info" style={{ marginTop: 8, marginBottom: 0 }}><CheckCircle2 size={16} className="ic" /><div>This ticket is closed. Raise a new ticket if you need further help.</div></div>
            ) : (
              <form action={reply} style={{ marginTop: 8 }}>
                <textarea name="body" className="input" rows={3} style={{ resize: 'vertical' }} placeholder={isStaff ? 'Reply to the employee…' : 'Add a reply…'} required />
                <div className="between" style={{ marginTop: 10 }}>
                  {isStaff ? (
                    <label className="row" style={{ fontSize: 12.5, color: 'var(--muted)', cursor: 'pointer' }}><input type="checkbox" name="internal" /> <Lock size={13} /> Internal note (hidden from employee)</label>
                  ) : <span />}
                  <button className="btn btn-primary btn-sm"><Send size={14} /> Send reply</button>
                </div>
              </form>
            )}
          </Card>
        </div>

        {isStaff && (
          <div>
            <Card title="Handling" icon={<UserCheck size={18} />}>
              <div className="field-label">Assignee</div>
              <div className="field-value" style={{ marginBottom: 14 }}>{t.assignee ?? <span className="muted">Unassigned</span>}</div>
              {t.assignee_user_id !== principal.userId && (
                <form action={assignToMe}><button className="btn btn-ghost btn-sm" style={{ width: '100%', marginBottom: 14 }}><UserCheck size={14} /> Assign to me</button></form>
              )}
              <div className="field-label">Update status</div>
              <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                {(['open', 'pending', 'resolved', 'closed'] as const).map((s) => (
                  <form key={s} action={setStatus}>
                    <input type="hidden" name="status" value={s} />
                    <button className={`btn btn-sm ${t.status === s ? 'btn-primary' : 'btn-ghost'}`} style={{ width: '100%', justifyContent: 'flex-start' }}>
                      {s === 'resolved' || s === 'closed' ? <CheckCircle2 size={14} /> : <Clock size={14} />}
                      <span style={{ textTransform: 'capitalize' }}>{s}</span>
                    </button>
                  </form>
                ))}
              </div>
            </Card>
            <Card title="Details" icon={<LifeBuoy size={18} />}>
              <div className="fgrid fgrid-1" style={{ gap: 12 }}>
                <div><div className="field-label">Category</div><div className="field-value" style={{ textTransform: 'capitalize' }}>{t.category}</div></div>
                <div><div className="field-label">Priority</div><div className="field-value"><Pill tone={PRIO_TONE[t.priority] ?? 'neutral'}>{t.priority}</Pill></div></div>
                <div><div className="field-label">Opened by</div><div className="field-value">{t.opener}</div></div>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
