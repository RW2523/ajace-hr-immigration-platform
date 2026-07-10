/**
 * Role-aware assistant (§10, §14). Retrieval is access-scoped; generation runs
 * through OpenRouter with a hard legal guardrail. The assistant tracks status and
 * deadlines but must NEVER give immigration legal advice — anything resembling a
 * legal judgment is routed to counsel with a standard message.
 */
import type postgres from 'postgres';
import type { Principal } from '@hr/shared';
import { defaultEmbedder, type Embedder } from './embeddings.js';
import { retrieve, type Chunk } from './retrieval.js';

export const LEGAL_GUARDRAIL_SYSTEM = `You are an HR & immigration STATUS-AND-DEADLINE assistant for a US staffing firm.
You help users understand their own case status, upcoming deadlines, required documents, and general policy.
You are NOT a lawyer and must NOT provide immigration legal advice. If a question asks for a legal judgment —
eligibility determinations presented as legal conclusions, filing strategy, how to respond to an RFE, whether to
choose consular processing vs. change of status, or any "what should I legally do" question — do NOT answer it.
Instead respond exactly with a referral to the firm's immigration counsel. Only use the provided context; if the
answer is not in context, say you don't have that information. Never reveal another person's data.`;

const COUNSEL_REFERRAL =
  'This question involves a legal judgment, which I\'m not able to provide. I\'ve flagged it for your firm\'s immigration counsel, who will follow up. I can still help with your current status, deadlines, and required documents.';

/** Heuristic guardrail: detect requests for legal judgment before calling the model. */
export function requiresCounsel(question: string): boolean {
  const q = question.toLowerCase();
  const patterns = [
    /\bshould i\b.*\b(file|apply|choose|switch|withdraw|appeal|respond)\b/,
    /\brespond to (an?|my) rfe\b/,
    /\bhow (do|should) i (respond|answer).*(rfe|denial|notice)\b/,
    /\b(consular processing|change of status)\b.*\b(better|should|advise|recommend)\b/,
    /\bam i (legally )?eligible\b/,
    /\bwhat are my (legal )?(options|chances)\b/,
    /\bwill i (get|be) (approved|denied)\b/,
    /\blegal advice\b/,
    /\bfiling strategy\b/,
  ];
  return patterns.some((re) => re.test(q));
}

export interface AssistantAnswer {
  answer: string;
  routedToCounsel: boolean;
  sources: Chunk[];
}

export interface AssistantDeps {
  sql: postgres.Sql;
  embedder?: Embedder;
  /** Chat completion via OpenRouter (injected for testability). */
  complete?: (system: string, user: string) => Promise<string>;
}

export async function ask(
  deps: AssistantDeps,
  principal: Principal,
  question: string,
): Promise<AssistantAnswer> {
  // Guardrail first — never let a legal-judgment question reach generation (§14).
  if (requiresCounsel(question)) {
    return { answer: COUNSEL_REFERRAL, routedToCounsel: true, sources: [] };
  }

  const embedder = deps.embedder ?? defaultEmbedder();
  const sources = await retrieve(deps.sql, embedder, principal, question, 5);
  const context = sources.map((s, i) => `[${i + 1}] (${s.docType}) ${s.content}`).join('\n\n');

  const complete = deps.complete ?? openRouterComplete;
  const user = `Question: ${question}\n\nContext:\n${context || '(no relevant context found)'}`;
  const answer = await complete(LEGAL_GUARDRAIL_SYSTEM, user);
  return { answer, routedToCounsel: false, sources };
}

/** True if any LLM provider key is configured. */
export function llmConfigured(): boolean {
  return !!(process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY);
}

/**
 * Chat completion (OpenAI-compatible). Uses OpenAI directly with gpt-4o-mini when
 * OPENAI_API_KEY is set; otherwise OpenRouter (`openai/gpt-4o-mini` by default).
 */
export async function chatComplete(system: string, user: string): Promise<string> {
  const openaiKey = process.env.OPENAI_API_KEY;
  const orKey = process.env.OPENROUTER_API_KEY;
  let baseUrl: string, apiKey: string, model: string;
  if (openaiKey) {
    baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
    apiKey = openaiKey;
    model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  } else if (orKey) {
    baseUrl = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
    apiKey = orKey;
    model = process.env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini';
  } else {
    throw new Error('No LLM API key set (OPENAI_API_KEY or OPENROUTER_API_KEY)');
  }
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`LLM request failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  return json.choices[0]!.message.content;
}

/** Back-compat alias. */
export const openRouterComplete = chatComplete;
