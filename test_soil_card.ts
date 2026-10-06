/**
 * Fertilizer advice needs a soil card. Only the pilot (Talanda union, Tanore) has an SRDI card, so at every other place the crop calendar and
 * rotation replay stay, but no fertilizer amount and no Talanda soil number appears anywhere in the advice.
 */
import assert from 'node:assert/strict';
import { RotationEngine } from './packages/rotation-engine/src/engine.ts';
import { NO_SOIL_CARD, placeFor, listPlaces, PILOT_ID } from './packages/rotation-engine/src/data/location.ts';
import { TALANDA_SRDI } from './packages/rotation-engine/src/data/tanore_replay_data.ts';
import { recordFor } from './packages/rotation-engine/src/data/crop_choice.ts';
import { withPlace } from './packages/rotation-engine/src/data/location.ts';
import { cropsFromKeys, keypadMenu, replyFor } from './services/api/src/voice.ts';

console.log('========================================================');
console.log('  SOIL CARD (SRDI) SCOPE TEST SUITE                     ');
console.log('========================================================\n');

const engine = new RotationEngine();
const BASE_REQUEST = {
  unionNameBangla: 'তালন্দ ইউনিয়ন', upazila: 'Tanore', district: 'Rajshahi', landType: 'medium_high' as const, season: '2026-aman',
  farmerPriorities: { water: 0.5, income: 0.3, soil: 0.2 },
};
const advise = (unionId: string, extra: Record<string, unknown> = {}) => engine.generateAdvice({ ...BASE_REQUEST, unionId, ...extra } as any);

/** Every string and number in a JSON value, with the key path it sits under. */
function walk(value: unknown, path = '', out: Array<{ path: string; value: string | number }> = []) {
  if (typeof value === 'string' || typeof value === 'number') out.push({ path, value });
  else if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${path}[${index}]`, out));
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`, out);
  return out;
}

// ---- 1. the place has no card: placeFor
const NON_PILOT = ['ADM3_Godagari', 'ADM3_ChuadangaSadar', 'ADM3_SylhetSadar', 'ADM3_Alamdanga'];
for (const id of NON_PILOT) {
  const place = placeFor(id)!;
  assert.equal(place.kind, 'upazila');
  assert.equal(place.srdi, null, `${id} has no SRDI card`);
  assert.ok(Object.values(place.rabi).every((record: any) => record.fertilizer === null), `${id}: the replay's fertilizer doses (the Talanda card's numbers) are dropped`);
  assert.ok(!/SRDI Talanda card until/.test(place.dataNote), 'the data note no longer says Talanda\'s doses are borrowed');
}
const pilot = placeFor(PILOT_ID)!;
assert.equal(pilot.srdi, TALANDA_SRDI, 'the pilot keeps its card');
assert.equal(placeFor('ADM3_Tanore'), pilot, 'ADM3_Tanore is the pilot');
assert.ok(Object.values(pilot.rabi).every((record: any) => record.fertilizer && record.fertilizer.ureaKgHa > 0), 'the pilot keeps its doses');
assert.equal(listPlaces().length, 544);
// the crop-choice crops carry doses too (SRDI Talanda / BARI numbers): none at a place with no card, all at the pilot
withPlace(placeFor('ADM3_Godagari')!, () => assert.equal(recordFor('potato@11-01')?.fertilizer ?? null, null, 'no crop-choice dose without a card'));
withPlace(pilot, () => assert.ok(recordFor('potato@11-01')?.fertilizer, 'the pilot keeps the crop-choice doses'));
console.log('✓ placeFor: a non-pilot place has no srdi and no replay doses; the pilot keeps both.');

// ---- 2. the planner output for a place with no card: no fertilizer number anywhere
const FERT_NUMBER = /(urea|tsp|mop|potash|gypsum|zinc|ইউরিয়া|টিএসপি|এমওপি|পটাশ|জিপসাম|জিংক)[^.।]*[0-9০-৯]/i;
const KG_OF_FERT = /[0-9০-৯][^.।]*(kg|কেজি)[^.।]*(urea|tsp|mop|ইউরিয়া|টিএসপি|এমওপি)/i;
const REQUESTS: Array<Record<string, unknown>> = [
  {}, // the default plan
  { preferredCrops: ['potato'] },
  { preferredCrops: ['sunflower', 'mungbean'] },
  { heroCrop: 'wheat', avoidCrops: ['rice'] },
  { currentAmanCrop: 'BRRI dhan49' },
];
let checked = 0;
for (const id of NON_PILOT) {
  for (const extra of REQUESTS) {
    const advice = advise(id, extra);
    assert.ok(advice.options.length > 0, `${id}: the crop calendar and rotation options are still produced`);
    for (const option of advice.options) {
      assert.equal(option.ledger?.ureaKgHa, null, `${id} ${option.id}: no urea total`);
      assert.ok(option.timeline.length > 0 && option.approvedActionBangla.length > 0, 'the calendar stays');
      assert.ok(option.ledger!.groundwaterPumpedM3PerHa >= 0, 'the water ledger stays');
      const soil = option.dimensionDetails.soil;
      const pest = option.dimensionDetails.pest;
      for (const key of ['rabiUreaKgHa', 'rabiTspKgHa', 'rabiMopKgHa', 'rotationUreaKgHa', 'srdiSoilType']) assert.equal(soil.metrics[key], null, `${id} ${option.id}: soil.${key}`);
      assert.equal(pest.metrics.rotationUreaKgHa, null, `${id} ${option.id}: pest.rotationUreaKgHa`);
      assert.equal(soil.summaryBangla.includes(NO_SOIL_CARD.bn), true, 'the soil text carries the plain message (Bangla)');
      assert.equal(soil.summaryEnglish.includes(NO_SOIL_CARD.en), true, 'and in English');
      const tip = option.stewardship!.find(t => t.kind === 'fertilizer')!;
      assert.ok(tip.bn.includes(NO_SOIL_CARD.bn) && tip.en.includes(NO_SOIL_CARD.en), `${id} ${option.id}: the fertilizer tip is the message`);
      assert.ok(option.stewardship!.some(t => t.kind === 'water') && option.stewardship!.some(t => t.kind === 'metals'), 'the other tips stay');
      assert.ok(!option.ipmActions!.some(t => /SRDI/.test(t.en) || /SRDI/.test(t.bn)), 'no IPM tip leans on the SRDI card');
    }
    assert.equal(advice.farmer_card!.season2.fertilizerBangla, NO_SOIL_CARD.bn, `${id}: the farmer card says there is no fertilizer advice`);
    assert.equal((advice.farmer_card!.season2 as any).fertilizerEnglish, NO_SOIL_CARD.en);
    // no fertilizer amount in any text or number of the whole answer
    for (const { path, value } of walk(advice)) {
      if (typeof value === 'number') {
        assert.ok(!/ureaKgHa|tspKgHa|mopKgHa|gypsumKgHa|zincSulphateKgHa|boricAcidKgHa/.test(path), `${id}: numeric fertilizer field ${path}`);
        continue;
      }
      const text = value.replace(NO_SOIL_CARD.bn, '').replace(NO_SOIL_CARD.en, '');
      assert.ok(!FERT_NUMBER.test(text) && !KG_OF_FERT.test(text), `${id}: a fertilizer amount in ${path}: ${text.slice(0, 120)}`);
      assert.ok(!/SRDI Talanda|তালন্দ কার্ড|Kharia/.test(text), `${id}: a Talanda soil card reference in ${path}: ${text.slice(0, 120)}`);
    }
    checked += 1;
  }
}
console.log(`✓ Planner: ${checked} plans at ${NON_PILOT.length} places keep the calendar and rotation, carry the plain message and no fertilizer number.`);

// the detector itself works: it flags the pilot's real fertilizer text
assert.ok(walk(advise(PILOT_ID)).some(({ value }) => typeof value === 'string' && (FERT_NUMBER.test(value) || KG_OF_FERT.test(value))), 'control: the check finds fertilizer amounts where they exist');

// ---- 3. the pilot is unchanged
const pilotAdvice = advise(PILOT_ID);
const top = pilotAdvice.options[0];
assert.equal(typeof top.ledger!.ureaKgHa, 'number');
assert.ok((top.ledger!.ureaKgHa as number) > 0);
assert.equal(typeof top.dimensionDetails.soil.metrics.rotationUreaKgHa, 'number');
assert.equal(top.dimensionDetails.soil.metrics.srdiSoilType, TALANDA_SRDI.soilTypeBangla);
assert.match(top.dimensionDetails.soil.summaryEnglish, /SRDI Talanda card|BARI handbook/);
assert.match(top.stewardship!.find(t => t.kind === 'fertilizer')!.en, /\d+(\.\d+)? kg/);
assert.match(pilotAdvice.farmer_card!.season2.fertilizerBangla, /ইউরিয়া.*টিএসপি.*এমওপি/);
assert.equal((pilotAdvice.farmer_card!.season2 as any).fertilizerEnglish, undefined, 'the pilot\'s farmer card has no extra field');
assert.ok(!JSON.stringify(pilotAdvice).includes(NO_SOIL_CARD.bn), 'the message never appears at the pilot');
assert.ok(pilotAdvice.options.some(o => o.ipmActions!.some(t => /SRDI/.test(t.en))), 'the pilot keeps its SRDI IPM tip');
assert.ok(placeFor('ADM3_Tanore') === pilot && advise('ADM3_Tanore').options[0].ledger!.ureaKgHa === top.ledger!.ureaKgHa, 'ADM3_Tanore advises like the pilot');
console.log('✓ Pilot: the same fertilizer numbers, SRDI texts and IPM tips as before; the message never appears.\n');

// ---- 4. the keypad survey replies (what the survey webhook sends by voice and SMS): the reply builder is called directly, as the webhook does
const SOIL_CARD_TEXT = /SRDI|Kharia|খিয়ার|এসআরডিআই|Talanda card|তালন্দ কার্ড/;
const PLACE_WORDS = /তালন্দ|Talanda|তানোর|Tanore/;
const place = (id: string) => placeFor(id)!;
const keypadReply = (unionId: string, keys: string[]) => {
  const { crops, officer } = cropsFromKeys(keys);
  if (!crops.length) return { officer, texts: [] as string[] }; // keypad 9 alone: a call-back for the officer, no spoken advice
  const p = place(unionId);
  const advice = advise(unionId, { unionNameBangla: p.nameBangla, upazila: p.upazila, district: p.district, preferredCrops: crops });
  const reply = replyFor(advice);
  return { officer, texts: [reply.speechBangla, reply.smsBangla, keypadMenu().promptBangla] };
};
let keypadTexts = 0;
for (const keys of [['1'], ['2'], ['3'], ['4'], ['5'], ['6'], ['7'], ['8'], ['9'], ['9', '1'], ['4', '8', '9'], ['1', '2', '3']]) {
  for (const id of ['ADM3_Godagari', 'ADM3_ChuadangaSadar']) {
    const { officer, texts } = keypadReply(id, keys);
    assert.equal(officer, keys.includes('9'), 'keypad 9 still asks for the officer');
    for (const text of texts) {
      assert.ok(text.length > 0);
      assert.ok(!FERT_NUMBER.test(text) && !KG_OF_FERT.test(text), `${id} keys ${keys.join('+')}: a fertilizer amount in "${text.slice(0, 100)}"`);
      assert.ok(!SOIL_CARD_TEXT.test(text) && !PLACE_WORDS.test(text), `${id} keys ${keys.join('+')}: Talanda or soil-card text in "${text.slice(0, 100)}"`);
      keypadTexts += 1;
    }
  }
}
assert.deepEqual(keypadReply('ADM3_Godagari', ['9']).texts, [], 'keypad 9 alone sends no advice text');
assert.ok(keypadTexts >= 40, `the check covers the keypad replies (${keypadTexts} texts)`);
const pilotReply = keypadReply(PILOT_ID, ['1']);
assert.ok(pilotReply.texts[0].length > 50, 'the pilot\'s keypad reply is still produced');
console.log(`✓ Keypad survey replies: ${keypadTexts} spoken and SMS texts at two non-pilot places carry no fertilizer amount, soil card text or Talanda name; keypad 9 still asks for the officer.\n`);

console.log('========================================================');
console.log('  ALL SOIL CARD SCOPE TESTS PASSED                      ');
console.log('========================================================\n');
