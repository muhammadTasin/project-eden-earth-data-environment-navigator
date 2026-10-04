/**
 * NASA POWER daily agroclimatology (community=AG) for an arbitrary point.
 *
 * This is delayed reanalysis/satellite-derived data (typically 2-3 days latency), NOT a forecast and NOT live.
 * Every value comes from the provider response for the REQUESTED coordinates. Missing values stay null:
 * nothing is defaulted, and when the provider fails the caller gets a provider_unavailable error rather than
 * a stored baseline. NASA POWER does not provide SMAP soil moisture; that is reported as unavailable unless
 * the Earth Engine worker supplies it (see cattle/adapters/earth_engine.ts).
 */
import { ApiError, type SourceInfo } from './errors.ts';

export interface WeatherObservationDay {
  date: string; // YYYY-MM-DD
  t2m: number | null; // mean temperature °C
  t2mMax: number | null;
  t2mMin: number | null;
  rh2m: number | null; // relative humidity %
  rainMm: number | null;
  windSpeedMs: number | null;
}

export interface WeatherResponse {
  location: { lat: number; lon: number };
  source: SourceInfo;
  dataSource: string;
  dataTypeNoticeBangla: string;
  dataTypeNoticeEnglish: string;
  latestObservationDate: string;
  latencyNoticeBangla: string;
  latencyNoticeEnglish: string;
  /** Always false: NASA POWER is delayed data. Kept for older clients. */
  isLive: false;
  cachedAt: string;
  windowStart: string;
  windowEnd: string;
  daysWithData: number;
  latest: WeatherObservationDay;
  /** Mean of daily T2M over the days that have data in the window, or null when none. */
  meanT2mWindow: number | null;
  /** Sum of daily rain over days with data; `rainDaysWithData` says how many days it covers. */
  rainWindowMm: number | null;
  rainDaysWithData: number;
  soilMoisture: { status: 'unavailable'; reason: string };
  recentDays: WeatherObservationDay[];
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const WINDOW_DAYS = 30;
const cache = new Map<string, { at: number; value: WeatherResponse }>();

/** Exposed for tests and the readiness probe. */
export function nasaCacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}
export function clearNasaCache(): void { cache.clear(); }
export let lastNasaSuccessAt: string | null = null;

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}
function hyphen(s: string): string {
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;
}
/** NASA POWER uses -999 as the fill value for every parameter. */
function val(v: unknown, round = 1): number | null {
  const n = Number(v);
  if (v === null || v === undefined || !Number.isFinite(n) || n <= -900) return null;
  const f = 10 ** round;
  return Math.round(n * f) / f;
}

export async function getNasaWeather(lat: number, lon: number): Promise<WeatherResponse> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new ApiError('invalid_input', 'Invalid latitude or longitude');
  const key = nasaCacheKey(lat, lon);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const end = new Date(Date.now() - 2 * 86400000);
  const start = new Date(end.getTime() - (WINDOW_DAYS - 1) * 86400000);
  const params = 'T2M,T2M_MAX,T2M_MIN,RH2M,PRECTOTCORR,WS2M';
  const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=${params}&community=AG`
    + `&longitude=${lon}&latitude=${lat}&start=${ymd(start)}&end=${ymd(end)}&format=JSON`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  let data: any;
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`NASA POWER returned HTTP ${res.status}`);
    data = await res.json();
  } catch (err: any) {
    throw new ApiError('provider_unavailable', 'NASA POWER observations are temporarily unavailable', { provider: 'NASA POWER', reason: String(err?.message || err) });
  } finally {
    clearTimeout(timeout);
  }

  const p = data?.properties?.parameter;
  if (!p?.T2M) throw new ApiError('provider_unavailable', 'NASA POWER returned an unexpected response', { provider: 'NASA POWER' });

  const days: WeatherObservationDay[] = Object.keys(p.T2M).sort().map(d => ({
    date: hyphen(d),
    t2m: val(p.T2M[d]),
    t2mMax: val(p.T2M_MAX?.[d]),
    t2mMin: val(p.T2M_MIN?.[d]),
    rh2m: val(p.RH2M?.[d], 0),
    rainMm: (() => { const r = val(p.PRECTOTCORR?.[d]); return r === null ? null : Math.max(0, r); })(),
    windSpeedMs: (() => { const w = val(p.WS2M?.[d]); return w === null ? null : Math.max(0, w); })(),
  }));
  const withData = days.filter(d => d.t2m !== null);
  if (withData.length === 0) {
    throw new ApiError('no_data', 'NASA POWER has no valid observations for this location and period', { windowStart: hyphen(ymd(start)), windowEnd: hyphen(ymd(end)) });
  }

  const latest = withData[withData.length - 1];
  const temps = withData.map(d => d.t2m as number);
  const rains = days.filter(d => d.rainMm !== null).map(d => d.rainMm as number);
  const fetchedAt = new Date().toISOString();
  lastNasaSuccessAt = fetchedAt;

  const value: WeatherResponse = {
    location: { lat, lon },
    source: {
      provider: 'NASA POWER (community AG)',
      kind: 'satellite_delayed',
      live: false,
      fetchedAt,
      validAt: latest.date,
      note: 'Delayed agroclimatology (satellite/reanalysis, ~2-3 day latency). Not a forecast and not live.',
    },
    dataSource: 'NASA POWER Daily Agroclimatology',
    dataTypeNoticeBangla: 'বিলম্বিত উপগ্রহ ও পুনঃবিশ্লেষণ পর্যবেক্ষণ উপাত্ত (পূর্বাভাস নয়, সরাসরি নয়)',
    dataTypeNoticeEnglish: 'Delayed satellite/reanalysis observation data (not a forecast, not live)',
    latestObservationDate: latest.date,
    latencyNoticeBangla: 'নাসা পাওয়ার উপাত্তে সাধারণত ২–৩ দিন বিলম্ব থাকে।',
    latencyNoticeEnglish: 'NASA POWER data typically lags by 2-3 days.',
    isLive: false,
    cachedAt: fetchedAt,
    windowStart: hyphen(ymd(start)),
    windowEnd: hyphen(ymd(end)),
    daysWithData: withData.length,
    latest,
    meanT2mWindow: Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10,
    rainWindowMm: rains.length ? Math.round(rains.reduce((a, b) => a + b, 0) * 10) / 10 : null,
    rainDaysWithData: rains.length,
    soilMoisture: {
      status: 'unavailable',
      reason: 'NASA POWER does not include SMAP root-zone soil moisture. It is provided only when the Earth Engine worker is configured.',
    },
    recentDays: days,
  };

  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), value });
  return value;
}
