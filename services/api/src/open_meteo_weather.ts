/**
 * Seven-day numerical weather-model forecast from Open-Meteo.
 * This is a forecast estimate, not a local ground-station observation. Missing provider values stay null;
 * nothing is defaulted to 0 or any other substitute.
 */
import { ApiError, type SourceInfo } from './errors.ts';

export interface OpenMeteoForecast {
  provider: 'Open-Meteo';
  source: SourceInfo;
  fetchedAt: string;
  timezone: string;
  /** Offset of the zone-naive hourly/current times from UTC, from the provider. */
  utcOffsetSeconds: number;
  modelNoticeBangla: string;
  modelNoticeEnglish: string;
  current: {
    time: string;
    temperatureC: number;
    apparentTemperatureC: number | null;
    relativeHumidityPct: number;
    precipitationMm: number | null;
    rainMm: number | null;
    windSpeedMs: number | null;
    windDirectionDeg: number | null;
    weatherCode: number | null;
  };
  hourly: Array<{
    time: string;
    temperatureC: number | null;
    relativeHumidityPct: number | null;
    precipitationProbabilityPct: number | null;
    precipitationMm: number | null;
    rainMm: number | null;
    weatherCode: number | null;
  }>;
  daily: Array<{
    date: string;
    weatherCode: number | null;
    temperatureMaxC: number | null;
    temperatureMinC: number | null;
    precipitationMm: number | null;
    rainMm: number | null;
    precipitationProbabilityMaxPct: number | null;
    windSpeedMaxMs: number | null;
  }>;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const cache = new Map<string, { cachedAt: number; forecast: OpenMeteoForecast }>();
export let lastOpenMeteoSuccessAt: string | null = null;
export function clearOpenMeteoCache(): void { cache.clear(); }
/** Cache key is the exact requested coordinates, so one location's forecast is never served for another. */
export function openMeteoCacheKey(lat: number, lon: number): string { return `${lat.toFixed(3)},${lon.toFixed(3)}`; }

const finiteOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export async function getOpenMeteoForecast(lat: number, lon: number): Promise<OpenMeteoForecast> {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new ApiError('invalid_input', 'Invalid latitude or longitude');
  }

  const key = openMeteoCacheKey(lat, lon);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) return cached.forecast;

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,wind_speed_10m,wind_direction_10m,weather_code',
    hourly: 'temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,rain,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,rain_sum,precipitation_probability_max,wind_speed_10m_max',
    forecast_days: '7',
    timezone: 'auto',
    temperature_unit: 'celsius',
    precipitation_unit: 'mm',
    wind_speed_unit: 'ms',
  });

  const apiKey = process.env.OPEN_METEO_API_KEY?.trim();
  if (apiKey) params.set('apikey', apiKey);
  const host = apiKey ? 'https://customer-api.open-meteo.com' : 'https://api.open-meteo.com';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    let data: any;
    try {
      const response = await fetch(`${host}/v1/forecast?${params}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Open-Meteo returned HTTP ${response.status}`);
      data = await response.json();
    } catch (err: any) {
      throw new ApiError('provider_unavailable', 'Open-Meteo forecast is temporarily unavailable', { provider: 'Open-Meteo', reason: String(err?.message || err) });
    }
    const current = data?.current;
    const hourly = data?.hourly;
    const daily = data?.daily;
    if (!current || !hourly?.time?.length || !daily?.time?.length
      || !current.time || finiteOrNull(data.utc_offset_seconds) === null || finiteOrNull(current.temperature_2m) === null || finiteOrNull(current.relative_humidity_2m) === null) {
      throw new ApiError('provider_unavailable', 'Open-Meteo returned an incomplete forecast', { provider: 'Open-Meteo' });
    }

    const fetchedAt = new Date().toISOString();
    const forecast: OpenMeteoForecast = {
      provider: 'Open-Meteo',
      source: {
        provider: 'Open-Meteo',
        kind: 'model_estimate',
        live: true,
        fetchedAt,
        validAt: String(current.time),
        note: 'Numerical weather-model estimate for the requested coordinates, not a local station observation.',
      },
      fetchedAt,
      timezone: String(data.timezone || 'Asia/Dhaka'),
      utcOffsetSeconds: finiteOrNull(data.utc_offset_seconds) as number,
      modelNoticeBangla: 'এটি সংখ্যাভিত্তিক আবহাওয়া মডেলের অনুমান (পূর্বাভাস), স্থানীয় আবহাওয়া স্টেশনের মাপ নয়। একই উপজেলার মধ্যেও আবহাওয়া ভিন্ন হতে পারে।',
      modelNoticeEnglish: 'This is a numerical weather-model estimate (forecast), not a local weather-station observation. Conditions may vary within an upazila.',
      current: {
        time: String(current.time || ''),
        temperatureC: finiteOrNull(current.temperature_2m) as number,
        apparentTemperatureC: finiteOrNull(current.apparent_temperature),
        relativeHumidityPct: finiteOrNull(current.relative_humidity_2m) as number,
        precipitationMm: finiteOrNull(current.precipitation),
        rainMm: finiteOrNull(current.rain),
        windSpeedMs: finiteOrNull(current.wind_speed_10m),
        windDirectionDeg: finiteOrNull(current.wind_direction_10m),
        weatherCode: finiteOrNull(current.weather_code),
      },
      hourly: hourly.time.map((time: string, index: number) => ({
        time: String(time),
        temperatureC: finiteOrNull(hourly.temperature_2m?.[index]),
        relativeHumidityPct: finiteOrNull(hourly.relative_humidity_2m?.[index]),
        precipitationProbabilityPct: finiteOrNull(hourly.precipitation_probability?.[index]),
        precipitationMm: finiteOrNull(hourly.precipitation?.[index]),
        rainMm: finiteOrNull(hourly.rain?.[index]),
        weatherCode: finiteOrNull(hourly.weather_code?.[index]),
      })),
      daily: daily.time.map((date: string, index: number) => ({
        date: String(date),
        weatherCode: finiteOrNull(daily.weather_code?.[index]),
        temperatureMaxC: finiteOrNull(daily.temperature_2m_max?.[index]),
        temperatureMinC: finiteOrNull(daily.temperature_2m_min?.[index]),
        precipitationMm: finiteOrNull(daily.precipitation_sum?.[index]),
        rainMm: finiteOrNull(daily.rain_sum?.[index]),
        precipitationProbabilityMaxPct: finiteOrNull(daily.precipitation_probability_max?.[index]),
        windSpeedMaxMs: finiteOrNull(daily.wind_speed_10m_max?.[index]),
      })),
    };
    if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    cache.set(key, { cachedAt: now, forecast });
    lastOpenMeteoSuccessAt = fetchedAt;
    return forecast;
  } finally {
    clearTimeout(timeout);
  }
}
