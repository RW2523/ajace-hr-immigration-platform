/**
 * rag-server tool logic (§11.1, §10). Both tools use ACCESS-SCOPED retrieval: the
 * caller's resolved Principal filters chunks server-side before anything reaches
 * the model. rag_answer additionally enforces the §14 legal-advice guardrail.
 */
import type postgres from 'postgres';
import { z } from 'zod';
import type { Principal } from '@hr/shared';
import { ask, retrieve, defaultEmbedder, type Embedder, type AssistantDeps } from '@hr/rag';

// ── rag_search (access-scoped retrieval) ────────────────────────────────────
export const ragSearchInput = z.object({ query: z.string().min(1), k: z.number().int().min(1).max(20).optional() });
export async function ragSearch(
  sql: postgres.Sql,
  principal: Principal,
  input: { query: string; k?: number },
  embedder: Embedder = defaultEmbedder(),
) {
  const results = await retrieve(sql, embedder, principal, input.query, input.k ?? 5);
  return {
    query: input.query,
    // Only content the caller is permitted to see is ever returned.
    results: results.map((r) => ({ content: r.content, doc_type: r.docType, score: Number(r.score.toFixed(4)) })),
  };
}

// ── rag_answer (retrieval + guarded generation) ─────────────────────────────
export const ragAnswerInput = z.object({ question: z.string().min(1) });
export async function ragAnswer(
  sql: postgres.Sql,
  principal: Principal,
  input: { question: string },
  deps: Partial<AssistantDeps> = {},
) {
  const answer = await ask({ sql, ...deps }, principal, input.question);
  return {
    answer: answer.answer,
    routed_to_counsel: answer.routedToCounsel,
    sources: answer.sources.map((s) => ({ content: s.content, doc_type: s.docType })),
  };
}
