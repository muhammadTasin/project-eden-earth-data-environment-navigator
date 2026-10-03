/**
 * Test the phone call from a terminal: build the Bangla advice for a place and the crops a farmer named, then read
 * it to one phone through Awaj Digital's Direct TTS Broadcast, wait for the call and print how it went.
 *
 *   npm run call:test -- --to 01XXXXXXXXX --place ADM3_Godagari --crops sunflower,lentil
 *   npm run call:test -- --to 01XXXXXXXXX --text "আমি সূর্যমুখী আর মসুর করতে চাই"
 *   npm run call:test -- --to 01XXXXXXXXX --hero wheat --avoid rice
 *   add --live (with AWAJ_API_TOKEN, AWAJ_SENDER and AWAJ_LIVE=1 in .env) to place the real call; otherwise it is
 *   a dry run that prints the script and the exact request.
 *
 *   npm run call:test -- --upload-menu menu.m4a      upload the recorded crop menu as the voice "mather-kotha-menu"
 *   npm run call:test -- --voices                    list the account's voices and their approval
 *   npm run call:test -- --keypad --to 01XXXXXXXXX   call with the keypad menu (needs the approved menu voice)
 */
import { RotationEngine } from '../../../packages/rotation-engine/src/engine.ts';
import { placeFor } from '../../../packages/rotation-engine/src/data/location.ts';
import { replyFor, requestFromWords, understand } from './voice.ts';
import { awajConfig, balance, bdMobile, broadcastResult, listVoices, sendKeypadSurvey, sendTemplateSurvey, sendTtsCall, ttsStatus, uploadVoice } from './awaj.ts';
import { keypadMenu } from './voice.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const live = process.argv.includes('--live');
  if (live && !awajConfig().live) throw new Error('--live needs AWAJ_API_TOKEN, AWAJ_SENDER and AWAJ_LIVE=1 (in .env or the environment)');
  if (process.argv.includes('--voices')) {
    console.log(JSON.stringify((await listVoices()).data, null, 2));
    return;
  }
  const menuFile = arg('upload-menu');
  if (menuFile) {
    console.log('Record this menu, then upload it:\n' + keypadMenu().promptBangla + '\n');
    console.log(JSON.stringify(await uploadVoice(menuFile, arg('name') ?? 'mather-kotha-menu'), null, 2));
    return;
  }
  if (process.argv.includes('--keypad')) {
    const to = bdMobile(arg('to') ?? '');
    if (!to) throw new Error('Pass --to 01XXXXXXXXX (a Bangladeshi mobile number)');
    const cfg = awajConfig();
    const menu = keypadMenu();
    const metadata = { channel: 'mather-kotha-keypad', unionId: arg('place') ?? 'talanda_tanore' };
    const sent = cfg.surveyTemplate
      ? await sendTemplateSurvey({ phoneNumbers: [to], templateName: cfg.surveyTemplate, webhookUrl: cfg.webhookUrl ?? undefined, metadata })
      : await sendKeypadSurvey({ phoneNumbers: [to], questionVoice: cfg.menuVoice ?? '<AWAJ_MENU_VOICE>', options: menu.options, officerKey: menu.officerKey, officerNumber: cfg.officerNumber ?? undefined, webhookUrl: cfg.webhookUrl ?? undefined, metadata });
    console.log(`Menu the farmer hears:\n${menu.promptBangla}\n`);
    console.log(JSON.stringify(sent, null, 2));
    if (!cfg.webhookUrl) console.log('\nSet PUBLIC_BASE_URL so Awaj can post the pressed keys back (for a test, a tunnel to this PC).');
    return;
  }
  const phone = bdMobile(arg('to') ?? '');
  if (!phone) throw new Error('Pass --to 01XXXXXXXXX (a Bangladeshi mobile number)');
  const placeId = arg('place') ?? 'talanda_tanore';
  const place = placeFor(placeId);
  if (!place) throw new Error(`Unknown place ${placeId}; GET /api/v1/places lists them`);
  const text = arg('text');
  const heard = text ? understand(text) : null;
  const words = heard ? requestFromWords(heard) : {};
  const listArg = (name: string) => (arg(name) ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const crops = words.preferredCrops ?? listArg('crops');
  const hero = words.heroCrop ?? arg('hero');
  const avoid = [...(words.avoidCrops ?? []), ...listArg('avoid')];

  const advice = new RotationEngine().generateAdvice({
    unionId: place.id,
    unionNameBangla: place.nameBangla,
    upazila: place.upazila,
    district: place.district,
    landType: words.landType ?? 'medium_high',
    season: '2026-aman',
    preferredCrops: crops.length ? crops : undefined,
    heroCrop: hero,
    avoidCrops: avoid.length ? avoid : undefined,
    farmerPriorities: words.farmerPriorities ?? { water: 0.5, income: 0.3, soil: 0.2 },
  });
  const reply = replyFor(advice, heard);
  console.log(`Place: ${place.nameEnglish}, ${place.district}; main crop: ${hero ?? '-'}; other crops: ${crops.join(', ') || '-'}; avoid: ${avoid.join(', ') || '-'}`);
  if (heard) console.log('Heard:', JSON.stringify({ crops: heard.crops, hero: heard.hero, excluded: heard.excluded, notModelled: heard.notModelled, land: heard.landType }));
  console.log(`\nCall script (~${reply.durationSecondsEstimate} s):\n${reply.speechBangla}\n\nSMS (${reply.smsSegments} part${reply.smsSegments > 1 ? 's' : ''}):\n${reply.smsBangla}\n`);

  if (live) console.log('Balance:', JSON.stringify((await balance()).data));
  const sent = await sendTtsCall({ phoneNumbers: [phone], texts: [reply.speechBangla], metadata: { channel: 'mather-kotha-test', place: place.id } });
  if (sent.dryRun) {
    console.log('Dry run, nothing dialled. Request that would go to Awaj:');
    console.log(JSON.stringify({ endpoint: (sent as { endpoint?: string }).endpoint, ...sent.request }, null, 2));
    return;
  }
  if (!('requestId' in sent) || !sent.response?.ok) {
    console.log('Awaj refused the request:', JSON.stringify((sent as { response?: unknown }).response));
    return;
  }
  console.log(`Accepted (${sent.requestId}); waiting for the audio and the call...`);
  let broadcastId: number | null = null;
  for (let i = 0; i < 40 && broadcastId === null; i++) {
    await sleep(3000);
    const st = (await ttsStatus(sent.requestId)).data as { status?: string; broadcast_id?: number | null; error?: string };
    console.log('  TTS status:', st.status ?? JSON.stringify(st));
    if (st.status === 'failed') return console.log('  failed:', st.error);
    if (st.status === 'completed') broadcastId = st.broadcast_id ?? null;
  }
  if (broadcastId === null) return console.log('No broadcast id yet; check the Awaj dashboard.');
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const r = (await broadcastResult(broadcastId)).data as { isComplete?: boolean; results?: unknown[]; broadcast?: { status?: string } };
    if (r.isComplete) return console.log('Result:', JSON.stringify(r.results));
    console.log('  call status:', r.broadcast?.status ?? 'waiting');
  }
  console.log(`Still running; GET /broadcasts/${broadcastId}/result later.`);
}

main().catch(err => {
  console.error(err.message ?? err);
  process.exit(1);
});
