import assert from 'node:assert/strict';
import type http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ApiError } from './services/api/src/errors.ts';
import { compactPowerResponse, computeClimateIndicators, getPowerClimate, parsePowerDailyResponse, POWER_PARAMETERS } from './services/api/src/power.ts';
import type { CompactPowerFixture, DailyRows } from './services/api/src/power.ts';
import { MANAGER_SITES } from './services/api/src/sites.ts';
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
const unknownSiteToken = 'header.unknownsite.signature';
const users: Record<string, any> = {
  [managerToken]: { id: 'manager-1', email: 'field@example.test', app_metadata: { role: 'manager', site: 'talanda' }, user_metadata: { site: 'dharmapasha' } },
  [viewerToken]: { id: 'viewer-1', email: 'viewer@example.test', app_metadata: { role: 'viewer', site: 'talanda' } },
  [unknownSiteToken]: { id: 'manager-3', email: 'manager3@example.test', app_metadata: { role: 'manager', site: 'atlantis' } },
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

// Another area's public weather: the id must be on the known upazila list, coordinates come from the server's data, never from the request.
const reqFor = (query: string, authorization = `Bearer ${managerToken}`) => ({ headers: { authorization }, url: `/api/v1/manager/climate${query}` }) as http.IncomingMessage;
const areaCache = path.join(scratch, 'area-cache');
const seen: Array<{ lat: string | null; lon: string | null }> = [];
const areaFetch: typeof fetch = async (input) => {
  const url = new URL(String(input));
  seen.push({ lat: url.searchParams.get('latitude'), lon: url.searchParams.get('longitude') });
  return new Response(JSON.stringify(toPowerResponse(makeWindowRows())), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const areaOptions = { verify, power: { fetchImpl: areaFetch, cacheDir: areaCache, fixturePath, now: fixedNow } };
const chuadanga = await managerClimate(reqFor('?area=ADM3_ChuadangaSadar&lat=1&lon=2'), areaOptions);
assert.deepEqual(seen.at(-1), { lat: '23.5886', lon: '88.8846' }, 'coordinates come from the upazila list, not from lat/lon in the request');
assert.equal(chuadanga.area.id, 'ADM3_ChuadangaSadar');
assert.equal(chuadanga.area.nameEnglish, 'Chuadanga Sadar, Chuadanga');
assert.equal(chuadanga.area.isHome, false, 'another area is marked as not the manager\'s own');
assert.equal(chuadanga.site.id, 'ADM3_ChuadangaSadar');
const home = await managerClimate(reqFor(''), areaOptions);
assert.equal(home.area.isHome, true);
assert.equal(home.area.id, 'talanda');
const homeByPlace = await managerClimate(reqFor('?area=talanda_tanore'), areaOptions);
assert.equal(homeByPlace.area.isHome, true, 'the dashboard pilot id is the manager\'s own area');
assert.deepEqual(seen.at(-1), { lat: '24.62', lon: '88.56' }, 'the home area uses the site\'s own coordinates');
for (const bad of ['?area=nowhere', '?area=ADM3_Atlantis', '?area=../../etc/passwd', '?area=24.6,88.5', '?area=ADM3_']) {
  const before = seen.length;
  await assert.rejects(managerClimate(reqFor(bad), areaOptions), (error: any) => error instanceof ApiError && error.status === 422, bad);
  assert.equal(seen.length, before, `no download for ${bad}`);
}
await assert.rejects(managerClimate(reqFor('?area=ADM3_ChuadangaSadar', ''), areaOptions), (error: any) => error instanceof ApiError && error.status === 401);
await assert.rejects(managerClimate(reqFor('?area=ADM3_ChuadangaSadar', `Bearer ${viewerToken}`), areaOptions), (error: any) => error instanceof ApiError && error.status === 403);
console.log('✓ Area climate: known ids only, server-side coordinates, home area flagged, bad ids 422, token still required.');

// Refresh: downloads again, but not twice within a minute; a failed download falls back to the saved copy and says so.
const downloads = () => seen.length;
const t0 = downloads();
await managerClimate(reqFor('?area=ADM3_ChuadangaSadar'), areaOptions);
assert.equal(downloads(), t0, 'without refresh, today\'s saved copy is used');
const later = { ...areaOptions, power: { ...areaOptions.power, now: new Date(fixedNow.getTime() + 5 * 60_000) } };
const refreshed = await managerClimate(reqFor('?area=ADM3_ChuadangaSadar&refresh=1'), later);
assert.equal(downloads(), t0 + 1, 'refresh downloads again');
assert.equal(refreshed.dataSource, 'live');
assert.equal(refreshed.fetchedAt, later.power.now.toISOString());
await managerClimate(reqFor('?area=ADM3_ChuadangaSadar&refresh=1'), later);
assert.equal(downloads(), t0 + 1, 'a second refresh within a minute does not download again');
const failing = { ...later, power: { ...later.power, now: new Date(later.power.now.getTime() + 5 * 60_000), fetchImpl: (async () => { throw new Error('down'); }) as typeof fetch } };
const fellBack = await managerClimate(reqFor('?area=ADM3_ChuadangaSadar&refresh=1'), failing);
assert.equal(fellBack.dataSource, 'cache');
assert.equal(fellBack.liveFetchFailed, true);
assert.equal(fellBack.offline, false);
console.log('✓ Refresh: downloads again, limited to once a minute, falls back to the saved copy and reports it.');

// OFFLINE=1: newest cache entry for the site (any date range), then the committed fixture, then a clear no_data error. Never a fetch.
const talanda = { id: 'talanda', nameBangla: 'তালন্দ', nameEnglish: 'Talanda', lat: 24.62, lon: 88.56 };
process.env.OFFLINE = '1';
const offlineFetch: typeof fetch = async () => { requestCount += 1; throw new Error('network must not be used offline'); };
const requestsBefore = requestCount;

const offlineSummary = await managerClimate(req(`Bearer ${managerToken}`), {
  verify,
  power: { cacheDir, fixturePath, now: fixedNow, fetchImpl: offlineFetch },
});
assert.equal(offlineSummary.dataSource, 'cache');
assert.equal(offlineSummary.fetchedAt, fixedNow.toISOString(), 'the response says when the data was downloaded');
assert.equal(offlineSummary.dataDateRange.to, END, 'the response carries the real date range of the data served');

// A cache entry written under another date range (here: "now" is 400 days later) is still used.
const laterNow = new Date(fixedNow.getTime() + 400 * DAY);
const oldCacheSummary = await getPowerClimate(talanda, { cacheDir, fixturePath, now: laterNow, fetchImpl: offlineFetch });
assert.equal(oldCacheSummary.dataSource, 'cache', 'OFFLINE=1 serves an old cache entry whatever today\'s date is');
assert.equal(oldCacheSummary.dataDateRange.to, END);
console.log('✓ OFFLINE=1 with a cache entry from another day: served from cache, real date range reported.');

// Fixture in the compact committed format, built from the same rows.
const fixtureSite = compactPowerResponse(toPowerResponse(makeWindowRows()), talanda.lat, talanda.lon);
const fixtureFile: CompactPowerFixture = { version: 1, parameters: [...POWER_PARAMETERS], generatedAt: '2026-01-02T03:04:05.000Z', sites: { talanda: fixtureSite } };
await fs.writeFile(fixturePath, JSON.stringify(fixtureFile));
const emptyCacheDir = path.join(scratch, 'empty-cache');
const fixtureSummary = await getPowerClimate(talanda, { cacheDir: emptyCacheDir, fixturePath, now: laterNow, fetchImpl: offlineFetch });
assert.equal(fixtureSummary.dataSource, 'fixture', 'empty cache falls through to the fixture');
assert.equal(fixtureSummary.fetchedAt, fixtureFile.generatedAt);
assert.equal(fixtureSummary.dataDateRange.to, END);
assert.equal(fixtureSummary.indicators.rainfall.totalMm, offlineSummary.indicators.rainfall.totalMm, 'fixture and cache give the same indicators');
const cachePreferred = await getPowerClimate(talanda, { cacheDir, fixturePath, now: fixedNow, fetchImpl: offlineFetch });
assert.equal(cachePreferred.dataSource, 'cache', 'a cache entry wins over the fixture');
console.log('✓ OFFLINE=1 with an empty cache: served from the fixture; cache is preferred when both exist.');

await assert.rejects(getPowerClimate(talanda, { cacheDir: emptyCacheDir, fixturePath: path.join(scratch, 'absent-fixture.json'), now: fixedNow, fetchImpl: offlineFetch }),
  (error: any) => error instanceof ApiError && error.status === 404 && /OFFLINE=1/.test(error.message) && /talanda/.test(error.message));
await assert.rejects(getPowerClimate({ ...talanda, id: 'atlantis' }, { cacheDir, fixturePath, now: fixedNow, fetchImpl: offlineFetch }),
  (error: any) => error instanceof ApiError && error.status === 404 && /atlantis/.test(error.message), 'a site with no cache and no fixture entry is a clear error');
await assert.rejects(managerClimate(req(`Bearer ${unknownSiteToken}`), { verify, power: { cacheDir, fixturePath, now: fixedNow, fetchImpl: offlineFetch } }),
  (error: any) => error instanceof ApiError && error.status === 403 && /not configured/.test(error.message), 'an unknown manager site is refused');
assert.equal(requestCount, requestsBefore, 'OFFLINE=1 never calls fetch');
console.log('✓ OFFLINE=1: no cache and no fixture, or an unknown site, gives a clear error; fetch was never called.');

// The committed fixture: all sites, only the 8 parameters, 2 decimals, -999 for missing, small.
const realFixturePath = path.resolve('services/api/fixtures/power-climate-fixture.json');
const realText = await fs.readFile(realFixturePath, 'utf8');
assert.ok(realText.length < 2_000_000, `fixture is ${realText.length} bytes`);
const realFixture: CompactPowerFixture = JSON.parse(realText);
assert.deepEqual(realFixture.parameters, [...POWER_PARAMETERS]);
const offlineAtOctober = await getPowerClimate(MANAGER_SITES.talanda, { cacheDir: emptyCacheDir, fixturePath: realFixturePath, now: new Date('2026-10-06T12:00:00.000Z'), fetchImpl: offlineFetch });
const offlineAtNovember = await getPowerClimate(MANAGER_SITES.talanda, { cacheDir: emptyCacheDir, fixturePath: realFixturePath, now: new Date('2026-11-13T12:00:00.000Z'), fetchImpl: offlineFetch });
assert.deepEqual(offlineAtOctober.indicators, offlineAtNovember.indicators, 'OFFLINE=1 fixture indicators do not depend on today\'s date');
assert.deepEqual(offlineAtOctober.last30Days, offlineAtNovember.last30Days, 'OFFLINE=1 fixture window follows the data served');
const siteIds = [...new Set(Object.values(MANAGER_SITES).map(site => site.id))];
assert.deepEqual(Object.keys(realFixture.sites).sort(), [...siteIds].sort(), 'the fixture covers every site in sites.ts');
for (const site of Object.values(MANAGER_SITES)) {
  const entry = realFixture.sites[site.id];
  assert.equal(entry.lat, site.lat);
  assert.equal(entry.lon, site.lon);
  assert.deepEqual(Object.keys(entry.values), [...POWER_PARAMETERS]);
  const days = Math.round((Date.parse(entry.to) - Date.parse(entry.from)) / DAY) + 1;
  assert.ok(days > 365 * 10, `${site.id} has about 11 years of days`);
  for (const series of Object.values(entry.values)) {
    assert.equal(series.length, days);
    assert.ok(series.every(value => Number.isFinite(value) && (value === -999 || Math.round(value * 100) / 100 === value)));
  }
  const served = await getPowerClimate(site, { cacheDir: emptyCacheDir, now: laterNow, fetchImpl: offlineFetch });
  assert.equal(served.dataSource, 'fixture', `${site.id} is served from the committed fixture`);
  assert.equal(served.dataDateRange.to, served.last30Days.to);
  assert.notEqual(served.indicators.rainfall.value, null, `${site.id} has a rainfall total`);
}
// Offline, an area with no cache and no fixture: a clear error for that area only; the manager's own area still works.
const seenBefore = seen.length;
await assert.rejects(managerClimate(reqFor('?area=ADM3_Tanore'), { verify, power: { cacheDir: path.join(scratch, 'none'), fixturePath: path.join(scratch, 'none.json'), now: fixedNow, fetchImpl: offlineFetch } }),
  (error: any) => error instanceof ApiError && error.status === 404 && /ADM3_Tanore|talanda/.test(error.message));
const offlineChuadanga = await managerClimate(reqFor('?area=ADM3_ChuadangaSadar'), { verify, power: { cacheDir: areaCache, fixturePath, now: fixedNow, fetchImpl: offlineFetch } });
assert.equal(offlineChuadanga.dataSource, 'cache');
assert.equal(offlineChuadanga.offline, true, 'the response says OFFLINE=1 is on');
await assert.rejects(managerClimate(reqFor('?area=ADM3_Abhaynagar'), { verify, power: { cacheDir: areaCache, fixturePath, now: fixedNow, fetchImpl: offlineFetch } }),
  (error: any) => error instanceof ApiError && error.status === 404 && /OFFLINE=1/.test(error.message), 'an area never downloaded has no offline data');
assert.equal(seen.length, seenBefore, 'offline area requests never download');
assert.equal(requestCount, requestsBefore, 'OFFLINE=1 never calls fetch');
delete process.env.OFFLINE;
await fs.rm(scratch, { recursive: true, force: true });
console.log('✓ Committed fixture: every site, 8 parameters, 2 decimals, under 2 MB, serves OFFLINE=1 with no network.\n');

console.log('========================================================');
console.log('  ALL NASA POWER CLIMATE TESTS PASSED                   ');
console.log('========================================================\n');
