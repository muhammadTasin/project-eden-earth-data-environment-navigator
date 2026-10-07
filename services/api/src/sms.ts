/**
 * Bangla SMS through the REVE Systems SMS gateway (the account Awaj's support set up; smpp.revesms.com).
 *
 *   SMS_API_KEY, SMS_SECRET_KEY  from the REVE panel; keep them in .env, never commit them
 *   SMS_SENDER_ID                the caller ID / sender ID on the account
 *   SMS_BASE_URL                 default https://smpp.revesms.com:7790 (the HTTPS API port in REVE's notes)
 *   SMS_LIVE=1                   the switch that turns dry runs into real, billed messages
 *
 * Without them every send returns the request it would make ({ dryRun: true, ... }) with the keys masked.
 * The API is GET /sendtext?apikey&secretkey&callerID&toUser&messageContent; numbers go as 8801XXXXXXXXX.
 */
import { bdMobile } from './awaj.ts';

const BASE = () => (process.env.SMS_BASE_URL || 'https://smpp.revesms.com:7790').replace(/\/$/, '');

export function smsConfig() {
  const apiKey = process.env.SMS_API_KEY || '';
  const secret = process.env.SMS_SECRET_KEY || '';
  const sender = process.env.SMS_SENDER_ID || '';
  return {
    configured: Boolean(apiKey && secret && sender),
    live: process.env.SMS_LIVE === '1' && Boolean(apiKey && secret && sender),
    sender: sender || null,
    gateway: BASE(),
  };
}

/** Unicode Bangla goes 70 characters to a part (67 when the message is split). */
export function smsParts(text: string): number {
  const unicode = /[^\x00-\x7F]/.test(text);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return text.length <= single ? 1 : Math.ceil(text.length / multi);
}

export async function sendSms(phone: string, text: string) {
  const cfg = smsConfig();
  const local = bdMobile(phone);
  const toUser = local ? `88${local}` : null;
  const request = { callerID: cfg.sender ?? '<SMS_SENDER_ID>', toUser, messageContent: text, parts: smsParts(text) };
  const masked = `GET ${cfg.gateway}/sendtext?apikey=***&secretkey=***&callerID=…&toUser=…&messageContent=…`;
  if (!toUser) return { dryRun: !cfg.live, error: 'phone must be a Bangladeshi mobile number (01XXXXXXXXX)', request };
  if (!cfg.live) return { dryRun: true, endpoint: masked, request };
  const url = `${cfg.gateway}/sendtext?${new URLSearchParams({
    apikey: process.env.SMS_API_KEY!, secretkey: process.env.SMS_SECRET_KEY!, callerID: cfg.sender!, toUser, messageContent: text,
  })}`;
  const res = await fetch(url, { method: 'GET' });
  const body = await res.text();
  let response: unknown = body;
  try { response = JSON.parse(body); } catch { /* the gateway may answer in plain text */ }
  return { dryRun: false, endpoint: masked, status: res.status, response };
}
