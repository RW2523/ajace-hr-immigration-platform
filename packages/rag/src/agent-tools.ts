/**
 * Agent tools = domain "subagents". Each is a specialist over one slice of the
 * platform's wide data (knowledge base, case status, deadlines, documents, rules).
 * Every tool is access-scoped to the caller. These are the SAME capabilities the
 * MCP servers expose (case/rules/docs/rag) — here as in-process tools the agent
 * orchestrates. Adding a domain = adding a tool (data, not a rewrite).
 */
import type postgres from 'postgres';
import type { Principal } from '@hr/shared';
import { loadRuleData, validateCase, type CaseSnapshot } from '@hr/rules-engine';
import { retrieveHybrid } from './retrieval.js';
import type { Embedder } from './embeddings.js';

export interface ToolCtx {
  sql: postgres.Sql;
  principal: Principal;
  embedder: Embedder;
}
export interface Source { label: string; detail: string }
export interface ToolResult { text: string; sources: Source[] }

export interface AgentTool {
  name: string;
  /** For LLM function-calling + heuristic routing. */
  description: string;
  keywords: string[];
  parameters: Record<string, { type: string; description: string }>;
  run: (ctx: ToolCtx, args: Record<string, string>) => Promise<ToolResult>;
}

async function myEmployee(sql: postgres.Sql, principal: Principal) {
  const [e] = await sql<{ id: string; org_id: string; full_name: string; current_status: string | null; country: string | null }[]>`
    select e.id, e.org_id, e.full_name, c.current_status, c.country_of_birth as country
    from app.employees e left join app.immigration_cases c on c.employee_id = e.id
    where e.user_id = ${principal.userId} order by c.opened_at desc limit 1`;
  return e ?? null;
}

const searchKnowledge: AgentTool = {
  name: 'search_knowledge_base',
  description:
    "Semantic search over AJACE's company policies, immigration rules, AND the CONTENTS of the user's own uploaded documents. Use this whenever the question is about what a rule/policy states, or what is WRITTEN INSIDE one of the user's documents (e.g. 'what does my EAD say', EAD category, I-20 details, passport info, visa validity). Do NOT use get_my_documents for document contents — that only returns submission status.",
  keywords: ['policy', 'policies', 'benefit', 'pto', 'leave policy', 'rule', 'limit', 'fee', 'how many', 'what is', 'stem', 'opt', 'h-1b', 'h1b', 'cap', 'unemployment', '401k', 'handbook', 'my ead', 'ead card', 'i-20', 'i20', 'passport', 'says', 'category', 'valid', 'document say'],
  parameters: { query: { type: 'string', description: 'The search query' } },
  async run(ctx, args) {
    const hits = await retrieveHybrid(ctx.sql, ctx.embedder, ctx.principal, args.query ?? '', 5);
    return {
      text: hits.length ? hits.map((h) => `- ${h.content}`).join('\n') : 'No matching policy or rule found in the knowledge base.',
      sources: hits.map((h) => ({ label: h.docType, detail: h.content.slice(0, 100) })),
    };
  },
};

const myStatus: AgentTool = {
  name: 'get_my_status',
  description: "Get the caller's own current immigration status and the next steps they are eligible for.",
  keywords: ['my status', 'current status', 'what status', 'next step', 'eligible', 'transition', 'my case', 'am i on'],
  parameters: {},
  async run(ctx) {
    const e = await myEmployee(ctx.sql, ctx.principal);
    if (!e || !e.current_status) return { text: "No immigration case is on file for your account yet.", sources: [] };
    const data = await loadRuleData(ctx.sql);
    const dateRows = await ctx.sql<{ date_type: string; value: string }[]>`
      select cd.date_type, to_char(cd.value,'YYYY-MM-DD') as value from app.case_dates cd join app.immigration_cases c on c.id = cd.case_id where c.employee_id = ${e.id}`;
    const dates: Record<string, string> = {}; for (const d of dateRows) dates[d.date_type] = d.value;
    const snap: CaseSnapshot = { currentStatus: e.current_status, dates, collectedDocuments: [], attributes: {} };
    const res = validateCase(data, snap, new Date().toISOString().slice(0, 10));
    const next = res.eligibleTransitions.map((t) => t.toStatus.replace(/_/g, ' '));
    // Transitions gated on legal preconditions the engine cannot self-confirm are
    // shown as pending counsel review, never as a firm "eligible" step (Bug 1).
    const review = res.needsCounselReviewTransitions.map((t) => t.toStatus.replace(/_/g, ' '));
    const reviewText = review.length ? ` Pending counsel review: ${review.join(', ')}.` : '';
    return {
      text: `Current status: ${e.current_status.replace(/_/g, ' ')}${e.country ? ` (country of birth: ${e.country})` : ''}. Eligible next steps: ${next.length ? next.join(', ') : 'none right now'}.${reviewText}`,
      sources: [{ label: 'case', detail: `Status ${e.current_status}` }],
    };
  },
};

const myDeadlines: AgentTool = {
  name: 'get_my_deadlines',
  description: "Get the caller's own upcoming immigration and HR deadlines.",
  keywords: ['deadline', 'due', 'expire', 'expires', 'when is', 'when does', 'upcoming', 'report due', 'renew'],
  parameters: {},
  async run(ctx) {
    const e = await myEmployee(ctx.sql, ctx.principal);
    if (!e) return { text: 'No employee record is linked to your account.', sources: [] };
    const rows = await ctx.sql<{ date_type: string; value: string; days: number }[]>`
      select cd.date_type, to_char(cd.value,'YYYY-MM-DD') as value, (cd.value - current_date) as days
      from app.case_dates cd join app.immigration_cases c on c.id = cd.case_id
      where c.employee_id = ${e.id} and cd.value >= current_date order by cd.value asc limit 8`;
    if (!rows.length) return { text: 'You have no upcoming tracked deadlines.', sources: [] };
    return {
      text: rows.map((r) => `- ${r.date_type.replace(/_/g, ' ')}: ${r.value} (${r.days} days away)`).join('\n'),
      sources: rows.map((r) => ({ label: 'deadline', detail: `${r.date_type} ${r.value}` })),
    };
  },
};

const myDocuments: AgentTool = {
  name: 'get_my_documents',
  description: "List which documents the caller has submitted and which are still required for their status.",
  keywords: ['document', 'documents', 'upload', 'need to submit', 'still need', 'paperwork', 'missing', 'required doc'],
  parameters: {},
  async run(ctx) {
    const e = await myEmployee(ctx.sql, ctx.principal);
    if (!e) return { text: 'No employee record is linked to your account.', sources: [] };
    const status = (await ctx.sql<{ wac: string | null }[]>`select work_authorization_category as wac from app.employees where id = ${e.id}`)[0]?.wac ?? e.current_status ?? 'f1_opt';
    const reqs = await ctx.sql<{ key: string; label: string }[]>`select key, label from app.document_requirements where required and applies_to_statuses @> ${ctx.sql.json([status] as never)}`;
    const have = new Set((await ctx.sql<{ document_type: string }[]>`select document_type from app.documents where employee_id = ${e.id}`).map((d) => d.document_type));
    const missing = reqs.filter((r) => !have.has(r.key));
    return {
      text: `Submitted ${have.size} document(s). ${missing.length ? `Still required: ${missing.map((m) => m.label).join(', ')}.` : 'All required documents are in — nice work.'}`,
      sources: [{ label: 'documents', detail: `${have.size} uploaded, ${missing.length} missing` }],
    };
  },
};

export const AGENT_TOOLS: AgentTool[] = [searchKnowledge, myStatus, myDeadlines, myDocuments];
export { myEmployee };
