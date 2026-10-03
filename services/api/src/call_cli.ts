/**
 * Test the phone call from a terminal: build the Bangla advice for a place and the crops a farmer named, then read
 * it to one phone through Awaj Digital's Direct TTS Broadcast, wait for the call and print how it went.
 *
 *   npm run call:test -- --to 01XXXXXXXXX --place ADM3_Godagari --crops sunflower,lentil
 *   npm run call:test -- --to 01XXXXXXXXX --text "আমি সূর্যমুখী আর মসুর করতে চাই"
 *   add --live (with AWAJ_API_TOKEN, AWAJ_SENDER and AWAJ_LIVE=1 in .env) to place the real call; otherwise it is
 *   a dry run that prints the script and the exact request.
 */
import { RotationEngine } from '../../../packages/rotation-engine/src/engine.ts';
import { placeFor } from '../../../packages/rotation-engine/src/data/location.ts';
import { replyFor, understand } from './voice.ts';
import { awajConfig, balance, bdMobile, broadcastResult, sendTtsCall, ttsStatus } from './awaj.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const phone = bdMobile(arg('to') ?? '');
  if (!phone) throw new Error('Pass --to 01XXXXXXXXX (a Bangladeshi mobile number)');
  const placeId = arg('place') ?? 'talanda_tanore';
  const place = placeFor(placeId);
  if (!place) throw new Error(`Unknown place ${placeId}; GET /api/v1/places lists them`);
  const text = arg('text');
  const heard = text ? understand(text) : null;
  const crops = heard && (heard.crops.length || heard.notModelled.length)
    ? [...heard.crops, ...heard.notModelled]
    : (arg('crops') ?? '').split(',').map(s => s.trim()).filter(Boolean);

  const advice = new RotationEngine().generateAdvice({
    unionId: place.id,
    unionNameBangla: place.nameBangla,
    upazila: place.upazila,
    district: place.district,
    landType: heard?.landType ?? 'medium_high',
    season: '2026-aman',
    preferredCrops: crops.length ? crops : undefined,
    farmerPriorities: heard?.priorities ?? { water: 0.5, income: 0.3, soil: 0.2 },
  });
  const reply = replyFor(advice, heard);
  console.log(`Place: ${place.nameEnglish}, ${place.district}; crops: ${crops.join(', ') || '(none named)'}`);
  if (heard) console.log('Heard:', JSON.stringify({ crops: heard.crops, excluded: heard.excluded, notModelled: heard.notModelled, land: heard.landType }));
  console.log(`\nCall script (~${reply.durationSecondsEstimate} s):\n${reply.speechBangla}\n\nSMS (${reply.smsSegments} part${reply.smsSegments > 1 ? 's' : ''}):\n${reply.smsBangla}\n`);

  if (process.argv.includes('--live') && !awajConfig().live) {
    throw new Error('--live needs AWAJ_API_TOKEN, AWAJ_SENDER and AWAJ_LIVE=1 (in .env or the environment)');
  }
  if (process.argv.includes('--live')) console.log('Balance:', JSON.stringify((await balance()).data));
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
