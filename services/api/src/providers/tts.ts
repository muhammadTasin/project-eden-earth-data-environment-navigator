/**
 * Server-side text-to-speech adapter, deliberately separate from text generation (llm.ts).
 *
 * Expects an HTTP endpoint that accepts POST JSON {text, voice, language} and returns audio bytes
 * (Content-Type audio/*). That is a small contract on purpose, so any provider can sit behind a thin proxy.
 * When TTS_BASE_URL is unset the status is `unavailable` and clients fall back to on-device speech.
 */
import { ApiError } from '../errors.ts';

export interface TtsStatus {
  status: 'configured' | 'unavailable';
  voice: string | null;
  reason?: string;
}

export interface TtsResult { audio: Buffer; contentType: string }

export function ttsStatus(env = process.env): TtsStatus {
  if (!env.TTS_BASE_URL?.trim()) {
    return { status: 'unavailable', voice: null, reason: 'TTS_BASE_URL is not set; clients use on-device speech when available' };
  }
  return { status: 'configured', voice: env.TTS_VOICE?.trim() || null };
}

export async function synthesizeSpeech(text: string, language = 'bn', env = process.env): Promise<TtsResult> {
  const status = ttsStatus(env);
  if (status.status !== 'configured') {
    throw new ApiError('configuration_required', 'No text-to-speech provider is configured on the server', { setting: 'TTS_BASE_URL', fallback: 'on_device_tts' });
  }
  const key = env.TTS_API_KEY?.trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(env.TTS_BASE_URL!.trim(), {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ text, language, voice: status.voice }),
    });
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.startsWith('audio/')) throw new Error(`TTS endpoint returned HTTP ${res.status} (${contentType || 'no content type'})`);
    return { audio: Buffer.from(await res.arrayBuffer()), contentType };
  } catch (err: any) {
    throw new ApiError('provider_unavailable', 'The text-to-speech provider is unavailable', { reason: String(err?.message || err), fallback: 'on_device_tts' });
  } finally {
    clearTimeout(timer);
  }
}
