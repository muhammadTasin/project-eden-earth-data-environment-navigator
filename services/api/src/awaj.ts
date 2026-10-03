/**
 * Awaj Digital voice API (https://awajdigital.com/api-docs): calls that read the advice aloud in Bangla (Direct TTS
 * Broadcast), keypad surveys (Direct Survey) and their results. Nothing is dialled unless all three are set:
 *   AWAJ_API_TOKEN  the Bearer token from the Awaj dashboard (Profile -> API Tokens); keep it in .env, never commit it
 *   AWAJ_SENDER     an active caller number on the account (GET /senders lists them)
 *   AWAJ_LIVE=1     the switch that turns dry runs into real, billed calls
 * Without them every function returns the exact request it would send ({ dryRun: true, ... }).
 * Awaj needs the "direct broadcast" and "AI TTS" permissions on the account for Direct TTS (ask their support).
 */
import { randomUUID } from 'node:crypto';

const BASE = (process.env.AWAJ_BASE_URL || 'https://api.awajdigital.com/api').replace(/\/$/, '');

export function awajConfig() {
  const token = process.env.AWAJ_API_TOKEN || '';
  const sender = process.env.AWAJ_SENDER || '';
  return {
    baseUrl: BASE,
    tokenSet: Boolean(token),
    sender: sender || null,
    live: process.env.AWAJ_LIVE === '1' && Boolean(token) && Boolean(sender),
    voice: process.env.AWAJ_VOICE === 'male' ? 'male' : 'female',
  };
}

/** '+8801712345678', '8801712345678', '01712-345678' -> '01712345678'; null if it is not a Bangladeshi mobile. */
export function bdMobile(raw: string): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '').replace(/^88(?=01)/, '');
  return /^01[3-9]\d{8}$/.test(digits) ? digits : null;
}

function requestId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`.slice(0, 64); // Awaj wants 16-64 characters
}

async function call(method: 'GET' | 'POST', path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.AWAJ_API_TOKEN}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // keep the raw text
  }
  return { status: res.status, ok: res.ok, data };
}

/** Read Bangla text aloud to up to 999 numbers (POST /broadcasts/direct-tts). Rate limit: 1 request per second. */
export async function sendTtsCall(opts: { phoneNumbers: string[]; texts: string[]; metadata?: Record<string, unknown> }) {
  const cfg = awajConfig();
  const numbers = [...new Set(opts.phoneNumbers.map(bdMobile).filter((n): n is string => Boolean(n)))];
  const body = {
    request_id: requestId('mk_tts'),
    sender: cfg.sender ?? '<AWAJ_SENDER>',
    phone_numbers: numbers,
    texts: opts.texts.map(t => t.slice(0, 5000)).slice(0, 10),
    voice: cfg.voice,
    language_code: 'bn-BD',
    metadata: opts.metadata ?? {},
  };
  if (!numbers.length) return { dryRun: !cfg.live, error: 'No valid Bangladeshi mobile number (01XXXXXXXXX)', request: body };
  if (!cfg.live) return { dryRun: true, endpoint: `POST ${BASE}/broadcasts/direct-tts`, request: body };
  return { dryRun: false, endpoint: `POST ${BASE}/broadcasts/direct-tts`, requestId: body.request_id, response: await call('POST', '/broadcasts/direct-tts', body) };
}

/** Processing state of a Direct TTS request: pending, processing, completed (with broadcast_id) or failed. */
export async function ttsStatus(id: string) {
  return call('GET', `/broadcasts/direct-tts/${encodeURIComponent(id)}/status`);
}

/** Per-number outcome of a broadcast once it is complete: answered, not answered, busy... with call seconds. */
export async function broadcastResult(broadcastId: number | string) {
  return call('GET', `/broadcasts/${encodeURIComponent(String(broadcastId))}/result`);
}

export async function balance() {
  return call('GET', '/balance');
}

export async function senders() {
  return call('GET', '/senders');
}

/**
 * A keypad survey without a dashboard template (POST /v1/surveys/direct-order). The question must be a recorded,
 * approved voice from the account's library (or an 8 kHz mono WAV URL, with extra permission); keys 1-9.
 * When it completes, Awaj posts the pressed keys to webhookUrl.
 */
export async function sendKeypadSurvey(opts: {
  phoneNumbers: string[];
  questionVoice: string;
  options: Array<{ key: string }>;
  officerKey?: string;
  officerNumber?: string;
  webhookUrl?: string;
  metadata?: Record<string, unknown>;
}) {
  const cfg = awajConfig();
  const numbers = [...new Set(opts.phoneNumbers.map(bdMobile).filter((n): n is string => Boolean(n)))];
  const officer = opts.officerNumber ? bdMobile(opts.officerNumber) : null;
  const body = {
    request_id: requestId('mk_survey'),
    sender: cfg.sender ?? '<AWAJ_SENDER>',
    phone_numbers: numbers,
    question_voices: [{ type: 'voice', name: opts.questionVoice }],
    dtmf_options: [
      ...opts.options.map(o => ({ key: o.key, option_type: 'voice', voices: [] })),
      ...(opts.officerKey && officer ? [{ key: opts.officerKey, option_type: 'transfer', transfer_numbers: [officer] }] : []),
    ],
    metadata: opts.metadata ?? {},
    ...(opts.webhookUrl ? { webhook_url: opts.webhookUrl } : {}),
    config: { retry_count: 1 },
  };
  if (!numbers.length) return { dryRun: !cfg.live, error: 'No valid Bangladeshi mobile number (01XXXXXXXXX)', request: body };
  if (!cfg.live) return { dryRun: true, endpoint: `POST ${BASE}/v1/surveys/direct-order`, request: body };
  return { dryRun: false, endpoint: `POST ${BASE}/v1/surveys/direct-order`, response: await call('POST', '/v1/surveys/direct-order', body) };
}
