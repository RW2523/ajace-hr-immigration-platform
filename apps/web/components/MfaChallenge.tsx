'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldCheck } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';

/** Step-up MFA at sign-in: verify a TOTP code to reach aal2, then enter the app. */
export function MfaChallenge() {
  const supabase = supabaseBrowser();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null); setBusy(true);
    const { data: factors, error: fErr } = await supabase.auth.mfa.listFactors();
    const factor = factors?.totp?.[0];
    if (fErr || !factor) { setBusy(false); setErr('No authenticator is enrolled on this account.'); return; }
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    router.replace('/dashboard');
    router.refresh();
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {err && <div className="callout callout-warn"><div>{err}</div></div>}
      <input
        className="input"
        inputMode="numeric"
        maxLength={6}
        placeholder="123456"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        style={{ letterSpacing: '.3em', textAlign: 'center', fontSize: 18 }}
        autoFocus
      />
      <button className="btn btn-primary" style={{ padding: '11px 16px' }} disabled={busy || code.length !== 6} onClick={submit}>
        {busy ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />} Verify &amp; continue
      </button>
    </div>
  );
}
