/**
 * Access-scoped retrieval (§10) — the mandatory security control of the RAG layer.
 * Every rag_chunks row carries access metadata (owner, role-visibility, doc type),
 * and the retrieval query is filtered by the caller's permission set ON THE SERVER
 * before any chunk reaches the model. An employee can NEVER retrieve another
 * person's case data.
 *
 * This explicit filter mirrors the DB `rag_read` RLS policy, giving defense in
 * depth: even if this filter were bypassed, RLS blocks cross-user rows.
 */
import type postgres from 'postgres';
import { effectiveScope, type Principal } from '@hr/shared';
import type { Embedder } from './embeddings.js';

export interface Chunk {
  id: string;
  content: string;
  docType: string;
  score: number;
}

export interface IngestInput {
  orgId: string;
  content: string;
  docType: string;
  ownerUserId?: string | null;
  ownerEmployeeId?: string | null;
  roleVisibility?: string[];
  sourceDocumentId?: string | null;
}

/** Embed and store a chunk with its access metadata. Runs as a trusted job. */
export async function ingestChunk(
  sql: postgres.Sql,
  embedder: Embedder,
  input: IngestInput,
): Promise<string> {
  const embedding = await embedder.embed(input.content);
  const literal = toVectorLiteral(embedding);
  const [row] = await sql`
    insert into app.rag_chunks (org_id, content, embedding, doc_type, owner_user_id,
      owner_employee_id, role_visibility, source_document_id)
    values (${input.orgId}, ${input.content}, ${literal}::vector, ${input.docType},
      ${input.ownerUserId ?? null}, ${input.ownerEmployeeId ?? null},
      ${sql.json((input.roleVisibility ?? []) as never)}, ${input.sourceDocumentId ?? null})
    returning id`;
  return row!.id as string;
}

/**
 * Retrieve the top-k chunks for a query, scoped to what the principal may see.
 * The scope predicate is built from the principal's permissions — not from any
 * client-supplied role.
 */
export async function retrieve(
  sql: postgres.Sql,
  embedder: Embedder,
  principal: Principal,
  query: string,
  k = 5,
): Promise<Chunk[]> {
  const embedding = await embedder.embed(query);
  const literal = toVectorLiteral(embedding);

  // Does the caller have org-wide (or global) reach over case internals? (HR+/employer/admin)
  const scope = effectiveScope(principal, 'case_internals', 'read');
  const orgWide = scope === 'org' || scope === 'global';
  const assigned = principal.assignedEmployeeIds;

  const rows = await sql<{ id: string; content: string; doc_type: string; distance: number }[]>`
    select id, content, doc_type, (embedding <=> ${literal}::vector) as distance
    from app.rag_chunks
    where org_id = ${principal.orgId}
      and (
        owner_user_id = ${principal.userId}
        or (owner_user_id is null and owner_employee_id is null)
        or ${orgWide}
        or (owner_employee_id is not null and owner_employee_id = any(${assigned}::uuid[]))
      )
    order by embedding <=> ${literal}::vector
    limit ${k}`;

  return rows.map((r) => ({ id: r.id, content: r.content, docType: r.doc_type, score: 1 - r.distance }));
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

/**
 * Keyword search over chunks (same access scope as vector retrieval). Ranks by the
 * number of query terms matched. Complements vector search so exact-term questions
 * (e.g. "unemployment limit", "H-1B cap fee") are reliably found even with a weak
 * embedder — hybrid retrieval, RAGFlow-style.
 */
export async function keywordSearch(
  sql: postgres.Sql,
  principal: Principal,
  query: string,
  k = 6,
): Promise<Chunk[]> {
  const terms = [...new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4))].slice(0, 10);
  if (terms.length === 0) return [];
  const patterns = terms.map((t) => `%${t}%`);
  const scope = effectiveScope(principal, 'case_internals', 'read');
  const orgWide = scope === 'org' || scope === 'global';
  const assigned = principal.assignedEmployeeIds;

  const rows = await sql<{ id: string; content: string; doc_type: string }[]>`
    select id, content, doc_type from app.rag_chunks
    where org_id = ${principal.orgId}
      and (
        owner_user_id = ${principal.userId}
        or (owner_user_id is null and owner_employee_id is null)
        or ${orgWide}
        or (owner_employee_id is not null and owner_employee_id = any(${assigned}::uuid[]))
      )
      and content ilike any(${patterns})
    limit 60`;

  const scored = rows.map((r) => {
    const lc = r.content.toLowerCase();
    const hits = terms.reduce((s, t) => (lc.includes(t) ? s + 1 : s), 0);
    return { id: r.id, content: r.content, docType: r.doc_type, score: hits / terms.length };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

/** Hybrid retrieval: keyword matches first (precise), then vector (semantic), deduped. */
export async function retrieveHybrid(
  sql: postgres.Sql,
  embedder: Embedder,
  principal: Principal,
  query: string,
  k = 6,
): Promise<Chunk[]> {
  const [kw, vec] = await Promise.all([
    keywordSearch(sql, principal, query, k),
    retrieve(sql, embedder, principal, query, k).catch(() => [] as Chunk[]),
  ]);
  const seen = new Set<string>();
  const out: Chunk[] = [];
  for (const c of [...kw, ...vec]) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
    if (out.length >= k) break;
  }
  return out;
}
