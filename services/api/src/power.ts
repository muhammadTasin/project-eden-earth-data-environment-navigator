import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nasaConfig } from './config.ts';
import { ApiError } from './errors.ts';
import type { ManagerSite } from './sites.ts';

export const POWER_PARAMETERS = [
  'T2M', 'T2M_MAX', 'T2M_MIN', 'PRECTOTCORR', 'RH2M', 'WS2M', 'ALLSKY_SFC_SW_DWN', 'GWETROOT',
] as const;
export type PowerParameter = typeof POWER_PARAMETERS[number];
export type DailyValues = Partial<Record<PowerParameter, number>>;
export type DailyRows = Record<string, DailyValues>;
export type ClimateDataSource = 'live' | 'cache' | 'fixture';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CACHE_DIR = path.resolve(__dirname, '../.data/power-climate-cache');
const DEFAULT_FIXTURE_PATH = path.resolve(__dirname, '../fixtures/power-climate-fixture.json');
const REQUEST_TIMEOUT_MS = 12_000;
const MS_PER_DAY = 86_400_000;

export interface RawPowerResponse {
  header?: { fill_value?: number };
  properties?: { parameter?: Record<string, Record<string, number | string>> };
}

interface PowerEnvelope {
  version: 1;
  siteId: string;
  lat: number;
  lon: number;
  parameters: PowerParameter[];
  requestedRange: { from: string; to: string };
  fetchedAt: string;
  response: RawPowerResponse;
}

export interface ClimateDateRange {
  from: string;
  to: string;
}

export interface ClimateIndicator<T> {
  value: T | null;
  unit: string;
  dateRange: ClimateDateRange & Record<string, unknown>;
  source: 'NASA POWER';
  coverage: { observedDays: number; expectedDays: number };
  [key: string]: unknown;
}

export interface ClimateIndicators {
  rainfall: ClimateIndicator<number> & {
    totalMm: number | null;
    normalMm: number | null;
    anomalyMm: number | null;
    anomalyPercent: number | null;
  };
  heatStressDays: ClimateIndicator<number> & { thresholdC: 35 };
  longestDrySpell: ClimateIndicator<number> & { thresholdMmPerDay: 1 };
  rootZoneWetness: ClimateIndicator<number>;
}

export interface PowerClimateResult {
  indicators: ClimateIndicators;
  dataDateRange: ClimateDateRange;
  last30Days: ClimateDateRange;
  dataSource: ClimateDataSource;
  /** When the POWER data in use was downloaded (ISO). For a fixture, when the fixture was built. */
  fetchedAt: string;
  generatedAt: string;
  site: { id: string; nameBangla: string; nameEnglish: string };
}

export interface PowerClientOptions {
  fetchImpl?: typeof fetch;
  cacheDir?: string;
  fixturePath?: string;
  now?: Date;
  timeoutMs?: number;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || isoDate(date) !== value) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  return date;
}

function addDays(value: string, amount: number): string {
  return isoDate(new Date(parseIsoDate(value).getTime() + amount * MS_PER_DAY));
}

function addYearsClamped(value: string, amount: number): string {
  const date = parseIsoDate(value);
  const year = date.getUTCFullYear() + amount;
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return isoDate(new Date(Date.UTC(year, month, Math.min(day, lastDay))));
}

function powerDate(value: string): string {
  return value.replaceAll('-', '');
}

function requestedRange(now: Date): ClimateDateRange {
  const end = isoDate(now);
  // POWER daily values can lag by several days; fetch a small lead-in so the oldest
  // same-season normal window is still complete when the current data is delayed.
  return { from: addDays(addYearsClamped(end, -10), -36), to: end };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Parse NASA's parameter-by-date payload. NASA's -999 fill value is omitted, never treated as an observation. */
export function parsePowerDailyResponse(response: RawPowerResponse): DailyRows {
  const parameterData = response?.properties?.parameter;
  if (!isRecord(parameterData)) throw new Error('NASA POWER response did not contain daily parameters');
  const rows: DailyRows = {};
  for (const parameter of POWER_PARAMETERS) {
    const byDate = parameterData[parameter];
    if (!isRecord(byDate)) continue;
    for (const [rawDate, rawValue] of Object.entries(byDate)) {
      if (!/^\d{8}$/.test(rawDate)) continue;
      const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
      try { parseIsoDate(date); } catch { continue; }
      const value = typeof rawValue === 'number' ? rawValue : Number(rawValue);
      if (!Number.isFinite(value) || value === -999) continue;
      (rows[date] ??= {})[parameter] = value;
    }
  }
  if (!Object.keys(rows).length) throw new Error('NASA POWER response contained no usable daily values');
  return rows;
}

function usable(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value !== -999;
}

function windowDates(to: string, length: number): string[] {
  return Array.from({ length }, (_, index) => addDays(to, index - length + 1));
}

function sumRainfall(rows: DailyRows, dates: string[]) {
  const values = dates.map(date => rows[date]?.PRECTOTCORR).filter(usable);
  return { sum: values.reduce((total, value) => total + value, 0), observed: values.length, complete: values.length === dates.length };
}

/** Pure indicator calculations from normalized daily records, keyed by YYYY-MM-DD. */
export function computeClimateIndicators(rows: DailyRows, endDate: string): ClimateIndicators {
  parseIsoDate(endDate);
  const recent30 = windowDates(endDate, 30);
  const currentRain = sumRainfall(rows, recent30);
  const normalWindows = Array.from({ length: 10 }, (_, index) => {
    const shiftedEnd = addYearsClamped(endDate, -(index + 1));
    const dates = windowDates(shiftedEnd, 30);
    return { year: Number(shiftedEnd.slice(0, 4)), from: dates[0], to: dates[dates.length - 1], ...sumRainfall(rows, dates) };
  });
  const completeNormals = normalWindows.filter(window => window.complete);
  const totalMm = currentRain.complete ? currentRain.sum : null;
  const normalMm = completeNormals.length === 10
    ? completeNormals.reduce((sum, window) => sum + window.sum, 0) / 10
    : null;
  const anomalyMm = totalMm !== null && normalMm !== null ? totalMm - normalMm : null;
  const anomalyPercent = anomalyMm !== null && normalMm !== null && normalMm > 0 ? (anomalyMm / normalMm) * 100 : null;
  const currentRange = { from: recent30[0], to: recent30[29] };

  const recent14 = windowDates(endDate, 14);
  const soilValues = recent14.map(date => rows[date]?.GWETROOT).filter(usable);
  const soilMean = soilValues.length ? soilValues.reduce((sum, value) => sum + value, 0) / soilValues.length : null;

  const heatValues = recent30.map(date => rows[date]?.T2M_MAX).filter(usable);
  const heatDays = heatValues.length ? heatValues.filter(value => value > 35).length : null;

  let longestDrySpell = 0;
  let currentDrySpell = 0;
  let dryObservedDays = 0;
  for (const date of recent30) {
    const rain = rows[date]?.PRECTOTCORR;
    if (!usable(rain)) {
      currentDrySpell = 0;
      continue;
    }
    dryObservedDays += 1;
    if (rain < 1) {
      currentDrySpell += 1;
      longestDrySpell = Math.max(longestDrySpell, currentDrySpell);
    } else {
      currentDrySpell = 0;
    }
  }

  return {
    rainfall: {
      value: totalMm,
      totalMm,
      normalMm,
      anomalyMm,
      anomalyPercent,
      unit: 'mm',
      dateRange: {
        ...currentRange,
        normalWindows: normalWindows.map(({ year, from, to }) => ({ year, from, to })),
      },
      source: 'NASA POWER',
      coverage: { observedDays: currentRain.observed, expectedDays: 30 },
      normalCoverage: { completeYears: completeNormals.length, expectedYears: 10 },
      anomalyPercentUnit: '%',
    },
    heatStressDays: {
      value: heatDays,
      unit: 'days',
      thresholdC: 35,
      dateRange: currentRange,
      source: 'NASA POWER',
      coverage: { observedDays: heatValues.length, expectedDays: 30 },
    },
    longestDrySpell: {
      value: dryObservedDays ? longestDrySpell : null,
      unit: 'consecutive days',
      thresholdMmPerDay: 1,
      dateRange: currentRange,
      source: 'NASA POWER',
      coverage: { observedDays: dryObservedDays, expectedDays: 30 },
    },
    rootZoneWetness: {
      value: soilMean,
      unit: 'fraction (0–1)',
      dateRange: { from: recent14[0], to: recent14[13] },
      source: 'NASA POWER',
      coverage: { observedDays: soilValues.length, expectedDays: 14 },
    },
  };
}

function cacheKey(site: ManagerSite, range: ClimateDateRange): string {
  const key = JSON.stringify({ site: site.id, lat: site.lat, lon: site.lon, range, parameters: POWER_PARAMETERS });
  return crypto.createHash('sha256').update(key).digest('hex');
}

function validEnvelope(value: unknown): value is PowerEnvelope {
  if (!isRecord(value) || value.version !== 1 || typeof value.siteId !== 'string' || !isRecord(value.requestedRange)
    || typeof value.requestedRange.from !== 'string' || typeof value.requestedRange.to !== 'string'
    || typeof value.fetchedAt !== 'string' || !isRecord(value.response) || !isRecord(value.response.properties)
    || !isRecord(value.response.properties.parameter)) return false;
  return Array.isArray(value.parameters) && value.parameters.join(',') === POWER_PARAMETERS.join(',');
}

async function readEnvelope(filePath: string): Promise<PowerEnvelope | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return validEnvelope(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Same site, same coordinates and the same 8 parameters. The date range is deliberately not compared: an old entry is still the best offline answer. */
function compatibleEnvelope(envelope: PowerEnvelope, site: ManagerSite): boolean {
  return envelope.siteId === site.id && envelope.lat === site.lat && envelope.lon === site.lon
    && envelope.parameters.join(',') === POWER_PARAMETERS.join(',');
}

/** The committed fixture stores each parameter as one array of daily values starting at `from` (-999 = missing), which is far smaller than NASA's one-key-per-date JSON. */
export interface CompactPowerSite {
  lat: number;
  lon: number;
  from: string;
  to: string;
  values: Record<PowerParameter, number[]>;
}

export interface CompactPowerFixture {
  version: 1;
  parameters: PowerParameter[];
  generatedAt: string;
  sites: Record<string, CompactPowerSite>;
}

/** Turns a POWER response into the compact fixture form: values rounded to 2 decimals, -999 kept for missing days. */
export function compactPowerResponse(response: RawPowerResponse, lat: number, lon: number): CompactPowerSite {
  const parameterData = response?.properties?.parameter;
  if (!isRecord(parameterData)) throw new Error('NASA POWER response did not contain daily parameters');
  const days = new Set<string>();
  for (const parameter of POWER_PARAMETERS) {
    for (const rawDate of Object.keys(isRecord(parameterData[parameter]) ? parameterData[parameter] as object : {})) {
      if (/^\d{8}$/.test(rawDate)) days.add(rawDate);
    }
  }
  const sorted = [...days].sort();
  if (!sorted.length) throw new Error('NASA POWER response contained no daily values');
  const toIso = (raw: string) => `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  const from = toIso(sorted[0]);
  const to = toIso(sorted[sorted.length - 1]);
  const length = Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / MS_PER_DAY) + 1;
  const values = {} as Record<PowerParameter, number[]>;
  for (const parameter of POWER_PARAMETERS) {
    const byDate = isRecord(parameterData[parameter]) ? parameterData[parameter] as Record<string, number | string> : {};
    values[parameter] = Array.from({ length }, (_, index) => {
      const raw = Number(byDate[addDays(from, index).replaceAll('-', '')]);
      return Number.isFinite(raw) && raw !== -999 ? Math.round(raw * 100) / 100 : -999;
    });
  }
  return { lat, lon, from, to, values };
}

function isCompactFixture(value: unknown): value is CompactPowerFixture {
  return isRecord(value) && value.version === 1 && typeof value.generatedAt === 'string' && isRecord(value.sites)
    && Array.isArray(value.parameters) && value.parameters.join(',') === POWER_PARAMETERS.join(',');
}

let fixtureMemo: { filePath: string; mtimeMs: number; fixture: CompactPowerFixture | null } | null = null;

async function readFixture(fixturePath: string): Promise<CompactPowerFixture | null> {
  try {
    const { mtimeMs } = await fs.stat(fixturePath);
    if (fixtureMemo?.filePath === fixturePath && fixtureMemo.mtimeMs === mtimeMs) return fixtureMemo.fixture;
    const parsed: unknown = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
    const fixture = isCompactFixture(parsed) ? parsed : null;
    fixtureMemo = { filePath: fixturePath, mtimeMs, fixture };
    return fixture;
  } catch {
    return null;
  }
}

/** The fixture entry for this site as an envelope in the same shape a cached live response has, so the indicator code is shared. */
async function fixtureEnvelope(fixturePath: string, site: ManagerSite): Promise<PowerEnvelope | null> {
  const fixture = await readFixture(fixturePath);
  const entry = fixture?.sites[site.id];
  if (!fixture || !entry || entry.lat !== site.lat || entry.lon !== site.lon || !isRecord(entry.values)) return null;
  const parameter: Record<string, Record<string, number>> = {};
  for (const name of POWER_PARAMETERS) {
    const series = entry.values[name];
    if (!Array.isArray(series)) return null;
    parameter[name] = Object.fromEntries(series.map((value, index) => [addDays(entry.from, index).replaceAll('-', ''), value]));
  }
  return {
    version: 1,
    siteId: site.id,
    lat: site.lat,
    lon: site.lon,
    parameters: [...POWER_PARAMETERS],
    requestedRange: { from: entry.from, to: entry.to },
    fetchedAt: fixture.generatedAt,
    response: { header: { fill_value: -999 }, properties: { parameter } },
  };
}

/** Stored POWER data for this site, best first: the newest cache entry (any date range), then the committed fixture. */
async function cacheCandidates(cacheDir: string, fixturePath: string, site: ManagerSite) {
  const cached: Array<{ envelope: PowerEnvelope; source: 'cache' | 'fixture' }> = [];
  try {
    const names = await fs.readdir(cacheDir);
    for (const name of names.filter(name => name.endsWith('.json'))) {
      const envelope = await readEnvelope(path.join(cacheDir, name));
      if (envelope && compatibleEnvelope(envelope, site)) cached.push({ envelope, source: 'cache' });
    }
  } catch {
    // A missing cache directory is expected on a first run.
  }
  cached.sort((a, b) => b.envelope.fetchedAt.localeCompare(a.envelope.fetchedAt));
  const fixture = await fixtureEnvelope(fixturePath, site);
  if (fixture) cached.push({ envelope: fixture, source: 'fixture' });
  return cached;
}

async function saveCache(cacheDir: string, key: string, envelope: PowerEnvelope) {
  await fs.mkdir(cacheDir, { recursive: true });
  const target = path.join(cacheDir, `${key}.json`);
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(envelope));
  await fs.rename(temporary, target);
}

export async function fetchPower(url: URL, fetchImpl: typeof fetch, timeoutMs: number): Promise<RawPowerResponse> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('NASA POWER request timed out')), timeoutMs);
    try {
      const response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`NASA POWER returned HTTP ${response.status}`);
      const payload: unknown = await response.json();
      if (!isRecord(payload)) throw new Error('NASA POWER returned an invalid JSON document');
      parsePowerDailyResponse(payload as RawPowerResponse);
      return payload as RawPowerResponse;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('NASA POWER request failed');
}

function latestCompleteClimateDate(rows: DailyRows): string | null {
  return Object.keys(rows).sort().reverse().find(date => usable(rows[date]?.PRECTOTCORR) && usable(rows[date]?.T2M_MAX)) ?? null;
}

/** Fetch POWER data (or use disk cache/fixture in offline mode) and produce a site-scoped summary. */
export async function getPowerClimate(site: ManagerSite, options: PowerClientOptions = {}): Promise<PowerClimateResult> {
  const config = nasaConfig();
  const range = requestedRange(options.now ?? new Date());
  const cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
  const fixturePath = options.fixturePath ?? DEFAULT_FIXTURE_PATH;
  const fetchImpl = options.fetchImpl ?? fetch;
  const key = cacheKey(site, range);
  // Online only: today's exact entry. Its file name contains the date range, so it changes every day (OFFLINE=1 does not use it).
  const exactCandidate = config.offline ? null : await readEnvelope(path.join(cacheDir, `${key}.json`));
  const exact = exactCandidate && compatibleEnvelope(exactCandidate, site)
    && exactCandidate.requestedRange.from === range.from && exactCandidate.requestedRange.to === range.to
    ? exactCandidate : null;
  const fallbackCandidates = await cacheCandidates(cacheDir, fixturePath, site);
  let envelope: PowerEnvelope | null = null;
  let dataSource: ClimateDataSource = 'cache';

  if (config.offline) {
    // OFFLINE=1: never touch the network. Newest cache entry for this site (whatever day it was fetched), then the committed fixture.
    const fallback = fallbackCandidates[0];
    envelope = fallback?.envelope ?? null;
    if (!envelope) {
      throw new ApiError('no_data', `OFFLINE=1 is set, but there is no NASA POWER cache or fixture for site "${site.id}". Run once online to populate the local cache, or rebuild the fixture with services/api/scripts/build_power_fixture.ts.`);
    }
    dataSource = fallback.source;
  } else if (exact) {
    envelope = exact;
    dataSource = 'cache';
  } else {
    const url = new URL(config.endpoints.powerDailyPoint);
    url.searchParams.set('parameters', POWER_PARAMETERS.join(','));
    url.searchParams.set('community', 'AG');
    url.searchParams.set('longitude', String(site.lon));
    url.searchParams.set('latitude', String(site.lat));
    url.searchParams.set('start', powerDate(range.from));
    url.searchParams.set('end', powerDate(range.to));
    url.searchParams.set('format', 'JSON');
    url.searchParams.set('time-standard', 'UTC');
    try {
      const response = await fetchPower(url, fetchImpl, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
      envelope = {
        version: 1,
        siteId: site.id,
        lat: site.lat,
        lon: site.lon,
        parameters: [...POWER_PARAMETERS],
        requestedRange: range,
        fetchedAt: (options.now ?? new Date()).toISOString(),
        response,
      };
      await saveCache(cacheDir, key, envelope);
      dataSource = 'live';
    } catch {
      const fallback = fallbackCandidates[0];
      envelope = fallback?.envelope ?? null;
      if (!envelope) throw new ApiError('provider_unavailable', 'NASA POWER could not be reached and no compatible cached data is available');
      dataSource = fallback?.source ?? 'cache';
    }
  }

  const rows = parsePowerDailyResponse(envelope.response);
  const endDate = latestCompleteClimateDate(rows);
  if (!endDate) throw new ApiError('no_data', 'NASA POWER has no recent rainfall and temperature records for this site');
  const allDates = Object.keys(rows).sort();
  const indicators = computeClimateIndicators(rows, endDate);
  return {
    site: { id: site.id, nameBangla: site.nameBangla, nameEnglish: site.nameEnglish },
    indicators,
    dataDateRange: { from: allDates[0], to: endDate },
    last30Days: { from: addDays(endDate, -29), to: endDate },
    dataSource,
    fetchedAt: envelope.fetchedAt,
    generatedAt: (options.now ?? new Date()).toISOString(),
  };
}
