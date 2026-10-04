/**
 * Server-side text-generation adapter. Text generation only: it never produces speech audio (see tts.ts).
 *
 * Talks to any OpenAI-compatible /chat/completions endpoint (vLLM, Ollama's /v1, llama.cpp server, a hosted
 * gateway, ...). Gemma 3 4B can be served this way, but nothing here claims a Gemma endpoint is deployed or
 * fine-tuned: status is `configured` only when LLM_BASE_URL and LLM_MODEL are set, and `reachable` is never
 * assumed. Credentials stay on the server.
 */
import { ApiError } from '../errors.ts';

export interface LlmStatus {
  status: 'configured' | 'unavailable';
  model: string | null;
  reason?: string;
}

export interface LlmClient {
  generate(prompt: string, maxTokens?: number): Promise<string>;
}

export function llmStatus(env = process.env): LlmStatus {
  if (!env.LLM_BASE_URL?.trim() || !env.LLM_MODEL?.trim()) {
    return { status: 'unavailable', model: null, reason: 'LLM_BASE_URL and LLM_MODEL are not set' };
  }
  return { status: 'configured', model: env.LLM_MODEL.trim() };
}

/** Returns null when not configured so callers fall back to the deterministic template narrator. */
export function createLlmClient(env = process.env): LlmClient | null {
  if (llmStatus(env).status !== 'configured') return null;
  const base = env.LLM_BASE_URL!.trim().replace(/\/+$/, '');
  const model = env.LLM_MODEL!.trim();
  const key = env.LLM_API_KEY?.trim();
  return {
    async generate(prompt, maxTokens) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Number(env.LLM_TIMEOUT_MS) || 15000);
      try {
        const res = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            ...(maxTokens ? { max_tokens: maxTokens } : {}),
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        if (!res.ok) throw new Error(`LLM endpoint returned HTTP ${res.status}`);
        const data = await res.json() as any;
        const text = data?.choices?.[0]?.message?.content;
        if (typeof text !== 'string' || !text.trim()) throw new Error('LLM endpoint returned no text');
        return text.trim();
      } catch (err: any) {
        throw new ApiError('provider_unavailable', 'The language model endpoint is unavailable', { reason: String(err?.message || err) });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
