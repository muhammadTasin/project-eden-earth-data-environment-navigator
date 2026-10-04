/**
 * Automated Test Suite for Cattle AOI & Advisory Pipeline.
 */
import assert from 'node:assert/strict';
import { createFarmAoi, validateAoiGeometry } from './services/api/src/cattle/aoi.ts';
import { LocalFileCattleRepository } from './services/api/src/cattle/repository.ts';
import { calculateCattleThi, classifyThiStress, generateCattleAdvisory } from './services/api/src/cattle/advisory.ts';
import { getEarthEngineReadiness, clearEarthEngineReadinessCache, mapWorkerResult, extractEarthEngineFeatures } from './services/api/src/cattle/adapters/earth_engine.ts';
import { getNasaWeather, clearNasaCache } from './services/api/src/weather.ts';
import { getOpenMeteoForecast, clearOpenMeteoCache } from './services/api/src/open_meteo_weather.ts';
import { ApiError } from './services/api/src/errors.ts';
import { getLocationsPayload, nearestLocation } from './services/api/src/locations.ts';
import { triggerModelTraining } from './services/api/src/cattle/ml_pipeline.ts';
import { compileFeaturesForAoi } from './services/api/src/cattle/features.ts';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

console.log('========================================================');
console.log('  CATTLE AOI & ADVISORY PIPELINE TEST SUITE             ');
console.log('========================================================\n');

// ---------------------------------------------------------------------------
// TEST 1: AOI Geometry & Boundary Validation
// ---------------------------------------------------------------------------
console.log('[TEST 1] Testing AOI Geometry Validation and Bangladesh Bounds...');

// Valid Polygon in Tanore, Rajshahi
const validCoords = [
  [
    [88.5810, 24.5150],
    [88.5845, 24.5150],
    [88.5845, 24.5185],
    [88.5810, 24.5185],
    [88.5810, 24.5150],
  ],
];
const validGeom = { type: 'Polygon', coordinates: validCoords };
const validRes = validateAoiGeometry(validGeom);
assert.equal(validRes.valid, true, 'Valid polygon should pass');
assert.ok((validRes.areaSquareMeters || 0) > 1000, 'Area should be calculated and > 1000 m²');
assert.ok(validRes.centroid, 'Centroid should be calculated');

// Out of bounds coordinate (e.g. outside Bangladesh: lat 35.0, lon 75.0)
const outOfBoundsGeom = {
  type: 'Polygon',
  coordinates: [
    [
      [75.0, 35.0],
      [75.1, 35.0],
      [75.1, 35.1],
      [75.0, 35.1],
      [75.0, 35.0],
    ],
  ],
};
const oobRes = validateAoiGeometry(outOfBoundsGeom);
assert.equal(oobRes.valid, false, 'Out-of-bounds polygon must fail');
assert.match(oobRes.error || '', /outside Bangladesh bounds/, 'Should give clear bounds error message');

// Unclosed ring
const unclosedGeom = {
  type: 'Polygon',
  coordinates: [
    [
      [88.5810, 24.5150],
      [88.5845, 24.5150],
      [88.5845, 24.5185],
      [88.5810, 24.5185],
    ],
  ],
};
const unclosedRes = validateAoiGeometry(unclosedGeom);
assert.equal(unclosedRes.valid, false, 'Unclosed ring must fail');
assert.match(unclosedRes.error || '', /not closed/, 'Should state polygon ring is not closed');

// createFarmAoi factory
const farm = createFarmAoi({
  farmLabel: 'তালন্দ ডেইরি টেস্ট খামার',
  ownerName: 'মো. রফিকুল ইসলাম',
  geometry: validGeom,
  source: 'map_draw',
});
assert.ok(farm.aoiId.startsWith('aoi_'), 'Farm AOI ID should have aoi_ prefix');
assert.equal(farm.crs, 'EPSG:4326');
assert.ok(farm.areaHectares > 0, 'Area in hectares must be positive');
assert.ok(farm.areaAcres > 0, 'Area in acres must be positive');
assert.ok(farm.district?.includes('Rajshahi'), `Farm near Tanore should map to Rajshahi district, got ${farm.district}`);
assert.ok(farm.nearestUpazilaDistanceKm! < 20, 'nearest reference point is close, and its distance is recorded');

// Self-intersecting (bow-tie) ring and holes are rejected
const bowTie = validateAoiGeometry({ type: 'Polygon', coordinates: [[[88.58, 24.51], [88.59, 24.52], [88.59, 24.51], [88.58, 24.52], [88.58, 24.51]]] });
assert.equal(bowTie.valid, false);
assert.match(bowTie.error || '', /crosses itself/);
const withHole = validateAoiGeometry({ type: 'Polygon', coordinates: [validCoords[0], [[88.582, 24.516], [88.583, 24.516], [88.583, 24.517], [88.582, 24.516]]] });
assert.equal(withHole.valid, false);
assert.match(withHole.error || '', /holes/);
assert.throws(() => createFarmAoi({ farmLabel: 'x', geometry: outOfBoundsGeom }), (e: any) => e instanceof ApiError && e.code === 'invalid_input');

// nearest upazila comes from the full locations dataset and records its distance
const dhakaNearest = nearestLocation(23.81, 90.41);
assert.ok(dhakaNearest.distanceKm < 40, 'nearest reference point for Dhaka must be near Dhaka');
assert.ok(farm.nearestUpazilaDistanceKm !== undefined, 'distance to the reference point is stored');
const loc = getLocationsPayload();
assert.equal(loc.districtCount, 64);
assert.ok(loc.upazilaCount >= 495);

console.log('✓ TEST 1 PASSED: AOI Geometry & Bangladesh bounds strictly verified.\n');

// ---------------------------------------------------------------------------
// TEST 2: Local Repository Isolation and Persistence
// ---------------------------------------------------------------------------
console.log('[TEST 2] Testing Repository Persistence & Cross-AOI Isolation...');
const tmpStorePath = path.join(os.tmpdir(), `cattle_test_store_${Date.now()}.json`);
const testRepo = new LocalFileCattleRepository(tmpStorePath);

// Save AOI
await testRepo.saveAoi(farm);
const fetchedAoi = await testRepo.getAoi(farm.aoiId);
assert.equal(fetchedAoi?.aoiId, farm.aoiId);
assert.equal(fetchedAoi?.farmLabel, farm.farmLabel);

// Features partitioned by AOI
const testFeature = {
  aoiId: farm.aoiId,
  dataset: 'MODIS/061/MOD13A1',
  band: 'NDVI',
  observationInterval: '2026-09-01/2026-09-16',
  units: 'index',
  pixelSizeMeters: 500,
  aggregationMethod: 'mean' as const,
  validPixelCoveragePct: 100,
  qualityState: 'GOOD' as const,
  fetchedAt: new Date().toISOString(),
  sourceVersion: '061',
  value: 0.65,
  isRegionalProxy: false,
};
await testRepo.saveFeatures(farm.aoiId, [testFeature]);

const farmFeatures = await testRepo.getFeatures(farm.aoiId);
assert.equal(farmFeatures.length, 1);
assert.equal(farmFeatures[0].value, 0.65);

// Ensure other AOIs get zero features (no leakage)
const otherFeatures = await testRepo.getFeatures('aoi_other_non_existent');
assert.equal(otherFeatures.length, 0, 'Features must never leak across different AOIs');

// No fabricated seed farm unless SEED_DEMO_DATA=true
assert.equal((await new LocalFileCattleRepository(path.join(os.tmpdir(), `cattle_seed_${Date.now()}.json`)).listAois()).length, 0, 'no seeded farm by default');

// Deleting an AOI removes its jobs
await testRepo.saveJob({ jobId: 'job_x', aoiId: farm.aoiId, jobType: 'pipeline_refresh', status: 'failed', progressPct: 100, stageMessage: '', stageMessageBangla: '', errors: [], missing: [], attempts: 1, maxAttempts: 3, queuedAt: new Date().toISOString() });
await testRepo.deleteAoi(farm.aoiId);
assert.equal((await testRepo.listJobs(farm.aoiId)).length, 0, 'jobs of a deleted AOI are removed');

// A corrupt store is moved aside, never overwritten
const corruptPath = path.join(os.tmpdir(), `cattle_corrupt_${Date.now()}.json`);
fs.writeFileSync(corruptPath, '{ this is not json');
const corruptRepo = new LocalFileCattleRepository(corruptPath);
assert.equal((await corruptRepo.listAois()).length, 0);
assert.ok(corruptRepo.loadError, 'load error is surfaced');
assert.ok(fs.readdirSync(os.tmpdir()).some(f => f.startsWith(path.basename(corruptPath) + '.corrupt.')), 'corrupt file was preserved');

// Cleanup tmp file
if (fs.existsSync(tmpStorePath)) fs.unlinkSync(tmpStorePath);

console.log('✓ TEST 2 PASSED: Repository isolation and persistence verified.\n');

// ---------------------------------------------------------------------------
// TEST 3: Cattle THI Calculation & NRC (1971) Stress Benchmarks
// ---------------------------------------------------------------------------
console.log('[TEST 3] Testing Cattle THI (NRC 1971) and Stress Categories...');

// Benchmark 1: Comfortable temperature (25°C, 50% RH) -> THI ~ 71.8 (Normal, < 72)
const thi1 = calculateCattleThi(25, 50);
assert.equal(thi1, 71.8);
assert.equal(classifyThiStress(thi1), 'normal');

// Benchmark 2: Mild heat stress (28°C, 65% RH) -> THI ~ 77.7 (Alert, 72 <= THI < 79)
const thi2 = calculateCattleThi(28, 65);
assert.equal(thi2, 77.7);
assert.equal(classifyThiStress(thi2), 'alert');

// Benchmark 3: Danger / Moderate stress (30°C, 60% RH) -> THI ~ 79.8 (Danger, 79 <= THI < 84)
const thi3 = calculateCattleThi(30, 60);
assert.equal(thi3, 79.8);
assert.equal(classifyThiStress(thi3), 'danger');

// Benchmark 4: Emergency / Severe stress (32°C, 70% RH) -> THI ~ 84.4 (Emergency, >= 84)
const thi4 = calculateCattleThi(32, 70);
assert.equal(thi4, 84.4);
assert.equal(classifyThiStress(thi4), 'emergency');

console.log('✓ TEST 3 PASSED: NRC (1971) THI formulas and veterinary thresholds verified.\n');

// ---------------------------------------------------------------------------
// TEST 4: Advisory generation uses hourly humidity and carries no unsupported claims
// ---------------------------------------------------------------------------
console.log('[TEST 4] Testing Advisory Generation, hourly humidity THI and evidence separation...');

// Provider times are zone-naive local strings; Dhaka is UTC+6. "now" is fixed so the next-24-hour window is deterministic.
const nowMs = Date.parse('2026-10-04T08:20:00Z'); // 14:20 local
const localHours = Array.from({ length: 48 }, (_, i) => {
  const t = new Date(Date.parse('2026-10-04T00:00:00Z') + i * 3600000).toISOString().slice(0, 16);
  const hour = i % 24;
  return {
    time: t,
    temperatureC: hour >= 11 && hour <= 16 ? 34 : 25,
    relativeHumidityPct: hour >= 11 && hour <= 16 ? 55 : 92, // humid at night, drier at midday
    precipitationProbabilityPct: 0, precipitationMm: 0, rainMm: 0, weatherCode: 0,
  };
});
localHours[30] = { ...localHours[30], relativeHumidityPct: null as any }; // one hour with missing humidity
const nowIso = new Date(nowMs).toISOString();
const weatherInput: any = {
  aoiId: farm.aoiId, centroid: farm.centroid, pointType: 'aoi_centroid', fetchedAt: nowIso,
  nasaUnavailableReason: 'NASA POWER unavailable (test)', nasaAgroclimatology: null,
  openMeteoForecast: {
    provider: 'Open-Meteo', fetchedAt: nowIso, timezone: 'Asia/Dhaka', utcOffsetSeconds: 21600,
    source: { provider: 'Open-Meteo', kind: 'model_estimate', live: true, fetchedAt: nowIso, validAt: '2026-10-04T14:00', note: 'x' },
    modelNoticeBangla: '', modelNoticeEnglish: '',
    current: { time: '2026-10-04T14:00', temperatureC: 31, apparentTemperatureC: 36, relativeHumidityPct: 68, precipitationMm: 0, rainMm: 0, windSpeedMs: 2.5, windDirectionDeg: 180, weatherCode: 1 },
    hourly: localHours, daily: [],
  },
};
const dummyFeatures = compileFeaturesForAoi(farm, weatherInput, [], nowMs);
assert.equal(dummyFeatures.forecastHourly[0].time, '2026-10-04T14:00', 'hourly window starts at the current local hour, not at midnight');
assert.ok(dummyFeatures.forecastHourly.length <= 24 && dummyFeatures.hoursMissingInputs === 1, 'the hour with missing humidity is excluded and counted, not filled in');
assert.ok(dummyFeatures.forecastHourly.every(h => h.relativeHumidityPct === 55 || h.relativeHumidityPct === 92), 'each hour keeps its own humidity');

const adv = generateCattleAdvisory(farm, dummyFeatures, [], { unavailable: [], reason: 'Earth Engine not configured' });
assert.ok(adv.derived.thi.current > 80, 'At 31°C and 68% RH, THI should be in the danger zone');
const noon = adv.derived.thi.hourly.find(h => h.time.endsWith('T14:00'))!;
const night = adv.derived.thi.hourly.find(h => h.time.endsWith('T22:00'))!;
assert.equal(noon.thi, calculateCattleThi(34, 55));
assert.equal(night.thi, calculateCattleThi(25, 92));
assert.notEqual(noon.thi, calculateCattleThi(34, 68), 'hourly THI must not reuse the current humidity');
assert.ok(adv.derived.thi.lowestThiHours && adv.derived.thi.lowestThiHours.length > 0, 'lowest-THI hours are derived from the hourly curve');
assert.equal(adv.measured.nasaPower && 'status' in adv.measured.nasaPower ? adv.measured.nasaPower.status : '', 'unavailable', 'unavailable NASA data is reported, not defaulted');
assert.equal(adv.measured.satellite.status, 'unavailable');
assert.equal(adv.forageStatus.ndviProxy, null);
assert.equal(adv.forageStatus.forageAvailable, 'unavailable');

// Evidence kinds are separated and no unsupported numeric claims remain
assert.equal(adv.measured.kind, 'measured'); assert.equal(adv.derived.kind, 'derived'); assert.equal(adv.heuristic.kind, 'heuristic');
const advJson = JSON.stringify(adv);
for (const banned of ['estimatedIncreasePct', '১০-২০%', '+25%', '+50%', '06:00 – 09:00', 'peer-reviewed']) {
  assert.ok(!advJson.includes(banned), `advisory must not contain unsupported claim: ${banned}`);
}

assert.equal(adv.modelStatus.supervisedModelAvailable, false);
assert.equal(adv.modelStatus.modelRegistryStatus, 'training_data_unavailable');
assert.equal(adv.modelStatus.unavailablePredictions.length, 2);
assert.match(adv.forageStatus.disclaimerEnglish, /not edible forage or biomass/);

console.log('✓ TEST 4 PASSED: hourly-humidity THI, evidence separation and unavailable gates verified.\n');

// ---------------------------------------------------------------------------
// TEST 5: Model Training Trigger & Ground-Truth Gate
// ---------------------------------------------------------------------------
console.log('[TEST 5] Testing Model Training Trigger & Data Gate...');
const trainRes = await triggerModelTraining('heat_stress_panting', farm);
assert.equal(trainRes.success, false);
assert.equal(trainRes.status, 'training_data_unavailable');
assert.equal(trainRes.sampleCount, 0);
assert.match(trainRes.message, /Training paused/);

console.log('✓ TEST 5 PASSED: Model training zero-fabrication gate verified.\n');

// ---------------------------------------------------------------------------
// TEST 6: Earth Engine adapter - honest statuses, no null-as-success
// ---------------------------------------------------------------------------
console.log('[TEST 6] Testing Earth Engine adapter statuses...');

// A missing interpreter is reported as configuration_required
process.env.EE_PYTHON = '/nonexistent/python3';
clearEarthEngineReadinessCache();
const eeMissing = await getEarthEngineReadiness(true);
assert.equal(eeMissing.status, 'configuration_required');
const eeExtract = await extractEarthEngineFeatures(farm);
assert.equal(eeExtract.success, false);
assert.equal(eeExtract.status, 'configuration_required');
assert.equal(eeExtract.features.length, 0, 'no features (and no null values) when Earth Engine is not configured');
delete process.env.EE_PYTHON;
clearEarthEngineReadinessCache();

// Mapping of worker output: only real values with real coverage become features
const bigFarm = { ...farm, areaHectares: 30000 }; // larger than one 11 km pixel
const mapped = mapWorkerResult(bigFarm, {
  status: 'success',
  datasets: [
    { key: 'MODIS_NDVI', status: 'ok', dataset: 'MODIS/061/MOD13A1', band: 'NDVI', units: 'index', pixelSizeMeters: 500, sourceVersion: '061', value: 0.61, validPixelCoveragePct: 92.5, aggregationMethod: 'mean', observationDate: '2026-09-28' },
    { key: 'SMAP_ROOTZONE', status: 'no_data', dataset: 'NASA/SMAP/SPL4SMGP/008', reason: 'masked over this AOI' },
    { key: 'IMERG_RAIN_30D', status: 'ok', dataset: 'NASA/GPM_L3/IMERG_V07', band: 'precipitation', units: 'mm (30-day total)', pixelSizeMeters: 11132, value: Number.NaN, validPixelCoveragePct: 100 },
  ],
});
assert.equal(mapped.status, 'partial');
assert.equal(mapped.features.length, 1, 'NaN and no_data datasets are not turned into features');
assert.equal(mapped.features[0].validPixelCoveragePct, 92.5, 'coverage comes from the worker, not a constant');
assert.equal(mapped.features[0].value, 0.61);
assert.equal(mapped.features[0].isRegionalProxy, false);
assert.equal(mapped.unavailable.length, 2);
assert.equal(mapWorkerResult(farm, { status: 'success', datasets: [] }).success, false, 'empty worker output is not a success');
assert.equal(mapWorkerResult(farm, { status: 'error', message: 'boom' }).status, 'failed');
const smallFarmMapped = mapWorkerResult(farm, { status: 'success', datasets: [{ key: 'MODIS_NDVI', status: 'ok', dataset: 'MODIS/061/MOD13A1', band: 'NDVI', units: 'index', pixelSizeMeters: 500, value: 0.4, validPixelCoveragePct: 100, observationDate: '2026-09-28' }] });
assert.equal(smallFarmMapped.features[0].isRegionalProxy, true, 'a farm smaller than one pixel is flagged as a regional proxy');

console.log('✓ TEST 6 PASSED: Earth Engine adapter reports configuration_required / partial honestly.\n');

// ---------------------------------------------------------------------------
// TEST 7: Weather services - per-location caching, no fabricated fallbacks (fetch is stubbed, no network)
// ---------------------------------------------------------------------------
console.log('[TEST 7] Testing weather caching, missing values and failure behaviour...');
const realFetch = globalThis.fetch;
const calls: string[] = [];
function stubNasa(url: string) {
  calls.push(url);
  const u = new URL(url);
  const lat = Number(u.searchParams.get('latitude'));
  const days = ['20260927', '20260928', '20260929'];
  const mk = (f: (d: string, i: number) => number) => Object.fromEntries(days.map((d, i) => [d, f(d, i)]));
  return new Response(JSON.stringify({ properties: { parameter: {
    T2M: mk((_, i) => lat + i), T2M_MAX: mk(() => lat + 5), T2M_MIN: mk(() => lat - 5),
    RH2M: mk((_, i) => (i === 1 ? -999 : 80)), PRECTOTCORR: mk((_, i) => (i === 2 ? -999 : 1.5)), WS2M: mk(() => 2),
  } } }), { status: 200 });
}
globalThis.fetch = (async (input: any) => stubNasa(String(input))) as any;
clearNasaCache();
const nasa1 = await getNasaWeather(23.5, 90.1);
const nasa2 = await getNasaWeather(24.5, 88.5);
const nasa1again = await getNasaWeather(23.5, 90.1);
assert.equal(calls.length, 2, 'repeat request for the same location hits the cache, a different location does not');
assert.equal(nasa1.location.lat, 23.5); assert.equal(nasa2.location.lat, 24.5);
assert.notEqual(nasa1.latest.t2m, nasa2.latest.t2m, 'one location must never get another location\'s cached data');
assert.equal(nasa1again.latest.t2m, nasa1.latest.t2m);
assert.equal(nasa1.recentDays[1].rh2m, null, 'NASA fill value -999 becomes null, not a default humidity');
assert.equal(nasa1.recentDays[2].rainMm, null, 'missing rain stays null');
assert.equal(nasa1.rainDaysWithData, 2);
assert.equal(nasa1.rainWindowMm, 3);
assert.equal(nasa1.isLive, false); assert.equal(nasa1.source.kind, 'satellite_delayed'); assert.equal(nasa1.source.live, false);
assert.equal(nasa1.soilMoisture.status, 'unavailable');

globalThis.fetch = (async () => new Response('boom', { status: 500 })) as any;
clearNasaCache();
await assert.rejects(getNasaWeather(21.5, 91.5), (e: any) => e instanceof ApiError && e.code === 'provider_unavailable', 'provider failure is an error, never baseline data');

// Open-Meteo: hourly humidity is requested and parsed; missing values stay null; cache is per location
const omCalls: string[] = [];
globalThis.fetch = (async (input: any) => {
  const url = String(input); omCalls.push(url);
  const lat = Number(new URL(url).searchParams.get('latitude'));
  return new Response(JSON.stringify({
    timezone: 'Asia/Dhaka', utc_offset_seconds: 21600,
    current: { time: '2026-10-04T14:00', temperature_2m: lat, relative_humidity_2m: 60 },
    hourly: { time: ['2026-10-04T14:00', '2026-10-04T15:00'], temperature_2m: [lat, null], relative_humidity_2m: [61, 70], precipitation_probability: [0, 0], precipitation: [0, 0], rain: [0, 0], weather_code: [1, 1] },
    daily: { time: ['2026-10-04'], weather_code: [1] },
  }), { status: 200 });
}) as any;
clearOpenMeteoCache();
const om1 = await getOpenMeteoForecast(23, 90);
const om2 = await getOpenMeteoForecast(24, 90);
assert.ok(omCalls[0].includes('relative_humidity_2m') && new URL(omCalls[0]).searchParams.get('hourly')!.includes('relative_humidity_2m'), 'hourly humidity is requested');
assert.equal(om1.current.temperatureC, 23); assert.equal(om2.current.temperatureC, 24, 'forecast cache is per location');
assert.equal(om1.hourly[0].relativeHumidityPct, 61);
assert.equal(om1.hourly[1].temperatureC, null, 'missing hourly temperature stays null');
assert.equal(om1.current.apparentTemperatureC, null, 'missing apparent temperature stays null (not 0)');
assert.equal(om1.current.windSpeedMs, null);
assert.equal(om1.source.kind, 'model_estimate');
process.env.OPEN_METEO_API_KEY = 'test-key'; clearOpenMeteoCache();
await getOpenMeteoForecast(25, 90);
assert.ok(omCalls[omCalls.length - 1].startsWith('https://customer-api.open-meteo.com/'), 'API key switches to the customer host');
delete process.env.OPEN_METEO_API_KEY;
globalThis.fetch = (async () => { throw new Error('network down'); }) as any;
clearOpenMeteoCache();
await assert.rejects(getOpenMeteoForecast(22, 90), (e: any) => e instanceof ApiError && e.code === 'provider_unavailable');
globalThis.fetch = realFetch;

console.log('✓ TEST 7 PASSED: weather caching is per location, missing values stay null, failures are explicit.\n');

console.log('========================================================');
console.log('  ALL CATTLE AUTOMATED TESTS PASSED SUCCESSFULLY!       ');
console.log('========================================================\n');
