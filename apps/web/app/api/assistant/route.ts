/**
 * Streaming assistant endpoint. Runs the access-scoped RAG agent, then streams the
 * answer token by token. Tool/source metadata (known after the gather step) is sent
 * in the `x-assistant-meta` header (base64 UTF-8 JSON) before the body streams.
 */
import { getPrincipal, db } from '@/lib/session';
import { rateLimit } from '@/lib/rate-limit';
import { runAgentStream } from '@hr/rag';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_QUESTION_LEN = 4000;

export async function POST(req: Request) {
  const principal = await getPrincipal();
  if (!principal) return new Response('Unauthorized', { status: 401 });

  // Rate limit per authenticated user: the assistant makes paid LLM calls, so this
  // caps runaway cost/abuse (20 questions / minute per user).
  const rl = rateLimit(`assistant:${principal.userId}`, 20, 60_000);
  if (!rl.ok) {
    return new Response('Too many requests. Please slow down.', {
      status: 429,
      headers: { 'retry-after': String(rl.resetInSeconds) },
    });
  }

  let raw: unknown;
  try { raw = (await req.json())?.question; } catch { return new Response('Bad request', { status: 400 }); }
  if (typeof raw !== 'string') return new Response('Bad request', { status: 400 });
  const question = raw.trim().slice(0, MAX_QUESTION_LEN);
  if (!question) return new Response('Bad request', { status: 400 });

  const { meta, stream } = await runAgentStream({ sql: db() }, principal, question);
  const metaB64 = Buffer.from(JSON.stringify(meta), 'utf8').toString('base64');

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of stream) controller.enqueue(encoder.encode(chunk));
      } catch {
        controller.enqueue(encoder.encode('\n\n(Sorry — the response was interrupted.)'));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'x-assistant-meta': metaB64,
      'cache-control': 'no-cache, no-transform',
    },
  });
}
