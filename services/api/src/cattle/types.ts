/**
 * Core type definitions for the AOI-centered Cattle Advisory & ML Pipeline.
 */

import type { SourceInfo, SourceKind } from '../errors.ts';

export type GeoJsonPolygon = {
  type: 'Polygon';
  coordinates: number[][][]; // [ [ [lon, lat], ... ] ]
};

export type GeoJsonMultiPolygon = {
  type: 'MultiPolygon';
  coordinates: number[][][][];
};

export type AoiGeometry = GeoJsonPolygon | GeoJsonMultiPolygon;

export interface FarmAOI {
  aoiId: string;
  farmLabel: string;
  ownerName: string;
  geometry: AoiGeometry;
  crs: 'EPSG:4326';
  areaSquareMeters: number;
  areaHectares: number;
  areaAcres: number;
  centroid: [number, number]; // [lon, lat]
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  /** Approximate: nearest reference point in the locations dataset, with its distance. */
  nearestUpazila?: string;
  nearestUpazilaDistanceKm?: number;
  district?: string;
  /** True for seeded demonstration records; never real farm data. */
  demo?: boolean;
  provenance: {
    source: 'map_draw' | 'geojson_upload' | 'manual_entry';
    drawnBy?: string;
    uploadedFileName?: string;
    createdAt: string;
    updatedAt: string;
  };
}

/**
 * queued -> running -> succeeded | partial | failed | blocked
 *  - succeeded: every step (weather, NASA POWER, satellite extraction, advisory) produced real data
 *  - partial:   the advisory was produced but at least one optional input is missing (see `missing`)
 *  - failed:    a required step failed or the job was interrupted (see `errorCode`); may be retried
 *  - blocked:   cannot run until configuration or data is supplied (see `errorCode`, e.g. configuration_required)
 */
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'blocked';

export const JOB_TYPES = ['pipeline_refresh', 'satellite_extract', 'weather_refresh', 'train_model'] as const;
export type JobType = typeof JOB_TYPES[number];

export interface BackgroundJob {
  jobId: string;
  aoiId: string;
  jobType: JobType;
  status: JobStatus;
  progressPct: number; // 0 - 100
  stageMessage: string;
  stageMessageBangla: string;
  errors: string[];
  /** Machine-readable reason for failed/blocked jobs: provider_unavailable, configuration_required, training_data_unavailable, interrupted_by_restart, timeout, internal. */
  errorCode?: string;
  /** Inputs that could not be obtained, so clients can show exactly what is missing. */
  missing: Array<{ input: string; reason: string }>;
  attempts: number;
  maxAttempts: number;
  resultsSummary?: {
    thiLatest?: number;
    thiCategory?: string;
    weatherSource?: string;
    satelliteSource?: string;
    featuresExtracted?: number;
    featuresExpected?: number;
    isRegionalProxy?: boolean;
    modelStatus?: string;
    qualityIssues?: string[];
  };
  queuedAt: string;
  /** Set when work actually begins (not at enqueue). */
  startedAt?: string;
  finishedAt?: string;
}

export type FeatureQuality = 'GOOD' | 'ACCEPTABLE' | 'DEGRADED' | 'CLOUDY' | 'MISSING' | 'REGIONAL_PROXY';

export interface ExtractedFeature {
  aoiId: string;
  dataset: string; // e.g. 'NASA/GPM_L3/IMERG_V07', 'NASA/SMAP/SPL4SMGP/008', 'MODIS/061/MOD13A1', 'ECMWF/ERA5_LAND/HOURLY', 'NASA_POWER_AG'
  band: string; // e.g. 'precipitation', 'sm_rootzone', 'NDVI', 'T2M'
  observationInterval: string; // e.g. '2026-09-25/2026-09-30'
  units: string; // e.g. 'mm/hr', 'm3/m3', 'index', 'degC'
  pixelSizeMeters: number; // native resolution (e.g. 11000 for IMERG, 500 for MODIS)
  aggregationMethod: 'mean' | 'median' | 'centroid_sample' | 'nearest';
  validPixelCoveragePct: number;
  qualityState: FeatureQuality;
  fetchedAt: string;
  sourceVersion: string;
  value: number | null;
  isRegionalProxy: boolean;
  notesBangla?: string;
  notesEnglish?: string;
}

export type ThiStressCategory = 'normal' | 'alert' | 'danger' | 'emergency';

export interface HourlyThiForecast {
  /** Zone-naive local time from the provider, e.g. 2026-10-03T14:00 */
  time: string;
  temperatureC: number;
  relativeHumidityPct: number;
  thi: number;
  category: ThiStressCategory;
}

/**
 * Advisory payload. Sections are labelled by evidence kind so clients can keep them apart:
 *  - measured:  provider data (Open-Meteo model estimate, NASA POWER delayed observations, Earth Engine satellite values)
 *  - derived:   arithmetic on measured data (THI and its category)
 *  - heuristic: generic guidance keyed on the THI category; not validated for local breeds and not a prediction
 */
export interface CattleAdvisoryResult {
  aoiId: string;
  farmLabel: string;
  generatedAt: string;
  measured: {
    kind: 'measured';
    forecast: {
      source: SourceInfo;
      temperatureC: number;
      relativeHumidityPct: number;
      apparentTemperatureC: number | null;
    };
    nasaPower: {
      source: SourceInfo;
      latestObservationDate: string;
      meanT2mWindow: number | null;
      rainWindowMm: number | null;
      windowStart: string;
      windowEnd: string;
      daysWithData: number;
    } | { status: 'unavailable'; reason: string };
    satellite: {
      status: 'ok' | 'partial' | 'unavailable';
      reason?: string;
      features: ExtractedFeature[];
      unavailable: Array<{ dataset: string; reason: string }>;
    };
  };
  derived: {
    kind: 'derived';
    thi: {
      current: number;
      category: ThiStressCategory;
      formula: string;
      categoryLabelBangla: string;
      categoryLabelEnglish: string;
      /** Next hours from now (location time) with both temperature and humidity from the forecast. */
      hourly: HourlyThiForecast[];
      hoursMissingInputs: number;
      horizonHours: number;
      /** Hours with the lowest forecast THI (HH:MM local), or null when no hourly data. */
      lowestThiHours: string[] | null;
      thresholdNote: string;
    };
  };
  heuristic: {
    kind: 'heuristic';
    basis: string;
    summaryBangla: string;
    summaryEnglish: string;
    bulletsBangla: string[];
    bulletsEnglish: string[];
    waterDemand: { category: 'normal' | 'elevated' | 'critical'; labelBangla: string; labelEnglish: string; note: string };
    grazing: { suitableNow: boolean; rationaleBangla: string; rationaleEnglish: string; lowestThiHours: string[] | null };
  };
  forageStatus: {
    ndviProxy: number | null;
    resolutionMeters: number | null;
    quality: FeatureQuality;
    observationDate: string | null;
    forageAvailable: 'proxy_only' | 'unavailable';
    disclaimerBangla: string;
    disclaimerEnglish: string;
  };
  modelStatus: {
    heatStressMethod: 'rule_based_thi';
    supervisedModelAvailable: false;
    modelRegistryStatus: 'training_data_unavailable';
    unavailablePredictions: Array<{
      target: 'milk_loss' | 'disease_risk';
      targetLabelBangla: string;
      targetLabelEnglish: string;
      reasonBangla: string;
      reasonEnglish: string;
    }>;
  };
  providerAttributions: Array<{
    name: string;
    parameter: string;
    kind: SourceKind;
    spatialResolution: string;
    latency: string;
    caveat: string;
  }>;
}
