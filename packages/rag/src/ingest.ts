/**
 * Knowledge-base ingestion (inspired by RAGFlow's chunk pipeline / RAG-Anything's
 * breadth). Populates app.rag_chunks with:
 *   - org-shared knowledge: immigration rules + company policies (visible to all)
 *   - per-employee facts: case status, deadlines, documents (owner-scoped)
 *
 * Access metadata on every chunk is what makes retrieval safe: org-shared chunks
 * have null owners; personal facts are owned by the employee/user so RLS + the
 * retrieval filter keep them private.
 */
import type postgres from 'postgres';
import type { Embedder } from './embeddings.js';
import { ingestChunk } from './retrieval.js';

const POLICIES = [
  { title: 'Employee Handbook', body: 'The AJACE Inc Employee Handbook covers working hours, remote-work expectations, PTO accrual (15 days per year), code of conduct, and the process for raising concerns via the HR Help Desk.' },
  { title: 'Time Off Policy', body: 'Paid time off accrues at 15 days per year. Requests are submitted under Time Off and approved by HR. Sick leave is separate. Unused PTO does not roll over beyond 5 days.' },
  { title: 'Benefits Overview', body: 'Benefits open enrollment offers Medical (PPO or HDHP+HSA), Dental, Vision, and a 401(k) with company match up to 6%. Elections are made under Benefits and can be updated during qualifying life events.' },
  { title: 'I-9 and Work Authorization Policy', body: 'All employees complete Form I-9. Section 1 by day one, Section 2 within 3 business days. E-Verify case is created within 3 business days of hire. Employees on F-1 OPT/STEM OPT or H-1B must keep their work-authorization documents current and report changes promptly.' },
  { title: 'Immigration Support Policy', body: 'AJACE Inc sponsors work visas including H-1B and supports the green-card process. The immigration coordinator and outside counsel manage filings. Employees track their status, deadlines, and required documents in this portal. The assistant provides status and deadline information but not legal advice.' },
];

/** Ingest org-shared knowledge (rules + policies). Idempotent per org. */
export async function ingestOrgKnowledge(sql: postgres.Sql, embedder: Embedder, orgId: string): Promise<number> {
  // clear previous org-shared knowledge to avoid duplicates on re-run
  await sql`delete from app.rag_chunks where org_id = ${orgId} and doc_type in ('rule','policy')`;
  let n = 0;

  // Immigration rules → one chunk each (org-shared).
  const rules = await sql<{ status_or_transition_key: string; attribute: string; value: unknown; notes: string; source_citation: string; confirmed_by_counsel: boolean }[]>`
    select status_or_transition_key, attribute, value, notes, source_citation, confirmed_by_counsel
    from app.rules where superseded_by is null`;
  for (const r of rules) {
    const val = typeof r.value === 'string' ? r.value : JSON.stringify(r.value);
    const content = `Immigration rule — ${r.status_or_transition_key.replace(/_/g, ' ')}: ${r.attribute.replace(/_/g, ' ')} = ${val}.${r.notes ? ' ' + r.notes : ''}${r.source_citation ? ` (Source: ${r.source_citation})` : ''}${r.confirmed_by_counsel ? '' : ' [pending counsel review]'}`;
    await ingestChunk(sql, embedder, { orgId, content, docType: 'rule', ownerUserId: null, ownerEmployeeId: null });
    n++;
  }

  // Policies → chunk each (org-shared).
  for (const p of POLICIES) {
    await ingestChunk(sql, embedder, { orgId, content: `Company policy — ${p.title}: ${p.body}`, docType: 'policy', ownerUserId: null, ownerEmployeeId: null });
    n++;
  }
  return n;
}

/** Ingest one employee's personal case facts (owner-scoped). Idempotent. */
export async function ingestEmployeeFacts(sql: postgres.Sql, embedder: Embedder, employeeId: string): Promise<number> {
  const [e] = await sql<{ org_id: string; user_id: string | null; full_name: string; work_authorization_category: string | null }[]>`
    select org_id, user_id, full_name, work_authorization_category from app.employees where id = ${employeeId}`;
  if (!e) return 0;
  await sql`delete from app.rag_chunks where owner_employee_id = ${employeeId} and doc_type = 'case_fact'`;
  let n = 0;
  const add = async (content: string) => { await ingestChunk(sql, embedder, { orgId: e.org_id, content, docType: 'case_fact', ownerUserId: e.user_id, ownerEmployeeId: employeeId }); n++; };

  if (e.work_authorization_category) await add(`${e.full_name}'s current work-authorization status is ${e.work_authorization_category.replace(/_/g, ' ')}.`);

  const dates = await sql<{ date_type: string; value: string }[]>`
    select date_type, to_char(value,'YYYY-MM-DD') as value from app.case_dates cd
    join app.immigration_cases c on c.id = cd.case_id where c.employee_id = ${employeeId} order by value`;
  for (const d of dates) await add(`${e.full_name} has an upcoming ${d.date_type.replace(/_/g, ' ')} on ${d.value}.`);

  const docs = await sql<{ document_type: string; filename: string | null }[]>`
    select document_type, filename from app.documents where employee_id = ${employeeId}`;
  if (docs.length) await add(`${e.full_name} has uploaded these documents: ${docs.map((d) => d.filename ?? d.document_type).join(', ')}.`);

  const [i9] = await sql<{ s2: boolean; ev: boolean }[]>`
    select (section2_completed_at is not null) s2, (everify_case_id is not null) ev from app.i9_records where employee_id = ${employeeId} limit 1`;
  if (i9) await add(`${e.full_name}'s I-9 Section 2 is ${i9.s2 ? 'complete' : 'pending'} and E-Verify is ${i9.ev ? 'confirmed' : 'pending'}.`);

  return n;
}

function chunkText(text: string, size = 700, overlap = 90): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= size) return clean ? [clean] : [];
  const out: string[] = [];
  let i = 0;
  while (i < clean.length) {
    out.push(clean.slice(i, i + size));
    i += size - overlap;
    if (out.length > 40) break; // cap very large documents
  }
  return out;
}

/**
 * Ingest an uploaded document's extracted text into the knowledge base, OWNER-scoped
 * to the employee/user, so the assistant can answer from the person's own documents
 * (never anyone else's). Re-ingesting a document replaces its prior chunks.
 */
export async function ingestDocumentText(
  sql: postgres.Sql,
  embedder: Embedder,
  opts: { orgId: string; employeeId: string | null; userId: string | null; documentId: string; docType: string; filename: string; text: string; sensitive?: boolean },
): Promise<number> {
  await sql`delete from app.rag_chunks where source_document_id = ${opts.documentId}`;
  const label = opts.docType.replace(/_/g, ' ');
  // §12: never place the CONTENTS of a sensitive document (passport/EAD/SSN card)
  // into the general knowledge index as plaintext. Keep only a findable metadata
  // chunk; the raw text stays encrypted on the document row and is surfaced only
  // through audited, authorized paths.
  if (opts.sensitive) {
    await ingestChunk(sql, embedder, {
      orgId: opts.orgId,
      content: `Sensitive document on file: "${opts.filename}" (${label}). Contents are protected; ask HR or view it under Documents.`,
      docType: 'case_doc',
      ownerUserId: opts.userId,
      ownerEmployeeId: opts.employeeId,
      sourceDocumentId: opts.documentId,
    });
    return 1;
  }
  const chunks = chunkText(opts.text);
  let n = 0;
  for (const c of chunks) {
    await ingestChunk(sql, embedder, {
      orgId: opts.orgId,
      content: `From the document "${opts.filename}" (${label}): ${c}`,
      docType: 'case_doc',
      ownerUserId: opts.userId,
      ownerEmployeeId: opts.employeeId,
      sourceDocumentId: opts.documentId,
    });
    n++;
  }
  // Always keep at least a metadata chunk so the document is findable by name/type.
  if (n === 0) {
    await ingestChunk(sql, embedder, {
      orgId: opts.orgId,
      content: `Document on file: "${opts.filename}" (${label}).`,
      docType: 'case_doc',
      ownerUserId: opts.userId,
      ownerEmployeeId: opts.employeeId,
      sourceDocumentId: opts.documentId,
    });
    n = 1;
  }
  return n;
}

/** Full ingest for an org and all its employees. */
export async function ingestAll(sql: postgres.Sql, embedder: Embedder, orgId: string): Promise<{ knowledge: number; facts: number }> {
  const knowledge = await ingestOrgKnowledge(sql, embedder, orgId);
  const employees = await sql<{ id: string }[]>`select id from app.employees where org_id = ${orgId}`;
  let facts = 0;
  for (const e of employees) facts += await ingestEmployeeFacts(sql, embedder, e.id);
  return { knowledge, facts };
}
