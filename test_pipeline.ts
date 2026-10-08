import fs from 'node:fs';
import { RotationEngine, UnsupportedUnionError } from './packages/rotation-engine/src/engine.ts';
import { TANORE_LEDGER_RESEARCH, TANORE_RABI_REPLAY } from './packages/rotation-engine/src/data/tanore_replay_data.ts';
import { DualGateNarrationValidator, type ILocalLLMClient } from './packages/narration-core/src/dual_gate_validator.ts';
import { TemplateNarrator } from './packages/narration-core/src/template_narrator.ts';
import { understandRequest } from './packages/rotation-engine/src/understand.ts';
import { placeFor } from './packages/rotation-engine/src/data/location.ts';

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
  // Upland monsoon crops go on high land only (data/land.ts), so the waterlogging comparison is made there
  const soaked = (place: string) => {
    const opts = engine.generateAdvice({ ...TALANDA, unionId: place, landType: 'high', farmerPriorities: { water: 0.5, income: 0.3, soil: 0.2 }, heroCrop: 'wheat', avoidCrops: ['rice'] }).options;
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

  // TEST 17: Advice that fits the place: land type, what farmers grow, flash floods, district yields, today's soil
  console.log('[TEST 17] Testing advice that fits each upazila...');
  const at = (unionId: string, extra: Record<string, unknown> = {}) => {
    const place = placeFor(unionId)!;
    return engine.generateAdvice({
      unionId, unionNameBangla: place.nameBangla, upazila: place.upazila, district: place.district, landType: place.defaultLandType,
      landTypeAssumed: true, season: '2026-aman', farmerPriorities: { water: 0.5, income: 0.3, soil: 0.2 }, ...extra,
    } as Parameters<typeof engine.generateAdvice>[0]);
  };
  const winterOf = (o: typeof advice.options[number]) => o.cropSequence.find(p => p.seasonType === 'Rabi')!;
  // Haor low land (NASA NASADEM + Landsat + BRRI survey): no Aman, Boro cut before the flash floods in most springs
  const haor = at('ADM3_Khaliajuri');
  if (haor.scope.land_type !== 'low' || haor.options.some(o => o.cropSequence[0].seasonType === 'Aman')) {
    throw new Error('Khaliajuri is haor low land: no option may hold Aman');
  }
  const haorFlood = haor.options[0].dimensionDetails.flood.metrics;
  if (winterOf(haor.options[0]).crop !== 'Boro rice' || (haorFlood.flashFloodCaught as number) / (haorFlood.flashFloodSeasons as number) >= 0.4
    || !['flash_flood', 'deep_flooding'].every(h => haor.local_context!.hazards.includes(h))) {
    throw new Error('Haor low land gets a Boro cut before the flash floods in most springs, with both hazards named');
  }
  // NASA OPERA radar: haor low land is free when 80% of the 2025 monsoon water had drained (11 Dec), not on a fixed date
  const haorContext = JSON.stringify(haor.local_context);
  if (!haorContext.includes('NASA OPERA radar (2025)') || !haorContext.includes('free from ~11 Dec')) {
    throw new Error('Haor low land takes its free date from the OPERA radar drain date');
  }
  const higher = at('ADM3_Khaliajuri', { landType: 'medium_high', landTypeAssumed: false });
  if (!higher.options.every(o => o.cropSequence[0].seasonType === 'Aman') || higher.local_context!.landTypeAssumed) {
    throw new Error('When the farmer says the field is higher, Aman comes back');
  }
  // SRDI's salinity survey: Shyamnagar's saline land keeps barley and sunflower and leaves out salt-sensitive crops
  const coast = at('ADM3_Shyamnagar');
  const coastWinters = coast.options.map(o => winterOf(o).crop);
  if (!coast.local_context!.hazards.includes('salinity') || !coast.stale_or_missing_inputs.some(s => s.dataset === 'Soil salinity')
    || coastWinters.some(c => ['Lentil', 'Potato', 'Maize', 'Boro rice'].includes(c)) || !coastWinters.some(c => c === 'Barley' || c === 'Sunflower')) {
    throw new Error(`Shyamnagar (99% saline, SRDI 2009) must name salinity and plan salt-tolerant winter crops (got ${coastWinters.join(', ')})`);
  }
  // District yields move income: Faridpur grows the most lentil, above the national yield
  const faridpur = at('ADM3_FaridpurSadar');
  const lentilPlan = faridpur.options.find(o => winterOf(o).crop === 'Lentil');
  if (!lentilPlan || (lentilPlan.dimensionDetails.income.metrics.districtYieldTPerHa as number) <= (lentilPlan.dimensionDetails.income.metrics.nationalYieldTPerHa as number)) {
    throw new Error('Faridpur must offer lentil, with its district yield above the national one');
  }
  // Different places, different plans
  const sample = ['ADM3_FaridpurSadar', 'ADM3_MunshiganjSadar', 'ADM3_Khaliajuri', 'ADM3_Nachole', 'ADM3_Shyamnagar', 'ADM3_PanchagarhSadar', 'ADM3_Chatkhil', 'ADM3_SylhetSadar', 'ADM3_Godagari', 'ADM3_BholaSadar'];
  const winters = new Set(sample.map(id => winterOf(at(id).options[0]).crop));
  if (winters.size < 4) throw new Error(`Ten upazilas across the country should not share one winter crop (got ${[...winters].join(', ')})`);
  // Today's NASA reading: a dry soil in October costs the replay's 50 mm of residual water; in March it does not
  const drySoil = { date: '2026-10-01', soilStatus: 'dry', soilRank: 0, soilYears: 10, rain30PctOfNormal: 45, source: 'test' };
  const october = at('ADM3_FaridpurSadar', { currentConditions: drySoil, today: '2026-10-05' });
  const march = at('ADM3_FaridpurSadar', { currentConditions: drySoil, today: '2027-03-01' });
  const lentilOct = october.options.find(o => winterOf(o).crop === 'Lentil')!;
  const lentilMar = march.options.find(o => o.id === lentilOct.id)!;
  if (lentilOct.dimensionDetails.water.metrics.dryStartExtraMm !== 50 || !lentilOct.approvedActionIds.includes('action_dry_start')
    || !october.local_context!.hazards.includes('dry_start') || lentilMar.dimensionDetails.water.metrics.dryStartExtraMm !== undefined) {
    throw new Error('A dry soil before the winter sowing adds 50 mm and a sowing step; in March it does not');
  }
  // NASA SMAP's root-zone percentile, when it is the reading, is named with its percentile
  const smapDry = at('ADM3_FaridpurSadar', { currentConditions: { date: '2026-10-02', soilStatus: 'dry', soilPercentile: 0.4, sensor: 'SMAP', rain30PctOfNormal: 57, source: 'test' }, today: '2026-10-05' });
  const smapNote = JSON.stringify(smapDry.local_context);
  const smapWater = JSON.stringify(smapDry.options.find(o => winterOf(o).crop === 'Lentil')!.dimensionDetails.water);
  if (!smapNote.includes('SMAP satellite') || !smapNote.includes('0th percentile') || smapNote.includes("reading (POWER") || !smapWater.includes('(NASA SMAP)')) {
    throw new Error(`A SMAP reading is named as SMAP with its percentile (got: ${smapNote.slice(0, 160)})`);
  }
  // NASA GLDAS groundwater: irrigation weighs more where the aquifer falls fastest (Barind), never less on the coast
  const barindWeight = at('ADM3_Nachole').options[0].dimensionDetails.water.metrics.groundwaterWeight as number;
  const coastWeight = coast.options[0].dimensionDetails.water.metrics.groundwaterWeight as number;
  if (!(barindWeight > 1.3 && coastWeight === 1)) throw new Error(`GLDAS weights: Barind ${barindWeight}, coast ${coastWeight}`);
  // NASA SEDAC PEST-CHEMGRIDS in the pest score: potato takes more pesticide than Aman-Boro, lentil less
  const munshiganj = at('ADM3_MunshiganjSadar');
  const potatoPest = munshiganj.options.find(o => winterOf(o).crop === 'Potato')!.dimensionDetails.pest.metrics;
  const lentilPest = lentilPlan.dimensionDetails.pest.metrics;
  if (!((potatoPest.pesticideKgHa as number) > (potatoPest.pesticideAmanBoroKgHa as number) && (lentilPest.pesticideKgHa as number) < (lentilPest.pesticideAmanBoroKgHa as number))) {
    throw new Error('PEST-CHEMGRIDS: potato above Aman-Boro, lentil below');
  }
  console.log(`Khaliajuri: ${haor.options[0].nameEnglish}; flash floods before harvest in ${haorFlood.flashFloodCaught} of ${haorFlood.flashFloodSeasons} springs`);
  console.log(`Top winter crops in ten upazilas: ${[...winters].join(', ')}; GLDAS weight Barind ${barindWeight}, coast ${coastWeight}`);
  // Without irrigation: no Boro or Aus, and each dry-season upland crop carries its rain-only yield (FAO-56 root zone)
  const noWater = at('ADM3_Nachole', { irrigation: 'none' });
  if (noWater.options.some(o => o.cropSequence.some(p => /Boro|Aus/.test(p.crop)))
    || !noWater.options.every(o => typeof o.dimensionDetails.water.metrics.rainfedYieldTypical === 'number' && o.dimensionDetails.water.metrics.irrigationAvailable === false)) {
    throw new Error('A field without irrigation gets no Boro or Aus, and every plan states its rain-only yield');
  }
  if (understandRequest('আমার জমিতে সেচ নেই').irrigation !== 'none') throw new Error('"সেচ নেই" means no irrigation');
  // NASA POWER disease weather: a quiet week says no precautionary spray; a blast week says look first; potato meets late blight
  const blast = (status: string, days7: number) => ({ date: '2026-10-04', soilStatus: 'normal', source: 'test',
    disease: { date: '2026-10-04', riceBlast: { days7, status, season: 'aman' }, lateBlight: { days7: 0, status: 'off', season: null } } });
  const quiet = at('ADM3_FaridpurSadar', { currentConditions: blast('low', 0), today: '2026-10-07' });
  const quietText = JSON.stringify(quiet.local_context);
  if (!quietText.includes('no precautionary fungicide spray is needed on Aman this week') || quiet.local_context!.hazards.includes('disease_weather')
    || !(quiet.local_context as any).diseaseWeather?.rules?.length) {
    throw new Error('A week without blast weather tells the farmer no precautionary spray is needed');
  }
  const blastWeek = at('ADM3_FaridpurSadar', { currentConditions: blast('high', 4), today: '2026-10-07' });
  if (!blastWeek.local_context!.hazards.includes('disease_weather') || !JSON.stringify(blastWeek.local_context).includes('Walk the Aman field')) {
    throw new Error('A week of blast weather raises a disease-weather alert that says to look before spraying');
  }
  const potatoPlan = at('ADM3_RangpurSadar', {
    heroCrop: 'potato', today: '2026-12-20',
    currentConditions: { date: '2026-12-18', soilStatus: 'normal', source: 'test',
      disease: { date: '2026-12-18', riceBlast: { days7: 0, status: 'off', season: null }, lateBlight: { days7: 4, status: 'high', season: 'potato' } } },
  });
  const pm = potatoPlan.options[0].dimensionDetails.pest.metrics as Record<string, number>;
  if (!potatoPlan.local_context!.hazards.includes('disease_weather') || !(pm.diseaseWeatherDays > pm.diseaseWeatherAmanBoroDays)) {
    throw new Error(`Potato meets more late-blight weather than Aman-Boro, and a blight week is flagged (got ${pm.diseaseWeatherDays} vs ${pm.diseaseWeatherAmanBoroDays})`);
  }
  if (!quiet.options[0].ipmActions.some(t => t.en.startsWith('No insecticide in the first 40 days'))) {
    throw new Error("Aman plans carry IRRI's no-early-spray step");
  }
  // NASA HLS (30 m): the salty coast leaves most Aman land fallow in winter; the Barind grows a winter crop on most of it
  const hlsShare = (id: string) => Number(/NASA HLS satellites \(30 m\): (\d+)% of the land that grew Aman/.exec(JSON.stringify(at(id).local_context))?.[1]);
  const coastHls = hlsShare('ADM3_Shyamnagar'), barindHls = hlsShare('ADM3_Tanore');
  if (!(coastHls < 30 && barindHls > 70)) throw new Error(`HLS winter cropping: Shyamnagar low, Tanore high (got ${coastHls}% and ${barindHls}%)`);
  console.log(`NASA HLS: Aman land green again in winter 2025-26, Shyamnagar ${coastHls}%, Tanore ${barindHls}%`);
  // This week in the field (field_alerts.ts): a dry spell at Aman flowering, cold on Boro seedbeds, heat at Boro
  // flowering, AWD that waits for forecast rain, and heat at wheat grain filling
  const days = (v: number) => Array(7).fill(v);
  const fw = (from: string, over: Record<string, unknown> = {}) => ({
    through: from, observedTo: from, rainSource: 'IMERG+POWER', rain7: 2, rain14: 10, et0Mm7: 4, tmax3: 31, tmin3: 22, paddyWaterMm: 20,
    paddyDry14: '00000000000000', paddyDryNext7: '0000000', forecast: { from, tmax: days(31), tmin: days(22), rain: days(0), et0: days(4) }, ...over,
  });
  const cc = (field: unknown) => ({ date: '2026-10-05', soilStatus: 'normal', source: 'test', field });
  const alertsOf = (a: ReturnType<typeof at>) => a.local_context!.fieldAlerts!.alerts;
  const dryAman = at('ADM3_Tanore', { today: '2026-10-08', currentConditions: cc(fw('2026-10-08', { paddyWaterMm: -12, paddyDry14: '00000001111111', paddyDryNext7: '1111111' })) });
  const dryAlert = alertsOf(dryAman).find(x => x.id === 'aman_dry_spell');
  if (dryAlert?.level !== 'high' || !dryAman.local_context!.hazards.includes('aman_dry_spell') || !dryAman.farmer_summary_bangla.includes('একবার সেচ দিন')) {
    throw new Error('Seven dry days at Aman flowering raise a rescue-irrigation alert that reaches the farmer line');
  }
  const wetAman = at('ADM3_Tanore', { today: '2026-10-08', currentConditions: cc(fw('2026-10-08', { paddyWaterMm: 60 })) });
  if (alertsOf(wetAman).find(x => x.id === 'aman_dry_spell')?.level !== 'clear' || wetAman.local_context!.hazards.includes('aman_dry_spell')) {
    throw new Error('A paddy with standing water is told no irrigation is needed this week');
  }
  const winterDay = (today: string, hero: string, over: Record<string, unknown>) => at('ADM3_Tanore', { heroCrop: hero, today, currentConditions: cc(fw(today, over)) });
  const cold = alertsOf(winterDay('2027-01-10', 'boro', { tmin3: 12, forecast: { from: '2027-01-10', tmax: days(20), tmin: [11, 8.5, 9, 12, 12, 13, 13], rain: days(0), et0: days(2) } }));
  const hotBoro = alertsOf(winterDay('2027-04-10', 'boro', { tmax3: 34, forecast: { from: '2027-04-10', tmax: [35, 36.4, 37, 34, 33, 33, 32], tmin: days(25), rain: days(0), et0: days(5) } }));
  const awd = alertsOf(winterDay('2027-03-01', 'boro', { forecast: { from: '2027-03-01', tmax: days(30), tmin: days(19), rain: [12, 10, 3, 0, 0, 0, 0], et0: days(4) } }));
  const hotWheat = alertsOf(winterDay('2027-02-15', 'wheat', { tmax3: 29, forecast: { from: '2027-02-15', tmax: [29, 30.5, 31, 31, 30, 29, 29], tmin: days(16), rain: days(0), et0: days(3.5) } }));
  if (cold.find(x => x.id === 'cold_seedbed')?.level !== 'high' || cold.find(x => x.id === 'cold_seedbed')?.numbers.tminC !== 8.5) {
    throw new Error('A night at 8.5 C in January puts Boro seedbeds on a cold alert');
  }
  if (hotBoro.find(x => x.id === 'rice_heat')?.level !== 'high' || !hotBoro.find(x => x.id === 'rice_heat')!.textEnglish.includes('5-7 cm')
    || !hotBoro.find(x => x.id === 'boro_awd')?.textEnglish.includes('no alternate wetting and drying now')) {
    throw new Error('37 C at Boro flowering says keep 5-7 cm of water, and AWD pauses at flowering');
  }
  if (!awd.find(x => x.id === 'boro_awd')?.titleEnglish.startsWith('Rain coming') || hotWheat.find(x => x.id === 'wheat_heat')?.level !== 'watch') {
    throw new Error('AWD holds the irrigation for 25 mm of forecast rain; 31 C at wheat grain filling is a watch');
  }
  if (alertsOf(at('ADM3_Tanore', { today: '2026-07-01', currentConditions: cc(fw('2026-07-01')) })).length) {
    throw new Error('No crop is at a sensitive stage on 1 July, so no field alert');
  }
  // NASA OPERA flood water now: replant late Aman until 10 September, then the winter crop as the land drains
  const flooded = (today: string) => at('ADM3_Tanore', { today, currentConditions: { date: today, soilStatus: 'normal', source: 'test',
    flood: { date: today, seenShare: 0.6, floodShare: 0.3, waterNow: 0.35, waterDry: 0.05 } } });
  const floodAug = flooded('2026-08-20').local_context!;
  const floodOct = flooded('2026-10-08').local_context!;
  const augustFlood = floodAug.fieldAlerts!.alerts.find(x => x.id === 'flood_now');
  if (augustFlood?.level !== 'high' || !augustFlood.textEnglish.includes('BR22, BR23, BRRI dhan46 or 54 by 15 September') || floodAug.hazards[0] !== 'flood_now') {
    throw new Error('30% of the land under water in August says replant BR22/BR23/dhan46/54 by 15 September, first among the hazards');
  }
  if (!floodOct.fieldAlerts!.alerts.find(x => x.id === 'flood_now')?.textEnglish.includes('Sow the winter crop as each field drains')) {
    throw new Error('Flood water in October says sow the winter crop as the land drains');
  }
  // Flood on low land and a dry paddy at the district point: irrigate only the higher fields, as a watch
  const wetAndDry = at('ADM3_Tanore', { today: '2026-10-08', currentConditions: { date: '2026-10-08', soilStatus: 'normal', source: 'test',
    field: fw('2026-10-08', { paddyWaterMm: -12, paddyDry14: '00000001111111', paddyDryNext7: '1111111' }),
    flood: { date: '2026-09-20', seenShare: 0.9, floodShare: 0.4, waterNow: 0.5, waterDry: 0.1, lastYearRadar: 0.01 } } }).local_context!;
  const softened = wetAndDry.fieldAlerts!.alerts.find(x => x.id === 'aman_dry_spell');
  if (softened?.level !== 'watch' || !softened.textEnglish.includes('irrigate only the higher fields')) {
    throw new Error('Where OPERA sees flood water the dry-spell alert drops to a watch for the higher fields');
  }
  console.log(`Field alerts: Aman dry spell ${dryAlert.level}, Boro seedbed cold ${cold[0].level}, Boro flowering heat ${hotBoro[0].level}, AWD "${awd[0].titleEnglish}"`);
  // Groundwater budget (NASA GRACE via GLDAS, BBS Boro area): Rajshahi needs a few percent of its Boro moved to stop the
  // fall; Sylhet's Boro is watered mostly from rivers and beels, so the budget is not given there
  const rajshahiBudget = at('ADM3_Tanore').local_context!;
  const sylhetBudget = at('ADM3_Balaganj').local_context!;
  const moveRajshahi = rajshahiBudget.groundwaterBudget?.moveShareToLentil ?? 0;
  if (!rajshahiBudget.groundwaterBudget?.applies || !(moveRajshahi > 0.02 && moveRajshahi < 0.1)
    || !rajshahiBudget.notesEnglish.some(n => n.startsWith('NASA GRACE (GLDAS-2.2): groundwater under Rajshahi district falls about 7.7 mm'))) {
    throw new Error(`Rajshahi's groundwater budget moves a few percent of its Boro to lentil (got ${moveRajshahi})`);
  }
  if (sylhetBudget.groundwaterBudget?.applies || sylhetBudget.notesEnglish.some(n => n.startsWith('NASA GRACE'))) {
    throw new Error('Sylhet falls under 4 mm a year, so no groundwater budget is given');
  }
  console.log(`Groundwater budget: Rajshahi moves ${(moveRajshahi * 100).toFixed(1)}% of its Boro (${rajshahiBudget.groundwaterBudget!.moveHaToLentil} ha) to lentil`);
  console.log('✓ TEST 17 PASSED: Land type, current patterns, flash floods, district yields and today\'s soil shape each upazila\'s plan.\n');

  console.log('========================================================');
  console.log('  ALL 17 CORE TESTS PASSED SUCCESSFULLY!                ');
  console.log('========================================================');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
