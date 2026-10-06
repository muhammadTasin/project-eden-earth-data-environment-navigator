import type { IEvidenceDimensionPlugin, EvaluationContext, DimensionScoreResult } from '@project-eden/contracts';
import { amanOrNull, rabiOf, kharif1Of, kharif2Of, clampScore, rotationDose } from '../data/lookup.ts';
import { LOC } from '../data/location.ts';
import { RESISTANT_VARIETIES } from '../data/ipm_catalog.ts';
import { bnDigits, seasonDay } from '../bn.ts';

/**
 * Pest pressure and pesticide need of a rotation, from four transparent rules:
 *  1. host break: a non-rice Rabi crop after Aman breaks the rice-pest cycle; Boro after Aman keeps it going
 *  2. nitrogen: the SRDI urea total for the rotation (lush, high-N crops draw more pests)
 *  3. resistance: Rabi varieties the BWMRI/BRRI pages list as disease resistant
 *  4. timing: sowing after the handbook deadline raises pest and disease pressure
 * These are IPM rules, not field pest counts, so confidence is low until SAAOs log pest sightings.
 */
export class PestDimensionPlugin implements IEvidenceDimensionPlugin {
  readonly id = 'pest';
  readonly displayNameBangla = 'বালাই চাপ ও কীটনাশক কমানো';
  readonly displayNameEnglish = 'Pest Pressure & Pesticide Need';
  readonly version = '1.0.0';
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
    // null where the place has no SRDI soil card: then there is no nitrogen term in the score and no urea number in the text
    const ureaExact = rotationDose([amanSlot ? (LOC.srdi?.aman ?? null) : undefined, k2?.record.fertilizer, rabi.fertilizer, k1?.record.fertilizer], 'ureaKgHa');
    const rotationUrea = ureaExact === null ? null : Math.round(ureaExact);
    const resistance = RESISTANT_VARIETIES[crop.variety];
    const deadline = rabi.sowingWindow?.[1];
    const sownOnTime = !deadline || seasonDay(rabi.sowing) <= seasonDay(deadline);

    let score = riceCrops === 0 ? 0.9 : hostBreak ? 0.85 : riceCrops === 2 ? 0.4 : 0.3;
    if (rabiName.isLegume || k1?.catalog.isLegume || k2?.catalog.isLegume) score += 0.05;
    if (rotationUrea !== null) score -= (Math.max(0, rotationUrea - 300) / 1000) * 0.3;
    if (resistance) score += 0.05;
    if (!sownOnTime) score -= 0.15;
    const pestScore = clampScore(score, 0.1, 0.95);

    const partsBn = [
      riceCrops === 0
        ? 'সারা বছর ধান নেই: মাজরা পোকা ও বাদামি গাছফড়িং খাবার পায় না।'
        : hostBreak && amanSlot
          ? `${amanSlot.catalog.varietyBangla}-এর পর ${rabiName.cropBangla}: ধানের পোকার চক্র ভাঙে।`
          : hostBreak
            ? 'বছরে একবারই ধান: ধানের পোকার চক্র ভাঙে।'
            : 'ধানের পর আবার ধান: মাজরা পোকা ও বাদামি গাছফড়িং সারা বছর খাবার পায়।',
      rotationUrea === null ? '' : `পুরো চক্রে ইউরিয়া ${bnDigits(rotationUrea)} কেজি/হেক্টর (SRDI)।`,
      resistance ? `${rabiName.varietyBangla} ${resistance.bn}।` : '',
      sownOnTime ? '' : 'দেরিতে বোনায় পোকা ও রোগের চাপ বাড়ে।',
    ];
    const partsEn = [
      riceCrops === 0
        ? 'No rice in the year: stem borers and planthoppers find no host.'
        : hostBreak ? `${rabiName.crop} after ${amanSlot ? 'Aman' : 'rice'} breaks the rice-pest cycle.` : 'Rice after rice keeps stem borers and planthoppers fed all year.',
      rotationUrea === null ? '' : `Rotation urea ${rotationUrea} kg/ha (SRDI).`,
      resistance ? `${crop.variety} is ${resistance.en}.` : '',
      sownOnTime ? '' : 'Late sowing raises pest and disease pressure.',
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
      },
      provenance: {
        source: `Rotation IPM rules (team) from BRRI/BARI IPM guidance, ${LOC.srdi ? 'SRDI Talanda card, ' : ''}BWMRI/BRRI variety pages; no field pest counts yet`,
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
