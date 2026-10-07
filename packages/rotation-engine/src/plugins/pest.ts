import type { IEvidenceDimensionPlugin, EvaluationContext, DimensionScoreResult } from '@project-eden/contracts';
import { amanOrNull, rabiOf, kharif1Of, kharif2Of, clampScore } from '../data/lookup.ts';
import { LOC } from '../data/location.ts';
import { RESISTANT_VARIETIES } from '../data/ipm_catalog.ts';
import { choiceIdOf } from '../data/crop_choice.ts';
import { pesticideEstimate } from '../stewardship.ts';
import { bnDecimal, bnDigits, seasonDay } from '../bn.ts';
import { planDiseaseDays } from '../data/disease.ts';

/**
 * Pest pressure and pesticide need of a rotation, from four transparent rules:
 *  1. host break: a non-rice Rabi crop after Aman breaks the rice-pest cycle; Boro after Aman keeps it going
 *  2. nitrogen: the SRDI urea total for the rotation (lush, high-N crops draw more pests)
 *  3. resistance: Rabi varieties the BWMRI/BRRI pages list as disease resistant
 *  4. timing: sowing after the handbook deadline raises pest and disease pressure
 * and NASA SEDAC's PEST-CHEMGRIDS estimate of the pesticide the year's crops take at this upazila, against the usual
 * Aman-Boro rotation there (potato and vegetables take the most, pulses and oilseeds the least), and NASA POWER's
 * count of the days in a typical season whose weather favours rice blast and potato late blight at this place
 * (research/explore/disease_climatology.py): each such day more than Aman-Boro takes 0.003 off.
 * These are IPM rules and a model estimate, not field pest counts, so confidence is low until SAAOs log pest sightings.
 */
export class PestDimensionPlugin implements IEvidenceDimensionPlugin {
  readonly id = 'pest';
  readonly displayNameBangla = 'বালাই চাপ ও কীটনাশক কমানো';
  readonly displayNameEnglish = 'Pest Pressure & Pesticide Need';
  readonly version = '1.1.0';
  readonly isEnabled = true;

  evaluate(context: EvaluationContext): DimensionScoreResult {
    const amanSlot = amanOrNull(context);
    const { crop, record: rabi, catalog: rabiName } = rabiOf(context);

    const k1 = kharif1Of(context);
    const k2 = kharif2Of(context);
    // Rice crops in the year: Aman, Boro, Aus. One breaks the rice-pest cycle, none leaves rice pests no host, and
    // each extra rice crop keeps them fed.
    const riceCrops = (amanSlot ? 1 : 0) + (rabiName.hostGroup === 'rice' ? 1 : 0) + (k1?.catalog.hostGroup === 'rice' ? 1 : 0);
    const hostBreak = riceCrops <= 1;
    const rotationUrea = Math.round((amanSlot ? LOC.srdi.aman.ureaKgHa : 0) + (k2?.record.fertilizer.ureaKgHa ?? 0)
      + rabi.fertilizer.ureaKgHa + (k1?.record.fertilizer.ureaKgHa ?? 0));
    const resistance = RESISTANT_VARIETIES[crop.variety];
    const deadline = rabi.sowingWindow?.[1];
    const sownOnTime = !deadline || seasonDay(rabi.sowing) <= seasonDay(deadline);

    let score = riceCrops === 0 ? 0.9 : hostBreak ? 0.85 : riceCrops === 2 ? 0.4 : 0.3;
    if (rabiName.isLegume || k1?.catalog.isLegume || k2?.catalog.isLegume) score += 0.05;
    score -= (Math.max(0, rotationUrea - 300) / 1000) * 0.3;
    if (resistance) score += 0.05;
    if (!sownOnTime) score -= 0.15;
    // NASA SEDAC PEST-CHEMGRIDS: each tenth of the Aman-Boro load more (or less) moves the score 0.025 down (or up)
    const cropIds = [amanSlot ? 'aman' : k2 ? choiceIdOf(k2.crop.variety) : '', choiceIdOf(crop.variety), k1 ? choiceIdOf(k1.crop.variety) : '']
      .filter(Boolean);
    const plan = pesticideEstimate(cropIds);
    const usual = pesticideEstimate(['aman', 'boro']);
    const loadKgHa = (plan.low + plan.high) / 2;
    const usualKgHa = (usual.low + usual.high) / 2;
    const loadRatio = usualKgHa > 0 ? loadKgHa / usualKgHa : 1;
    score -= 0.25 * (loadRatio - 1);
    // NASA POWER, 2001-2025: days of blast weather on Aman and Boro, and of late-blight weather on potato, here
    const ids = [choiceIdOf(crop.variety), k1 ? choiceIdOf(k1.crop.variety) : ''];
    const planDays = planDiseaseDays({ aman: Boolean(amanSlot), boro: rabiName.hostGroup === 'rice', potato: ids.includes('potato') });
    const usualDays = planDiseaseDays({ aman: true, boro: true, potato: false });
    if (planDays !== null && usualDays !== null) score -= 0.003 * (planDays - usualDays);
    const pestScore = clampScore(score, 0.1, 0.95);

    const partsBn = [
      riceCrops === 0
        ? 'সারা বছর ধান নেই: মাজরা পোকা ও বাদামি গাছফড়িং খাবার পায় না।'
        : hostBreak && amanSlot
          ? `${amanSlot.catalog.varietyBangla}-এর পর ${rabiName.cropBangla}: ধানের পোকার চক্র ভাঙে।`
          : hostBreak
            ? 'বছরে একবারই ধান: ধানের পোকার চক্র ভাঙে।'
            : 'ধানের পর আবার ধান: মাজরা পোকা ও বাদামি গাছফড়িং সারা বছর খাবার পায়।',
      `পুরো চক্রে ইউরিয়া ${bnDigits(rotationUrea)} কেজি/হেক্টর (SRDI)।`,
      `নাসার PEST-CHEMGRIDS অনুমানে এই ফসলগুলোতে বছরে হেক্টরে প্রায় ${bnDecimal(loadKgHa, 2)} কেজি কীটনাশক (সক্রিয় উপাদান), আমন–বোরোতে ${bnDecimal(usualKgHa, 2)}।`,
      resistance ? `${rabiName.varietyBangla} ${resistance.bn}।` : '',
      sownOnTime ? '' : 'দেরিতে বোনায় পোকা ও রোগের চাপ বাড়ে।',
      planDays !== null && usualDays !== null
        ? `নাসার আবহাওয়ায় (২০০১–২০২৫) সাধারণ বছরে এই ফসলগুলো ব্লাস্ট বা লেট ব্লাইটের উপযোগী আবহাওয়া পায় প্রায় ${bnDigits(planDays)} দিন, আমন–বোরো ${bnDigits(usualDays)} দিন।`
        : '',
    ];
    const partsEn = [
      riceCrops === 0
        ? 'No rice in the year: stem borers and planthoppers find no host.'
        : hostBreak ? `${rabiName.crop} after ${amanSlot ? 'Aman' : 'rice'} breaks the rice-pest cycle.` : 'Rice after rice keeps stem borers and planthoppers fed all year.',
      `Rotation urea ${rotationUrea} kg/ha (SRDI).`,
      `NASA SEDAC PEST-CHEMGRIDS: about ${loadKgHa.toFixed(2)} kg/ha of pesticide active ingredient a year on these crops here, against ${usualKgHa.toFixed(2)} on Aman-Boro.`,
      resistance ? `${crop.variety} is ${resistance.en}.` : '',
      sownOnTime ? '' : 'Late sowing raises pest and disease pressure.',
      planDays !== null && usualDays !== null
        ? `NASA POWER weather, 2001-2025: in a typical year these crops meet about ${planDays} days of rice-blast or potato late-blight weather here, against ${usualDays} on Aman-Boro.`
        : '',
    ];

    return {
      dimensionId: this.id,
      score: pestScore,
      confidence: 'low',
      summaryBangla: partsBn.filter(Boolean).join(' '),
      summaryEnglish: partsEn.filter(Boolean).join(' '),
      metrics: {
        breaksRicePestCycle: hostBreak,
        riceCropsInYear: riceCrops,
        rotationUreaKgHa: rotationUrea,
        resistantVariety: resistance ? resistance.en : 'none listed',
        sownOnTime,
        pesticideKgHa: Math.round(loadKgHa * 1000) / 1000,
        pesticideAmanBoroKgHa: Math.round(usualKgHa * 1000) / 1000,
        ...(planDays !== null ? { diseaseWeatherDays: planDays, diseaseWeatherAmanBoroDays: usualDays } : {}),
      },
      provenance: {
        source: 'Rotation IPM rules (team) from BRRI/BARI IPM guidance, SRDI Talanda card, BWMRI/BRRI variety pages; NASA SEDAC PEST-CHEMGRIDS v1.01 (2020) pesticide estimate for the upazila; NASA POWER disease-weather days 2001-2025 (BLASTAM-style wet hours, Hutton criteria); no field pest counts yet',
        timePeriod: 'rules; pest sightings come from SAAO field observations',
        spatialResolution: 'Rotation level',
        measuredOrModeled: 'assumed',
        notesBangla: 'মাঠে পোকা গোনার তথ্য এলে (কর্মকর্তার পর্যবেক্ষণ) এই স্কোর আরও নির্ভুল হবে।',
      },
    };
  }

  explain(result: DimensionScoreResult) {
    const m = result.metrics;
    return {
      banglaBullets: [
        m.breaksRicePestCycle ? 'রবিতে ধান নয়, তাই ধানের পোকার চক্র ভাঙে।' : 'বছরে দুবার ধান: পোকার চক্র চলতেই থাকে।',
      ],
      englishBullets: [
        m.breaksRicePestCycle ? 'No rice in Rabi, so the rice-pest cycle breaks.' : 'Two rice crops a year keep the pest cycle going.',
      ],
    };
  }
}
