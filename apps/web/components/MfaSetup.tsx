'use client';
import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, Loader2, Trash2, Check } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';

interface Factor { id: string; friendly_name: string | null; status: string }

/** TOTP (authenticator-app) MFA enrollment + management, backed by Supabase Auth. */
export function MfaSetup() {
  const supabase = supabaseBrowser();
  const [loading, setLoading] = useState(true);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enroll, setEnroll] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors((data?.totp ?? []) as Factor[]);
    setLoading(false);
  }
  useEffect(() => { refresh(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  const verified = factors.filter((f) => f.status === 'verified');

  async function startEnroll() {
    setErr(null); setBusy(true);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setEnroll({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirmEnroll() {
    if (!enroll) return;
    setErr(null); setBusy(true);
    const chg = await supabase.auth.mfa.challenge({ factorId: enroll.factorId });
    if (chg.error) { setBusy(false); setErr(chg.error.message); return; }
    const { error } = await supabase.auth.mfa.verify({ factorId: enroll.factorId, challengeId: chg.data.id, code });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setEnroll(null); setCode(''); await refresh();
  }

  async function remove(factorId: string) {
    setBusy(true);
    await supabase.auth.mfa.unenroll({ factorId });
    setBusy(false); await refresh();
  }

  if (loading) return <div className="row muted" style={{ gap: 8 }}><Loader2 size={16} className="spin" /> Checking security status…</div>;

  return (
    <div>
      <div className="row" style={{ gap: 10, marginBottom: 14 }}>
        {verified.length > 0
          ? <span className="pill pill-ok" style={{ padding: '5px 11px' }}><ShieldCheck size={13} /> Two-factor authentication is on</span>
          : <span className="pill pill-warn" style={{ padding: '5px 11px' }}><ShieldAlert size={13} /> Two-factor authentication is off</span>}
      </div>

      {err && <div className="callout callout-warn" style={{ marginBottom: 14 }}><div>{err}</div></div>}

      {verified.map((f) => (
        <div key={f.id} className="between" style={{ padding: '11px 13px', background: 'var(--surface-2)', border: '1px solid var(--border-2)', borderRadius: 'var(--r-sm)', marginBottom: 8 }}>
          <div className="row"><ShieldCheck size={16} color="var(--ok)" /><span style={{ fontWeight: 650 }}>{f.friendly_name || 'Authenticator app'}</span><span className="pill pill-ok" style={{ padding: '2px 8px' }}>verified</span></div>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => remove(f.id)}><Trash2 size={13} /> Remove</button>
        </div>
      ))}

      {!enroll && (
        <button className="btn btn-primary" style={{ marginTop: 8 }} disabled={busy} onClick={startEnroll}>
          {busy ? <Loader2 size={15} className="spin" /> : <ShieldCheck size={15} />} {verified.length > 0 ? 'Add another authenticator' : 'Enable two-factor authentication'}
        </button>
      )}

      {enroll && (
        <div style={{ marginTop: 14, padding: 16, border: '1px solid var(--border-2)', borderRadius: 'var(--r-md)', background: 'var(--surface-2)' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Scan this with your authenticator app</div>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Google Authenticator, 1Password, Authy — then enter the 6-digit code to confirm.</div>
          {/* Supabase returns the QR as an SVG data URI */}
          <img src={enroll.qr} alt="TOTP QR code" style={{ width: 176, height: 176, background: '#fff', borderRadius: 8, padding: 8 }} />
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Or enter this secret manually: <code>{enroll.secret}</code></div>
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <input className="input" inputMode="numeric" maxLength={6} placeholder="123456" value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={{ width: 130, letterSpacing: '.2em', textAlign: 'center' }} />
            <button className="btn btn-primary" disabled={busy || code.length !== 6} onClick={confirmEnroll}>{busy ? <Loader2 size={15} className="spin" /> : <Check size={15} />} Confirm</button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => { setEnroll(null); setCode(''); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
