/**
 * The assistant agent — a router-orchestrator over domain specialist tools
 * (the "subagents"). It answers like an assistant: understands the question,
 * calls the right specialist(s) over the wide data set, and replies conversationally
 * with sources.
 *
 * - With an LLM key (gpt-4o-mini): true function-calling loop — the model decides
 *   which tools to call, then writes the answer.
 * - Without a key: a heuristic router calls the best-matching tools and synthesizes
 *   a natural reply from real data. Either way, answers come from real scoped data.
 *
 * Legal-judgment questions are always routed to counsel first (§14).
 */
import type postgres from 'postgres';
import type { Principal } from '@hr/shared';
import { AGENT_TOOLS, type AgentTool, type Source, type ToolCtx } from './agent-tools.js';
import { defaultEmbedder, type Embedder } from './embeddings.js';
import { llmConfigured } from './assistant.js';
import { requiresCounsel, LEGAL_GUARDRAIL_SYSTEM } from './assistant.js';

export interface AgentAnswer {
  answer: string;
  routedToCounsel: boolean;
  sources: Source[];
  toolsUsed: string[];
}

export interface AgentDeps {
  sql: postgres.Sql;
  embedder?: Embedder;
  /** Optional override for the LLM endpoint (defaults to env-configured gpt-4o-mini). */
  llm?: (messages: unknown[], tools?: unknown[]) => Promise<{ content: string | null; toolCalls: { id: string; name: string; args: string }[] }>;
}

const COUNSEL_REFERRAL =
  "That question calls for a legal judgment, which I can't give. I've flagged it for AJACE's immigration counsel, who'll follow up. I can still help with your status, deadlines, documents, and policy — just ask.";

export async function runAgent(deps: AgentDeps, principal: Principal, question: string): Promise<AgentAnswer> {
  if (requiresCounsel(question)) {
    return { answer: COUNSEL_REFERRAL, routedToCounsel: true, sources: [], toolsUsed: [] };
  }
  const ctx: ToolCtx = { sql: deps.sql, principal, embedder: deps.embedder ?? defaultEmbedder() };
  return llmConfigured() ? runWithLLM(ctx, deps, question) : runHeuristic(ctx, question);
}

/* ── Heuristic router (no LLM key) ──────────────────────────────────────────── */
async function runHeuristic(ctx: ToolCtx, question: string): Promise<AgentAnswer> {
  const q = question.toLowerCase();
  const kb = AGENT_TOOLS.find((t) => t.name === 'search_knowledge_base')!;
  // Score personal specialists; a matching personal tool wins, else fall back to
  // the knowledge base. Running a single best specialist keeps answers clean.
  const personal = AGENT_TOOLS.filter((t) => t.name !== 'search_knowledge_base')
    .map((t) => ({ t, score: t.keywords.reduce((s, k) => (q.includes(k) ? s + 1 : s), 0) }))
    .sort((a, b) => b.score - a.score);
  const primary = personal[0] && personal[0].score > 0 ? personal[0].t : kb;

  const r = await primary.run(ctx, { query: question });
  const empty = !r.text || /^No matching|^No immigration case|^You have no|^No employee/.test(r.text);

  const intro =
    primary.name === 'get_my_deadlines' ? "Here are your upcoming deadlines:\n\n" :
    primary.name === 'get_my_documents' ? "" :
    primary.name === 'get_my_status' ? "" :
    "Here's what I found in AJACE's knowledge base:\n\n";

  const answer = empty
    ? (primary === kb
        ? "I couldn't find that in the policy or immigration knowledge base. Try rephrasing, or open a Help Desk ticket and HR will follow up."
        : `${r.text} You can also ask me about your deadlines, documents, status, or company policy.`)
    : `${intro}${r.text}\n\nAnything else you'd like me to check?`;
  return { answer, routedToCounsel: false, sources: r.sources, toolsUsed: [primary.name] };
}

/* ── LLM function-calling loop (gpt-4o-mini) ────────────────────────────────── */
async function runWithLLM(ctx: ToolCtx, deps: AgentDeps, question: string): Promise<AgentAnswer> {
  const call = deps.llm ?? defaultLLM;
  const tools = AGENT_TOOLS.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(Object.entries(t.parameters).map(([k, v]) => [k, { type: v.type, description: v.description }])),
        required: Object.keys(t.parameters),
      },
    },
  }));
  const messages: any[] = [
    { role: 'system', content: `${LEGAL_GUARDRAIL_SYSTEM}\nYou can call tools to fetch the user's real, access-scoped data. Prefer tools over guessing. Cite what you used. Be warm, concise, and specific.` },
    { role: 'user', content: question },
  ];
  const sources: Source[] = [];
  const toolsUsed: string[] = [];

  for (let i = 0; i < 4; i++) {
    const { content, toolCalls } = await call(messages, tools);
    if (toolCalls.length === 0) {
      return { answer: content ?? "I'm not sure — could you rephrase?", routedToCounsel: false, sources, toolsUsed };
    }
    messages.push({ role: 'assistant', content: content ?? '', tool_calls: toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })) });
    for (const tc of toolCalls) {
      const tool = AGENT_TOOLS.find((t) => t.name === tc.name);
      let out: string;
      if (!tool) { out = 'Unknown tool.'; }
      else {
        toolsUsed.push(tc.name);
        let args: Record<string, string> = {};
        try { args = JSON.parse(tc.args || '{}'); } catch { /* ignore */ }
        const r = await tool.run(ctx, args);
        sources.push(...r.sources);
        out = r.text;
      }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: out });
    }
  }
  return { answer: "I gathered your details but couldn't finalize an answer — please try rephrasing.", routedToCounsel: false, sources, toolsUsed };
}

function resolveProvider() {
  const openaiKey = process.env.OPENAI_API_KEY;
  const orKey = process.env.OPENROUTER_API_KEY;
  return {
    baseUrl: openaiKey ? (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1') : (process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1'),
    apiKey: (openaiKey || orKey)!,
    model: openaiKey ? (process.env.OPENAI_MODEL ?? 'gpt-4o-mini') : (process.env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini'),
  };
}

/** Default OpenAI-compatible chat completion with tool-calling (gpt-4o-mini). */
async function defaultLLM(messages: unknown[], tools?: unknown[], toolChoice: 'auto' | 'required' | 'none' = 'auto') {
  const { baseUrl, apiKey, model } = resolveProvider();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, tools, tool_choice: tools ? toolChoice : undefined, temperature: 0.2 }),
  });
  if (!res.ok) throw new Error(`LLM failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { choices: { message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[] };
  const msg = json.choices[0]!.message;
  return {
    content: msg.content,
    toolCalls: (msg.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, args: c.function.arguments })),
  };
}

function toolSpecs() {
  return AGENT_TOOLS.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(Object.entries(t.parameters).map(([k, v]) => [k, { type: v.type, description: v.description }])),
        required: Object.keys(t.parameters),
      },
    },
  }));
}

/** Streaming completion — yields content deltas (SSE) token by token. */
async function* streamCompletion(messages: unknown[]): AsyncGenerator<string> {
  const { baseUrl, apiKey, model } = resolveProvider();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0.3, stream: true }),
  });
  if (!res.ok || !res.body) { yield 'Sorry — I could not generate a response just now.'; return; }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const data = t.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch { /* ignore keep-alives */ }
    }
  }
}

async function* streamWords(text: string): AsyncGenerator<string> {
  for (const part of text.split(/(\s+)/)) {
    if (part) yield part;
    await new Promise((r) => setTimeout(r, 14));
  }
}

export interface AgentMeta { routedToCounsel: boolean; sources: Source[]; toolsUsed: string[] }

/**
 * Streaming variant: gathers tool data first (so sources/tools are known), then
 * returns a generator that streams the final answer token by token. `meta` is
 * ready before streaming begins so the caller can send it as a header.
 */
export async function runAgentStream(
  deps: AgentDeps,
  principal: Principal,
  question: string,
): Promise<{ meta: AgentMeta; stream: AsyncGenerator<string> }> {
  if (requiresCounsel(question)) {
    return { meta: { routedToCounsel: true, sources: [], toolsUsed: [] }, stream: streamWords(COUNSEL_REFERRAL) };
  }
  const ctx: ToolCtx = { sql: deps.sql, principal, embedder: deps.embedder ?? defaultEmbedder() };

  if (!llmConfigured()) {
    const a = await runHeuristic(ctx, question);
    return { meta: { routedToCounsel: false, sources: a.sources, toolsUsed: a.toolsUsed }, stream: streamWords(a.answer) };
  }

  const tools = toolSpecs();
  const messages: any[] = [
    { role: 'system', content: `${LEGAL_GUARDRAIL_SYSTEM}\nYou can call tools to fetch the user's real, access-scoped data. Prefer tools over guessing. Be warm, concise, and specific; format with short paragraphs or bullets.` },
    { role: 'user', content: question },
  ];
  const sources: Source[] = [];
  const toolsUsed: string[] = [];

  // One gather round: FORCE a tool call so the model always fetches real data
  // before answering (prevents "let me check…" filler with no retrieval).
  const first = await defaultLLM(messages, tools, 'required');
  if (first.toolCalls.length === 0) {
    // Model declined to call a tool — stream its direct answer.
    return { meta: { routedToCounsel: false, sources, toolsUsed }, stream: streamCompletion(messages) };
  }
  messages.push({ role: 'assistant', content: first.content ?? '', tool_calls: first.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })) });
  for (const tc of first.toolCalls) {
    const tool = AGENT_TOOLS.find((t) => t.name === tc.name);
    let out = 'Unknown tool.';
    if (tool) {
      toolsUsed.push(tc.name);
      let args: Record<string, string> = {};
      try { args = JSON.parse(tc.args || '{}'); } catch { /* ignore */ }
      const r = await tool.run(ctx, args);
      sources.push(...r.sources);
      out = r.text;
    }
    messages.push({ role: 'tool', tool_call_id: tc.id, content: out });
  }
  // Stream the final answer from the gathered context (no tools → forces prose).
  messages.push({ role: 'system', content: 'Answer the user now, directly and specifically, using only the tool results above. Do not say you are retrieving or checking — just give the answer warmly and concisely.' });
  return { meta: { routedToCounsel: false, sources, toolsUsed }, stream: streamCompletion(messages) };
}
