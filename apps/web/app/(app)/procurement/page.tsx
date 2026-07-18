import { getPrincipal } from '@/lib/session';
import { Card } from '@/components/ui';
import { Briefcase, ArrowUpRight } from 'lucide-react';

export const metadata = { title: 'Procurement · Ajace' };

const PROCUREMENT_URL = process.env.NEXT_PUBLIC_PROCUREMENT_URL || 'https://pocu-wheat.vercel.app';
const linkStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  marginTop: 8,
  color: 'var(--brand-600, #4f46e5)',
  fontWeight: 600,
  textDecoration: 'none',
} as const;

/**
 * Procurement module — access-gated to firm leadership / a dedicated procurement role.
 * The nav tab only appears for these users (see the sidebar); this page also enforces
 * the check server-side. During the port into the platform it opens the dedicated
 * workspace; later it will host the procurement UI in place.
 */
export default async function ProcurementPage() {
  const principal = (await getPrincipal())!;
  const allowed = principal.roleKeys.some((r) => r === 'admin' || r === 'employer' || r === 'procurement');
  if (!allowed) {
    return (
      <Card>
        <div className="muted">You don’t have access to the Procurement module. Ask an admin if you need it.</div>
      </Card>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Briefcase size={22} />
        <h1 style={{ margin: 0, fontSize: 20 }}>Procurement Intelligence</h1>
      </div>
      <Card>
        <p>Discover, dedupe, score, and draft responses to government procurement opportunities.</p>
        <a href={PROCUREMENT_URL} target="_blank" rel="noreferrer" style={linkStyle}>
          Open Procurement workspace <ArrowUpRight size={16} />
        </a>
        <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
          This module is being brought into the platform. For now it opens the dedicated workspace; access is limited to
          your role.
        </p>
      </Card>
    </div>
  );
}
