import type { IEvidenceDimensionPlugin, EvaluationContext, DimensionScoreResult } from '@project-eden/contracts';
import { amanOf, rabiOf, kharif1Of, clampScore } from '../data/lookup.ts';
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
    const { catalog: amanName } = amanOf(context);
    const { crop, record: rabi, catalog: rabiName } = rabiOf(context);

    const k1 = kharif1Of(context);
    // Rice crops in the year: Aman, plus Boro and/or Aus. One breaks the rice-pest cycle; each more keeps it fed.
    const riceCrops = 1 + (rabiName.hostGroup === 'rice' ? 1 : 0) + (k1?.catalog.hostGroup === 'rice' ? 1 : 0);
    const hostBreak = riceCrops === 1;
    const rotationUrea = Math.round(LOC.srdi.aman.ureaKgHa + rabi.fertilizer.ureaKgHa + (k1?.record.fertilizer.ureaKgHa ?? 0));
    const resistance = RESISTANT_VARIETIES[crop.variety];
    const deadline = rabi.sowingWindow?.[1];
    const sownOnTime = !deadline || seasonDay(rabi.sowing) <= seasonDay(deadline);

    let score = hostBreak ? 0.85 : riceCrops === 2 ? 0.4 : 0.3;
    if (rabiName.isLegume || k1?.catalog.isLegume) score += 0.05;
    score -= (Math.max(0, rotationUrea - 300) / 1000) * 0.3;
    if (resistance) score += 0.05;
    if (!sownOnTime) score -= 0.15;
    const pestScore = clampScore(score, 0.1, 0.95);

    const partsBn = [
      hostBreak
        ? `${amanName.varietyBangla}-এর পর ${rabiName.cropBangla}: ধানের পোকার চক্র ভাঙে।`
        : 'ধানের পর আবার ধান: মাজরা পোকা ও বাদামি গাছফড়িং সারা বছর খাবার পায়।',
      `পুরো চক্রে ইউরিয়া ${bnDigits(rotationUrea)} কেজি/হেক্টর (SRDI)।`,
      resistance ? `${rabiName.varietyBangla} ${resistance.bn}।` : '',
      sownOnTime ? '' : 'দেরিতে বোনায় পোকা ও রোগের চাপ বাড়ে।',
    ];
    const partsEn = [
      hostBreak ? `${rabiName.crop} after Aman breaks the rice-pest cycle.` : 'Rice after rice keeps stem borers and planthoppers fed all year.',
      `Rotation urea ${rotationUrea} kg/ha (SRDI).`,
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
        rotationUreaKgHa: rotationUrea,
        resistantVariety: resistance ? resistance.en : 'none listed',
        sownOnTime,
      },
      provenance: {
        source: 'Rotation IPM rules (team) from BRRI/BARI IPM guidance, SRDI Talanda card, BWMRI/BRRI variety pages; no field pest counts yet',
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
