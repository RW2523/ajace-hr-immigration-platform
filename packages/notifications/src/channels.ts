/**
 * Notification channel adapters (§4, §9). Email via provider (Resend default),
 * in-app persisted to app.notifications for a bell UI, Slack/SMS interfaces reserved.
 * Selected by env; behaviour differs by environment so production never silently
 * drops a send.
 */
import type postgres from 'postgres';

export interface OutboundMessage {
  to: string; // email address or user id (in-app)
  subject: string;
  body: string;
  channel: string;
  /** app.notifications row id this message corresponds to (set by the runner). */
  notificationId?: string;
  /** Deep-link the bell UI should open for this reminder. */
  link?: string | null;
}

export interface Channel {
  readonly name: string;
  send(msg: OutboundMessage): Promise<void>;
}

/** True when we must not fake-deliver: real provider required. */
export function isProdLike(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.NOTIFICATIONS_PROD === '1';
}

/** Dev/test default: records instead of sending. Never used in prod for email. */
export class ConsoleChannel implements Channel {
  readonly name: string;
  readonly sent: OutboundMessage[] = [];
  constructor(name = 'console') {
    this.name = name;
  }
  async send(msg: OutboundMessage): Promise<void> {
    this.sent.push(msg);
  }
}

/**
 * Production guard: stands in for the email channel when RESEND_API_KEY is missing
 * in a prod-like environment. It FAILS LOUDLY on every send so the reminder is
 * recorded as failed/retryable rather than consumed as "sent" with nothing delivered.
 */
export class MissingEmailChannel implements Channel {
  readonly name = 'email';
  constructor() {
    console.error(
      '[notifications] RESEND_API_KEY is not set in a production-like environment — ' +
        'email reminders CANNOT be delivered and will be marked failed/retryable. ' +
        'Set RESEND_API_KEY (or NOTIFICATIONS_PROD=0 for local dev).',
    );
  }
  async send(_msg: OutboundMessage): Promise<void> {
    throw new Error('RESEND_API_KEY not configured; refusing to fake email delivery in production.');
  }
}

/** Resend email adapter (used when RESEND_API_KEY is set). */
export class ResendChannel implements Channel {
  readonly name = 'email';
  constructor(
    private apiKey = process.env.RESEND_API_KEY ?? '',
    private from = process.env.NOTIFICATIONS_FROM_EMAIL ?? 'noreply@example.com',
  ) {}
  async send(msg: OutboundMessage): Promise<void> {
    if (!this.apiKey) throw new Error('RESEND_API_KEY not set');
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: msg.to, subject: msg.subject, html: msg.body }),
    });
    if (!res.ok) throw new Error(`Resend failed: ${res.status} ${await res.text()}`);
  }
}

/**
 * In-app channel: persists user-facing content onto the notifications row so a
 * topbar bell UI can render it. The row is created (unread) by the runner; this
 * adapter fills in title/body/link and asserts the unread state. Delivery = a real
 * DB write, not a no-op.
 *
 * Bell UI contract — read rows with:
 *   select id, title, body, link, related_case_id, created_at
 *   from app.notifications
 *   where recipient_user_id = $uid and channel = 'in_app' and read_at is null
 *   order by created_at desc
 * Mark read by setting read_at = now().
 */
export class InAppChannel implements Channel {
  readonly name = 'in_app';
  constructor(private sql: postgres.Sql) {}
  async send(msg: OutboundMessage): Promise<void> {
    if (!msg.notificationId) {
      throw new Error('InAppChannel requires notificationId to persist the bell notification.');
    }
    const [row] = await this.sql`
      update app.notifications
        set title = ${msg.subject}, body = ${msg.body}, link = ${msg.link ?? null}, read_at = null
      where id = ${msg.notificationId}
      returning id`;
    if (!row) throw new Error(`InAppChannel: notification ${msg.notificationId} not found.`);
  }
}

/**
 * Resolve the channel set from env. `sql` (when provided) backs the in-app channel;
 * without it the in-app channel degrades to a console sink (pure/unit contexts).
 */
export function resolveChannels(sql?: postgres.Sql): Record<string, Channel> {
  let email: Channel;
  if (process.env.RESEND_API_KEY) {
    email = new ResendChannel();
  } else if (isProdLike()) {
    email = new MissingEmailChannel(); // fail loud, never fake success
  } else {
    console.warn('[notifications] RESEND_API_KEY not set — using console email sink (dev/test only).');
    email = new ConsoleChannel('email');
  }
  return {
    email,
    in_app: sql ? new InAppChannel(sql) : new ConsoleChannel('in_app'),
  };
}
