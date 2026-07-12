import Link from 'next/link';
import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ArrowLeft, Send, PenLine, CheckCircle2 } from 'lucide-react';
import { getPrincipal, db } from '@/lib/session';
import { hasStaffScope } from '@hr/shared';
import { getOfferLetter, sendOfferLetter, signOfferLetter } from '@hr/hr';
import { Card, Pill } from '@/components/ui';

/** True if the caller may view this letter: staff in the same org, or its employee. */
function canView(
  principal: { orgId: string; userId: string },
  letter: { orgId: string; ownerUserId: string | null },
  staff: boolean,
): boolean {
  if (letter.ownerUserId && letter.ownerUserId === principal.userId) return true; // the employee it's for
  return staff && letter.orgId === principal.orgId; // staff within the owning org
}

async function sendAction(formData: FormData) {
  'use server';
  const principal = await getPrincipal();
  if (!principal) return;
  const id = String(formData.get('id'));
  // sendOfferLetter loads the row and authorizes with the requireContext pattern.
  await sendOfferLetter(db(), principal, id);
  revalidatePath(`/hr/offer-letters/${id}`);
}

async function signAction(formData: FormData) {
  'use server';
  const principal = await getPrincipal();
  if (!principal) return;
  const id = String(formData.get('id'));
  // signOfferLetter loads the row and authorizes the owning employee only.
  await signOfferLetter(db(), principal, id);
  revalidatePath(`/hr/offer-letters/${id}`);
}

export default async function OfferLetterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const principal = (await getPrincipal())!;
  const letter = await getOfferLetter(db(), id);
  if (!letter) notFound();

  const staff = hasStaffScope(principal, 'hr_items', 'read');
  if (!canView(principal, letter, staff)) {
    return <Card><div className="muted">You don't have access to this offer letter.</div></Card>;
  }
  const isOwner = letter.ownerUserId === principal.userId;

  return (
    <div>
      <div className="page-head">
        <div>
          <Link href="/hr/offer-letters" className="btn btn-ghost btn-sm" style={{ marginBottom: 8 }}><ArrowLeft size={14} /> All offer letters</Link>
          <div className="page-title">Offer letter — {letter.employeeName}</div>
          <div className="page-sub">{letter.variables.role_title} · created {letter.createdAt}</div>
        </div>
        <Pill tone={letter.esignStatus === 'signed' ? 'ok' : letter.esignStatus === 'sent' ? 'brand' : 'neutral'}>
          {letter.esignStatus === 'signed' && <CheckCircle2 size={12} />}{letter.esignStatus}
        </Pill>
      </div>

      <Card title="Letter">
        {letter.renderedHtml
          ? <div className="offer-letter-doc" dangerouslySetInnerHTML={{ __html: letter.renderedHtml }} />
          : <div className="muted">No rendered document.</div>}
      </Card>

      <Card title="E-signature">
        <div className="fgrid">
          <div><div className="input-label">Status</div><div>{letter.esignStatus}</div></div>
          <div><div className="input-label">Signed at</div><div>{letter.signedAt ?? '—'}</div></div>
        </div>
        <div className="row" style={{ gap: 10, marginTop: 14 }}>
          {staff && (letter.esignStatus === 'draft' || letter.esignStatus === 'sent') && (
            <form action={sendAction}>
              <input type="hidden" name="id" value={letter.id} />
              <button className="btn btn-primary"><Send size={15} /> {letter.esignStatus === 'draft' ? 'Send to employee' : 'Re-send'}</button>
            </form>
          )}
          {isOwner && letter.esignStatus === 'sent' && (
            <form action={signAction}>
              <input type="hidden" name="id" value={letter.id} />
              <button className="btn btn-primary"><PenLine size={15} /> Accept &amp; sign</button>
            </form>
          )}
          {letter.esignStatus === 'signed' && (
            <div className="row" style={{ color: 'var(--ok)', fontWeight: 600 }}><CheckCircle2 size={16} /> Signed and accepted.</div>
          )}
        </div>
      </Card>
    </div>
  );
}
