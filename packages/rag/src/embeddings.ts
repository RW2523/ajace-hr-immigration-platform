/**
 * Embeddings provider (§4). OpenRouter has NO embeddings endpoint, so embeddings
 * use a dedicated provider (OpenAI-compatible by default), configured by env. A
 * deterministic local hash-embedder is used in tests so retrieval scoping can be
 * tested without a network call or API key.
 */
export interface Embedder {
  readonly dim: number;
  embed(text: string): Promise<number[]>;
}

/** OpenAI-compatible embeddings (text-embedding-3-small default). */
export class OpenAIEmbedder implements Embedder {
  readonly dim: number;
  constructor(
    private apiKey = process.env.EMBEDDINGS_API_KEY ?? '',
    private model = process.env.EMBEDDINGS_MODEL ?? 'text-embedding-3-small',
    dim = Number(process.env.EMBEDDINGS_DIM ?? 1536),
    private baseUrl = process.env.EMBEDDINGS_BASE_URL ?? 'https://api.openai.com/v1',
  ) {
    this.dim = dim;
  }
  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) throw new Error('EMBEDDINGS_API_KEY not set');
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`embeddings failed: ${res.status}`);
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data[0]!.embedding;
  }
}

/** Deterministic hash embedder for tests (no network). Not for production quality. */
export class HashEmbedder implements Embedder {
  constructor(readonly dim = 1536) {}
  async embed(text: string): Promise<number[]> {
    const v = new Array(this.dim).fill(0);
    const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
    for (const tok of tokens) {
      let h = 2166136261;
      for (let i = 0; i < tok.length; i++) {
        h ^= tok.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      v[Math.abs(h) % this.dim] += 1;
    }
    // L2 normalize
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }
}

export function defaultEmbedder(): Embedder {
  return process.env.EMBEDDINGS_API_KEY ? new OpenAIEmbedder() : new HashEmbedder();
}
