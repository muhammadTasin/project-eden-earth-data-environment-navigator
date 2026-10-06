/**
 * Every outside service the website or the backend uses or claims to use, in one list, with an honest status and a safe probe.
 *
 * Status label (what the Data sources card shows):
 *   live    real data or a real service, fetched when it is asked for
 *   saved   real data, but a saved copy: a cache, a committed fixture, a dated file or a built-in reference table
 *   demo    simulated or sample: nothing real happens (a dry run, a sample record, a made-up farm)
 *   notset  not set up on this server (the feature falls back, or does not work)
 *
 * Probe (what `npm run check:integrations` prints): one harmless read or an auth check, never a call, an SMS, a billed speech or text
 * generation, and never a message to a phone. A provider that cannot be checked without cost or without a documented check is SKIPPED
 * and says why.
 *
 * Printing rules (tests enforce them): a report names providers, says SET/UNSET and PASS/FAIL/SKIPPED, and gives a note from the closed
 * NOTES list below. It never contains a value from the environment, a token, a URL with a key in it or an error message from the
 * provider (those can echo the request). Values are read only through config.ts and only to make the one request.
 */
import { envIsSet, envValue, nasaConfig } from './config.ts';
import type { IntegrationGroup } from './config.ts';
import { liveStatus } from './live.ts';

export type StatusLabel = 'live' | 'saved' | 'demo' | 'notset';
export type ProbeResult = 'PASS' | 'FAIL' | 'SKIPPED';
export type SetState = 'SET' | 'UNSET' | 'PARTIAL' | 'NOT_NEEDED' | 'NOT_APPLICABLE';
export type Bilingual = { bn: string; en: string };

/** The only notes a probe may give: fixed words, so nothing from a provider's reply can reach the output. */
export const NOTES = {
  ok: { bn: 'সাড়া ঠিক আছে', en: 'answered correctly' },
  not_configured: { bn: 'সেট করা নেই, তাই পরীক্ষা হয়নি', en: 'not set up, so not checked' },
  offline_mode: { bn: 'OFFLINE মোড চালু, নেটওয়ার্কে যাওয়া হয়নি', en: 'offline mode is on, the network was not used' },
  http_error: { bn: 'সরবরাহকারী ত্রুটি বা অগ্রাহ্য সংকেত দিয়েছে', en: 'the provider answered with an error or refused' },
  timeout: { bn: 'সময়ের মধ্যে সাড়া আসেনি', en: 'no answer in time' },
  network_error: { bn: 'সংযোগ করা যায়নি', en: 'could not connect' },
  bad_response: { bn: 'উত্তরের ধরন প্রত্যাশিত নয়', en: 'the answer was not what was expected' },
  not_probed_cost: { bn: 'পরীক্ষা করলেই খরচ হতে পারে, তাই করা হয়নি', en: 'not checked: any request may be billed' },
  not_probed_docs: { bn: 'ক্ষতিহীন যাচাইয়ের নথিভুক্ত পথ নিশ্চিত নয়, তাই করা হয়নি', en: 'not checked: no documented harmless check was confirmed' },
  not_probed_policy: { bn: 'স্বয়ংক্রিয় পরীক্ষা সরবরাহকারীর নীতিতে নিরুৎসাহিত, তাই করা হয়নি', en: 'not checked: automated checks are discouraged by the provider' },
  not_probed_static: { bn: 'বাইরের কোনো সেবা নয়, পরীক্ষার কিছু নেই', en: 'no outside service to check' },
  not_used: { bn: 'চাবি রাখা যায়, কিন্তু কোনো ফিচার এটা এখনো ব্যবহার করে না', en: 'a key can be stored, but no feature uses it yet' },
  worker_unavailable: { bn: 'Earth Engine কর্মী (Python) চালু করা যায়নি', en: 'the Earth Engine worker (Python) could not run' },
  file_fresh: { bn: 'ফাইল সাম্প্রতিক', en: 'the file is recent' },
  file_stale: { bn: 'ফাইল পুরনো (৩ দিনের বেশি)', en: 'the file is old (more than 3 days)' },
  file_missing: { bn: 'ফাইল নেই', en: 'the file is missing' },
} as const satisfies Record<string, Bilingual>;
export type NoteCode = keyof typeof NOTES;

export interface ProbeOutcome { result: ProbeResult; note: NoteCode }

export interface ProbeContext {
  fetchImpl: typeof fetch;
  offline: boolean;
  timeoutMs: number;
  /** Earth Engine readiness check (a real, harmless ee.Initialize in the Python worker); replaced in tests. */
  eeReadiness: () => Promise<'ready' | 'not_ready'>;
  now: Date;
}

export interface Provider {
  id: string;
  name: Bilingual;
  /** The variables that belong to this provider (names only); `required` are the ones without which it is not set up. */
  group: IntegrationGroup | null;
  required: string[][]; // any one of these sets of variables, all set, makes the provider SET
  keyNeeded: 'none' | 'optional' | 'required' | 'not_applicable';
  cost: 'free' | 'free account' | 'free tier or paid' | 'paid' | 'internal';
  signupUrl: string | null;
  /** The feature that uses it. */
  usedBy: Bilingual;
  /** What is real, in one line. */
  reality: Bilingual;
  status(ctx: { offline: boolean }): { label: StatusLabel; reason: Bilingual };
  probe(ctx: ProbeContext): Promise<ProbeOutcome>;
}

const skipped = (note: NoteCode): ProbeOutcome => ({ result: 'SKIPPED', note });
const passed = (): ProbeOutcome => ({ result: 'PASS', note: 'ok' });
const failed = (note: NoteCode): ProbeOutcome => ({ result: 'FAIL', note });

/** One GET. The only things that leave this function are a status number or a note code: never a URL, a header or an error message. */
async function get(ctx: ProbeContext, url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown } | NoteCode> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);
  try {
    const res = await ctx.fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json', ...headers } });
    let body: unknown = null;
    try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body };
  } catch (error) {
    return (error as { name?: string })?.name === 'AbortError' ? 'timeout' : 'network_error';
  } finally {
    clearTimeout(timer);
  }
}

async function simpleProbe(ctx: ProbeContext, url: string, headers: Record<string, string> = {}, check?: (body: unknown) => boolean): Promise<ProbeOutcome> {
  if (ctx.offline) return skipped('offline_mode');
  const answer = await get(ctx, url, headers);
  if (typeof answer === 'string') return failed(answer);
  if (answer.status < 200 || answer.status >= 300) return failed('http_error');
  if (check && !check(answer.body)) return failed('bad_response');
  return passed();
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object';

const trimSlash = (value: string) => value.replace(/\/+$/, '');

export const PROVIDERS: Provider[] = [
  {
    id: 'nasa-power',
    name: { bn: 'NASA POWER (আবহাওয়া ও বৃষ্টি)', en: 'NASA POWER (weather and rain)' },
    group: 'nasaPower', required: [], keyNeeded: 'none', cost: 'free', signupUrl: null,
    usedBy: { bn: 'ম্যানেজারের জলবায়ু কার্ড, আবহাওয়া ট্যাব (পর্যবেক্ষণ), গবাদিপশু ফিচার', en: 'The manager climate card, the weather tab (observations), the cattle feature' },
    reality: { bn: 'আসল তথ্য, ২–৩ দিন দেরিতে। OFFLINE=1 হলে সংরক্ষিত কপি বা নমুনা ফাইল।', en: 'Real data, 2–3 days behind. With OFFLINE=1 it is a saved copy or the committed sample file.' },
    status: ({ offline }) => offline
      ? { label: 'saved', reason: { bn: 'OFFLINE মোড: সংরক্ষিত কপি বা নমুনা ফাইল', en: 'Offline mode: saved copy or sample file' } }
      : { label: 'live', reason: { bn: 'চাবি ছাড়াই সরাসরি আনা হয়', en: 'Fetched directly, no key needed' } },
    probe: (ctx) => simpleProbe(ctx, 'https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M&community=AG&longitude=88.56&latitude=24.62&start=20260901&end=20260902&format=JSON', {}, body => isObject(body) && isObject(body.properties)),
  },
  {
    id: 'open-meteo',
    name: { bn: 'Open-Meteo (আবহাওয়ার পূর্বাভাস)', en: 'Open-Meteo (weather forecast)' },
    group: 'openMeteo', required: [], keyNeeded: 'optional', cost: 'free', signupUrl: 'https://open-meteo.com/',
    usedBy: { bn: 'আবহাওয়া ট্যাবের ৭ দিনের পূর্বাভাস, গবাদিপশু ফিচার', en: 'The weather tab’s 7-day forecast, the cattle feature' },
    reality: { bn: 'সরাসরি আনা মডেলের অনুমান (পর্যবেক্ষণ নয়)। OFFLINE=1 এটা থামায় না।', en: 'A model forecast fetched live (not an observation). OFFLINE=1 does not stop it.' },
    status: () => ({ label: 'live', reason: { bn: 'চাবি ছাড়াই (অবাণিজ্যিক) সরাসরি আনা হয়', en: 'Fetched directly, no key needed for non-commercial use' } }),
    probe: (ctx) => simpleProbe(ctx, 'https://api.open-meteo.com/v1/forecast?latitude=24.62&longitude=88.56&current=temperature_2m', {}, body => isObject(body) && isObject(body.current)),
  },
  {
    id: 'nasa-gibs',
    name: { bn: 'NASA GIBS (মানচিত্রের উপগ্রহ স্তর)', en: 'NASA GIBS (map satellite layers)' },
    group: null, required: [], keyNeeded: 'none', cost: 'free', signupUrl: null,
    usedBy: { bn: 'ওভারভিউ মানচিত্রের IMERG ও অন্যান্য স্তর (ব্রাউজার সরাসরি আনে)', en: 'The overview map’s IMERG and other layers (the browser fetches them)' },
    reality: { bn: 'সরাসরি মানচিত্র টাইল; সংখ্যার ডেটা নয়।', en: 'Live map tiles; they are pictures, not the numbers shown elsewhere.' },
    status: () => ({ label: 'live', reason: { bn: 'ব্রাউজার সরাসরি আনে', en: 'The browser fetches the tiles directly' } }),
    probe: async (ctx) => {
      if (ctx.offline) return skipped('offline_mode');
      const answer = await get(ctx, 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/IMERG_Precipitation_Rate/default/2026-10-01/GoogleMapsCompatible_Level6/3/3/3.png');
      return typeof answer === 'string' ? failed(answer) : answer.status === 200 ? passed() : failed('http_error');
    },
  },
  {
    id: 'browser-cdn',
    name: { bn: 'ব্রাউজারের CDN ও মানচিত্র টাইল (cdnjs, Google Fonts, OpenStreetMap)', en: 'Browser CDNs and map tiles (cdnjs, Google Fonts, OpenStreetMap)' },
    group: null, required: [], keyNeeded: 'none', cost: 'free', signupUrl: null,
    usedBy: { bn: 'মানচিত্রের লাইব্রেরি, ফন্ট ও ভিত্তি মানচিত্র', en: 'The map library, fonts and the base map' },
    reality: { bn: 'ইন্টারনেট ছাড়া মানচিত্র ও ফন্ট আসবে না (সার্ভারের ডেটা আসবে)।', en: 'Without internet the map and fonts do not load (server data still does).' },
    status: () => ({ label: 'live', reason: { bn: 'ব্রাউজার সরাসরি আনে', en: 'The browser loads them directly' } }),
    probe: async () => skipped('not_probed_policy'),
  },
  {
    id: 'supabase',
    name: { bn: 'Supabase (ম্যানেজার সাইন-ইন)', en: 'Supabase (manager sign-in)' },
    group: 'supabase', required: [['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'AUTH_EMAIL_DOMAIN']], keyNeeded: 'required', cost: 'free tier or paid', signupUrl: 'https://supabase.com/dashboard',
    usedBy: { bn: 'ম্যানেজার ডেস্কে সাইন-ইন, ভূমিকা ও সাইট যাচাই', en: 'Manager sign-in and the role and site check' },
    reality: { bn: 'আসল সাইন-ইন। না থাকলে ম্যানেজার ঢুকতে পারে না।', en: 'Real sign-in. Without it no manager can enter.' },
    status: () => envIsSet('SUPABASE_URL') && envIsSet('SUPABASE_ANON_KEY') && envIsSet('AUTH_EMAIL_DOMAIN')
      ? { label: 'live', reason: { bn: 'আসল সাইন-ইন সেবা', en: 'The real sign-in service' } }
      : { label: 'notset', reason: { bn: 'সেট করা নেই: ম্যানেজার সাইন-ইন চলবে না', en: 'Not set up: manager sign-in will not work' } },
    probe: async (ctx) => {
      if (!envIsSet('SUPABASE_URL') || !envIsSet('SUPABASE_ANON_KEY')) return skipped('not_configured');
      // the public settings of the project's own auth service, read with the project's own public (anon) key
      return simpleProbe(ctx, `${trimSlash(envValue('SUPABASE_URL'))}/auth/v1/settings`, { apikey: envValue('SUPABASE_ANON_KEY') }, isObject);
    },
  },
  {
    id: 'awaj',
    name: { bn: 'Awaj Digital (ভয়েস কল ও কিপ্যাড)', en: 'Awaj Digital (voice calls and keypad)' },
    group: 'awaj', required: [['AWAJ_API_TOKEN', 'AWAJ_SENDER']], keyNeeded: 'required', cost: 'paid', signupUrl: 'https://awajdigital.com/',
    usedBy: { bn: 'কৃষকের ফোনে পরামর্শ পড়ে শোনানো, কিপ্যাড-৯ কল-ব্যাক', en: 'Reading advice to a farmer by phone; keypad-9 call-backs' },
    reality: { bn: 'চাবি, প্রেরক নম্বর ও AWAJ_LIVE=1 না থাকলে কোনো কল হয় না: শুধু "কী পাঠানো হতো" দেখায় (ডেমো)।', en: 'Without the token, a sender number and AWAJ_LIVE=1 no call is ever made: the screens only show what would be sent (demo).' },
    status: () => {
      if (!envIsSet('AWAJ_API_TOKEN') || !envIsSet('AWAJ_SENDER')) return { label: 'notset', reason: { bn: 'সেট করা নেই: কোনো কল হবে না, শুধু ডেমো', en: 'Not set up: no call can be made, demo only' } };
      return envValue('AWAJ_LIVE') === '1'
        ? { label: 'live', reason: { bn: 'আসল, বিল হওয়া কল চালু', en: 'Real, billed calls are on' } }
        : { label: 'demo', reason: { bn: 'চাবি আছে কিন্তু AWAJ_LIVE=1 নয়: সব কল ডেমো (সিমুলেটেড)', en: 'A token is set but AWAJ_LIVE is not 1: every call is a simulated dry run' } };
    },
    probe: async (ctx) => {
      if (!envIsSet('AWAJ_API_TOKEN')) return skipped('not_configured');
      // the account balance: a read. No call, no SMS, nothing is sent to a phone.
      const base = trimSlash(envValue('AWAJ_BASE_URL') || 'https://api.awajdigital.com/api');
      return simpleProbe(ctx, `${base}/balance`, { Authorization: `Bearer ${envValue('AWAJ_API_TOKEN')}` });
    },
  },
  {
    id: 'tts',
    name: { bn: 'টেক্সট-টু-স্পিচ সেবা (সার্ভার)', en: 'Text-to-speech service (server)' },
    group: 'tts', required: [['TTS_BASE_URL']], keyNeeded: 'optional', cost: 'free tier or paid', signupUrl: null,
    usedBy: { bn: 'অডিও প্রিভিউ ও কল-স্ক্রিপ্টের বাংলা ভয়েস', en: 'The Bangla voice for audio previews and call scripts' },
    reality: { bn: 'সেট না থাকলে ব্রাউজারের নিজের স্পিচ ব্যবহার হয় (ডিভাইসভেদে মান আলাদা); সার্ভার কোনো অডিও বানায় না।', en: 'Unset, the browser’s own speech is used (quality varies by device); the server makes no audio.' },
    status: () => envIsSet('TTS_BASE_URL')
      ? { label: 'live', reason: { bn: 'সার্ভার-পাশের TTS এন্ডপয়েন্ট সেট করা', en: 'A server-side TTS endpoint is set' } }
      : { label: 'notset', reason: { bn: 'সেট করা নেই: ব্রাউজারের নিজের স্পিচ', en: 'Not set up: the browser’s own speech is used' } },
    probe: async () => (envIsSet('TTS_BASE_URL') ? skipped('not_probed_cost') : skipped('not_configured')),
  },
  {
    id: 'llm',
    name: { bn: 'ভাষা মডেল (LLM, OpenAI-সামঞ্জস্যপূর্ণ)', en: 'Language model (LLM, OpenAI-compatible)' },
    group: 'llm', required: [['LLM_BASE_URL', 'LLM_MODEL']], keyNeeded: 'optional', cost: 'free tier or paid', signupUrl: null,
    usedBy: { bn: 'পরামর্শের বাংলা বর্ণনা (দুই-ধাপ যাচাইয়ের পর)', en: 'Wording of the advice in Bangla (after the two-step check)' },
    reality: { bn: 'সেট না থাকলে নির্ধারিত টেমপ্লেট ব্যবহার হয়; কোনো মডেল ধরে নেওয়া হয় না।', en: 'Unset, a fixed template is used; no model is assumed to exist.' },
    status: () => envIsSet('LLM_BASE_URL') && envIsSet('LLM_MODEL')
      ? { label: 'live', reason: { bn: 'সেট করা (সংযোগ যাচাই `npm run check:integrations`-এ)', en: 'Set up (reachability is checked by `npm run check:integrations`)' } }
      : { label: 'notset', reason: { bn: 'সেট করা নেই: নির্ধারিত টেমপ্লেট', en: 'Not set up: the fixed template is used' } },
    probe: async (ctx) => {
      if (!envIsSet('LLM_BASE_URL') || !envIsSet('LLM_MODEL')) return skipped('not_configured');
      const key = envValue('LLM_API_KEY');
      // the model list of an OpenAI-compatible server: a read, no text is generated
      const outcome = await simpleProbe(ctx, `${trimSlash(envValue('LLM_BASE_URL'))}/models`, key ? { Authorization: `Bearer ${key}` } : {});
      return outcome.result === 'FAIL' && outcome.note === 'http_error' ? failed('http_error') : outcome;
    },
  },
  {
    id: 'earth-engine',
    name: { bn: 'Google Earth Engine (NDVI, SMAP, IMERG)', en: 'Google Earth Engine (NDVI, SMAP, IMERG)' },
    group: 'earthEngine', required: [['EE_PROJECT'], ['GOOGLE_APPLICATION_CREDENTIALS']], keyNeeded: 'required', cost: 'free account', signupUrl: 'https://earthengine.google.com/',
    usedBy: { bn: 'গবাদিপশু ফিচারের উপগ্রহ তথ্য (সবুজ, মাটির রস, বৃষ্টি)', en: 'The cattle feature’s satellite data (greenness, soil moisture, rain)' },
    reality: { bn: 'সেট না থাকলে উপগ্রহ অংশ "অনুপলব্ধ" দেখায়; আবহাওয়ার অংশ চলে।', en: 'Unset, the satellite part says "unavailable"; the weather part still works.' },
    status: () => envIsSet('EE_PROJECT') || envIsSet('GOOGLE_APPLICATION_CREDENTIALS')
      ? { label: 'live', reason: { bn: 'সেট করা (প্রস্তুত কিনা `npm run check:integrations`-এ)', en: 'Set up (readiness is checked by `npm run check:integrations`)' } }
      : { label: 'notset', reason: { bn: 'সেট করা নেই: উপগ্রহ অংশ অনুপলব্ধ', en: 'Not set up: the satellite part is unavailable' } },
    probe: async (ctx) => {
      if (!envIsSet('EE_PROJECT') && !envIsSet('GOOGLE_APPLICATION_CREDENTIALS')) return skipped('not_configured');
      try {
        return (await ctx.eeReadiness()) === 'ready' ? passed() : failed('worker_unavailable');
      } catch {
        return failed('worker_unavailable');
      }
    },
  },
  {
    id: 'earthdata',
    name: { bn: 'NASA Earthdata Login (SMAP, IMERG, MODIS)', en: 'NASA Earthdata Login (SMAP, IMERG, MODIS)' },
    group: 'earthdata', required: [['EARTHDATA_USERNAME', 'EARTHDATA_PASSWORD'], ['EDL_USER', 'EDL_PASS'], ['EARTHDATA_TOKEN']], keyNeeded: 'required', cost: 'free account', signupUrl: 'https://urs.earthdata.nasa.gov/users/new',
    usedBy: { bn: 'শুধু রাতের হালনাগাদ ও গবেষণার Python স্ক্রিপ্ট (IMERG, SMAP, MODIS ডাউনলোড); ওয়েবসাইট সরাসরি ব্যবহার করে না', en: 'Only the nightly update and the research Python scripts (IMERG, SMAP, MODIS downloads); the website does not call it' },
    reality: { bn: 'সার্ভার চালু অবস্থায় এই লগইন ব্যবহৃত হয় না; ওয়েবসাইটের IMERG সংখ্যা রাতে বানানো একটি সংরক্ষিত ফাইল।', en: 'The running server never uses this login; the website’s IMERG numbers come from a file the nightly job saves.' },
    status: () => envIsSet('EARTHDATA_TOKEN') || (envIsSet('EARTHDATA_USERNAME') && envIsSet('EARTHDATA_PASSWORD')) || (envIsSet('EDL_USER') && envIsSet('EDL_PASS'))
      ? { label: 'saved', reason: { bn: 'শুধু রাতের কাজ ব্যবহার করে; ফল সংরক্ষিত ফাইলে', en: 'Used only by the nightly job; its result is a saved file' } }
      : { label: 'notset', reason: { bn: 'সেট করা নেই: রাতের হালনাগাদে IMERG বাদ', en: 'Not set up: the nightly update skips IMERG' } },
    probe: async () => (nasaConfigHasEarthdata() ? skipped('not_probed_docs') : skipped('not_configured')),
  },
  {
    id: 'firms',
    name: { bn: 'NASA FIRMS (আগুনের তথ্য)', en: 'NASA FIRMS (fire data)' },
    group: 'firms', required: [['FIRMS_MAP_KEY']], keyNeeded: 'required', cost: 'free account', signupUrl: 'https://firms.modaps.eosdis.nasa.gov/api/map_key/',
    usedBy: { bn: 'কোনো ফিচার ব্যবহার করে না', en: 'No feature uses it' },
    reality: { bn: 'চাবি রাখার জায়গা আছে, কিন্তু কোড এটা ডাকে না।', en: 'There is a place to store the key, but no code calls it.' },
    status: () => ({ label: 'notset', reason: { bn: 'এই চ্যালেঞ্জে লাগে না; কোনো ফিচার ব্যবহার করে না', en: 'Not needed for this challenge; no feature uses it' } }),
    probe: async () => (envIsSet('FIRMS_MAP_KEY') ? skipped('not_probed_docs') : skipped('not_configured')),
  },
  {
    id: 'nasa-api',
    name: { bn: 'NASA Open APIs (api.nasa.gov)', en: 'NASA Open APIs (api.nasa.gov)' },
    group: 'nasaApi', required: [['NASA_API_KEY']], keyNeeded: 'optional', cost: 'free account', signupUrl: 'https://api.nasa.gov/',
    usedBy: { bn: 'কোনো ফিচার ব্যবহার করে না', en: 'No feature uses it' },
    reality: { bn: 'চাবি রাখার জায়গা আছে, কিন্তু কোড এটা ডাকে না।', en: 'There is a place to store the key, but no code calls it.' },
    status: () => ({ label: 'notset', reason: { bn: 'কোনো ফিচার ব্যবহার করে না', en: 'No feature uses it' } }),
    probe: async (ctx) => (envIsSet('NASA_API_KEY')
      ? simpleProbe(ctx, `https://api.nasa.gov/planetary/apod?api_key=${encodeURIComponent(envValue('NASA_API_KEY'))}`, {}, isObject)
      : skipped('not_configured')),
  },
  {
    id: 'ads',
    name: { bn: 'NASA ADS (গবেষণাপত্র খোঁজা)', en: 'NASA ADS (literature search)' },
    group: 'ads', required: [['ADS_API_TOKEN']], keyNeeded: 'required', cost: 'free account', signupUrl: 'https://ui.adsabs.harvard.edu/user/settings/token',
    usedBy: { bn: 'কোনো ফিচার ব্যবহার করে না', en: 'No feature uses it' },
    reality: { bn: 'টোকেন রাখার জায়গা আছে, কিন্তু কোড এটা ডাকে না।', en: 'There is a place to store the token, but no code calls it.' },
    status: () => ({ label: 'notset', reason: { bn: 'কোনো ফিচার ব্যবহার করে না', en: 'No feature uses it' } }),
    probe: async (ctx) => (envIsSet('ADS_API_TOKEN')
      ? simpleProbe(ctx, 'https://api.adsabs.harvard.edu/v1/search/query?q=star', { Authorization: `Bearer ${envValue('ADS_API_TOKEN')}` }, isObject)
      : skipped('not_configured')),
  },
  {
    id: 'daily-update-file',
    name: { bn: 'দৈনিক NASA হালনাগাদ ফাইল (৫৪৪ উপজেলা)', en: 'Daily NASA update file (544 upazilas)' },
    group: null, required: [], keyNeeded: 'not_applicable', cost: 'internal', signupUrl: null,
    usedBy: { bn: 'ওভারভিউয়ের "দৈনিক নাসা তথ্য" কার্ড, মানচিত্রের রং, হাওরের সতর্কতা', en: 'The overview’s "Daily NASA conditions" card, the map colours, the haor warning' },
    reality: { bn: 'প্রতি সকালে GitHub কাজ ফাইলটি বানায় এবং commit করে; সার্ভার সরাসরি NASA-কে ডাকে না। IMERG শুধু Earthdata গোপন তথ্য থাকলে।', en: 'A GitHub job builds and commits the file each morning; the server does not call NASA for it. IMERG only if the Earthdata secrets are set there.' },
    status: () => ({ label: 'saved', reason: { bn: 'তারিখসহ সংরক্ষিত ফাইল', en: 'A dated saved file' } }),
    probe: async (ctx) => {
      const status = liveStatus();
      if (!status) return failed('file_missing');
      const generated = Date.parse(String((status as { generatedAt?: string }).generatedAt ?? ''));
      if (!Number.isFinite(generated)) return failed('bad_response');
      return ctx.now.getTime() - generated <= 3 * 86_400_000 ? { result: 'PASS', note: 'file_fresh' } : { result: 'FAIL', note: 'file_stale' };
    },
  },
  {
    id: 'release-snapshot',
    name: { bn: 'গবেষণা রিলিজ স্ন্যাপশট (tanore-2026.09.30)', en: 'Research release snapshot (tanore-2026.09.30)' },
    group: null, required: [], keyNeeded: 'not_applicable', cost: 'internal', signupUrl: null,
    usedBy: { bn: 'আমন/রবি রিপ্লে, SMAP ও বৃষ্টির স্ন্যাপশট, পরামর্শ ও স্কোর', en: 'The Aman/Rabi replay, the SMAP and rain snapshot, the advice and scores' },
    reality: { bn: 'কোডে বসানো তারিখসহ তথ্য; লাইভ নয়।', en: 'Dated data built into the code; not live.' },
    status: () => ({ label: 'saved', reason: { bn: 'কোডে বসানো, তারিখসহ', en: 'Built in, dated' } }),
    probe: async () => skipped('not_probed_static'),
  },
  {
    id: 'reference-tables',
    name: { bn: 'স্থির রেফারেন্স তথ্য (SRDI কার্ড, BMD স্টেশন, BWDB নদী স্টেশন, সীমানা)', en: 'Built-in reference tables (SRDI card, BMD stations, BWDB river stations, boundaries)' },
    group: null, required: [], keyNeeded: 'not_applicable', cost: 'internal', signupUrl: null,
    usedBy: { bn: 'সার কার্ড (শুধু তালন্দ), তাপমাত্রা সংশোধন, নদীভাঙন ট্যাব, মানচিত্রের সীমানা', en: 'The fertilizer card (Talanda only), temperature correction, the river-erosion tab, the map outlines' },
    reality: { bn: 'কোনো API নয়: কোডে বা ফাইলে বসানো প্রকাশিত সংখ্যা। নদীভাঙন ট্যাব BWDB-কে ডাকে না।', en: 'No API: published numbers built into code or files. The river-erosion tab does not call BWDB.' },
    status: () => ({ label: 'saved', reason: { bn: 'বসানো তথ্য', en: 'Built-in data' } }),
    probe: async () => skipped('not_probed_static'),
  },
  {
    id: 'demo-features',
    name: { bn: 'ডেমো ফিচার (কৃষকের ডেমো সাইন-ইন ও SMS, নমুনা কৃষক, কিপ্যাড টেস্ট, ডেমো খামার)', en: 'Demo features (farmer demo sign-in and SMS, sample farmers, keypad test, demo farm)' },
    group: null, required: [], keyNeeded: 'not_applicable', cost: 'internal', signupUrl: null,
    usedBy: { bn: 'কৃষক পোর্টাল, কর্মকর্তা ডেস্ক, বিতরণ স্ক্রিন, গবাদিপশু', en: 'The farmer portal, the officer desk, the delivery screen, the cattle feature' },
    reality: { bn: 'সিমুলেটেড: কোনো SMS যায় না, কোনো ফোন নম্বর যাচাই হয় না, নমুনা কৃষক আসল মানুষ নন।', en: 'Simulated: no SMS is sent, no phone number is checked, sample farmers are not real people.' },
    status: () => ({ label: 'demo', reason: { bn: 'ডেমো, সিমুলেটেড', en: 'Demo, simulated' } }),
    probe: async () => skipped('not_probed_static'),
  },
];

function nasaConfigHasEarthdata(): boolean {
  const c = nasaConfig();
  return Boolean(c.earthdata.token || (c.earthdata.username && c.earthdata.password));
}

/** SET when every variable of one of the required sets is set; PARTIAL when some are; NOT_NEEDED for an outside service that needs no key, NOT_APPLICABLE for built-in data. */
export function setState(provider: Provider): SetState {
  if (!provider.required.length) return provider.keyNeeded === 'not_applicable' ? 'NOT_APPLICABLE' : 'NOT_NEEDED';
  if (provider.required.some(names => names.every(envIsSet))) return 'SET';
  return provider.required.some(names => names.some(envIsSet)) ? 'PARTIAL' : 'UNSET';
}

/** The status of every provider with no network use: for the Data sources card. Names, labels and plain sentences only. */
export function integrationStatuses(offline = nasaConfig().offline) {
  return PROVIDERS.map(provider => {
    const { label, reason } = provider.status({ offline });
    return {
      id: provider.id,
      name: provider.name,
      label,
      reason,
      usedBy: provider.usedBy,
      reality: provider.reality,
      keyNeeded: provider.keyNeeded,
      cost: provider.cost,
      signupUrl: provider.signupUrl,
      configured: setState(provider),
    };
  });
}

export interface ReportRow { id: string; name: string; set: SetState; result: ProbeResult; note: NoteCode }

/** Runs every probe. A probe that throws is reported as FAIL with the note `network_error`: nothing about the error is kept. */
export async function runChecks(partial: Partial<ProbeContext> = {}): Promise<ReportRow[]> {
  const ctx: ProbeContext = {
    fetchImpl: partial.fetchImpl ?? fetch,
    offline: partial.offline ?? nasaConfig().offline,
    timeoutMs: partial.timeoutMs ?? 8000,
    eeReadiness: partial.eeReadiness ?? (async () => {
      const { getEarthEngineReadiness } = await import('./cattle/adapters/earth_engine.ts');
      return (await getEarthEngineReadiness(true)).status === 'ready' ? 'ready' : 'not_ready';
    }),
    now: partial.now ?? new Date(),
  };
  const rows: ReportRow[] = [];
  for (const provider of PROVIDERS) {
    let outcome: ProbeOutcome;
    try {
      outcome = await provider.probe(ctx);
    } catch {
      outcome = failed('network_error');
    }
    rows.push({ id: provider.id, name: provider.name.en, set: setState(provider), result: outcome.result, note: outcome.note });
  }
  return rows;
}

/** The text `npm run check:integrations` prints. Only provider names, SET/UNSET, PASS/FAIL/SKIPPED and a fixed note. */
export function renderReport(rows: ReportRow[]): string {
  const label = { SET: 'SET', UNSET: 'UNSET', PARTIAL: 'PARTIAL', NOT_NEEDED: 'no key needed', NOT_APPLICABLE: 'n/a' } as const;
  const width = Math.max(...rows.map(row => row.id.length));
  const lines = rows.map(row => `${row.id.padEnd(width)}  ${label[row.set].padEnd(13)}  ${row.result.padEnd(7)}  ${NOTES[row.note].en}`);
  const counts = (r: ProbeResult) => rows.filter(row => row.result === r).length;
  return ['Integrations (probe = one harmless read; never a call, an SMS or a billed generation)', '', ...lines, '', `PASS ${counts('PASS')}   FAIL ${counts('FAIL')}   SKIPPED ${counts('SKIPPED')}`].join('\n');
}
