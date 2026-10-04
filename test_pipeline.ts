import fs from 'node:fs';
import { RotationEngine, UnsupportedUnionError } from './packages/rotation-engine/src/engine.ts';
import { TANORE_LEDGER_RESEARCH, TANORE_RABI_REPLAY } from './packages/rotation-engine/src/data/tanore_replay_data.ts';
import { DualGateNarrationValidator, type ILocalLLMClient } from './packages/narration-core/src/dual_gate_validator.ts';
import { TemplateNarrator } from './packages/narration-core/src/template_narrator.ts';
import { understandRequest } from './packages/rotation-engine/src/understand.ts';

const BN = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const bn = (v: unknown) => String(v).replace(/\d/g, d => BN[Number(d)]);

const TALANDA = {
  unionId: 'talanda_tanore',
  unionNameBangla: 'তালন্দ ইউনিয়ন',
  upazila: 'Tanore',
  district: 'Rajshahi',
  landType: 'medium_high' as const,
  season: '2026-aman',
};

async function runTests() {
  console.log('========================================================');
  console.log('  EDEN Engine & Dual-Gate Narration Test Suite  ');
  console.log('========================================================\n');

  // TEST 1: Rotation Engine Initialization & Deterministic Replay
  console.log('[TEST 1] Testing Deterministic Rotation Engine for Talanda Union...');
  const engine = new RotationEngine();
  const advice = engine.generateAdvice({ ...TALANDA, farmerPriorities: { water: 0.5, income: 0.3, soil: 0.2 } });

  console.log(`Generated Advice ID: ${advice.advice_id} (data release ${advice.data_release})`);
  console.log(`Number of candidate rotations: ${advice.options.length}`);
  console.log(`Top recommended rotation: ${advice.options[0].nameBangla}`);
  console.log(`Top rotation score: ${advice.options[0].totalWeightedScore}`);
  console.log(`Scores breakdown:`, advice.options[0].scores);

  if (advice.options[0].id !== 'rot_dhan71_lentil') {
    throw new Error(`Expected rot_dhan71_lentil to be ranked #1, got: ${advice.options[0].id}`);
  }
  console.log('✓ TEST 1 PASSED: BRRI dhan71 -> Lentil is correctly ranked #1.\n');

  // TEST 2: Pluggable Feature Registry (Minus Feature)
  console.log('[TEST 2] Testing Plug-and-Play Feature Registry (Disabling Flood Dimension)...');
  const flagEngine = new RotationEngine();
  const registry = flagEngine.getRegistry();
  console.log(`Active plugins before: ${registry.getActivePlugins().map(p => p.id).join(', ')}`);

  registry.setFeatureFlag('flood', false);
  console.log(`Active plugins after disabling flood: ${registry.getActivePlugins().map(p => p.id).join(', ')}`);

  const adviceWithoutFlood = flagEngine.generateAdvice({ ...TALANDA, farmerPriorities: { water: 0.6, income: 0.4 } });

  if (adviceWithoutFlood.active_plugins.includes('flood') || 'flood' in adviceWithoutFlood.options[0].scores) {
    throw new Error('Flood dimension was supposed to be inactive!');
  }
  console.log(`Scores without flood:`, adviceWithoutFlood.options[0].scores);
  console.log('✓ TEST 2 PASSED: Feature minus successful with dynamic re-weighting.\n');

  // TEST 3: Deterministic Template Narrator
  console.log('[TEST 3] Testing Deterministic Bangla Template Narrator...');
  const templateNarrator = new TemplateNarrator();
  const templateResult = templateNarrator.render(advice);
  console.log(`Template Bangla Speech: "${templateResult.banglaSpeechText}"`);
  console.log(`Keypad Prompt: "${templateResult.banglaKeypadPrompt}"`);
  const speech = templateResult.banglaSpeechText;
  if (!speech.includes('তালন্দ ইউনিয়নের') || !speech.includes('ব্রি ধান৭১')) {
    throw new Error('Template text missing critical union or variety name!');
  }
  if (/[0-9]/.test(speech) || speech.includes('ইউনিয়ন ইউনিয়ন')) {
    throw new Error('Spoken Bangla must use Bangla digits and name the union once.');
  }
  console.log('✓ TEST 3 PASSED: Template narration is fluent and verified.\n');

  // TEST 4: Dual-Gate Pipeline with Compliant Local LLM (it only repeats approved facts)
  console.log('[TEST 4] Testing Dual-Gate Pipeline with Compliant Local LLM...');
  const top = advice.options[0];
  const water = top.dimensionDetails['water'].metrics;
  const compliantLLM: ILocalLLMClient = {
    async generate() {
      return `তালন্দ ইউনিয়নের জন্য ব্রি ধান৭১ ও মসুর চাষ সবচেয়ে উপযোগী। ${bn(water.totalSeasonsSimulated)} মৌসুমে ${bn(water.amanRescueIrrigationSeasons)} বার বাড়তি সেচ লেগেছে এবং ${top.fieldFreeDateBangla}ের মধ্যে ধান কাটা শেষ হবে।`;
    },
  };
  const validatorCompliant = new DualGateNarrationValidator(compliantLLM);
  const resultCompliant = await validatorCompliant.narrate(advice);
  console.log(`Engine used: ${resultCompliant.status}`);
  console.log(`Audit Log:`, resultCompliant.auditLog);
  if (resultCompliant.status !== 'local_model_checked') {
    throw new Error('Expected local_model_checked for compliant LLM output!');
  }
  console.log('✓ TEST 4 PASSED: Compliant LLM passed Gate 1 and Gate 2.\n');

  // TEST 5: Dual-Gate Pipeline with Adversarial / Hallucinating LLM
  console.log('[TEST 5] Testing Dual-Gate Pipeline against Hallucinating LLM (Fake numbers & forbidden loan)...');
  const adversarialLLM: ILocalLLMClient = {
    async generate() {
      // Injects an unapproved yield "১২ টন", an unapproved dose "৫০ কেজি" and the forbidden word "ঋণ"
      return 'এই জাত লাগালে ১২ টন ফলন পাওয়া যাবে এবং ৫০ কেজি ইউরিয়া সার লাগবে। কৃষি ব্যাংক থেকে ঋণ নিন।';
    },
  };
  const validatorAdversarial = new DualGateNarrationValidator(adversarialLLM);
  const resultAdversarial = await validatorAdversarial.narrate(advice);
  console.log(`Engine used after rejection: ${resultAdversarial.status}`);
  console.log(`Unapproved numbers caught by Gate 2:`, resultAdversarial.auditLog.unapprovedNumbersFound);
  console.log(`Unapproved actions caught by Gate 2:`, resultAdversarial.auditLog.unapprovedActionsFound);
  console.log(`Safe Fallback Speech Text: "${resultAdversarial.banglaSpeechText}"`);

  if (resultAdversarial.status !== 'fallback_template') {
    throw new Error('Expected fallback_template for adversarial LLM output!');
  }
  if (!resultAdversarial.auditLog.unapprovedNumbersFound.includes('১২')) {
    throw new Error('Gate 2 failed to catch hallucinated number 12!');
  }
  console.log('✓ TEST 5 PASSED: Adversarial hallucination caught and safely rejected to Template.\n');

  // TEST 6: Boro is scored with Boro's own research numbers (regression: it once fell back to lentil)
  console.log('[TEST 6] Testing that the Boro baseline uses Boro data...');
  const boro = advice.options.find(o => o.id === 'rot_dhan49_boro_conventional');
  const boroData = TANORE_RABI_REPLAY['BRRI dhan28'];
  if (!boro) throw new Error('Boro baseline missing from the options');
  const boroWater = boro.dimensionDetails['water'].metrics;
  const boroHeat = boro.dimensionDetails['heat'].metrics;
  console.log(`Boro irrigation ${boroWater.rabiNetIrrigationMm} mm, hot days ${boroHeat.hotDays}/${boroHeat.sensitiveWindowDays}`);
  if (boroWater.rabiNetIrrigationMm !== boroData.netIrrigationMm || boroHeat.hotDays !== boroData.heat?.hotDays) {
    throw new Error('Boro rotation is not scored with the Boro replay record!');
  }
  if (boro.scores.water >= top.scores.water) {
    throw new Error('Boro should need more irrigation than the recommended rotation.');
  }
  console.log('✓ TEST 6 PASSED: Boro baseline carries its own water and heat numbers.\n');

  // TEST 7: Unions without research data are refused, not answered with Talanda's numbers
  console.log('[TEST 7] Testing that an unmodelled union is refused...');
  let refused = false;
  try {
    engine.generateAdvice({ ...TALANDA, unionId: 'selborash_dharmapasha', landType: 'low', farmerPriorities: {} });
  } catch (err) {
    refused = err instanceof UnsupportedUnionError;
  }
  if (!refused) throw new Error('Expected UnsupportedUnionError for a union without research data');
  console.log('✓ TEST 7 PASSED: Only unions with research data get advice.\n');

  // TEST 8: A stated priority leads the ranking (keypad 1 = water)
  console.log('[TEST 8] Testing that the water priority puts the best water score first...');
  const waterFirst = engine.generateAdvice({ ...TALANDA, farmerPriorities: { water: 1 } });
  const bestWater = Math.max(...waterFirst.options.map(o => o.scores.water));
  console.log(`Water-first top: ${waterFirst.options[0].nameBangla} (water ${waterFirst.options[0].scores.water})`);
  if (waterFirst.options[0].scores.water !== bestWater) {
    throw new Error('With only a water priority, the top option should have the best water score.');
  }
  console.log('✓ TEST 8 PASSED: Farmer priorities steer the ranking.\n');

  // TEST 9: The Android app's offline seed shows the same advice as the engine
  console.log('[TEST 9] Testing that the Android offline seed matches the engine...');
  const seed = fs.readFileSync('apps/farmer-mobile/app/src/main/java/org/projecteden/farmermobile/data/model/AdviceModels.kt', 'utf8');
  const card = advice.farmer_card!;
  const mustMatch = [card.rotationTitleBangla, card.season1.variety, card.season1.irrigationBangla, card.season2.variety, card.season2.fertilizerBangla, card.alternative.name];
  const drifted = mustMatch.filter(text => !seed.includes(text));
  if (drifted.length) {
    throw new Error(`Android seed (AdviceModels.kt) drifted from the engine: ${drifted.join(' | ')}`);
  }
  console.log('✓ TEST 9 PASSED: Offline seed and engine agree.\n');

  // TEST 10: Pest pressure (IPM) and the English outputs
  console.log('[TEST 10] Testing the pest-pressure score, IPM steps and English outputs...');
  const lentil = advice.options.find(o => o.id === 'rot_dhan71_lentil')!;
  console.log(`Pest score: lentil ${lentil.scores.pest}, Boro ${boro.scores.pest}`);
  if (!(lentil.scores.pest > boro.scores.pest) || boro.dimensionDetails['pest'].metrics.breaksRicePestCycle !== false) {
    throw new Error('Rice after rice should carry more pest pressure than lentil after rice.');
  }
  if (!lentil.ipmActions?.length || lentil.ipmActions.some(tip => !tip.bn || !tip.en || !tip.source)) {
    throw new Error('Every rotation needs sourced IPM steps in Bangla and English.');
  }
  if (lentil.approvedActionEnglish?.length !== lentil.approvedActionBangla.length || !lentil.fieldFreeDateEnglish || !advice.farmer_summary_english || lentil.timeline.some(s => !s.cropNameEnglish)) {
    throw new Error('English versions are missing from the advice.');
  }
  const pestFirst = engine.generateAdvice({ ...TALANDA, farmerPriorities: { pest: 1 } });
  if (pestFirst.options[0].isBaseline || pestFirst.options[pestFirst.options.length - 1].id !== 'rot_dhan49_boro_conventional') {
    throw new Error('With a pest priority, the Boro baseline should rank last.');
  }
  console.log('✓ TEST 10 PASSED: Rotation lowers pest pressure; IPM steps and English text are present.\n');

  // TEST 11: The environment ledger reproduces the research ledger (explore/environment_ledger.py)
  console.log('[TEST 11] Testing that the environment ledger matches the research ledger...');
  const ledgerIds: Record<string, string> = {
    'BRRI dhan49 then Boro (BRRI dhan28)': 'rot_dhan49_boro_conventional',
    'BRRI dhan49 then wheat, sown 20 Nov': 'rot_dhan49_wheat_early',
    'BRRI dhan71 then lentil': 'rot_dhan71_lentil',
    'BRRI dhan71 then mustard': 'rot_dhan71_mustard',
  };
  for (const row of TANORE_LEDGER_RESEARCH) {
    const l = advice.options.find(o => o.id === ledgerIds[row.rotation])?.ledger;
    if (!l || l.groundwaterPumpedM3PerHa !== row.pumpedM3PerHa || l.floodedRiceDays !== row.floodedRiceDays || l.ureaKgHa !== row.ureaKgHa || l.bareDays !== row.bareDays) {
      throw new Error(`Ledger drifted for ${row.rotation}: ${JSON.stringify(l)} vs ${JSON.stringify(row)}`);
    }
  }
  console.log(`Flooded rice days: Boro rotation ${boro.ledger?.floodedRiceDays}, lentil rotation ${lentil.ledger?.floodedRiceDays}`);
  console.log(`✓ TEST 11 PASSED: The engine reproduces the research ledger for ${TANORE_LEDGER_RESEARCH.length} rotations.
`);

  // TEST 12: The farmer's own crops: every plan holds them, and every crop fits the calendar
  console.log('[TEST 12] Testing plans built around the crops a farmer names...');
  const chosen = engine.generateAdvice({ ...TALANDA, preferredCrops: ['sunflower', 'lentil', 'onion'], farmerPriorities: { water: 0.5, income: 0.3, soil: 0.2 } });
  const choice = chosen.crop_choice!;
  const holds = (o: typeof chosen.options[number], crop: string) => o.cropSequence.slice(1).some(p => p.crop.toLowerCase() === crop);
  if (!choice || chosen.options.some(o => !holds(o, 'sunflower') && !holds(o, 'lentil'))) {
    throw new Error('Every option must hold sunflower or lentil');
  }
  if (!choice.fits.every(f => f.fits) || !choice.notModelled.some(n => n.id === 'onion')) {
    throw new Error('Sunflower and lentil should fit at Talanda, and onion should be reported as not modelled');
  }
  if (!chosen.options.some(o => holds(o, 'sunflower') && o.cropSequence.length === 2)) {
    throw new Error('Winter sunflower on its own should be among the options');
  }
  for (const o of chosen.options) {
    const [aman, rabi, k1] = o.cropSequence;
    const sown = o.timeline.some(s => /sowing|transplanting/.test(s.cropNameEnglish ?? '') && (s.cropNameEnglish ?? '').toLowerCase().includes(rabi.crop.toLowerCase()));
    if (!aman.variety.startsWith('BRRI') || !sown) throw new Error(`${o.id}: the timeline does not show the ${rabi.crop} sowing`);
    if (k1 && !o.approvedActionEnglish?.some(a => a.includes('before Aman'))) throw new Error(`${o.id}: the Kharif-1 crop must be off the field before Aman`);
  }
  console.log(`Top for sunflower + lentil: ${chosen.options[0].nameEnglish}`);
  console.log(`Notes: ${choice.notesEnglish.join(' | ')}`);
  const k1Only = engine.generateAdvice({ ...TALANDA, preferredCrops: ['mungbean'], farmerPriorities: { water: 1 } });
  if (k1Only.options.some(o => !o.cropSequence.some((p, i) => i !== 1 && p.crop === 'Mungbean'))) {
    throw new Error('Mungbean alone is planned before the next monsoon or in it, around the best winter crop, in every option');
  }
  const plain = engine.generateAdvice({ ...TALANDA, farmerPriorities: { water: 0.5, income: 0.3, soil: 0.2 } });
  if (plain.crop_choice || plain.options.map(o => o.id).join() !== advice.options.map(o => o.id).join()) {
    throw new Error('Without named crops the five fixed rotations must stay as they were');
  }
  console.log('✓ TEST 12 PASSED: Plans follow the farmer\'s crops and the calendar.\n');

  // TEST 13: A spoken or typed request becomes crop ids, exclusions and the land type
  console.log('[TEST 13] Testing the Bangla request reader...');
  const heard = understandRequest('আমি সূর্যমুখী আর কিছু মসুর ডাল করতে চাই। আমার নিচু জমি, বোরো করব না');
  if (heard.crops.join() !== 'sunflower,lentil' || heard.excluded.join() !== 'boro' || heard.landType !== 'low') {
    throw new Error(`Request read wrongly: ${JSON.stringify(heard)}`);
  }
  if (understandRequest('মিষ্টি আলু আর আলু').crops.join() !== 'sweetpotato,potato' || understandRequest('আমি মুগ্ধ, গমগম করছে').crops.length) {
    throw new Error('The reader must tell sweet potato from potato and ignore look-alike words');
  }
  console.log(`Heard: ${JSON.stringify({ crops: heard.crops, excluded: heard.excluded, land: heard.landType })}`);
  console.log('✓ TEST 13 PASSED: Requests in Bangla are read into crops.\n');

  // TEST 14: Any crop as the main crop, and no rice at all when the farmer says so
  console.log('[TEST 14] Testing a main crop other than rice, with rice left out...');
  const noRice = engine.generateAdvice({ ...TALANDA, heroCrop: 'wheat', avoidCrops: ['rice'], farmerPriorities: { water: 0.5, income: 0.3, soil: 0.2 } });
  const riceIn = (o: typeof noRice.options[number]) => o.cropSequence.some(p => p.seasonType === 'Aman' || p.seasonType === 'Aus' || p.crop === 'Boro rice');
  if (!noRice.options.length || noRice.options.some(o => !o.cropSequence.some(p => p.crop === 'Wheat') || riceIn(o))) {
    throw new Error('Every option must hold wheat and no rice');
  }
  if (noRice.crop_choice?.heroCrop !== 'wheat' || !noRice.crop_choice.avoided.includes('aman')) {
    throw new Error('The advice must say the plan follows the main crop and leaves rice out');
  }
  const monsoon = noRice.options.map(o => o.cropSequence[0]);
  if (!monsoon.every(p => p.seasonType === 'Kharif-2') || !noRice.options[0].timeline.length || noRice.options.some(o => o.dimensionDetails.pest.metrics.riceCropsInYear !== 0)) {
    throw new Error('Without rice the monsoon slot holds another crop or nothing, and rice pests lose their host');
  }
  const sunflowerHero = engine.generateAdvice({ ...TALANDA, heroCrop: 'sunflower', avoidCrops: ['rice'], landType: 'high', farmerPriorities: { water: 0.5, income: 0.3, soil: 0.2 } });
  if (sunflowerHero.options[0].cropSequence[1].crop !== 'Sunflower') {
    throw new Error('A main crop goes in its own season first (winter sunflower before summer sunflower)');
  }
  const jute = engine.generateAdvice({ ...TALANDA, heroCrop: 'jute', farmerPriorities: { water: 0.5, income: 0.3, soil: 0.2 } });
  const juteTop = jute.options[0];
  if (!juteTop.cropSequence.some(p => p.crop === 'Jute') || !juteTop.timeline.some(s => s.cropNameEnglish === 'Jute harvest')) {
    throw new Error('Jute plans show the August jute harvest at the start of the cycle');
  }
  console.log(`Wheat, no rice: ${noRice.options[0].nameEnglish}`);
  console.log(`Sunflower as main crop: ${sunflowerHero.options[0].nameEnglish}`);
  console.log('✓ TEST 14 PASSED: Any crop can lead the year, and rice can be left out.\n');

  // TEST 15: Soil-and-water tips with numbers from the plan's own records
  console.log('[TEST 15] Testing the soil-and-water tips...');
  const tips = lentil.stewardship ?? [];
  const kinds = new Set(tips.map(t => t.kind));
  if (!['water', 'fertilizer', 'pesticide', 'metals'].every(k => kinds.has(k as never)) || tips.some(t => !t.bn || !t.en || !t.source)) {
    throw new Error('Every option needs sourced water, fertilizer, pesticide and metal tips in Bangla and English');
  }
  if (!tips.find(t => t.kind === 'water')!.en.includes('less groundwater') || !(boro.stewardship ?? []).find(t => t.kind === 'metals')!.en.includes('alternate wetting')) {
    throw new Error('Lentil must show its groundwater saving; the Boro baseline must get the AWD arsenic advice instead of a saving');
  }
  console.log(`Lentil water tip: ${tips.find(t => t.kind === 'water')!.en}`);
  console.log('✓ TEST 15 PASSED: Soil-and-water tips carry numbers and sources.\n');

  // TEST 16: NASA data behind the old limits: PEST-CHEMGRIDS pesticide, MERRA-2 waterlogging, measured jute Kc, prices
  console.log('[TEST 16] Testing pesticide estimates, waterlogging, jute and the new crop incomes...');
  const pestTip = (o: { stewardship?: Array<{ kind: string; en: string; source: string }> }) => o.stewardship!.find(t => t.kind === 'pesticide')!;
  if (!pestTip(lentil).en.includes('PEST-CHEMGRIDS') || !/about \d+% less/.test(pestTip(lentil).en) || !pestTip(lentil).source.includes('PEST-CHEMGRIDS')) {
    throw new Error('Aman then lentil must show less pesticide than Aman-Boro, from NASA SEDAC PEST-CHEMGRIDS');
  }
  const potato = engine.generateAdvice({ ...TALANDA, farmerPriorities: { water: 0.5, income: 0.3, soil: 0.2 }, preferredCrops: ['potato'] }).options[0];
  if (!/% more/.test(pestTip(potato).en)) throw new Error('A potato plan must show more pesticide than Aman-Boro');
  const soaked = (place: string) => {
    const opts = engine.generateAdvice({ ...TALANDA, unionId: place, farmerPriorities: { water: 0.5, income: 0.3, soil: 0.2 }, heroCrop: 'wheat', avoidCrops: ['rice'] }).options;
    const mung = opts.find(o => o.cropSequence.some(c => c.seasonType === 'Kharif-2' && c.crop === 'Mungbean'))!;
    return { days: mung.dimensionDetails.flood.metrics.kharif2WaterloggedDays as number, score: mung.scores.flood };
  };
  const dry = soaked('ADM3_Godagari');
  const wet = soaked('ADM3_SylhetSadar');
  if (!(wet.days > dry.days && wet.score < dry.score)) {
    throw new Error(`Monsoon mungbean must be wetter and riskier in Sylhet than in Godagari (${JSON.stringify({ dry, wet })})`);
  }
  const replay = JSON.parse(fs.readFileSync('packages/rotation-engine/src/data/crop_choice_replay.json', 'utf8'));
  if (replay.crops.jute.kcAssumed || !replay.crops.jute.kcSource.includes('Barman')) throw new Error('Jute must use the measured crop coefficients');
  const chickpea = engine.generateAdvice({ ...TALANDA, farmerPriorities: { water: 0.5, income: 0.3, soil: 0.2 }, preferredCrops: ['chickpea'] }).options[0];
  if (!chickpea.dimensionDetails.income.provenance.source.includes('BBS 2024-25 harvest price')) {
    throw new Error('Chickpea must get an income estimate from BBS prices and yields');
  }
  console.log(`Pesticide, lentil: ${pestTip(lentil).en.split('. ')[0]}`);
  console.log(`Monsoon mungbean waterlogged days: Godagari ${dry.days} (flood ${dry.score}), Sylhet Sadar ${wet.days} (flood ${wet.score})`);
  console.log('✓ TEST 16 PASSED: Pesticide, waterlogging, jute and crop incomes come from NASA and BBS data.\n');

  console.log('========================================================');
  console.log('  ALL 16 CORE TESTS PASSED SUCCESSFULLY!                ');
  console.log('========================================================');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
