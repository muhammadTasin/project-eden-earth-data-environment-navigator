/**
 * Google Earth Engine adapter and catalog specification.
 * Real extraction is done by the Python worker (cattle_worker.py) run as a child process. This module only
 * validates the worker's JSON and maps it to honest statuses; it never fabricates values, coverage or quality.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { FarmAOI, ExtractedFeature } from '../types.ts';

export interface EarthEngineCollectionSpec {
  collectionId: string;
  name: string;
  bands: string[];
  nativeResolutionMeters: number;
  cadence: string;
  latencyNotice: string;
  scaleFactor: number;
  hasQaMask: boolean;
  termsAndCaveatsBangla: string;
  termsAndCaveatsEnglish: string;
}

export const EE_CATALOG: Record<string, EarthEngineCollectionSpec> = {
  IMERG: {
    collectionId: 'NASA/GPM_L3/IMERG_V07',
    name: 'GPM IMERG Final Precipitation V07',
    bands: ['precipitation'],
    nativeResolutionMeters: 11132, // ~0.1 deg (~11 km)
    cadence: '30 minutes',
    latencyNotice: '2-3 months for Final V07; Early/Late runs have shorter latency with lower calibration',
    scaleFactor: 1.0,
    hasQaMask: true,
    termsAndCaveatsBangla: '১১ কিমি পিক্সেল সাধারণ খামারের চেয়ে অনেক বড়। এটি আঞ্চলিক প্রক্সি, মাঠের সুনির্দিষ্ট বৃষ্টিপাত নয়।',
    termsAndCaveatsEnglish: '11 km pixel is much larger than an individual farm. Coarse regional proxy, not farm-level rain gauge.',
  },
  SMAP: {
    collectionId: 'NASA/SMAP/SPL4SMGP/008',
    name: 'SMAP L4 Global 3-hourly 9 km Soil Moisture (SPL4SMGP/008)',
    bands: ['sm_surface', 'sm_rootzone'],
    nativeResolutionMeters: 9000, // 9 km native EASE-Grid 2.0 / 11,000 m EE grid
    cadence: '3 hours',
    latencyNotice: '2-3 days data processing latency',
    scaleFactor: 1.0,
    hasQaMask: true,
    termsAndCaveatsBangla: '৯ কিমি পিক্সেল ক্ষেত্রফলের জন্য এটি মাটির আর্দ্রতার আঞ্চলিক সূচক; খামারের মাটির সঠিক মাপ নয়।',
    termsAndCaveatsEnglish: '9 km pixel area serves as a regional soil moisture proxy; not a field-level physical moisture sensor.',
  },
  MODIS_VI: {
    collectionId: 'MODIS/061/MOD13A1',
    name: 'MODIS/Terra Vegetation Indices 16-Day Global 500m (V6.1)',
    bands: ['NDVI', 'DetailedQA'],
    nativeResolutionMeters: 500,
    cadence: '16 days',
    latencyNotice: '8-16 days compositing lag',
    scaleFactor: 0.0001,
    hasQaMask: true,
    termsAndCaveatsBangla: 'NDVI কেবল উদ্ভিদের সবুজতা নির্দেশ করে। এটি সরাসরি খাওয়া উপযোগী ঘাস, বায়োমাস বা পুষ্টির পরিমাণ নয়।',
    termsAndCaveatsEnglish: 'NDVI represents canopy greenness only. It is NOT edible forage, biomass, or feed quality without ground calibration.',
  },
  ERA5_LAND: {
    collectionId: 'ECMWF/ERA5_LAND/HOURLY',
    name: 'ECMWF ERA5-Land Hourly Reanalysis',
    bands: ['temperature_2m', 'dewpoint_temperature_2m'],
    nativeResolutionMeters: 9000,
    cadence: 'Hourly',
    latencyNotice: '2-3 months historical reanalysis latency; NOT a forecast',
    scaleFactor: 1.0,
    hasQaMask: false,
    termsAndCaveatsBangla: 'ঐতিহাসিক জলবায়ু মডেল পুনঃবিশ্লেষণ ডেটা। এটি পূর্বাভাস নয়।',
    termsAndCaveatsEnglish: 'Historical climate model reanalysis. It is NOT a live forecast.',
  },
};

export type EarthEngineStatus = 'ready' | 'configuration_required' | 'error';

export interface EarthEngineReadiness {
  status: EarthEngineStatus;
  /** Worker reason code: ready | missing_dependencies | auth_error | worker_unavailable | worker_error */
  reason: string;
  details: string;
  setupInstructions: string;
  checkedAt: string;
}

const SETUP_INSTRUCTIONS = `1. pip install earthengine-api
2. Create or choose a Google Cloud project with the Earth Engine API enabled and set EE_PROJECT.
3. Authenticate on the server: 'earthengine authenticate', or a service-account key exported as GOOGLE_APPLICATION_CREDENTIALS.
Credentials stay on the server and must never be committed or sent to clients.`;

const WORKER_PATH = process.env.EE_WORKER_PATH || path.join(path.dirname(fileURLToPath(import.meta.url)), '../../cattle_worker.py');
const READINESS_TTL_MS = 5 * 60 * 1000;
let readinessCache: { at: number; value: EarthEngineReadiness } | null = null;

function runWorker(args: string[], timeoutMs: number): Promise<any> {
  // Windows installs Python as `python` (its `python3` is a Microsoft Store shortcut that only prints a message)
  const python = process.env.EE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  return new Promise((resolve, reject) => {
    execFile(python, [WORKER_PATH, ...args], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: process.env }, (err, stdout) => {
      if (err) return reject(err);
      try {
        resolve(JSON.parse(String(stdout).trim().split('\n').pop() || ''));
      } catch {
        reject(new Error('Earth Engine worker returned invalid JSON'));
      }
    });
  });
}

/** Hint only: which credential files exist. Existence never means Earth Engine works; use getEarthEngineReadiness(). */
export function detectEarthEngineCredentialFiles(): string[] {
  const found: string[] = [];
  const env = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (env && fs.existsSync(env)) found.push('GOOGLE_APPLICATION_CREDENTIALS');
  if (fs.existsSync(path.join(os.homedir(), '.config', 'earthengine', 'credentials'))) found.push('earthengine_user_token');
  return found;
}

/** Runs a real ee.Initialize in the worker. Result is cached for 5 minutes. */
export async function getEarthEngineReadiness(force = false): Promise<EarthEngineReadiness> {
  if (!force && readinessCache && Date.now() - readinessCache.at < READINESS_TTL_MS) return readinessCache.value;
  const checkedAt = new Date().toISOString();
  let value: EarthEngineReadiness;
  try {
    const out = await runWorker(['--check-readiness'], 30000);
    if (out.ready === true) {
      value = { status: 'ready', reason: 'ready', details: String(out.message || 'Earth Engine initialised'), setupInstructions: SETUP_INSTRUCTIONS, checkedAt };
    } else {
      const reason = String(out.status || 'worker_error');
      value = {
        status: reason === 'missing_dependencies' || reason === 'auth_error' ? 'configuration_required' : 'error',
        reason,
        details: String(out.message || 'Earth Engine is not ready'),
        setupInstructions: SETUP_INSTRUCTIONS,
        checkedAt,
      };
    }
  } catch (err: any) {
    const missingPython = err?.code === 'ENOENT' || /Python was not found/i.test(String(err?.message || ''));
    value = {
      status: missingPython ? 'configuration_required' : 'error',
      reason: missingPython ? 'worker_unavailable' : 'worker_error',
      details: missingPython ? 'Python 3 was not found on the server (set EE_PYTHON)' : `Earth Engine worker failed: ${String(err?.message || err)}`,
      setupInstructions: SETUP_INSTRUCTIONS,
      checkedAt,
    };
  }
  readinessCache = { at: Date.now(), value };
  return value;
}
export function clearEarthEngineReadinessCache(): void { readinessCache = null; }

export interface UnavailableDataset { dataset: string; reason: string }

export interface EarthEngineExtractionResult {
  /** True only if at least one dataset returned a real value. */
  success: boolean;
  status: 'succeeded' | 'partial' | 'configuration_required' | 'failed';
  message: string;
  features: ExtractedFeature[];
  unavailable: UnavailableDataset[];
}

const SPEC_BY_KEY: Record<string, EarthEngineCollectionSpec> = {
  MODIS_NDVI: EE_CATALOG.MODIS_VI,
  SMAP_ROOTZONE: EE_CATALOG.SMAP,
  IMERG_RAIN_30D: EE_CATALOG.IMERG,
};
const EXPECTED_KEYS = Object.keys(SPEC_BY_KEY);

/** Pure mapping from the worker's JSON to features, exported for tests. Only datasets with a finite value and coverage > 0 become features. */
export function mapWorkerResult(aoi: FarmAOI, out: any, now = new Date().toISOString()): EarthEngineExtractionResult {
  if (!out || out.status !== 'success' || !Array.isArray(out.datasets)) {
    return { success: false, status: 'failed', message: String(out?.message || 'Earth Engine worker returned no results'), features: [], unavailable: [] };
  }
  const features: ExtractedFeature[] = [];
  const unavailable: UnavailableDataset[] = [];
  const seen = new Set<string>();
  for (const d of out.datasets) {
    const key = String(d?.key);
    seen.add(key);
    const spec = SPEC_BY_KEY[key];
    const coverage = Number(d?.validPixelCoveragePct);
    const value = Number(d?.value);
    if (!spec || d?.status !== 'ok' || !Number.isFinite(value) || !Number.isFinite(coverage) || coverage <= 0) {
      unavailable.push({ dataset: String(d?.dataset || key), reason: String(d?.reason || d?.status || 'no valid data') });
      continue;
    }
    const pixel = Number(d.pixelSizeMeters) || spec.nativeResolutionMeters;
    const pixelHectares = (pixel * pixel) / 10000;
    const proxy = aoi.areaHectares < pixelHectares;
    features.push({
      aoiId: aoi.aoiId,
      dataset: String(d.dataset),
      band: String(d.band),
      observationInterval: String(d.observationDate || ''),
      units: String(d.units),
      pixelSizeMeters: pixel,
      aggregationMethod: d.aggregationMethod === 'centroid_sample' ? 'centroid_sample' : 'mean',
      validPixelCoveragePct: coverage,
      qualityState: proxy ? 'REGIONAL_PROXY' : coverage >= 80 ? 'GOOD' : 'DEGRADED',
      fetchedAt: now,
      sourceVersion: String(d.sourceVersion || ''),
      value,
      isRegionalProxy: proxy,
      notesBangla: spec.termsAndCaveatsBangla,
      notesEnglish: spec.termsAndCaveatsEnglish,
    });
  }
  for (const key of EXPECTED_KEYS) {
    if (!seen.has(key)) unavailable.push({ dataset: SPEC_BY_KEY[key].collectionId, reason: 'worker did not report this dataset' });
  }
  if (features.length === 0) {
    return { success: false, status: 'failed', message: 'Earth Engine returned no valid satellite values for this AOI', features, unavailable };
  }
  return {
    success: true,
    status: unavailable.length ? 'partial' : 'succeeded',
    message: `Extracted ${features.length} of ${EXPECTED_KEYS.length} satellite datasets for AOI ${aoi.aoiId}`,
    features,
    unavailable,
  };
}

/** Real extraction through the Python worker. Missing setup is reported as configuration_required, never as success. */
export async function extractEarthEngineFeatures(aoi: FarmAOI): Promise<EarthEngineExtractionResult> {
  const readiness = await getEarthEngineReadiness();
  if (readiness.status !== 'ready') {
    return {
      success: false,
      status: readiness.status === 'configuration_required' ? 'configuration_required' : 'failed',
      message: readiness.details,
      features: [],
      unavailable: EXPECTED_KEYS.map(k => ({ dataset: SPEC_BY_KEY[k].collectionId, reason: readiness.reason })),
    };
  }
  try {
    const out = await runWorker(['--geojson', JSON.stringify(aoi.geometry)], 120000);
    return mapWorkerResult(aoi, out);
  } catch (err: any) {
    return { success: false, status: 'failed', message: `Earth Engine extraction failed: ${String(err?.message || err)}`, features: [], unavailable: [] };
  }
}
