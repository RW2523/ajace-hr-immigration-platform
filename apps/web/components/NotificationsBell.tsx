'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Bell, CheckCheck } from 'lucide-react';

export interface Notice {
  id: string;
  title: string | null;
  body: string | null;
  link: string | null;
  type: string | null;
  created_at: string;
}

/** Friendly fallback label when a notification has no explicit title. */
function label(n: Notice): string {
  if (n.title) return n.title;
  switch (n.type) {
    case 'helpdesk_reply': return 'New reply on your ticket';
    case 'helpdesk_status': return 'Your ticket status changed';
    case 'helpdesk_new_ticket': return 'A new help-desk ticket was raised';
    default: return (n.type ?? 'Notification').replace(/_/g, ' ');
  }
}

export function NotificationsBell({
  notices, markAllRead,
}: { notices: Notice[]; markAllRead: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const count = notices.length;

  return (
    <div className="notif-wrap">
      <button
        className="icon-btn"
        title={count > 0 ? `${count} new notification${count > 1 ? 's' : ''}` : 'Notifications'}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <Bell size={17} />
        {count > 0 && <span className="badge-count">{count > 9 ? '9+' : count}</span>}
      </button>

      {open && (
        <>
          <div className="notif-backdrop" onClick={() => setOpen(false)} />
          <div className="notif-pop" role="menu">
            <div className="notif-pop-head">
              <span style={{ fontWeight: 700, fontSize: 13 }}>Notifications</span>
              {count > 0 && (
                <form action={markAllRead}>
                  <button className="notif-markall" title="Mark all as read"><CheckCheck size={13} /> Mark all read</button>
                </form>
              )}
            </div>
            <div className="notif-list">
              {count === 0 ? (
                <div className="notif-empty">You're all caught up.</div>
              ) : notices.map((n) => {
                const inner = (
                  <>
                    <div className="notif-dot" />
                    <div style={{ minWidth: 0 }}>
                      <div className="notif-title">{label(n)}</div>
                      {n.body && <div className="notif-body">{n.body}</div>}
                      <div className="notif-time">{n.created_at}</div>
                    </div>
                  </>
                );
                return n.link
                  ? <Link key={n.id} href={n.link} className="notif-item" onClick={() => setOpen(false)}>{inner}</Link>
                  : <div key={n.id} className="notif-item">{inner}</div>;
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
