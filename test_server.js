import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = process.env.TEST_PORT || '4317';
const BASE = `http://localhost:${PORT}`;
// The officer desk writes to a throwaway store so tests never touch the demo data
const STORE = path.join(os.tmpdir(), `eden-officer-test-${process.pid}.json`);
const CATTLE_STORE = path.join(os.tmpdir(), `eden-cattle-test-${process.pid}.json`);
// The demo officer login exists only with DEMO_MODE=true and a code; the tests make up a fresh code every run
const OFFICER_CODE = crypto.randomBytes(12).toString('hex');
// A stand-in for the Supabase Auth server (GET /auth/v1/user), so the manager routes can be tested over HTTP without a project:
// 'mgr-token' is a manager, 'viewer-token' a signed-in user whose app_metadata.role is not manager, anything else is invalid.
const FAKE_USERS = {
  'mgr-token': { id: 'u-manager', email: 'sentry@example.test', app_metadata: { role: 'manager', site: 'talanda' }, user_metadata: {} },
  // JWT-shaped tokens (three parts) for the site-scoped routes: a manager of talanda, a manager of another site, a manager with no site
  'h.talanda.s': { id: 'u-talanda', email: 'sentry@example.test', app_metadata: { role: 'manager', site: 'talanda' }, user_metadata: {} },
  'h.other.s': { id: 'u-other', email: 'other@example.test', app_metadata: { role: 'manager', site: 'sun_dharmapasha' }, user_metadata: { site: 'talanda' } },
  'h.upper.s': { id: 'u-upper', email: 'upper@example.test', app_metadata: { role: 'manager', site: 'Talanda' }, user_metadata: {} },
  'h.alias.s': { id: 'u-alias', email: 'alias@example.test', app_metadata: { role: 'manager', site: ' tanore ' }, user_metadata: {} },
  'h.viewer.s': { id: 'u-viewer2', email: 'viewer2@example.test', app_metadata: { role: 'viewer', site: 'talanda' }, user_metadata: { role: 'manager' } },
  'h.nosite.s': { id: 'u-nosite', email: 'nosite@example.test', app_metadata: { role: 'manager' }, user_metadata: { site: 'talanda' } },
  'viewer-token': { id: 'u-viewer', email: 'viewer@example.test', app_metadata: { role: 'viewer' }, user_metadata: { role: 'manager' } },
};
const fakeSupabase = http.createServer((req, res) => {
  const user = FAKE_USERS[(req.headers.authorization || '').replace(/^Bearer\s+/i, '')];
  res.writeHead(user ? 200 : 401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(user ?? { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' }));
});
await new Promise((resolve) => fakeSupabase.listen(0, '127.0.0.1', resolve));
const FAKE_SUPABASE_URL = `http://127.0.0.1:${fakeSupabase.address().port}`;
// Made-up credentials for the data-sources test: none of these strings may ever appear in an API response
const FAKE_SECRETS = {
  EARTHDATA_USERNAME: 'fake-edl-user-7q1', EARTHDATA_PASSWORD: 'fake-edl-pass-7q2', EARTHDATA_TOKEN: 'fake-edl-token-7q3',
  NASA_API_KEY: 'fake-nasa-key-7q4', ADS_API_TOKEN: 'fake-ads-token-7q5', FIRMS_MAP_KEY: 'fake-firms-key-7q6',
};
const serverProc = spawn('node', ['--experimental-strip-types', 'services/api/src/server.ts'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  // tests never place a real call, never reach an LLM or TTS service, and read a fixed day of NASA conditions
  // (the daily update rewrites the live file)
  env: { ...process.env, PORT, DEMO_MODE: 'true', EDEN_OFFICER_CODE: OFFICER_CODE, SUPABASE_URL: FAKE_SUPABASE_URL, SUPABASE_ANON_KEY: 'fake-anon-key', ...FAKE_SECRETS, OFFLINE: '1', EDEN_OFFICER_STORE: STORE, CATTLE_STORE_PATH: CATTLE_STORE, SEED_DEMO_DATA: 'false', LLM_BASE_URL: '', TTS_BASE_URL: '',
    API_WRITE_TOKEN: '', AWAJ_LIVE: '0', EDEN_LIVE_FILE: path.resolve('tests/fixtures/live_conditions_2026-10-01.json') },
});

serverProc.stdout.on('data', (d) => process.stdout.write(d));
serverProc.stderr.on('data', (d) => process.stderr.write(d));

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE}/api/v1/overview`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server did not start within 5 seconds');
}

async function run() {
  await waitForServer();
  console.log('\n--- TESTING HTTP ENDPOINTS ---');

  // 1. GET /api/v1/overview
  console.log('Testing GET /api/v1/overview ...');
  const resOverview = await fetch(`${BASE}/api/v1/overview`);
  const dataOverview = await resOverview.json();
  check(resOverview.status === 200, 'overview status');
  check(dataOverview.local_satellite_conditions.smap?.date, 'overview has a dated SMAP value');
  const warnings = dataOverview.early_warnings;
  check(warnings?.haor?.skill?.length && warnings.cattleHeat?.months?.length === 12 && warnings.warmNights?.dhan71, 'overview carries the early warnings');
  const haor = await (await fetch(`${BASE}/api/v1/haor/flash-flood`)).json();
  check(haor.seasons.length === 25 && haor.status?.state, 'the haor endpoint serves the 25-season hindcast and the current status');
  check(haor.live?.upstream?.length === 4 && haor.live.upstream[0].calibrated && haor.live.date, 'the haor endpoint carries the live upstream reading');
  console.log('✓ Overview status:', resOverview.status, 'Union:', dataOverview.scope.union, 'SMAP', dataOverview.local_satellite_conditions.smap.rootZoneM3M3, 'on', dataOverview.local_satellite_conditions.smap.date);

  // Daily NASA update: every upazila, with dated sources
  const live = await (await fetch(`${BASE}/api/v1/live/status`)).json();
  check(live.upazilas === 544 && live.districts === 64 && live.sources.find(s => s.id === 'power')?.latestDate, 'the daily NASA update covers all 544 upazilas');
  const tanoreLive = await (await fetch(`${BASE}/api/v1/live/upazila?name=Tanore`)).json();
  check(tanoreLive.district === 'Rajshahi' && typeof tanoreLive.power.soilRoot === 'number', 'an upazila carries its NASA POWER conditions');
  const nearLive = await (await fetch(`${BASE}/api/v1/live/upazila?lat=24.62&lon=88.56`)).json();
  check(nearLive.name === 'Tanore', `the nearest upazila to the Tanore pilot point is Tanore (got ${nearLive.name})`);
  console.log('✓ Daily NASA update:', live.upazilas, 'upazilas; POWER', live.sources[0].latestDate, '; IMERG', live.sources[1].latestDate || 'not set');

  // Any upazila: the places list, advice from its district's replay, and the overview for it
  const places = await (await fetch(`${BASE}/api/v1/places`)).json();
  check(places.upazilas.length === 544, `every upazila is listed (got ${places.upazilas.length})`);
  const godagari = await (await fetch(`${BASE}/api/v1/advice`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unionId: 'ADM3_Godagari' }) })).json();
  check(godagari.options?.length === 5 && godagari.scope.union_id === 'ADM3_Godagari', 'an upazila outside the pilot gets ranked rotations');
  // no SRDI soil card outside the pilot: the calendar stays, but no fertilizer amount and the plain message instead
  const NO_CARD_BN = 'এই এলাকার মাটির কার্ড (SRDI) যোগ করা হয়নি, সার-পরামর্শ দেওয়া যাচ্ছে না';
  check(godagari.farmer_card.season2.fertilizerBangla === NO_CARD_BN, 'the farmer card carries the no-soil-card message instead of doses');
  check(godagari.options.every(o => o.ledger.ureaKgHa === null && o.dimensionDetails.soil.metrics.rotationUreaKgHa === null && o.timeline.length > 0), 'no urea numbers outside the pilot, calendar kept');
  check(!/ureaKgHa":\s*[0-9]|tspKgHa":\s*[0-9]|mopKgHa":\s*[0-9]/.test(JSON.stringify(godagari)), 'no fertilizer dose number anywhere in the advice JSON');
  const talandaAdvice = await (await fetch(`${BASE}/api/v1/advice`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unionId: 'talanda_tanore' }) })).json();
  check(talandaAdvice.options.every(o => typeof o.ledger.ureaKgHa === 'number') && !talandaAdvice.farmer_card.season2.fertilizerBangla.includes(NO_CARD_BN), 'the pilot still has its fertilizer numbers');
  const sylhetId = places.upazilas.find(u => u.district === 'Sylhet').id;
  const sylhet = await (await fetch(`${BASE}/api/v1/overview?place=${sylhetId}`)).json();
  check(sylhet.scope.district === 'Sylhet' && sylhet.aman_replay.length >= 5, 'the overview follows the chosen place');
  console.log('✓ Any upazila:', places.upazilas.length, 'places; Godagari top:', godagari.options[0].nameEnglish, '; Sylhet overview district:', sylhet.scope.district);

  // The farmer's own crops: the menu for a place, a spoken request answered, and the phone call (dry run)
  const menu = await (await fetch(`${BASE}/api/v1/crops?place=ADM3_Godagari`)).json();
  const sunflowerItem = menu.crops?.find(c => c.id === 'sunflower');
  check(menu.crops?.length >= 14 && sunflowerItem?.afterAman?.length && menu.keypad?.options?.length === 8, 'the crop menu lists the crops, where they fit, and the keypad menu');
  const voice = await (await fetch(`${BASE}/api/v1/voice/answer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unionId: 'ADM3_Godagari', text: 'আমি সূর্যমুখী আর মসুর করতে চাই' }) })).json();
  check(voice.understood.crops.join() === 'sunflower,lentil' && voice.advice.crop_choice?.fits.length === 2, 'a spoken request becomes a plan for those crops');
  check(voice.reply.speechBangla.includes('মাঠের কথা') && !/[0-9~]/.test(voice.reply.speechBangla), 'the call script is speakable Bangla with Bangla digits');
  const callRes = await fetch(`${BASE}/api/v1/calls/advice`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '+8801700000000', unionId: 'ADM3_Godagari', preferredCrops: 'potato' }) });
  const call = await callRes.json();
  check(callRes.status === 200 && call.call.dryRun === true && call.call.request.language_code === 'bn-BD' && call.call.request.phone_numbers[0] === '01700000000', 'the Awaj call is a dry run with the bn-BD script');
  const hook = await (await fetch(`${BASE}/api/v1/calls/survey-webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ survey_id: 1, metadata: { unionId: 'talanda_tanore' }, results: [{ phone_number: '01700000000', status: 'answered', response: '6', responses: ['6', '1'] }, { phone_number: '01800000000', status: 'not_answered' }] }) })).json();
  check(hook.handled.length === 1 && hook.handled[0].crops.join() === 'sunflower,lentil' && hook.handled[0].callBack.dryRun === true, 'keypad answers (6 = sunflower, 1 = lentil) trigger a planned call-back');
  console.log('✓ Crop choice:', menu.crops.length, 'crops at Godagari; voice top:', voice.advice.options[0].nameEnglish, '; call dry run', call.reply.durationSecondsEstimate, 's');

  // Any main crop, and no rice when the farmer says so; soil-and-water tips; keypad calls; MODIS greenness everywhere
  const wheat = await (await fetch(`${BASE}/api/v1/advice`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unionId: 'ADM3_Godagari', heroCrop: 'wheat', avoidCrops: ['rice'] }) })).json();
  const hasRice = (o) => o.cropSequence.some(p => p.seasonType === 'Aman' || p.seasonType === 'Aus' || p.crop === 'Boro rice');
  check(wheat.options.length && wheat.options.every(o => o.cropSequence.some(p => p.crop === 'Wheat') && !hasRice(o)), 'a wheat plan without rice holds wheat and no rice');
  check(wheat.options.every(o => (o.stewardship || []).some(t => t.kind === 'metals') && o.stewardship.some(t => t.kind === 'water')), 'every option carries soil-and-water tips');
  const spoken = await (await fetch(`${BASE}/api/v1/voice/answer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unionId: 'ADM3_Godagari', text: 'আমি ধান করতে চাই না, শুধু গম করব' }) })).json();
  check(spoken.understood.hero === 'wheat' && spoken.understood.excluded.includes('rice') && spoken.advice.crop_choice?.heroCrop === 'wheat' && !hasRice(spoken.advice.options[0]), 'a spoken "only wheat, no rice" plans wheat without rice');
  const keypad = await (await fetch(`${BASE}/api/v1/calls/keypad`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '01700000000', unionId: 'ADM3_Godagari' }) })).json();
  check(keypad.call.dryRun === true && keypad.menu.includes('চাপুন') && keypad.call.request.dtmf_options.length === 8, 'the keypad menu call is a dry run with eight crop keys');
  const gpl = await (await fetch(`${BASE}/api/v1/overview?place=ADM3_Godagari`)).json();
  check(gpl.context.winterGreenness?.recent?.cyclesPerYear !== undefined, 'every upazila has its MODIS winter greenness and crops a year');
  console.log('✓ Main crop without rice:', wheat.options[0].nameEnglish, '; Godagari crops a year', gpl.context.winterGreenness.early.cyclesPerYear, '->', gpl.context.winterGreenness.recent.cyclesPerYear);

  // The overview's map of Bangladesh: outlines for all 544 upazilas (sent gzipped) and one row of NASA values each
  const mapRows = await (await fetch(`${BASE}/api/v1/map/upazilas`)).json();
  const god = mapRows.upazilas.ADM3_Godagari;
  check(Object.keys(mapRows.upazilas).length === 544 && god.cropsNow !== undefined && god.boroIrrigationMm > 0 && god.pesticideRice?.length === 2 && god.organicMatter,
    'the map has 544 upazilas with MODIS, NASA replay, PEST-CHEMGRIDS and SRDI values');
  check(Object.values(mapRows.upazilas).filter(r => r.rainStatus).length > 500, "the map carries the daily NASA update's rain and soil status");
  const outlines = await fetch(`${BASE}/data/bd_upazilas.geojson`, { headers: { 'Accept-Encoding': 'gzip' } });
  const encoding = outlines.headers.get('content-encoding');
  const shapes = await outlines.json();
  check(outlines.headers.get('content-type')?.includes('geo+json') && encoding === 'gzip' && shapes.features.length === 544
    && shapes.features.every(f => mapRows.upazilas[f.properties.id]), 'the map outlines are gzipped and match the 544 upazila ids');
  console.log('✓ Map:', Object.keys(mapRows.upazilas).length, 'upazilas; Godagari crops a year', god.cropsNow, ', rice pesticide', god.pesticideRice.join('-'), 'kg/ha');

  // 2. POST /api/v1/advice
  console.log('Testing POST /api/v1/advice ...');
  const resAdvice = await fetch(`${BASE}/api/v1/advice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ landType: 'medium_high', farmerPriorities: { water: 0.6, income: 0.4 } }),
  });
  const dataAdvice = await resAdvice.json();
  check(resAdvice.status === 200, 'advice status');
  check(dataAdvice.farmer_card?.audioScriptBangla, 'advice carries the checked audio script for the app');
  console.log('✓ Advice status:', resAdvice.status, 'Top option:', dataAdvice.options[0].nameBangla);

  // 3. POST /api/v1/narrate
  console.log('Testing POST /api/v1/narrate ...');
  const resNarrate = await fetch(`${BASE}/api/v1/narrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ advice: dataAdvice, selectedOptionId: dataAdvice.options[0].id }),
  });
  const dataNarrate = await resNarrate.json();
  check(resNarrate.status === 200 && dataNarrate.status === 'verified_template', 'narrate');
  console.log('✓ Narrate status:', resNarrate.status, 'Engine used:', dataNarrate.status);

  // 4. POST /api/v1/channel-events (Keypad 1)
  console.log('Testing POST /api/v1/channel-events ...');
  const resKeypad = await fetch(`${BASE}/api/v1/channel-events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keypad: '1' }),
  });
  const dataKeypad = await resKeypad.json();
  check(resKeypad.status === 200 && dataKeypad.topOptionId, 'keypad re-ranks');
  console.log('✓ Keypad status:', resKeypad.status, 'Ack:', dataKeypad.acknowledgementBangla);

  // 5. POST /api/v1/advice for a union without research data
  console.log('Testing POST /api/v1/advice for an unmodelled union ...');
  const resUnknown = await fetch(`${BASE}/api/v1/advice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unionId: 'selborash_dharmapasha', landType: 'low' }),
  });
  check(resUnknown.status === 422, `expected 422 for an unmodelled union, got ${resUnknown.status}`);
  console.log('✓ Unmodelled union refused with', resUnknown.status);

  // 6-11. Krishi officer desk
  const post = (url, body, token) => fetch(`${BASE}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  console.log('Testing the Krishi officer desk ...');
  const locked = await fetch(`${BASE}/api/v1/officer/desk`);
  check(locked.status === 401, `officer desk must need sign-in, got ${locked.status}`);
  const wrong = await post('/api/v1/officer/login', { officerId: 'saao_talanda_01', accessCode: 'wrong-code' });
  check(wrong.status === 401, 'wrong access code must be refused');
  const session = await (await post('/api/v1/officer/login', { officerId: 'saao_talanda_01', accessCode: OFFICER_CODE })).json();
  check(session.token, 'officer login returns a session token');
  const auth = { headers: { Authorization: `Bearer ${session.token}` } };
  const deskView = await (await fetch(`${BASE}/api/v1/officer/desk`, auth)).json();
  check(deskView.queue[0].farmerId === 'F04' && deskView.queue[0].level === 'urgent', 'the keypad-9 farmer with a late Aman tops the queue');
  console.log('✓ Officer sign-in works; queue top:', deskView.queue[0].farmerId, deskView.queue[0].reasons.map(r => r.en).join('; '));

  const observed = await (await post('/api/v1/officer/observations', {
    farmerId: 'F02', landType: 'high', currentAmanCrop: 'BRRI dhan71', irrigation: 'shallow_tube_well',
    pestSeen: 'aphid', pestSeverity: 'high', priorities: { water: 0.4, income: 0.2, soil: 0.2, pest: 0.2 },
    noteBangla: 'জমি দেখা হয়েছে', resolveCallbacks: true,
  }, session.token)).json();
  check(observed.advice.verification?.officerId === 'saao_talanda_01', 'observation marks the advice as officer-verified');
  check(observed.advice.scope.land_type === 'high' && observed.advice.this_season.currentAmanVariety === 'BRRI dhan71', "the officer's field details take priority");
  const farmerAdvice = await (await post('/api/v1/advice', { farmerId: 'F02' })).json();
  check(farmerAdvice.verification && farmerAdvice.scope.land_type === 'high', 'farmer advice uses the officer observation');
  console.log('✓ Officer observation takes priority in F02 advice:', farmerAdvice.options[0].nameEnglish);

  const banned = await post('/api/v1/officer/observations', {
    farmerId: 'F02', landType: 'high', currentAmanCrop: 'BRRI dhan71', irrigation: 'shallow_tube_well', noteBangla: 'কৃষি ব্যাংক থেকে ঋণ নিন',
  }, session.token);
  check(banned.status === 400, 'officer notes go through the same banned-word filter');

  const keypad9 = await (await post('/api/v1/channel-events', { keypad: '9', farmerId: 'F03' })).json();
  check(keypad9.callbackId, 'keypad 9 creates a call-back request');
  const deskAfter = await (await fetch(`${BASE}/api/v1/officer/desk`, auth)).json();
  check(deskAfter.queue.find(q => q.farmerId === 'F03').openCallbackId === keypad9.callbackId, 'the call-back reaches the officer queue');
  const knowledge = await (await fetch(`${BASE}/api/v1/officer/knowledge`, auth)).json();
  check(knowledge.srdi.rows.length >= 5 && knowledge.ipm.byRabi.length >= 4, 'officer knowledge pack has the full SRDI card and IPM steps');
  console.log('✓ Keypad 9 call-back queued; knowledge pack served to the signed-in officer');

  // 12. Every dashboard text has an English translation
  const html = fs.readFileSync('apps/saao-dashboard/public/index.html', 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const { EN } = await import('./apps/saao-dashboard/public/i18n.js');
  const keys = new Set([...html.matchAll(/data-i18n(?:-title)?="([^"]+)"/g)].map(m => m[1]));
  const untranslated = [...keys].filter(k => !(k in EN));
  check(untranslated.length === 0, `English translations missing for: ${untranslated.join(', ')}`);
  console.log(`✓ All ${keys.size} dashboard texts have an English translation`);

  // 13. GET /
  // 14. Weather: contract, validation and per-location isolation (live providers; an outage must be reported honestly)
  console.log('Testing weather endpoints ...');
  const getJson = async (url) => { const r = await fetch(`${BASE}${url}`); return { status: r.status, body: await r.json() }; };
  const badLat = await getJson('/api/v1/weather/forecast?lat=abc&lon=90');
  check(badLat.status === 400 && badLat.body.error.code === 'invalid_input', 'invalid latitude is rejected with the error envelope');
  const outside = await getJson('/api/v1/weather/forecast?lat=51.5&lon=-0.12');
  check(outside.status === 400 && outside.body.error.code === 'invalid_input', 'coordinates outside Bangladesh are rejected');
  const missing = await getJson('/api/v1/weather?lat=24.6');
  check(missing.status === 400, 'missing lon is rejected (no silent Talanda default)');

  const dhaka = await getJson('/api/v1/weather/forecast?lat=23.81&lon=90.41');
  const sylhetForecast = await getJson('/api/v1/weather/forecast?lat=24.89&lon=91.87');
  if (dhaka.status === 200 && sylhetForecast.status === 200) {
    check(dhaka.body.location.lat === 23.81 && sylhetForecast.body.location.lat === 24.89, 'forecast echoes the requested coordinates');
    check(dhaka.body.forecast.source.kind === 'model_estimate' && dhaka.body.forecast.source.live === true, 'forecast is labelled a model estimate');
    const h = dhaka.body.forecast.hourly;
    check(h.length >= 24 && h.some(x => x.relativeHumidityPct !== null), 'hourly forecast carries relative humidity');
    check(new Set(h.slice(0, 24).map(x => x.relativeHumidityPct)).size > 1, 'hourly humidity varies by hour (not one repeated value)');
    check(dhaka.body.forecast.current.temperatureC !== sylhetForecast.body.forecast.current.temperatureC
      || dhaka.body.forecast.current.relativeHumidityPct !== sylhetForecast.body.forecast.current.relativeHumidityPct, 'two locations do not share one cached forecast');
    console.log('✓ Open-Meteo: per-location forecast with hourly humidity, labelled as a model estimate');
  } else {
    check(dhaka.body.error?.code === 'provider_unavailable', `forecast failure must be provider_unavailable, got ${JSON.stringify(dhaka.body)}`);
    console.log('! Open-Meteo unreachable from this machine: verified the honest provider_unavailable response instead');
  }

  const nasaA = await getJson('/api/v1/weather?lat=23.81&lon=90.41');
  const nasaB = await getJson('/api/v1/weather?lat=22.35&lon=91.83');
  if (nasaA.status === 200 && nasaB.status === 200) {
    check(nasaA.body.isLive === false && nasaA.body.source.kind === 'satellite_delayed' && nasaA.body.source.live === false, 'NASA POWER is never labelled live');
    check(nasaA.body.location.lat === 23.81 && nasaB.body.location.lat === 22.35, 'NASA response carries the requested coordinates');
    check(nasaA.body.soilMoisture.status === 'unavailable', 'NASA POWER reports soil moisture as unavailable instead of a constant');
    check(!('rootZoneMoistureM3M3' in nasaA.body.latest), 'no invented SMAP value in the NASA payload');
    check(JSON.stringify(nasaA.body.recentDays) !== JSON.stringify(nasaB.body.recentDays), 'NASA cache is per location');
    check(!JSON.stringify(nasaA.body).includes('তালন্দ'), 'NASA payload has no hardcoded Talanda labels');
    console.log('✓ NASA POWER: per-location, delayed, soil moisture unavailable, latest', nasaA.body.latestObservationDate);
  } else {
    check(nasaA.body.error?.code === 'provider_unavailable' || nasaA.body.error?.code === 'no_data', 'NASA failure must be an explicit error, never baseline data');
    console.log('! NASA POWER unreachable from this machine: verified the explicit error response instead');
  }

  const cfg = await getJson('/api/v1/config');
  check(cfg.status === 200 && cfg.body.llm.status === 'unavailable' && cfg.body.tts.status === 'unavailable', 'config reports unconfigured LLM/TTS as unavailable');
  check(cfg.body.earthEngine.status !== 'ready' || cfg.body.earthEngine.reason === 'ready', 'earth engine status comes from a real probe');
  check(cfg.body.jobs.productionDurable === false, 'config states the job store is not production durable');
  const locs = await getJson('/api/v1/locations');
  check(locs.body.districtCount === 64 && locs.body.upazilaCount >= 495, `locations cover all 64 districts and 495+ upazilas (got ${locs.body.districtCount}/${locs.body.upazilaCount})`);
  check(locs.body.districts.every(d => d.upazilas.length > 0 && d.upazilas.every(u => Number.isFinite(u.lat) && Number.isFinite(u.lon))), 'every upazila has coordinates');
  const tts = await fetch(`${BASE}/api/v1/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'পরীক্ষা' }) });
  check(tts.status === 503 && (await tts.json()).error.code === 'configuration_required', 'TTS without a provider returns configuration_required');
  const unknown = await getJson('/api/v1/does-not-exist');
  check(unknown.status === 404 && unknown.body.error.code === 'not_found', 'unknown API path is a JSON 404, not the HTML page');
  const badJson = await fetch(`${BASE}/api/v1/advice`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
  check(badJson.status === 400, 'malformed JSON is a 400');
  console.log('✓ Config, locations, TTS fallback status and error envelope verified');

  // 15. River Erosion Information (GET /api/v1/erosion)
  console.log('Testing GET /api/v1/erosion ...');
  const resErosion = await fetch(`${BASE}/api/v1/erosion?river=jamuna`);
  const dataErosion = await resErosion.json();
  check(resErosion.status === 200, 'erosion status');
  check(dataErosion.corridor.stations.length >= 3, 'erosion stations');
  check(dataErosion.corridor.stations[0].dangerLevelM > 0, 'station carries real danger level');
  console.log('✓ River Erosion status: 200, Corridor:', dataErosion.corridor.riverNameBangla, 'Stations:', dataErosion.corridor.stations.length);

  // 16. Unified Auth (POST /api/v1/auth/login, GET /session, POST /logout)
  console.log('Testing Unified Auth ...');
  const farmerLogin = await (await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'farmer', farmerId: 'F01', pin: '1234' }),
  })).json();
  check(farmerLogin.token && farmerLogin.user.role === 'farmer', 'farmer login succeeds with session token');
  const farmerSession = await (await fetch(`${BASE}/api/v1/auth/session`, {
    headers: { Authorization: `Bearer ${farmerLogin.token}` },
  })).json();
  check(farmerSession.user.id === 'F01', 'farmer session validated');
  const logoutRes = await (await fetch(`${BASE}/api/v1/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${farmerLogin.token}` },
  })).json();
  check(logoutRes.ok === true, 'logout succeeds');
  const expiredSession = await fetch(`${BASE}/api/v1/auth/session`, {
    headers: { Authorization: `Bearer ${farmerLogin.token}` },
  });
  check(expiredSession.status === 401, 'session revoked after logout');
  console.log('✓ Farmer Auth lifecycle verified: login -> session -> logout -> revoked');

  // 17. Grounded Bengali AI Agricultural Assistant (POST /api/v1/ai/ask)
  console.log('Testing AI Assistant ...');
  const aiNoLoc = await (await fetch(`${BASE}/api/v1/ai/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'আমার জমিতে সেচ কখন দেওয়া উচিত?' }),
  })).json();
  check(aiNoLoc.evidenceLevel === 'insufficient_evidence', 'AI asks for a location instead of using a default one');
  const aiFert = await (await fetch(`${BASE}/api/v1/ai/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'কত সার দেব?', lat: 23.81, lon: 90.41 }),
  })).json();
  check(aiFert.evidenceLevel === 'insufficient_evidence', 'AI does not apply the Talanda SRDI card elsewhere');
  const aiFertTalanda = await (await fetch(`${BASE}/api/v1/ai/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'কত সার দেব?', lat: 24.62, lon: 88.56 }),
  })).json();
  check(aiFertTalanda.evidenceLevel === 'reference_card' && aiFertTalanda.answer.includes('229'), 'AI reads the real SRDI card values near Talanda');
  const aiRefusal = await (await fetch(`${BASE}/api/v1/ai/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'শেয়ার বাজারে কোন শেয়ার কিনলে বেশি লাভ হবে?' }),
  })).json();
  check(aiRefusal.evidenceLevel === 'insufficient_evidence', 'AI refuses unsupported query without fabricating');
  console.log('✓ Grounded AI Assistant verified: evidence-based answer and safe refusal');

  // 18. Cattle AOI & Advisory Pipeline Endpoints
  console.log('Testing Cattle AOI & Advisory Endpoints ...');
  const resReadiness = await (await fetch(`${BASE}/api/v1/cattle/readiness`)).json();
  check(resReadiness.weatherForecast?.provider === 'Open-Meteo' && resReadiness.weatherForecast.status !== 'operational', 'readiness never hardcodes operational');
  check(resReadiness.mlModels?.supervisedHeatStress === 'training_data_unavailable', 'cattle ml readiness reports data unavailable');

  const resAois = await (await fetch(`${BASE}/api/v1/cattle/aois`)).json();
  check(Array.isArray(resAois.aois), 'list AOIs returns array');

  // Test invalid AOI geometry rejection (400)
  const badAoiRes = await fetch(`${BASE}/api/v1/cattle/aois`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      farmLabel: 'Invalid AOI',
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    }),
  });
  check(badAoiRes.status === 400, 'out-of-bounds geometry must be rejected with 400');

  // Create valid farm AOI in Tanore
  const newAoiRes = await fetch(`${BASE}/api/v1/cattle/aois`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      farmLabel: 'তানোর টেস্ট ডেইরি (Tanore Test Dairy)',
      ownerName: 'মো. রফিকুল ইসলাম',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [88.5810, 24.5150],
            [88.5845, 24.5150],
            [88.5845, 24.5185],
            [88.5810, 24.5185],
            [88.5810, 24.5150],
          ],
        ],
      },
    }),
  });
  check(newAoiRes.status === 201, `create AOI status 201, got ${newAoiRes.status}`);
  const newAoiData = await newAoiRes.json();
  check(newAoiData.aoi.aoiId && newAoiData.job.jobId, 'create AOI returns AOI and enqueued background job');

  check(newAoiData.job.status === 'queued' && newAoiData.job.startedAt === undefined, 'a queued job has not started');

  // Wait for the job to reach a terminal status; the advisory exists only after real processing
  let job = newAoiData.job;
  for (let i = 0; i < 120 && ['queued', 'running'].includes(job.status); i++) {
    await new Promise((r) => setTimeout(r, 500));
    job = (await (await fetch(`${BASE}/api/v1/cattle/jobs/${job.jobId}`)).json()).job;
  }
  check(!['queued', 'running'].includes(job.status), `job reached a terminal state, got ${job.status}`);
  const advRes = await fetch(`${BASE}/api/v1/cattle/aois/${encodeURIComponent(newAoiData.aoi.aoiId)}/advisory`);
  if (job.status === 'failed') {
    check(job.errorCode === 'provider_unavailable' && advRes.status === 404, 'a failed job leaves no advisory and says why');
    console.log('! weather providers unreachable: verified failed-job semantics instead');
  } else {
    check(job.status !== 'succeeded' || job.missing.length === 0, 'succeeded implies nothing is missing');
    check(job.status === 'partial' ? job.missing.length > 0 : true, 'partial lists what is missing');
    check(advRes.status === 200, 'advisory is available after the job completes');
    const advData = await advRes.json();
    const t = advData.advisory.derived.thi;
    check(t.current > 0 && t.hourly.length > 0 && t.hourly.length <= 24, 'advisory carries derived THI and an hourly curve');
    check(advData.advisory.measured.forecast.source.kind === 'model_estimate', 'measured forecast is labelled a model estimate');
    check(advData.advisory.heuristic.kind === 'heuristic' && !JSON.stringify(advData.advisory).includes('estimatedIncreasePct'), 'heuristic guidance carries no unsupported percentages');
    check(advData.advisory.modelStatus?.modelRegistryStatus === 'training_data_unavailable', 'advisory carries unavailable status for ungrounded models');
    if (!cfg.body.earthEngine || cfg.body.earthEngine.status !== 'ready') {
      check(job.status === 'partial' && advData.advisory.measured.satellite.status === 'unavailable' && advData.advisory.forageStatus.ndviProxy === null, 'without Earth Engine, satellite data is unavailable (no null-as-success)');
    }
  }

  const sat = await (await fetch(`${BASE}/api/v1/cattle/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aoiId: newAoiData.aoi.aoiId, jobType: 'satellite_extract' }) })).json();
  let satJob = sat.job;
  for (let i = 0; i < 60 && ['queued', 'running'].includes(satJob.status); i++) {
    await new Promise((r) => setTimeout(r, 250));
    satJob = (await (await fetch(`${BASE}/api/v1/cattle/jobs/${satJob.jobId}`)).json()).job;
  }
  if (cfg.body.earthEngine.status !== 'ready') {
    check(satJob.status === 'blocked' && satJob.errorCode === 'configuration_required', 'satellite job without Earth Engine is blocked/configuration_required, not complete');
  }
  const trainJob = await (await fetch(`${BASE}/api/v1/cattle/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aoiId: newAoiData.aoi.aoiId, jobType: 'train_model' }) })).json();
  let tJob = trainJob.job;
  for (let i = 0; i < 40 && ['queued', 'running'].includes(tJob.status); i++) {
    await new Promise((r) => setTimeout(r, 250));
    tJob = (await (await fetch(`${BASE}/api/v1/cattle/jobs/${tJob.jobId}`)).json()).job;
  }
  check(tJob.status === 'blocked' && tJob.errorCode === 'training_data_unavailable', 'training without labelled data is blocked, never succeeded');
  const badType = await fetch(`${BASE}/api/v1/cattle/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aoiId: newAoiData.aoi.aoiId, jobType: 'mine_bitcoin' }) });
  check(badType.status === 400, 'unknown job types are rejected');
  const retryOk = await fetch(`${BASE}/api/v1/cattle/jobs/${tJob.jobId}/retry`, { method: 'POST' });
  check(retryOk.status === 202, 'a blocked job can be retried');

  // Clean up created test AOI
  const delRes = await fetch(`${BASE}/api/v1/cattle/aois/${encodeURIComponent(newAoiData.aoi.aoiId)}`, {
    method: 'DELETE',
  });
  check(delRes.status === 200, 'delete AOI status');
  console.log('✓ Cattle AOI & Advisory Pipeline verified: create -> job enqueue -> advisory -> delete');

  // Officer routes without a token or with a token that is not valid
  console.log('Testing officer route protection ...');
  for (const [method, route] of [['GET', '/api/v1/officer/desk'], ['GET', '/api/v1/officer/knowledge'], ['GET', '/api/v1/officer/calls'],
    ['POST', '/api/v1/officer/observations'], ['POST', '/api/v1/officer/reset']]) {
    const noToken = await fetch(`${BASE}${route}`, { method });
    check(noToken.status === 401, `${method} ${route} without a token must be 401, got ${noToken.status}`);
    const junk = await fetch(`${BASE}${route}`, { method, headers: { Authorization: 'Bearer not-a-real-token' } });
    check(junk.status === 401 || junk.status === 503, `${method} ${route} with an unknown token must be refused, got ${junk.status}`);
  }
  const demoConfig = await (await fetch(`${BASE}/api/v1/auth/config`)).json();
  check(demoConfig.demoMode === true, 'auth config reports demo mode when DEMO_MODE=true');
  console.log('✓ Officer routes refuse missing and unknown tokens');

  // Manager data-sources status: 401 / 403 / 200 over HTTP, and never a secret value
  console.log('Testing GET /api/v1/manager/data-sources ...');
  const sources = '/api/v1/manager/data-sources';
  check((await fetch(`${BASE}${sources}`)).status === 401, 'data sources without a token must be 401');
  check((await fetch(`${BASE}${sources}`, { headers: { Authorization: 'Bearer nope' } })).status === 401, 'data sources with an unknown token must be 401');
  const asViewer = await fetch(`${BASE}${sources}`, { headers: { Authorization: 'Bearer viewer-token' } });
  check(asViewer.status === 403, `a signed-in non-manager must get 403, got ${asViewer.status}`);
  check(!(await asViewer.text()).includes('earthdataLogin'), 'the 403 body carries no status');
  const asManager = await fetch(`${BASE}${sources}`, { headers: { Authorization: 'Bearer mgr-token' } });
  check(asManager.status === 200, `a manager must get 200, got ${asManager.status}`);
  const managerText = await asManager.text();
  const sourcesBody = JSON.parse(managerText);
  const { integrations, ...flags } = sourcesBody;
  check(JSON.stringify(flags) === JSON.stringify({ earthdataLogin: 'set', earthdataToken: 'set', firmsMapKey: 'set', nasaApiKey: 'set', adsApiToken: 'set', offline: true }), `unexpected data-sources flags: ${JSON.stringify(flags)}`);
  // every integration, with one of four labels and plain sentences in both languages; offline mode makes NASA POWER a saved copy
  check(Array.isArray(integrations) && integrations.length >= 15, 'the data-sources response lists every integration');
  check(integrations.every((i) => ['live', 'saved', 'demo', 'notset'].includes(i.label) && i.name.bn && i.name.en && i.reason.bn && i.reason.en && i.usedBy.en && i.reality.bn), 'each integration has a label and bilingual text');
  check(integrations.find((i) => i.id === 'nasa-power').label === 'saved', 'with OFFLINE=1 NASA POWER is a saved copy, not live');
  check(integrations.find((i) => i.id === 'awaj').label === 'notset' && integrations.find((i) => i.id === 'demo-features').label === 'demo', 'unset Awaj is "notset" and the demo features say demo');
  check(!/[A-Z][A-Z0-9]+_[A-Z0-9_]{2,}/.test(JSON.stringify(integrations).replace(/OFFLINE|AWAJ_LIVE|DEMO_MODE|NOT_NEEDED|NOT_APPLICABLE/g, '')), 'the integrations list names no environment variable');
  for (const value of Object.values(FAKE_SECRETS)) check(!managerText.includes(value), 'the data-sources response must never contain a secret value');
  const demoSources = await fetch(`${BASE}${sources}`, { headers: { Authorization: `Bearer ${session.token}` } });
  check(demoSources.status === 200, 'the demo desk session may read the data-sources status in DEMO_MODE');
  const demoText = await demoSources.text();
  for (const value of Object.values(FAKE_SECRETS)) check(!demoText.includes(value), 'the demo response must never contain a secret value');
  console.log('✓ Data sources: 401 without a token, 403 for a non-manager, 200 for a manager, flags only (no secret)');

  // Everything a farmer hears or is sent (narration, audio script, voice reply, SMS, call script, keypad call, keypad-9 survey
  // answers, channel acknowledgements, the assistant): outside the pilot it carries no fertilizer amount and nothing from the Talanda SRDI card
  console.log('Testing spoken and delivered text outside the pilot ...');
  const postJson = async (route, body) => (await fetch(`${BASE}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  const phone = '01712345678';
  const NO_CARD = 'এই এলাকার মাটির কার্ড (SRDI) যোগ করা হয়নি, সার-পরামর্শ দেওয়া যাচ্ছে না';
  const FERT_AMOUNT = /(urea|tsp|mop|potash|gypsum|zinc|ইউরিয়া|টিএসপি|এমওপি|পটাশ|জিপসাম|জিংক)[^.।]*[0-9০-৯]|[0-9০-৯][^.।]*(kg|কেজি)[^.।]*(urea|tsp|mop|ইউরিয়া|টিএসপি|এমওপি)/i;
  const SOIL_CARD_TEXT = /SRDI|Kharia|খিয়ার|এসআরডিআই|Talanda card|তালন্দ কার্ড/;
  const TALANDA_WORDS = /তালন্দ|Talanda|তানোর|Tanore/;
  const deliveredTexts = async (place, near) => {
    const texts = [];
    const add = (name, value) => { if (typeof value === 'string' && value) texts.push({ name, value }); };
    const advice = await postJson('/api/v1/advice', { unionId: place });
    const card = advice.farmer_card;
    for (const k of ['audioScriptBangla', 'narrativeBangla', 'provenanceBangla']) add(`farmer_card.${k}`, card[k]);
    add('farmer_card.season2.fertilizerBangla', card.season2.fertilizerBangla);
    add('farmer_card.season2.notesBangla', card.season2.notesBangla);
    const narration = await postJson('/api/v1/narrate', { advice, selectedOptionId: advice.options[0].id });
    for (const k of ['banglaSpeechText', 'englishGloss', 'banglaKeypadPrompt']) add(`narrate.${k}`, narration[k]);
    for (const text of ['আমি মসুর ও সরিষা করতে চাই', 'আলু করতে চাই, সার কত দেব', 'বোরো ধান করব']) {
      const v = await postJson('/api/v1/voice/answer', { unionId: place, text });
      add(`voice[${text}].speech`, v.reply.speechBangla); add(`voice[${text}].sms`, v.reply.smsBangla);
    }
    const call = await postJson('/api/v1/calls/advice', { unionId: place, phone, text: 'গম করতে চাই' });
    call.call.request.texts.forEach((t, i) => add(`calls/advice.texts[${i}]`, t));
    add('calls/advice.sms', call.reply.smsBangla);
    const keypad = await postJson('/api/v1/calls/keypad', { unionId: place, phone });
    add('calls/keypad.menu', keypad.menu); add('calls/keypad.request', JSON.stringify(keypad.call.request ?? keypad.call));
    for (const key of ['1', '2', '3', '4', '5', '9']) {
      const c = await postJson('/api/v1/channel-events', { keypad: key, farmerId: 'F01', unionId: place });
      add(`channel-events[${key}].bn`, c.acknowledgementBangla); add(`channel-events[${key}].en`, c.acknowledgementEnglish);
    }
    const assistant = await postJson('/api/v1/ai/ask', { query: 'এই এলাকায় সারের সুপারিশ কী?', ...near });
    return { texts, assistant };
  };
  const away = await deliveredTexts('ADM3_Godagari', { lat: 24.4, lon: 88.3 });
  check(away.texts.length >= 30, `the check really covers the delivered texts (${away.texts.length} texts)`);
  for (const { name, value } of away.texts) {
    const text = value.replace(NO_CARD, '');
    check(!FERT_AMOUNT.test(text), `Godagari ${name} carries a fertilizer amount: ${text.slice(0, 120)}`);
    check(!SOIL_CARD_TEXT.test(text), `Godagari ${name} carries Talanda SRDI card text: ${text.slice(0, 120)}`);
    check(!TALANDA_WORDS.test(text), `Godagari ${name} names Talanda or Tanore: ${text.slice(0, 120)}`);
  }
  check(away.assistant.evidenceLevel === 'insufficient_evidence' && !FERT_AMOUNT.test(away.assistant.answer) && !/[0-9০-৯]+ কেজি/.test(away.assistant.answer), 'the assistant gives no fertilizer amount away from Talanda');
  const home = await deliveredTexts('talanda_tanore', { lat: 24.62, lon: 88.56 });
  check(home.texts.some(({ name, value }) => name === 'farmer_card.season2.fertilizerBangla' && /ইউরিয়া.*টিএসপি.*এমওপি/.test(value)), 'the pilot\'s farmer card keeps its fertilizer line');
  check(home.assistant.evidenceLevel === 'reference_card' && /ইউরিয়া/.test(home.assistant.answer), 'the assistant still reads the Talanda card at Talanda');
  check(home.texts.every(({ value }) => !value.includes(NO_CARD)), 'the no-soil-card message never reaches a pilot text');
  check(home.texts.some(({ name }) => name.startsWith('calls/advice')) && home.texts.some(({ name }) => name.startsWith('channel-events')), 'the pilot\'s call and acknowledgement texts are still produced');
  console.log(`✓ Delivered text: ${away.texts.length} Godagari texts (narration, audio script, voice, SMS, call script, keypad menu, acknowledgements) carry no fertilizer amount, Talanda soil card text or Talanda name; the pilot is unchanged`);

  // Site scope over HTTP: a manager sees and changes only their own site's desk; the area parameter accepts known ids only
  console.log('Testing manager site scope ...');
  const as = (token) => ({ headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  const deskOf = async (token) => (await fetch(`${BASE}/api/v1/officer/desk`, as(token))).json();
  const ownDesk = await deskOf('h.talanda.s');
  check(ownDesk.farmers.length === 4 && ownDesk.callbacks.some((c) => c.id === 'cb_seed_04'), 'the talanda manager sees the talanda desk');
  for (const token of ['h.other.s', 'h.nosite.s']) {
    const other = await deskOf(token);
    check(other.farmers.length === 0 && other.callbacks.length === 0 && other.queue.length === 0, `${token}: no farmers, call-backs or queue of another site`);
    const resolve = await fetch(`${BASE}/api/v1/officer/callbacks/cb_seed_04/resolve`, { method: 'POST', ...as(token) });
    check(resolve.status === 404, `${token}: another site's call-back is not found, got ${resolve.status}`);
    const observe = await fetch(`${BASE}/api/v1/officer/observations`, { method: 'POST', ...as(token), body: JSON.stringify({ farmerId: 'F01', landType: 'medium_high', currentAmanCrop: 'BRRI dhan71', irrigation: 'rainfed' }) });
    check(observe.status === 400, `${token}: cannot write an observation for another site's farmer, got ${observe.status}`);
    const calls = await (await fetch(`${BASE}/api/v1/officer/calls`, as(token))).json();
    check(calls.calls.length === 0, `${token}: the phone log of another site is not shown`);
  }
  const noSiteReset = await fetch(`${BASE}/api/v1/officer/reset`, { method: 'POST', ...as('h.nosite.s') });
  check(noSiteReset.status === 403 && (await noSiteReset.json()).error.code === 'site_required', 'a manager without a site cannot reset: 403 site_required (the dashboard shows the message and stays signed in)');
  // the same site written another way is the same site: the desk, the climate card and the area
  for (const token of ['h.upper.s', 'h.alias.s']) {
    const desk = await deskOf(token);
    check(desk.farmers.length === 4 && desk.callbacks.some((c) => c.id === 'cb_seed_04'), `${token}: a differently written talanda site sees the talanda desk`);
    const climate = await fetch(`${BASE}/api/v1/manager/climate`, as(token));
    const climateBody = await climate.json();
    check(climate.status === 200 && climateBody.area.id === 'talanda' && climateBody.area.isHome === true, `${token}: and the talanda climate card (status ${climate.status})`);
    const area = await (await fetch(`${BASE}/api/v1/manager/area`, as(token))).json();
    check(area.siteId === 'talanda' && area.placeId === 'talanda_tanore', `${token}: and the talanda home area`);
    const pack = await (await fetch(`${BASE}/api/v1/officer/knowledge`, as(token))).json();
    check(pack.srdi && pack.srdi.rows.length >= 4 && Array.isArray(pack.amanReplay), `${token}: and the talanda knowledge pack`);
  }
  // the knowledge pack is the pilot's: any other site gets only the no-soil-card message
  for (const token of ['h.other.s', 'h.nosite.s']) {
    const pack = await (await fetch(`${BASE}/api/v1/officer/knowledge`, as(token))).json();
    check(pack.srdi === null && pack.noSoilCard.bn === NO_CARD_BN && pack.noSoilCard.en.includes('soil card'), `${token}: the knowledge pack is the no-soil-card message`);
    for (const key of ['amanReplay', 'rabiReplay', 'ipm', 'caveats', 'saaoNotes', 'cattleHeat', 'haorSkill', 'haorEscape']) check(!(key in pack), `${token}: no ${key} (it is Tanore-point data)`);
  }
  await fetch(`${BASE}/api/v1/officer/reset`, { method: 'POST', ...as('h.other.s') });
  const afterReset = await deskOf('h.talanda.s');
  check(afterReset.farmers.length === 4 && afterReset.callbacks.some((c) => c.id === 'cb_seed_04' && c.status === 'open'), 'another site\'s reset leaves the talanda desk alone');
  const areaOf = async (token) => (await fetch(`${BASE}/api/v1/manager/area`, as(token))).json();
  const homeArea = await areaOf('h.talanda.s');
  check(homeArea.siteId === 'talanda' && homeArea.placeId === 'talanda_tanore' && homeArea.nameEnglish === 'Talanda, Tanore', 'the home area comes from app_metadata.site (not user_metadata)');
  check((await areaOf('h.other.s')).siteId === 'SUN_DHARMAPASHA', 'another manager has another home area, whatever user_metadata says');
  check((await fetch(`${BASE}/api/v1/manager/area`)).status === 401, 'the home area needs a token');
  check((await fetch(`${BASE}/api/v1/manager/area`, as('h.viewer.s'))).status === 403, 'the home area is for managers only');
  for (const area of ['nowhere', 'ADM3_Atlantis', '24.6,88.5', 'ADM3_']) {
    const bad = await fetch(`${BASE}/api/v1/manager/climate?area=${encodeURIComponent(area)}`, as('h.talanda.s'));
    check(bad.status === 422, `an unknown area (${area}) must be refused with 422, got ${bad.status}`);
  }
  check((await fetch(`${BASE}/api/v1/manager/climate?area=ADM3_ChuadangaSadar`)).status === 401, 'area climate needs a token');
  const sylhetOverview = await (await fetch(`${BASE}/api/v1/overview?place=ADM3_Godagari`)).json();
  check(sylhetOverview.early_warnings === null && sylhetOverview.soil_carbon === null && sylhetOverview.recent_farmer_contacts.length === 0 && sylhetOverview.pest_reports.length === 0 && sylhetOverview.context.landTypeBangla === null,
    'another place never receives the Tanore pilot\'s warnings, carbon, sample farmers or field reports');
  console.log('✓ Site scope: own desk only, another site cannot read, resolve, write or reset; area ids validated; pilot-only overview parts stay with the pilot');

  await checkDemoModeOff();

  console.log('\n===========================================');
  console.log('  ALL ENDPOINTS TESTED & VERIFIED!          ');
  console.log('===========================================');
}

/** A second server without DEMO_MODE: the demo officer credentials must not work at all. */
async function checkDemoModeOff() {
  console.log('Testing that the demo login is closed without DEMO_MODE ...');
  const port = String(Number(PORT) + 1);
  const base = `http://localhost:${port}`;
  const store = path.join(os.tmpdir(), `eden-officer-test-nodemo-${process.pid}.json`);
  const env = { ...process.env, PORT: port, EDEN_OFFICER_CODE: OFFICER_CODE, SUPABASE_URL: FAKE_SUPABASE_URL, SUPABASE_ANON_KEY: 'fake-anon-key', EDEN_OFFICER_STORE: store,
    CATTLE_STORE_PATH: CATTLE_STORE, LLM_BASE_URL: '', TTS_BASE_URL: '', API_WRITE_TOKEN: '', AWAJ_LIVE: '0',
    EDEN_LIVE_FILE: path.resolve('tests/fixtures/live_conditions_2026-10-01.json') };
  delete env.DEMO_MODE;
  const proc = spawn('node', ['--experimental-strip-types', 'services/api/src/server.ts'], { stdio: 'ignore', env });
  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      try { up = (await fetch(`${base}/api/v1/overview`)).ok; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    check(up, 'the no-demo server did not start');
    const json = { 'Content-Type': 'application/json' };
    const login = await fetch(`${base}/api/v1/officer/login`, { method: 'POST', headers: json, body: JSON.stringify({ officerId: 'saao_talanda_01', accessCode: OFFICER_CODE }) });
    check(login.status === 401, `demo officer login must be refused without DEMO_MODE, got ${login.status}`);
    const unified = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ role: 'officer', officerId: 'saao_talanda_01', accessCode: OFFICER_CODE }) });
    check(unified.status === 401, `unified officer login must be refused without DEMO_MODE, got ${unified.status}`);
    const officers = await (await fetch(`${base}/api/v1/officers`)).json();
    check(Array.isArray(officers) && officers.length === 0, 'the demo officer list is empty without DEMO_MODE');
    const desk = await fetch(`${base}/api/v1/officer/desk`);
    check(desk.status === 401, 'officer desk needs a token');
    const config = await (await fetch(`${base}/api/v1/auth/config`)).json();
    check(config.demoMode === false && Object.keys(config).sort().join() === 'demoMode,emailDomain,supabaseAnonKey,supabaseUrl', 'auth config exposes only the URL, the anon key, the email domain and the demo flag');
    // nothing configured: the manager sees "unset" and the demo NASA key
    const unset = await (await fetch(`${base}/api/v1/manager/data-sources`, { headers: { Authorization: 'Bearer mgr-token' } })).json();
    const { integrations: unsetIntegrations, ...unsetFlags } = unset;
    check(JSON.stringify(unsetFlags) === JSON.stringify({ earthdataLogin: 'unset', earthdataToken: 'unset', firmsMapKey: 'unset', nasaApiKey: 'unset', adsApiToken: 'unset', offline: false }), `unexpected unset data-sources flags: ${JSON.stringify(unsetFlags)}`);
    const unsetLabel = (id) => unsetIntegrations.find((i) => i.id === id).label;
    check(unsetLabel('nasa-power') === 'live' && unsetLabel('awaj') === 'notset' && unsetLabel('tts') === 'notset' && unsetLabel('llm') === 'notset', 'online and unset: POWER is live; Awaj, TTS and the LLM are not set up');
    console.log('✓ Without DEMO_MODE the demo officer credentials do not work at all');
  } finally {
    proc.kill();
    fs.rmSync(store, { force: true });
  }
}

function finish(code) {
  serverProc.kill();
  fakeSupabase.close();
  fs.rmSync(STORE, { force: true });
  fs.rmSync(CATTLE_STORE, { force: true });
  process.exit(code);
}

run()
  .then(() => finish(0))
  .catch((err) => {
    console.error('Test error:', err);
    finish(1);
  });
