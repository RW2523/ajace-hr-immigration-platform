/**
 * Notification channel adapters (§4, §9). Email via provider (Resend default),
 * in-app always, Slack/SMS interfaces reserved. Selected by env; a console adapter
 * is the safe default in dev/test so no real messages are sent.
 */
export interface OutboundMessage {
  to: string; // email address or user id (in-app)
  subject: string;
  body: string;
  channel: string;
}

export interface Channel {
  readonly name: string;
  send(msg: OutboundMessage): Promise<void>;
}

/** Dev/test default: records instead of sending. */
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

/** Resolve the channel set from env. */
export function resolveChannels(): Record<string, Channel> {
  const email: Channel = process.env.RESEND_API_KEY ? new ResendChannel() : new ConsoleChannel('email');
  return {
    email,
    in_app: new ConsoleChannel('in_app'), // in-app is persisted as a notification row; console is a no-op sink
  };
}
