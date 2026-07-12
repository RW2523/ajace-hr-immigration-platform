import { revalidatePath } from 'next/cache';
import { CheckCircle2, FileText, Info, ListChecks, Sparkle } from 'lucide-react';
import { getPrincipal, db } from '@/lib/session';
import { requirePermission, encryptPII } from '@hr/shared';
import { documentPath, signedDownloadUrl, uploadDocument } from '@/lib/storage';
import { extractDocument } from '@/lib/extract';
import { ingestDocumentText, defaultEmbedder } from '@hr/rag';
import { Card, Pill } from '@/components/ui';
import { DocUploader } from '@/components/DocUploader';
import { DocPreview } from '@/components/DocPreview';

/** On-demand signed URL for previewing/downloading a document (authorized + audited). */
async function signDoc(documentId: string) {
  'use server';
  const principal = await getPrincipal();
  if (!principal) return { url: null, contentType: null, filename: null };
  const sql = db();
  const [d] = await sql<{ org_id: string; employee_id: string | null; storage_key: string; content_type: string | null; filename: string | null; sensitive_pii: boolean; user_id: string | null }[]>`
    select d.org_id, d.employee_id, d.storage_key, d.content_type, d.filename, d.sensitive_pii, e.user_id
    from app.documents d left join app.employees e on e.id = d.employee_id where d.id = ${documentId}`;
  if (!d) return { url: null, contentType: null, filename: null };
  requirePermission(principal, {
    resource: d.sensitive_pii ? 'sensitive_pii' : 'documents', action: 'read',
    context: { employeeId: d.employee_id ?? undefined, ownerUserId: d.user_id ?? undefined, orgId: d.org_id },
  });
  if (d.sensitive_pii) {
    await sql`insert into app.audit_log (org_id, actor_user_id, action, resource) values (${d.org_id}, ${principal.userId}, 'document.download', ${'documents:' + documentId})`;
  }
  const url = await signedDownloadUrl(d.storage_key, 300);
  return { url, contentType: d.content_type, filename: d.filename };
}

async function upload(formData: FormData) {
  'use server';
  const principal = await getPrincipal();
  if (!principal) return;
  const file = formData.get('file') as File | null;
  const documentType = String(formData.get('document_type') ?? 'other').slice(0, 64);
  if (!file || file.size === 0) return;
  // Reject oversized or unexpected file types before touching storage (defense in
  // depth on top of the 5MB server-action body limit).
  const MAX_BYTES = 15 * 1024 * 1024;
  const ALLOWED = /^(application\/pdf|image\/(png|jpe?g|gif|webp|tiff?|heic)|text\/plain)$/i;
  if (file.size > MAX_BYTES) return;
  if (file.type && !ALLOWED.test(file.type)) return;
  const sql = db();
  const [emp] = await sql<{ id: string; org_id: string; user_id: string | null }[]>`
    select id, org_id, user_id from app.employees where user_id = ${principal.userId}`;
  if (!emp) return;
  const [req] = await sql<{ sensitive_pii: boolean }[]>`select sensitive_pii from app.document_requirements where key = ${documentType}`;
  const sensitive = req?.sensitive_pii ?? false;
  requirePermission(principal, {
    resource: sensitive ? 'sensitive_pii' : 'documents', action: 'create',
    context: { employeeId: emp.id, ownerUserId: emp.user_id ?? undefined, orgId: emp.org_id },
  });
  const bytes = await file.arrayBuffer();
  const key = documentPath(emp.org_id, emp.id, documentType, file.name);
  const ok = await uploadDocument(key, bytes, file.type || 'application/octet-stream');
  if (!ok) return;
  const [doc] = await sql<{ id: string }[]>`insert into app.documents (org_id, employee_id, document_type, storage_key, filename, content_type, sensitive_pii, uploaded_by)
            values (${emp.org_id}, ${emp.id}, ${documentType}, ${key}, ${file.name}, ${file.type || null}, ${sensitive}, ${principal.userId}) returning id`;
  await sql`insert into app.audit_log (org_id, actor_user_id, action, resource) values (${emp.org_id}, ${principal.userId}, 'document.upload', ${'documents:' + documentType})`;
  // Extract text (OCR for scanned/image documents), save it on the record, and
  // stream it into the knowledge base — all scoped to this employee.
  try {
    const { text, method } = await extractDocument(bytes, file.type || null, file.name);
    if (doc) {
      // §12: for sensitive documents (passport/EAD/SSN card) the extracted text is
      // PII — store it app-layer-encrypted at rest, and keep its contents OUT of the
      // general RAG index (ingest only a protected metadata chunk).
      const storedText = text ? (sensitive ? encryptPII(text) : text) : null;
      await sql`update app.documents set extracted_text = ${storedText}, extraction_method = ${method} where id = ${doc.id}`;
      await ingestDocumentText(sql, defaultEmbedder(), { orgId: emp.org_id, employeeId: emp.id, userId: principal.userId, documentId: doc.id, docType: documentType, filename: file.name, text, sensitive });
    }
  } catch { /* extraction/ingestion is best-effort; upload already succeeded */ }
  revalidatePath('/documents');
}

export default async function DocumentsPage() {
  const principal = (await getPrincipal())!;
  const sql = db();
  const [emp] = await sql<{ id: string; work_authorization_category: string | null }[]>`
    select id, work_authorization_category from app.employees where user_id = ${principal.userId}`;
  if (!emp) return <div><div className="page-head"><div className="page-title">Documents</div></div><Card><div className="muted">No employee record linked to your account.</div></Card></div>;

  const status = emp.work_authorization_category ?? 'f1_opt';
  const reqs = await sql<{ key: string; label: string; required: boolean; sensitive_pii: boolean; notes: string }[]>`
    select key, label, required, sensitive_pii, notes from app.document_requirements
    where applies_to_statuses @> ${sql.json([status] as never)} order by required desc, label`;
  const docs = await sql<{ id: string; document_type: string; filename: string | null; storage_key: string; sensitive_pii: boolean }[]>`
    select id, document_type, filename, storage_key, sensitive_pii from app.documents where employee_id = ${emp.id}`;
  const byType = new Map(docs.map((d) => [d.document_type, d]));

  const required = reqs.filter((r) => r.required);
  const recommended = reqs.filter((r) => !r.required);
  const submitted = required.filter((r) => byType.has(r.key)).length;
  const pct = required.length ? Math.round((submitted / required.length) * 100) : 100;

  function DocCard({ r }: { r: typeof reqs[number] }) {
    const doc = byType.get(r.key);
    const state = doc ? 'submitted' : r.required ? 'pending' : 'na';
    return (
      <div className={`doc-card ${state}`}>
        <div className="doc-card-top">
          <div className="doc-name">{r.label}{r.required && <span className="req-star">*</span>}</div>
          {doc ? <Pill tone="ok"><CheckCircle2 size={12} /> Submitted</Pill>
            : r.required ? <Pill tone="warn">Required</Pill> : <Pill tone="neutral">Optional</Pill>}
        </div>
        {r.notes && <div className="doc-desc">{r.notes.length > 120 ? r.notes.slice(0, 117) + '…' : r.notes}</div>}
        {doc ? (
          <div className="file-chip">
            <FileText size={15} />
            <span className="fname">{doc.filename ?? doc.document_type}</span>
            <DocPreview documentId={doc.id} filename={doc.filename} sign={signDoc} />
          </div>
        ) : (
          <DocUploader docType={r.key} action={upload} compact />
        )}
        {doc && <div style={{ marginTop: 8 }}><DocUploader docType={r.key} action={upload} compact /></div>}
      </div>
    );
  }

  return (
    <div>
      <div className="page-head between">
        <div>
          <div className="page-title">Document Submission</div>
          <div className="page-sub">Upload the paperwork your legal team needs to move your case forward.</div>
        </div>
        <Pill tone={pct === 100 ? 'ok' : 'brand'}>{submitted}/{required.length} required submitted</Pill>
      </div>

      <Card flat>
        <div className="between" style={{ marginBottom: 10 }}>
          <div className="row" style={{ fontWeight: 650, fontSize: 13 }}><ListChecks size={16} color="var(--brand-600)" /> Submission progress</div>
          <div className="muted" style={{ fontSize: 13, fontWeight: 650 }}>{pct}%</div>
        </div>
        <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
      </Card>

      <div className="callout callout-info">
        <Info size={18} className="ic" />
        <div>If a document does not apply to you, upload what you have and note it in the assistant. Your employer and legal team are notified as items come in.</div>
      </div>

      <div className="dropzone" style={{ marginBottom: 8 }}>
        <div className="dropzone-ic"><FileText size={22} /></div>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Upload documents below</div>
        <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>Each item has its own drop area — drag a file onto the matching card, or click to browse.</div>
      </div>

      <div className="section-label"><CheckCircle2 size={18} color="var(--danger)" /> Required Documents</div>
      <div className="doc-grid">
        {required.map((r) => <DocCard key={r.key} r={r} />)}
        {required.length === 0 && <div className="muted">No required documents for your current status.</div>}
      </div>

      {recommended.length > 0 && (
        <>
          <div className="section-label"><Sparkle size={18} color="var(--brand-600)" /> Strongly Recommended</div>
          <div className="doc-grid">{recommended.map((r) => <DocCard key={r.key} r={r} />)}</div>
        </>
      )}
    </div>
  );
}
