import type { ReactNode } from 'react';
import { CopyButton } from './CopyButton';

type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'brand';

export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function Card({
  title,
  icon,
  sub,
  actions,
  children,
  flat,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flat?: boolean;
}) {
  return (
    <section className={`card${flat ? ' card-flat' : ''}`}>
      {(title || actions) && (
        <div className="card-head">
          {icon && <div className="card-ic">{icon}</div>}
          <div style={{ minWidth: 0 }}>
            <div className="card-title">{title}</div>
            {sub && <div className="card-title-sub">{sub}</div>}
          </div>
          {actions && <div style={{ marginLeft: 'auto' }}>{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({
  label,
  value,
  copy,
  mono,
}: {
  label: string;
  value?: ReactNode;
  copy?: string;
  mono?: boolean;
}) {
  const empty = value === undefined || value === null || value === '' || value === '—';
  return (
    <div>
      <div className="field-label">{label}</div>
      <div className={`field-value${empty ? ' empty' : ''}`} style={mono ? { fontFamily: 'ui-monospace, monospace', letterSpacing: '.02em' } : undefined}>
        {empty ? '—' : value}
        {!empty && copy && <CopyButton value={copy} />}
      </div>
    </div>
  );
}

export function Callout({ tone = 'info', title, children }: { tone?: 'info' | 'warn'; title?: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className={`callout callout-${tone}`}>
      <div style={{ flex: 1 }}>
        {title && <strong>{title}</strong>}
        {title && ' '}
        {children}
      </div>
    </div>
  );
}

export function StatCard({
  icon,
  value,
  label,
  color = 'var(--brand-600)',
  bg = 'var(--brand-50)',
  trend,
}: {
  icon: ReactNode;
  value: ReactNode;
  label: string;
  color?: string;
  bg?: string;
  trend?: ReactNode;
}) {
  return (
    <div className="stat">
      <div className="stat-ic" style={{ background: bg, color }}>
        {icon}
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {trend && <div className="stat-trend">{trend}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, sub }: { icon: ReactNode; title: string; sub?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--muted)' }}>
      <div style={{ display: 'inline-grid', placeItems: 'center', width: 52, height: 52, borderRadius: 14, background: 'var(--bg-soft)', color: 'var(--muted-2)', marginBottom: 12 }}>
        {icon}
      </div>
      <div style={{ fontWeight: 700, color: 'var(--ink)', fontSize: 15 }}>{title}</div>
      {sub && <div style={{ fontSize: 13, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}
