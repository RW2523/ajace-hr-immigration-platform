import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{ fontFamily: 'var(--font-sans, system-ui, sans-serif)', display: 'grid', placeItems: 'center', minHeight: '100vh', background: 'var(--bg, #f5f6fa)', color: 'var(--ink, #1e2233)' }}>
      <div style={{ textAlign: 'center', padding: 24 }}>
        <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: '-.03em' }}>404</div>
        <p style={{ color: 'var(--muted, #5b627a)', fontSize: 14, marginTop: 6 }}>This page could not be found.</p>
        <Link href="/dashboard" style={{ display: 'inline-block', marginTop: 16, padding: '10px 18px', borderRadius: 10, background: 'var(--brand-600, #5b5bd6)', color: '#fff', fontWeight: 600, textDecoration: 'none' }}>
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
