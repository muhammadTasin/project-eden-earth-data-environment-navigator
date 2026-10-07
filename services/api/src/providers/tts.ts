/**
 * Server-side text-to-speech adapter, deliberately separate from text generation (llm.ts). Two providers:
 *
 *  - Google Cloud Text-to-Speech, when GOOGLE_TTS_CREDENTIALS names a service-account key file (kept outside the
 *    repository). Signs a token with the key (no Google SDK needed), Bangladeshi Bangla (bn-BD) by default.
 *    TTS_VOICE picks a voice by name, TTS_GENDER (female or male) otherwise; TTS_LANGUAGE overrides bn-BD.
 *    The project needs billing enabled in Google Cloud, or Google refuses with HTTP 403.
 *  - Any HTTP endpoint at TTS_BASE_URL that accepts POST JSON {text, voice, language} and returns audio bytes.
 *
 * With neither set the status is `unavailable` and clients fall back to on-device speech.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { ApiError } from '../errors.ts';

export interface TtsStatus {
  status: 'configured' | 'unavailable';
  provider: 'google' | 'http' | null;
  voice: string | null;
  language?: string;
  reason?: string;
}

export interface TtsResult { audio: Buffer; contentType: string }

/** 'mp3' for browsers and apps; 'wav8k' (16-bit, 8 kHz mono) for telephone calls. */
export type TtsFormat = 'mp3' | 'wav8k';

export function ttsStatus(env = process.env): TtsStatus {
  const creds = env.GOOGLE_TTS_CREDENTIALS?.trim();
  if (creds) {
    if (!fs.existsSync(creds)) return { status: 'unavailable', provider: null, voice: null, reason: 'GOOGLE_TTS_CREDENTIALS points at a file that does not exist' };
    return { status: 'configured', provider: 'google', voice: env.TTS_VOICE?.trim() || `${(env.TTS_GENDER || 'female').toLowerCase()} (default)`, language: env.TTS_LANGUAGE?.trim() || 'bn-BD' };
  }
  if (env.TTS_BASE_URL?.trim()) return { status: 'configured', provider: 'http', voice: env.TTS_VOICE?.trim() || null };
  return { status: 'unavailable', provider: null, voice: null, reason: 'Neither GOOGLE_TTS_CREDENTIALS nor TTS_BASE_URL is set; clients use on-device speech when available' };
}

// ------------------------------------------------------------------ Google Cloud Text-to-Speech
let token: { value: string; expires: number; file: string } | null = null;
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** An OAuth access token from the service-account key (JWT bearer grant), cached until a minute before it ends. */
async function googleToken(file: string): Promise<string> {
  if (token && token.file === file && Date.now() < token.expires - 60_000) return token.value;
  const sa = JSON.parse(fs.readFileSync(file, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: sa.token_uri, iat: now, exp: now + 3600,
  }))}`;
  const signature = b64url(crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key));
  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  if (!res.ok) throw new Error(`Google sign-in returned HTTP ${res.status}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000, file };
  return token.value;
}

async function googleSpeech(text: string, format: TtsFormat, env: NodeJS.ProcessEnv): Promise<TtsResult> {
  const access = await googleToken(env.GOOGLE_TTS_CREDENTIALS!.trim());
  const languageCode = env.TTS_LANGUAGE?.trim() || 'bn-BD';
  const name = env.TTS_VOICE?.trim();
  const body = {
    input: { text: text.slice(0, 4800) }, // Google's limit is 5,000 bytes of input per request
    voice: { languageCode, ...(name ? { name } : { ssmlGender: (env.TTS_GENDER || 'female').toUpperCase() === 'MALE' ? 'MALE' : 'FEMALE' }) },
    audioConfig: format === 'wav8k'
      ? { audioEncoding: 'LINEAR16', sampleRateHertz: 8000, speakingRate: 0.95 }
      : { audioEncoding: 'MP3', speakingRate: 0.95 },
  };
  const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const billing = res.status === 403 && /billing/i.test(detail);
    throw new Error(billing ? 'Google Cloud says billing must be enabled on the project before it will synthesize speech' : `Google TTS returned HTTP ${res.status}`);
  }
  const data = await res.json() as { audioContent: string };
  return { audio: Buffer.from(data.audioContent, 'base64'), contentType: format === 'wav8k' ? 'audio/wav' : 'audio/mpeg' };
}

// ------------------------------------------------------------------ any HTTP endpoint
async function httpSpeech(text: string, language: string, voice: string | null, env: NodeJS.ProcessEnv): Promise<TtsResult> {
  const key = env.TTS_API_KEY?.trim();
  const res = await fetch(env.TTS_BASE_URL!.trim(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ text, language, voice }),
  });
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok || !contentType.startsWith('audio/')) throw new Error(`TTS endpoint returned HTTP ${res.status} (${contentType || 'no content type'})`);
  return { audio: Buffer.from(await res.arrayBuffer()), contentType };
}

export async function synthesizeSpeech(text: string, language = 'bn', env = process.env, format: TtsFormat = 'mp3'): Promise<TtsResult> {
  const status = ttsStatus(env);
  if (status.status !== 'configured') {
    throw new ApiError('configuration_required', 'No text-to-speech provider is configured on the server', { setting: 'GOOGLE_TTS_CREDENTIALS or TTS_BASE_URL', fallback: 'on_device_tts' });
  }
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('text-to-speech timed out after 20 s')), 20000));
  try {
    return await Promise.race([
      status.provider === 'google' ? googleSpeech(text, format, env) : httpSpeech(text, language, status.voice, env),
      timeout,
    ]);
  } catch (err: any) {
    throw new ApiError('provider_unavailable', 'The text-to-speech provider is unavailable', { reason: String(err?.message || err), fallback: 'on_device_tts' });
  }
}
