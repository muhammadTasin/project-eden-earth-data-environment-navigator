/**
 * Cattle feature engineering. Builds the advisory inputs from provider data without defaulting any missing
 * value: hours without both temperature and humidity are dropped (and counted), never filled in.
 */
import type { FarmAOI, ExtractedFeature } from './types.ts';
import type { WeatherAdapterResult } from './adapters/weather_adapter.ts';
import type { SourceInfo } from '../errors.ts';

export interface ProcessedAoiFeatures {
  aoiId: string;
  centroid: [number, number];
  areaHectares: number;
  forecastSource: SourceInfo;
  latestWeather: {
    temperatureC: number;
    apparentTemperatureC: number | null;
    relativeHumidityPct: number;
    precipitationMm: number | null;
    windSpeedMs: number | null;
    fetchedAt: string;
    validAt: string;
  };
  /** Next hours from "now" in the location's own time, each with provider temperature AND humidity. */
  forecastHourly: Array<{ time: string; temperatureC: number; relativeHumidityPct: number }>;
  hoursMissingInputs: number;
  horizonHours: number;
  nasa: {
    source: SourceInfo;
    latestObservationDate: string;
    meanT2mWindow: number | null;
    rainWindowMm: number | null;
    windowStart: string;
    windowEnd: string;
    daysWithData: number;
  } | { status: 'unavailable'; reason: string };
  satelliteFeatures: ExtractedFeature[];
  qualityIssues: string[];
}

export const HOURLY_HORIZON = 24;

/** Provider hour strings are zone-naive local times. Interpret them as UTC to compare against "local now". */
export function localNowHourEpoch(utcOffsetSeconds: number, nowMs = Date.now()): number {
  const localMs = nowMs + utcOffsetSeconds * 1000;
  return Math.floor(localMs / 3600000) * 3600000;
}

export function compileFeaturesForAoi(
  aoi: FarmAOI,
  weather: WeatherAdapterResult,
  satelliteFeatures: ExtractedFeature[],
  nowMs = Date.now(),
): ProcessedAoiFeatures {
  const qualityIssues: string[] = [];
  const forecast = weather.openMeteoForecast;
  const current = forecast.current;
  const nasa = weather.nasaAgroclimatology;

  const fromNow = localNowHourEpoch(forecast.utcOffsetSeconds, nowMs);
  const window = forecast.hourly
    .filter(h => h.time && Date.parse(`${h.time}:00Z`) >= fromNow)
    .slice(0, HOURLY_HORIZON);
  const forecastHourly: ProcessedAoiFeatures['forecastHourly'] = [];
  let hoursMissingInputs = 0;
  for (const h of window) {
    if (h.temperatureC === null || h.relativeHumidityPct === null) {
      hoursMissingInputs++;
      continue;
    }
    forecastHourly.push({ time: h.time, temperatureC: h.temperatureC, relativeHumidityPct: h.relativeHumidityPct });
  }
  if (hoursMissingInputs > 0) qualityIssues.push(`${hoursMissingInputs} forecast hour(s) lack temperature or humidity and were excluded from the hourly THI curve`);
  if (window.length < HOURLY_HORIZON) qualityIssues.push(`Only ${window.length} of ${HOURLY_HORIZON} forecast hours are available from now`);

  for (const f of satelliteFeatures) {
    if (f.isRegionalProxy) {
      qualityIssues.push(`${f.dataset} pixel size (${(f.pixelSizeMeters / 1000).toFixed(0)} km) exceeds farm AOI dimensions; treated as regional proxy.`);
    }
  }

  return {
    aoiId: aoi.aoiId,
    centroid: aoi.centroid,
    areaHectares: aoi.areaHectares,
    forecastSource: forecast.source,
    latestWeather: {
      temperatureC: current.temperatureC,
      apparentTemperatureC: current.apparentTemperatureC,
      relativeHumidityPct: current.relativeHumidityPct,
      precipitationMm: current.precipitationMm,
      windSpeedMs: current.windSpeedMs,
      fetchedAt: forecast.fetchedAt,
      validAt: current.time,
    },
    forecastHourly,
    hoursMissingInputs,
    horizonHours: HOURLY_HORIZON,
    nasa: nasa
      ? {
          source: nasa.source,
          latestObservationDate: nasa.latestObservationDate,
          meanT2mWindow: nasa.meanT2mWindow,
          rainWindowMm: nasa.rainWindowMm,
          windowStart: nasa.windowStart,
          windowEnd: nasa.windowEnd,
          daysWithData: nasa.daysWithData,
        }
      : { status: 'unavailable', reason: weather.nasaUnavailableReason || 'NASA POWER unavailable' },
    satelliteFeatures,
    qualityIssues,
  };
}
