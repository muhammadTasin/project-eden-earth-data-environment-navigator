/**
 * Weather and observation adapter for the cattle pipeline.
 * Open-Meteo gives the numerical-model forecast at the AOI centroid (required: if it fails the job fails).
 * NASA POWER gives delayed observations for the same centroid (optional: if it fails the pipeline continues
 * and the advisory reports it as unavailable). Both are centroid point lookups, not polygon raster extractions.
 */
import { getOpenMeteoForecast, type OpenMeteoForecast } from '../../open_meteo_weather.ts';
import { getNasaWeather, type WeatherResponse } from '../../weather.ts';
import { ApiError } from '../../errors.ts';
import type { FarmAOI } from '../types.ts';

export interface WeatherAdapterResult {
  aoiId: string;
  centroid: [number, number]; // [lon, lat]
  pointType: 'aoi_centroid';
  openMeteoForecast: OpenMeteoForecast;
  nasaAgroclimatology: WeatherResponse | null;
  nasaUnavailableReason: string | null;
  fetchedAt: string;
}

export async function fetchWeatherForAoi(aoi: FarmAOI): Promise<WeatherAdapterResult> {
  const [lon, lat] = aoi.centroid;
  const forecast = await getOpenMeteoForecast(lat, lon);

  let nasa: WeatherResponse | null = null;
  let nasaUnavailableReason: string | null = null;
  try {
    nasa = await getNasaWeather(lat, lon);
  } catch (err) {
    nasaUnavailableReason = err instanceof ApiError ? err.message : String((err as any)?.message || err);
  }

  return {
    aoiId: aoi.aoiId,
    centroid: [lon, lat],
    pointType: 'aoi_centroid',
    openMeteoForecast: forecast,
    nasaAgroclimatology: nasa,
    nasaUnavailableReason,
    fetchedAt: new Date().toISOString(),
  };
}
