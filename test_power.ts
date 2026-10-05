import assert from 'node:assert/strict';
import type http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ApiError } from './services/api/src/errors.ts';
import { computeClimateIndicators, getPowerClimate, parsePowerDailyResponse, POWER_PARAMETERS } from './services/api/src/power.ts';
import type { DailyRows } from './services/api/src/power.ts';
import { managerClimate } from './services/api/src/manager_climate.ts';

const DAY = 86_400_000;
const END = '2026-07-31';
const fixedNow = new Date(`${END}T12:00:00.000Z`);

function addDays(date: string, days: number) {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY).toISOString().slice(0, 10);
}

function addYears(date: string, years: number) {
  const value = new Date(`${date}T00:00:00Z`);
  const year = value.getUTCFullYear() + years;
  const month = value.getUTCMonth();
  const day = value.getUTCDate();
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, last))).toISOString().slice(0, 10);
}

function makeWindowRows(endDate = END): DailyRows {
  const rows: DailyRows = {};
  for (let yearOffset = 0; yearOffset <= 10; yearOffset += 1) {
    const end = addYears(endDate, -yearOffset);
    for (let dayOffset = -29; dayOffset <= 0; dayOffset += 1) {
      const date = addDays(end, dayOffset);
      const current = yearOffset === 0;
      rows[date] = {
        T2M: 29,
        T2M_MAX: current && dayOffset >= -3 ? 36 : 34,
        T2M_MIN: 24,
        PRECTOTCORR: current ? (dayOffset >= -3 ? 0.5 : 2) : 1,
        RH2M: 60,
        WS2M: 1.2,
        ALLSKY_SFC_SW_DWN: 15,
        GWETROOT: 0.4,
      };
    }
  }
  return rows;
}

function toPowerResponse(rows: DailyRows) {
  const parameter: Record<string, Record<string, number>> = Object.fromEntries(POWER_PARAMETERS.map(key => [key, {}]));
  for (const [date, values] of Object.entries(rows)) {
    const key = date.replaceAll('-', '');
    for (const name of POWER_PARAMETERS) {
      const value = values[name];
      if (typeof value === 'number') parameter[name][key] = value;
    }
  }
  return { header: { fill_value: -999 }, properties: { parameter } };
}

function req(authorization?: string): http.IncomingMessage {
  return { headers: authorization ? { authorization } : {}, url: '/api/v1/manager/climate?site=dharmapasha' } as http.IncomingMessage;
}

const managerToken = 'header.manager.signature';
const viewerToken = 'header.viewer.signature';
const noSiteToken = 'header.nosite.signature';
const users: Record<string, any> = {
  [managerToken]: { id: 'manager-1', email: 'field@example.test', app_metadata: { role: 'manager', site: 'talanda' }, user_metadata: { site: 'dharmapasha' } },
  [viewerToken]: { id: 'viewer-1', email: 'viewer@example.test', app_metadata: { role: 'viewer', site: 'talanda' } },
  [noSiteToken]: { id: 'manager-2', email: 'manager2@example.test', app_metadata: { role: 'manager' }, user_metadata: { site: 'talanda' } },
};
const verify = async (token: string) => users[token] ?? null;

console.log('========================================================');
console.log('  NASA POWER CLIMATE FEATURE TEST SUITE                 ');
console.log('========================================================\n');

// Pure indicators: current 30-day total vs the ten same-date 30-day periods, heat, dry spell and soil wetness.
const indicatorRows = makeWindowRows();
const summary = computeClimateIndicators(indicatorRows, END);
assert.equal(summary.rainfall.totalMm, 54);
assert.equal(summary.rainfall.normalMm, 30);
assert.equal(summary.rainfall.anomalyMm, 24);
assert.equal(summary.rainfall.anomalyPercent, 80);
assert.equal(summary.rainfall.dateRange.from, '2026-07-02');
assert.equal(summary.rainfall.dateRange.normalWindows.length, 10);
assert.equal(summary.heatStressDays.value, 4, 'only four daily maximum temperatures exceeded 35 C');
assert.equal(summary.longestDrySpell.value, 4, 'the four final days below 1 mm/day are consecutive');
assert.equal(summary.rootZoneWetness.value, 0.4);
for (const indicator of Object.values(summary)) {
  assert.equal(indicator.source, 'NASA POWER');
  assert.ok(indicator.unit);
  assert.ok(indicator.dateRange.from && indicator.dateRange.to);
}
console.log('✓ Pure indicators: 30-day anomaly, heat days, dry spell, soil wetness, units and source.');

// NASA's fill sentinel is excluded; missing rain breaks a dry spell and missing soil does not enter the average.
const parsedSentinel = parsePowerDailyResponse({ properties: { parameter: {
  PRECTOTCORR: { '20260729': 0.5, '20260730': 0.5, '20260731': -999 },
  T2M_MAX: { '20260729': 36, '20260730': -999, '20260731': 40 },
  GWETROOT: { '20260730': 0.25, '20260731': -999 },
} } });
assert.equal(parsedSentinel['2026-07-31'].PRECTOTCORR, undefined);
const sentinelIndicators = computeClimateIndicators(parsedSentinel, END);
assert.equal(sentinelIndicators.longestDrySpell.value, 2, 'the -999 rain day breaks the dry-spell sequence');
assert.equal(sentinelIndicators.heatStressDays.value, 2, 'the -999 maximum temperature is not counted among the two valid heat days');
assert.equal(sentinelIndicators.rootZoneWetness.value, 0.25, 'the -999 soil value is excluded');
assert.equal(sentinelIndicators.rainfall.totalMm, null, 'an incomplete 30-day rainfall window is not reported as a total');
console.log('✓ Fill value: -999 is missing for rainfall, heat and root-zone wetness.');

// Manager climate API logic: bearer auth errors, site claim scope, and a mocked POWER call.
delete process.env.OFFLINE;
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'eden-power-test-'));
const cacheDir = path.join(scratch, 'cache');
const fixturePath = path.join(scratch, 'missing-fixture.json');
let requestCount = 0;
let retryCount = 0;
const mockFetch: typeof fetch = async (input) => {
  requestCount += 1;
  const url = new URL(String(input));
  assert.equal(url.origin + url.pathname, 'https://power.larc.nasa.gov/api/temporal/daily/point');
  assert.equal(url.searchParams.get('community'), 'AG');
  assert.equal(url.searchParams.get('format'), 'JSON');
  assert.equal(url.searchParams.get('latitude'), '24.62');
  assert.equal(url.searchParams.get('longitude'), '88.56');
  assert.deepEqual(url.searchParams.get('parameters')?.split(','), [...POWER_PARAMETERS]);
  if (retryCount++ === 0) throw new Error('temporary mocked network failure');
  const body = JSON.stringify(toPowerResponse(makeWindowRows()));
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const powerOptions = { fetchImpl: mockFetch, cacheDir, fixturePath, now: fixedNow };
await assert.rejects(managerClimate(req(), { verify }), (error: any) => error instanceof ApiError && error.status === 401);
await assert.rejects(managerClimate(req('Bearer invalid'), { verify }), (error: any) => error instanceof ApiError && error.status === 401);
await assert.rejects(managerClimate(req(`Bearer ${viewerToken}`), { verify }), (error: any) => error instanceof ApiError && error.status === 403);
await assert.rejects(managerClimate(req(`Bearer ${noSiteToken}`), { verify }), (error: any) => error instanceof ApiError && error.status === 403);
const managerSummary = await managerClimate(req(`Bearer ${managerToken}`), { verify, power: powerOptions });
assert.equal(managerSummary.site.id, 'talanda', 'the query site is ignored; app_metadata.site controls the result');
assert.equal(managerSummary.site.nameEnglish, 'Talanda, Tanore');
assert.equal(managerSummary.dataSource, 'live');
assert.equal(managerSummary.indicators.rainfall.source, 'NASA POWER');
assert.equal(requestCount, 2, 'POWER request gets one retry after the mocked first failure');
console.log('✓ Manager API: 401 without a token, 403 non-manager/missing site, 200 manager scoped to app_metadata.site.');

let timeoutAttempts = 0;
await assert.rejects(getPowerClimate({ id: 'talanda', nameBangla: 'তালন্দ', nameEnglish: 'Talanda', lat: 24.62, lon: 88.56 }, {
  cacheDir: path.join(scratch, 'timeout-cache'),
  fixturePath,
  now: fixedNow,
  timeoutMs: 5,
  fetchImpl: async (_input, init) => new Promise((_resolve, reject) => {
    timeoutAttempts += 1;
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
  }),
}), (error: any) => error instanceof ApiError && error.status === 502);
assert.equal(timeoutAttempts, 2, 'the timed-out POWER request is retried once');
console.log('✓ POWER timeout: the request is bounded and retries once.');

// Offline mode reads a matching on-disk cache and never calls fetch; a cache miss has a clear error and no network call.
process.env.OFFLINE = '1';
const offlineSummary = await managerClimate(req(`Bearer ${managerToken}`), {
  verify,
  power: { cacheDir, fixturePath, now: fixedNow, fetchImpl: async () => { requestCount += 1; throw new Error('network must not be used offline'); } },
});
assert.equal(offlineSummary.dataSource, 'cache');
assert.equal(requestCount, 2, 'OFFLINE=1 performs no fetch');
const cacheFile = (await fs.readdir(cacheDir)).find(name => name.endsWith('.json'))!;
await fs.copyFile(path.join(cacheDir, cacheFile), fixturePath);
const fixtureSummary = await getPowerClimate({ id: 'talanda', nameBangla: 'তালন্দ', nameEnglish: 'Talanda', lat: 24.62, lon: 88.56 }, {
  cacheDir: path.join(scratch, 'fixture-cache'),
  fixturePath,
  now: fixedNow,
  fetchImpl: async () => { requestCount += 1; throw new Error('network must not be used offline'); },
});
assert.equal(fixtureSummary.dataSource, 'fixture');
assert.equal(requestCount, 2, 'OFFLINE=1 fixture read performs no fetch');
const missingCacheDir = path.join(scratch, 'empty-cache');
await assert.rejects(getPowerClimate({ id: 'talanda', nameBangla: 'তালন্দ', nameEnglish: 'Talanda', lat: 24.62, lon: 88.56 }, {
  cacheDir: missingCacheDir,
  fixturePath: path.join(scratch, 'absent-fixture.json'),
  now: fixedNow,
  fetchImpl: async () => { requestCount += 1; throw new Error('network must not be used offline'); },
}), (error: any) => error instanceof ApiError && error.status === 404 && /OFFLINE=1/.test(error.message));
assert.equal(requestCount, 2, 'OFFLINE=1 cache miss also performs no fetch');
delete process.env.OFFLINE;
await fs.rm(scratch, { recursive: true, force: true });
console.log('✓ OFFLINE=1: reads cache only, reports a clear cache-miss error, and makes no network calls.\n');

console.log('========================================================');
console.log('  ALL NASA POWER CLIMATE TESTS PASSED                   ');
console.log('========================================================\n');
