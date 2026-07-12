import { ShieldCheck, KeyRound } from 'lucide-react';
import { Card } from '@/components/ui';
import { MfaSetup } from '@/components/MfaSetup';

export default function SecurityPage() {
  return (
    <div>
      <div className="page-head">
        <div className="page-title">Security</div>
        <div className="page-sub">Protect your account with an extra verification step.</div>
      </div>

      <Card title="Two-factor authentication" icon={<ShieldCheck size={18} />} sub="Require a one-time code from an authenticator app at sign-in">
        <MfaSetup />
      </Card>

      <Card title="Password" icon={<KeyRound size={18} />}>
        <div className="muted" style={{ fontSize: 13.5 }}>
          To change your password, sign out and use “Forgot password” on the sign-in screen, or contact your administrator.
        </div>
      </Card>
    </div>
  );
}
