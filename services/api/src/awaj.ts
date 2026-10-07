/**
 * Awaj Digital voice API (https://awajdigital.com/api-docs): calls that read the advice aloud in Bangla (Direct TTS
 * Broadcast), keypad surveys (Direct Survey) and their results. Nothing is dialled unless all three are set:
 *   AWAJ_API_TOKEN  the Bearer token from the Awaj dashboard (Profile -> API Tokens); keep it in .env, never commit it
 *   AWAJ_SENDER     an active caller number on the account (GET /senders lists them)
 *   AWAJ_LIVE=1     the switch that turns dry runs into real, billed calls
 * Without them every function returns the exact request it would send ({ dryRun: true, ... }).
 * Awaj needs the "direct broadcast" and "AI TTS" permissions on the account for Direct TTS (ask their support).
 *
 * The keypad menu (farmer presses 1-8 for a crop, 9 for the officer) is an Awaj survey. Surveys play recorded
 * voices, so record the menu text (GET /api/v1/crops returns it), upload it with uploadVoice and wait for Awaj to
 * approve it; then either name it in AWAJ_MENU_VOICE (one question, Direct Survey) or build a two-question template
 * in the Awaj dashboard and name it in AWAJ_SURVEY_TEMPLATE. Awaj posts the pressed keys to
 * PUBLIC_BASE_URL/api/v1/calls/survey-webhook?key=AWAJ_WEBHOOK_KEY when the survey completes.
 */
import fs from 'node:fs';
import path from 'node:path';
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
    menuVoice: process.env.AWAJ_MENU_VOICE || null,
    surveyTemplate: process.env.AWAJ_SURVEY_TEMPLATE || null,
    officerNumber: process.env.AWAJ_OFFICER_NUMBER || null,
    webhookUrl: process.env.PUBLIC_BASE_URL
      ? `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/api/v1/calls/survey-webhook${process.env.AWAJ_WEBHOOK_KEY ? `?key=${encodeURIComponent(process.env.AWAJ_WEBHOOK_KEY)}` : ''}`
      : null,
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

/**
 * Play our own audio to up to 999 numbers (POST /broadcasts/direct): the call script spoken in Google's Bangla voice,
 * served by this API at a public address (PUBLIC_BASE_URL) so Awaj can fetch it.
 */
export async function sendAudioCall(opts: { phoneNumbers: string[]; audioUrls: string[]; metadata?: Record<string, unknown> }) {
  const cfg = awajConfig();
  const numbers = [...new Set(opts.phoneNumbers.map(bdMobile).filter((n): n is string => Boolean(n)))];
  const body = {
    request_id: requestId('mk_audio'),
    sender: cfg.sender ?? '<AWAJ_SENDER>',
    phone_numbers: numbers,
    voices: opts.audioUrls.slice(0, 10),
    metadata: opts.metadata ?? {},
  };
  if (!numbers.length) return { dryRun: !cfg.live, error: 'No valid Bangladeshi mobile number (01XXXXXXXXX)', request: body };
  if (!cfg.live) return { dryRun: true, endpoint: `POST ${BASE}/broadcasts/direct`, request: body };
  return { dryRun: false, endpoint: `POST ${BASE}/broadcasts/direct`, requestId: body.request_id, response: await call('POST', '/broadcasts/direct', body) };
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

/** The account's recorded voices and whether Awaj approved them (the keypad menu must be approved). */
export async function listVoices() {
  return call('GET', '/voices');
}

/**
 * Upload a recorded voice (mp3, wav, ogg, m4a, aac, webm or flac, up to 10 MB) for the keypad menu. Awaj reviews it
 * before it can be played; check with listVoices.
 */
export async function uploadVoice(filePath: string, name: string) {
  const size = fs.statSync(filePath).size;
  if (size > 10 * 1024 * 1024) return { dryRun: !awajConfig().live, error: 'Awaj accepts voices up to 10 MB' };
  if (!awajConfig().live) return { dryRun: true, endpoint: `POST ${BASE}/voices/upload`, request: { name, audio: `${path.basename(filePath)} (${Math.round(size / 1024)} KB)` } };
  const form = new FormData();
  form.append('name', name);
  form.append('audio', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
  const res = await fetch(`${BASE}/voices/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.AWAJ_API_TOKEN}`, Accept: 'application/json' },
    body: form,
  });
  return { dryRun: false, status: res.status, data: await res.json().catch(() => null) };
}

/** A keypad survey from a template built in the Awaj dashboard (several questions, so two crops can be asked for). */
export async function sendTemplateSurvey(opts: { phoneNumbers: string[]; templateName: string; webhookUrl?: string; metadata?: Record<string, unknown> }) {
  const cfg = awajConfig();
  const numbers = [...new Set(opts.phoneNumbers.map(bdMobile).filter((n): n is string => Boolean(n)))];
  const body = {
    request_id: requestId('mk_tpl'),
    template_name: opts.templateName,
    sender: cfg.sender ?? '<AWAJ_SENDER>',
    phone_numbers: numbers,
    metadata: opts.metadata ?? {},
    ...(opts.webhookUrl ? { webhook_url: opts.webhookUrl } : {}),
  };
  if (!numbers.length) return { dryRun: !cfg.live, error: 'No valid Bangladeshi mobile number (01XXXXXXXXX)', request: body };
  if (!cfg.live) return { dryRun: true, endpoint: `POST ${BASE}/surveys`, request: body };
  return { dryRun: false, endpoint: `POST ${BASE}/surveys`, response: await call('POST', '/surveys', body) };
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
