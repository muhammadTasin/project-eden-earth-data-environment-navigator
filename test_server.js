import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = 'http://localhost:4000';
// The officer desk writes to a throwaway store so tests never touch the demo data
const STORE = path.join(os.tmpdir(), `eden-officer-test-${process.pid}.json`);
const OFFICER_CODE = process.env.EDEN_OFFICER_CODE || 'talanda-demo';
const serverProc = spawn('node', ['--experimental-strip-types', 'services/api/src/server.ts'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  env: { ...process.env, EDEN_OFFICER_STORE: STORE, AWAJ_LIVE: '0' }, // tests never place a real call
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
  // 14. Real NASA Weather Observations (GET /api/v1/weather)
  console.log('Testing GET /api/v1/weather ...');
  const resWeather = await fetch(`${BASE}/api/v1/weather?lat=24.62&lon=88.56`);
  const dataWeather = await resWeather.json();
  check(resWeather.status === 200, 'weather status');
  check(dataWeather.latestObservationDate && dataWeather.dataSource.includes('NASA POWER'), 'weather data source & observation date');
  check(dataWeather.latest?.t2m && dataWeather.latest?.rootZoneMoistureM3M3, 'weather carries real temperature and SMAP moisture');
  console.log('✓ NASA Weather status: 200, Latest date:', dataWeather.latestObservationDate, 'Temp:', dataWeather.latest.t2m, '°C, Live:', dataWeather.isLive);

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
  const aiWater = await (await fetch(`${BASE}/api/v1/ai/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'আমার জমিতে সেচ কখন দেওয়া উচিত?' }),
  })).json();
  check(aiWater.evidenceLevel === 'verified_high' && aiWater.sources.length >= 2, 'AI answers irrigation query with verified sources');
  check(aiWater.answer.includes('SMAP') || aiWater.answer.includes('সেচ'), 'AI answer references SMAP/irrigation evidence');

  const aiRefusal = await (await fetch(`${BASE}/api/v1/ai/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'শেয়ার বাজারে কোন শেয়ার কিনলে বেশি লাভ হবে?' }),
  })).json();
  check(aiRefusal.evidenceLevel === 'insufficient_evidence', 'AI refuses unsupported query without fabricating');
  console.log('✓ Grounded AI Assistant verified: evidence-based answer and safe refusal');

  console.log('\n===========================================');
  console.log('  ALL ENDPOINTS TESTED & VERIFIED!          ');
  console.log('===========================================');
}

function finish(code) {
  serverProc.kill();
  fs.rmSync(STORE, { force: true });
  process.exit(code);
}

run()
  .then(() => finish(0))
  .catch((err) => {
    console.error('Test error:', err);
    finish(1);
  });
