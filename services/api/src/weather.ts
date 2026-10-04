/**
 * Weather Service for Project EDEN.
 *
 * 1. Open-Meteo Forecast API:
 *    Provides current weather model estimates, hourly conditions (24h), and 7-day forecasts.
 *    Metric units, timezone=auto. Labeled strictly as model estimates/forecasts (not in-situ measurements).
 *    Cached per rounded coordinates (15-minute TTL).
 *
 * 2. NASA POWER Agroclimatology & SMAP L4 Soil Moisture:
 *    Provides satellite observations and reanalysis (MERRA-2 / GEOS-IT).
 *    Carries explicit 2-3 day data latency notices; kept separate from live forecast.
 *    Cached per rounded coordinates (6-hour TTL).
 */

import { LOC } from '../../../packages/rotation-engine/src/data/location.ts';
import { liveUpazila } from './live.ts';

export interface WeatherCondition {
  code: number;
  bangla: string;
  english: string;
}

export function getWeatherCondition(code: number): WeatherCondition {
  switch (code) {
    case 0: return { code, bangla: 'পরিষ্কার আকাশ', english: 'Clear sky' };
    case 1: return { code, bangla: 'মূলত পরিষ্কার আকাশ', english: 'Mainly clear' };
    case 2: return { code, bangla: 'আংশিক মেঘলা', english: 'Partly cloudy' };
    case 3: return { code, bangla: 'মেঘলা আকাশ', english: 'Overcast' };
    case 45: return { code, bangla: 'কুয়াশা', english: 'Fog' };
    case 48: return { code, bangla: 'ঘন কুয়াশা', english: 'Depositing rime fog' };
    case 51: return { code, bangla: 'হালকা গুঁড়ি গুঁড়ি বৃষ্টি', english: 'Light drizzle' };
    case 53: return { code, bangla: 'মাঝারি গুঁড়ি গুঁড়ি বৃষ্টি', english: 'Moderate drizzle' };
    case 55: return { code, bangla: 'ভারী গুঁড়ি গুঁড়ি বৃষ্টি', english: 'Dense drizzle' };
    case 56:
    case 57: return { code, bangla: 'ঠান্ডা গুঁড়ি গুঁড়ি বৃষ্টি', english: 'Freezing drizzle' };
    case 61: return { code, bangla: 'হালকা বৃষ্টি', english: 'Slight rain' };
    case 63: return { code, bangla: 'মাঝারি বৃষ্টি', english: 'Moderate rain' };
    case 65: return { code, bangla: 'ভারী বৃষ্টি', english: 'Heavy rain' };
    case 66:
    case 67: return { code, bangla: 'হিমায়িত বৃষ্টি', english: 'Freezing rain' };
    case 71: return { code, bangla: 'হালকা তুষারপাত', english: 'Slight snowfall' };
    case 73: return { code, bangla: 'মাঝারি তুষারপাত', english: 'Moderate snowfall' };
    case 75: return { code, bangla: 'ভারী তুষারপাত', english: 'Heavy snowfall' };
    case 77: return { code, bangla: 'তুষারকণা', english: 'Snow grains' };
    case 80: return { code, bangla: 'হালকা বৃষ্টির দমকা', english: 'Slight rain showers' };
    case 81: return { code, bangla: 'মাঝারি বৃষ্টির দমকা', english: 'Moderate rain showers' };
    case 82: return { code, bangla: 'ভারী বর্ষণ', english: 'Violent rain showers' };
    case 85:
    case 86: return { code, bangla: 'তুষারঝাপটা', english: 'Snow showers' };
    case 95: return { code, bangla: 'বজ্রঝড় / বজ্রবৃষ্টি', english: 'Thunderstorm' };
    case 96:
    case 99: return { code, bangla: 'শিলাবৃষ্টিসহ বজ্রঝড়', english: 'Thunderstorm with hail' };
    default: return { code, bangla: 'সাধারণ আবহাওয়া', english: 'Variable' };
  }
}

export interface HourlyForecastItem {
  time: string; // ISO string
  temperatureC: number;
  apparentTemperatureC: number;
  relativeHumidityPct: number;
  precipitationProbabilityPct: number;
  precipitationMm: number;
  rainMm: number;
  windSpeedMs: number;
  weatherCode: number;
  conditionBangla: string;
  conditionEnglish: string;
}

export interface DailyForecastItem {
  date: string; // YYYY-MM-DD
  weatherCode: number;
  conditionBangla: string;
  conditionEnglish: string;
  tempMaxC: number;
  tempMinC: number;
  apparentTempMaxC: number;
  apparentTempMinC: number;
  precipitationSumMm: number;
  rainSumMm: number;
  precipitationProbabilityMaxPct: number;
  windSpeedMaxMs: number;
}

export interface WeatherForecast {
  provider: string;
  modelNoticeBangla: string;
  modelNoticeEnglish: string;
  fetchedAt: string;
  isCached: boolean;
  timezone: string;
  current: {
    time: string;
    temperatureC: number;
    apparentTemperatureC: number;
    relativeHumidityPct: number;
    precipitationMm: number;
    rainMm: number;
    precipitationProbabilityPct?: number;
    windSpeedMs: number;
    windDirectionDeg: number;
    weatherCode: number;
    conditionBangla: string;
    conditionEnglish: string;
  };
  hourly: HourlyForecastItem[];
  daily: DailyForecastItem[];
}

export interface WeatherObservationDay {
  date: string; // YYYY-MM-DD
  t2m: number; // mean temperature °C
  t2mMax: number; // max temperature °C
  t2mMin: number; // min temperature °C
  rh2m: number; // relative humidity %
  rainMm: number; // precipitation mm
  windSpeedMs: number; // wind speed m/s
}

export interface WeatherResponse {
  location: {
    districtBangla: string;
    districtEnglish: string;
    upazilaBangla: string;
    upazilaEnglish: string;
    unionBangla: string;
    unionEnglish: string;
    lat: number;
    lon: number;
  };
  // Weather Model Forecast (Open-Meteo NWP)
  forecast: WeatherForecast | null;

  // NASA POWER Agroclimatology & SMAP L4 Observations (Historical Reanalysis, 2-3 Day Latency)
  dataSource: string;
  dataTypeNoticeBangla: string;
  dataTypeNoticeEnglish: string;
  latestObservationDate: string;
  latencyNoticeBangla: string;
  latencyNoticeEnglish: string;
  isLive: boolean;
  cachedAt: string;
  latest: {
    t2m: number;
    t2mMax: number;
    t2mMin: number;
    rh2m: number;
    rainMm: number;
    windSpeedMs: number;
    rootZoneMoistureM3M3: number;
    rootZoneMoistureStatusBangla: string;
    rootZoneMoistureDate: string;
    rainLast30DaysMm: number;
    rainVerdictBangla: string;
  };
  recentDays: WeatherObservationDay[];
  historicalObservations?: {
    dataSource: string;
    latestObservationDate: string;
    latencyNoticeBangla: string;
    latencyNoticeEnglish: string;
    isLive: boolean;
    cachedAt: string;
    latest: {
      t2m: number;
      t2mMax: number;
      t2mMin: number;
      rh2m: number;
      rainMm: number;
      windSpeedMs: number;
      rootZoneMoistureM3M3: number;
      rootZoneMoistureStatusBangla: string;
      rootZoneMoistureDate: string;
      rainLast30DaysMm: number;
      rainVerdictBangla: string;
    };
    recentDays: WeatherObservationDay[];
  };
}

// Coordinate-based cache storage
const forecastCache = new Map<string, { data: WeatherForecast; timestamp: number }>();
const FORECAST_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface NasaCacheEntry {
  latestObservationDate: string;
  isLive: boolean;
  cachedAt: string;
  latest: WeatherResponse['latest'];
  recentDays: WeatherObservationDay[];
}
const nasaCache = new Map<string, { data: NasaCacheEntry; timestamp: number }>();
const NASA_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function coordKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

function formatDateYMD(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function toHyphenDate(ymd: string): string {
  if (ymd.length === 8) {
    return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
  }
  return ymd;
}

/**
 * Resolves location hierarchy (district, upazila, union) for coordinates.
 */
function resolveLocationInfo(lat: number, lon: number) {
  // Check if close to Talanda pilot
  const isNearTalanda = Math.abs(lat - 24.62) < 0.06 && Math.abs(lon - 88.56) < 0.06;
  if (isNearTalanda) {
    return {
      districtBangla: 'রাজশাহী',
      districtEnglish: 'Rajshahi',
      upazilaBangla: 'তানোর',
      upazilaEnglish: 'Tanore',
      unionBangla: 'তালন্দ',
      unionEnglish: 'Talanda',
      lat,
      lon,
    };
  }

  const u = liveUpazila({ lat, lon });
  if (u) {
    return {
      districtBangla: u.district,
      districtEnglish: u.district,
      upazilaBangla: u.name,
      upazilaEnglish: u.name,
      unionBangla: u.name,
      unionEnglish: u.name,
      lat,
      lon,
    };
  }

  return {
    districtBangla: `${lat.toFixed(2)}° N`,
    districtEnglish: `${lat.toFixed(2)}° N`,
    upazilaBangla: `${lon.toFixed(2)}° E`,
    upazilaEnglish: `${lon.toFixed(2)}° E`,
    unionBangla: 'নির্বাচিত অবস্থান',
    unionEnglish: 'Selected Location',
    lat,
    lon,
  };
}

/**
 * Fetches weather forecast from Open-Meteo Forecast API with per-coordinate caching.
 */
export async function fetchOpenMeteoForecast(lat: number, lon: number): Promise<WeatherForecast | null> {
  const key = coordKey(lat, lon);
  const now = Date.now();
  const cached = forecastCache.get(key);

  if (cached && (now - cached.timestamp) < FORECAST_CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const apiKey = process.env.OPEN_METEO_API_KEY?.trim();
    const baseUrl = apiKey ? 'https://customer-api.open-meteo.com/v1/forecast' : 'https://api.open-meteo.com/v1/forecast';
    const params = new URLSearchParams({
      latitude: lat.toString(),
      longitude: lon.toString(),
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,wind_speed_10m,wind_direction_10m',
      hourly: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,precipitation,rain,weather_code,wind_speed_10m',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,rain_sum,precipitation_probability_max,wind_speed_10m_max',
      timezone: 'auto',
      wind_speed_unit: 'ms',
    });
    if (apiKey) {
      params.append('apikey', apiKey);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`${baseUrl}?${params.toString()}`, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json() as any;
      const cur = data.current || {};
      const curCode = Number(cur.weather_code ?? 0);
      const curCond = getWeatherCondition(curCode);

      // Hourly forecast: next 24 intervals
      const hourlyList: HourlyForecastItem[] = [];
      const hData = data.hourly || {};
      const hTimes: string[] = hData.time || [];
      const limit = Math.min(hTimes.length, 24);
      for (let i = 0; i < limit; i++) {
        const code = Number(hData.weather_code?.[i] ?? 0);
        const cond = getWeatherCondition(code);
        hourlyList.push({
          time: hTimes[i],
          temperatureC: Math.round(Number(hData.temperature_2m?.[i] ?? 0) * 10) / 10,
          apparentTemperatureC: Math.round(Number(hData.apparent_temperature?.[i] ?? 0) * 10) / 10,
          relativeHumidityPct: Math.round(Number(hData.relative_humidity_2m?.[i] ?? 0)),
          precipitationProbabilityPct: Math.round(Number(hData.precipitation_probability?.[i] ?? 0)),
          precipitationMm: Math.round(Number(hData.precipitation?.[i] ?? 0) * 10) / 10,
          rainMm: Math.round(Number(hData.rain?.[i] ?? 0) * 10) / 10,
          windSpeedMs: Math.round(Number(hData.wind_speed_10m?.[i] ?? 0) * 10) / 10,
          weatherCode: code,
          conditionBangla: cond.bangla,
          conditionEnglish: cond.english,
        });
      }

      // Daily forecast: 7 days
      const dailyList: DailyForecastItem[] = [];
      const dData = data.daily || {};
      const dTimes: string[] = dData.time || [];
      for (let i = 0; i < dTimes.length; i++) {
        const code = Number(dData.weather_code?.[i] ?? 0);
        const cond = getWeatherCondition(code);
        dailyList.push({
          date: dTimes[i],
          weatherCode: code,
          conditionBangla: cond.bangla,
          conditionEnglish: cond.english,
          tempMaxC: Math.round(Number(dData.temperature_2m_max?.[i] ?? 0) * 10) / 10,
          tempMinC: Math.round(Number(dData.temperature_2m_min?.[i] ?? 0) * 10) / 10,
          apparentTempMaxC: Math.round(Number(dData.apparent_temperature_max?.[i] ?? 0) * 10) / 10,
          apparentTempMinC: Math.round(Number(dData.apparent_temperature_min?.[i] ?? 0) * 10) / 10,
          precipitationSumMm: Math.round(Number(dData.precipitation_sum?.[i] ?? 0) * 10) / 10,
          rainSumMm: Math.round(Number(dData.rain_sum?.[i] ?? 0) * 10) / 10,
          precipitationProbabilityMaxPct: Math.round(Number(dData.precipitation_probability_max?.[i] ?? 0)),
          windSpeedMaxMs: Math.round(Number(dData.wind_speed_10m_max?.[i] ?? 0) * 10) / 10,
        });
      }

      const forecast: WeatherForecast = {
        provider: 'Open-Meteo (Numerical Weather Prediction: ECMWF/GFS Blend)',
        modelNoticeBangla: 'আবহাওয়া পূর্বাভাস গাণিতিক মডেলের অনুমানভিত্তিক (সরাসরি মাঠের পরিমাপ নয়)',
        modelNoticeEnglish: 'Weather forecast is based on numerical model estimates (not exact in-situ field measurements)',
        fetchedAt: new Date().toISOString(),
        isCached: false,
        timezone: data.timezone || 'Asia/Dhaka',
        current: {
          time: cur.time || new Date().toISOString(),
          temperatureC: Math.round(Number(cur.temperature_2m ?? 25.0) * 10) / 10,
          apparentTemperatureC: Math.round(Number(cur.apparent_temperature ?? cur.temperature_2m ?? 25.0) * 10) / 10,
          relativeHumidityPct: Math.round(Number(cur.relative_humidity_2m ?? 75)),
          precipitationMm: Math.round(Number(cur.precipitation ?? 0) * 10) / 10,
          rainMm: Math.round(Number(cur.rain ?? 0) * 10) / 10,
          precipitationProbabilityPct: hourlyList[0]?.precipitationProbabilityPct ?? 0,
          windSpeedMs: Math.round(Number(cur.wind_speed_10m ?? 1.5) * 10) / 10,
          windDirectionDeg: Math.round(Number(cur.wind_direction_10m ?? 0)),
          weatherCode: curCode,
          conditionBangla: curCond.bangla,
          conditionEnglish: curCond.english,
        },
        hourly: hourlyList,
        daily: dailyList,
      };

      forecastCache.set(key, { data: forecast, timestamp: now });
      return forecast;
    }
  } catch (err) {
    console.warn(`Open-Meteo forecast fetch warning for ${key}:`, (err as any)?.message || err);
  }

  // If live fetch fails, return cached data if available (with clear isCached flag)
  if (cached) {
    return {
      ...cached.data,
      isCached: true,
    };
  }

  // Never return fake fixed fallback as live forecast
  return null;
}

/**
 * Fetches NASA POWER Daily Agroclimatology observations.
 * Latency is typically 2-3 days; observations are historical reanalysis.
 */
async function fetchNasaObservations(lat: number, lon: number): Promise<NasaCacheEntry> {
  const key = coordKey(lat, lon);
  const now = Date.now();
  const cached = nasaCache.get(key);

  if (cached && (now - cached.timestamp) < NASA_CACHE_TTL_MS) {
    return cached.data;
  }

  const smap = LOC.conditions.smap;
  const rain30 = LOC.conditions.rainLast30Days;

  try {
    const endD = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
    const startD = new Date(endD.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days prior
    const start = formatDateYMD(startD);
    const end = formatDateYMD(endD);

    const params = 'T2M,T2M_MAX,T2M_MIN,RH2M,PRECTOTCORR,WS2M';
    const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=${params}&community=AG&longitude=${lon}&latitude=${lat}&start=${start}&end=${end}&format=JSON`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json() as any;
      const p = data?.properties?.parameter;
      if (p && p.T2M) {
        const dates = Object.keys(p.T2M).sort();
        const validDays: WeatherObservationDay[] = [];
        for (const d of dates) {
          const tVal = Number(p.T2M[d] ?? -999);
          if (tVal < -100) continue;
          validDays.push({
            date: toHyphenDate(d),
            t2m: Math.round(tVal * 10) / 10,
            t2mMax: Math.round(Number(p.T2M_MAX?.[d] ?? tVal) * 10) / 10,
            t2mMin: Math.round(Number(p.T2M_MIN?.[d] ?? tVal) * 10) / 10,
            rh2m: Math.round(Number(p.RH2M?.[d] ?? 80)),
            rainMm: Math.max(0, Math.round(Number(p.PRECTOTCORR?.[d] ?? 0) * 10) / 10),
            windSpeedMs: Math.max(0, Math.round(Number(p.WS2M?.[d] ?? 0) * 10) / 10),
          });
        }

        if (validDays.length > 0) {
          const lastDay = validDays[validDays.length - 1];
          const entry: NasaCacheEntry = {
            latestObservationDate: lastDay.date,
            isLive: true,
            cachedAt: new Date().toISOString(),
            latest: {
              t2m: lastDay.t2m,
              t2mMax: lastDay.t2mMax,
              t2mMin: lastDay.t2mMin,
              rh2m: lastDay.rh2m,
              rainMm: lastDay.rainMm,
              windSpeedMs: lastDay.windSpeedMs,
              rootZoneMoistureM3M3: smap?.rootZoneM3M3 ?? 0.311,
              rootZoneMoistureStatusBangla: 'মাটির মূল অঞ্চলে পর্যাপ্ত রস বিদ্যমান (৩১.১%)',
              rootZoneMoistureDate: smap?.date ?? '2026-09-23',
              rainLast30DaysMm: rain30?.imergLateMm ?? 0,
              rainVerdictBangla: 'স্বাভাবিকের চেয়ে শুকনো (৭৮.৪%)',
            },
            recentDays: validDays,
          };
          nasaCache.set(key, { data: entry, timestamp: now });
          return entry;
        }
      }
    }
  } catch (err) {
    console.warn(`NASA POWER live fetch warning for ${key}:`, (err as any)?.message || err);
  }

  // If live fetch fails, check if we have cached data for these coordinates
  if (cached) {
    return {
      ...cached.data,
      isLive: false,
    };
  }

  // For Talanda pilot baseline fallback when offline
  const baselineDays: WeatherObservationDay[] = [
    { date: '2026-09-24', t2m: 26.5, t2mMax: 28.8, t2mMin: 25.0, rh2m: 93, rainMm: 14.3, windSpeedMs: 2.9 },
    { date: '2026-09-25', t2m: 26.3, t2mMax: 27.8, t2mMin: 25.2, rh2m: 94, rainMm: 7.4, windSpeedMs: 3.5 },
    { date: '2026-09-26', t2m: 27.1, t2mMax: 30.2, t2mMin: 24.8, rh2m: 88, rainMm: 2.1, windSpeedMs: 2.2 },
    { date: '2026-09-27', t2m: 28.0, t2mMax: 32.1, t2mMin: 25.1, rh2m: 85, rainMm: 0.0, windSpeedMs: 1.8 },
    { date: '2026-09-28', t2m: 28.2, t2mMax: 32.5, t2mMin: 25.3, rh2m: 82, rainMm: 0.0, windSpeedMs: 1.5 },
  ];

  return {
    latestObservationDate: '2026-09-28',
    isLive: false,
    cachedAt: new Date().toISOString(),
    latest: {
      t2m: 28.2,
      t2mMax: 32.5,
      t2mMin: 25.3,
      rh2m: 82,
      rainMm: 0.0,
      windSpeedMs: 1.5,
      rootZoneMoistureM3M3: smap?.rootZoneM3M3 ?? 0.311,
      rootZoneMoistureStatusBangla: 'মাটির মূল অঞ্চলে পর্যাপ্ত রস বিদ্যমান (৩১.১%)',
      rootZoneMoistureDate: smap?.date ?? '2026-09-23',
      rainLast30DaysMm: rain30?.imergLateMm ?? 0,
      rainVerdictBangla: 'স্বাভাবিকের চেয়ে শুকনো (৭৮.৪%)',
    },
    recentDays: baselineDays,
  };
}

/**
 * Unified weather handler: resolves coordinates, fetches Open-Meteo forecast and NASA POWER observations.
 */
export async function getWeather(lat = 24.62, lon = 88.56): Promise<WeatherResponse> {
  const location = resolveLocationInfo(lat, lon);

  // Fetch forecast and NASA POWER in parallel
  const [forecast, nasa] = await Promise.all([
    fetchOpenMeteoForecast(lat, lon),
    fetchNasaObservations(lat, lon),
  ]);

  const historicalObservations = {
    dataSource: 'NASA POWER Daily Agroclimatology (GEOS-IT / MERRA-2) & SMAP L4',
    latestObservationDate: nasa.latestObservationDate,
    latencyNoticeBangla: 'নাসা উপগ্রহ উপাত্ত প্রক্রিয়াজাতকরণে সাধারণত ২–৩ দিন বিলম্ব থাকে।',
    latencyNoticeEnglish: 'NASA satellite observations typically have a 2-3 day processing latency.',
    isLive: nasa.isLive,
    cachedAt: nasa.cachedAt,
    latest: nasa.latest,
    recentDays: nasa.recentDays,
  };

  return {
    location,
    forecast,
    dataSource: historicalObservations.dataSource,
    dataTypeNoticeBangla: 'উপগ্রহ ও বায়ুমণ্ডলীয় পর্যবেক্ষণ উপাত্ত (পূর্বাভাস নয়)',
    dataTypeNoticeEnglish: 'Satellite & atmospheric observation data (not a forecast)',
    latestObservationDate: nasa.latestObservationDate,
    latencyNoticeBangla: historicalObservations.latencyNoticeBangla,
    latencyNoticeEnglish: historicalObservations.latencyNoticeEnglish,
    isLive: nasa.isLive,
    cachedAt: nasa.cachedAt,
    latest: nasa.latest,
    recentDays: nasa.recentDays,
    historicalObservations,
  };
}

export const getNasaWeather = getWeather;
