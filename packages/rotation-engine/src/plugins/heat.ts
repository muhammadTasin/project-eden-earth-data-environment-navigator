import type { IEvidenceDimensionPlugin, EvaluationContext, DimensionScoreResult } from '@project-eden/contracts';
import { amanOf, rabiOf, kharif1Of, clampScore } from '../data/lookup.ts';
import { bnDate, bnDecimal, bnDigits, enDate } from '../bn.ts';
import { LOC } from '../data/location.ts';
import { choiceIdOf, replayFacts } from '../data/crop_choice.ts';

/** Night temperature at Aman flowering, per variety, in the research's heat trends. */
const NIGHT_MEASURE: Record<string, string> = { 'BRRI dhan71': 'aman71_night_c', 'BRRI dhan49': 'aman49_night_c' };

export class HeatDimensionPlugin implements IEvidenceDimensionPlugin {
  readonly id = 'heat';
  readonly displayNameBangla = 'তাপমাত্রার সহনশীলতা';
  readonly displayNameEnglish = 'Heat Stress at Sensitive Stages';
  readonly version = '2.0.0';
  readonly isEnabled = true;

  evaluate(context: EvaluationContext): DimensionScoreResult {
    const { crop: amanCrop, record: aman, catalog: amanName } = amanOf(context);
    const { crop: rabiCrop, record: rabi, catalog: rabiName } = rabiOf(context);
    const heat = rabi.heat;
    const k1 = kharif1Of(context);
    const k1Heat = k1?.record.heat ?? null;
    const assumed = (variety: string) => variety.includes('@') && Boolean(replayFacts(choiceIdOf(variety))?.heat?.assumed);

    // Score = share of the sensitive stage that stays below the crop's heat threshold (the worse crop, with Kharif-1).
    const hotShare = Math.max(heat ? heat.hotDays / heat.windowDays : 0, k1Heat ? k1Heat.hotDays / k1Heat.windowDays : 0);
    const heatScore = clampScore(1 - hotShare, 0.1, 0.95);
    const limitNoteBangla = assumed(rabiCrop.variety) ? ' (সীমা সাহিত্য থেকে অনুমিত)' : '';
    const limitNoteEnglish = assumed(rabiCrop.variety) ? ' (assumed limit)' : '';
    const k1Bangla = k1 && k1Heat
      ? ` ${k1.catalog.cropBangla}: ${k1Heat.stageBangla} ${bnDigits(k1Heat.windowDays)} দিনের ${bnDigits(k1Heat.hotDays)} দিন ${bnDigits(k1Heat.thresholdC)}°C ছাড়ায়।`
      : '';
    const k1English = k1 && k1Heat
      ? ` ${k1.catalog.crop}: ${k1Heat.hotDays} of ${k1Heat.windowDays} days above ${k1Heat.thresholdC} C at ${k1Heat.stage}${assumed(k1.crop.variety) ? ' (assumed limit)' : ''}.`
      : '';

    const summaryBangla = heat
      ? `${heat.stageBangla} ${bnDigits(heat.windowDays)} দিনের মধ্যে প্রায় ${bnDigits(heat.hotDays)} দিন তাপমাত্রা ${bnDigits(heat.thresholdC)}°C ছাড়ায় (২৫ মৌসুমের মধ্যমা)${limitNoteBangla}।`
      : `${rabiName.cropBangla} ~${bnDate(rabi.harvest)} কাটা হয়, মার্চ-এপ্রিলের গরমের আগেই।`;
    // A significant warming of nights at this variety's flowering is shown as a caution (it does not change the score)
    const night = LOC.advisories?.heatTrends.find(t => t.measure === NIGHT_MEASURE[amanCrop.variety]);
    const warmingNights = night && night.kendallP < 0.05 && night.trendPerDecade > 0 ? night : null;
    const nightNoteBangla = warmingNights
      ? ` সতর্কতা: ${amanName.varietyBangla}-এর ফুল আসার সময়ের রাত প্রতি দশকে ${bnDecimal(warmingNights.trendPerDecade, 2)}°C গরম হচ্ছে।`
      : '';
    const nightNoteEnglish = warmingNights
      ? ` Watch: nights at ${amanCrop.variety} flowering are warming ${warmingNights.trendPerDecade} C per decade.`
      : '';

    const summaryEnglish = heat
      ? `About ${heat.hotDays} of ${heat.windowDays} days above ${heat.thresholdC} C at ${heat.stage} (median of 25 seasons)${limitNoteEnglish}.`
      : `${rabiName.crop} is harvested around ${enDate(rabi.harvest)}, before the March-April heat.`;

    return {
      dimensionId: this.id,
      score: heatScore,
      confidence: 'medium',
      summaryBangla: summaryBangla + k1Bangla + nightNoteBangla,
      summaryEnglish: summaryEnglish + k1English + nightNoteEnglish,
      metrics: {
        hotDays: heat?.hotDays ?? 0,
        sensitiveWindowDays: heat?.windowDays ?? 0,
        thresholdC: heat?.thresholdC ?? 0,
        sensitiveStage: heat?.stage ?? 'none before harvest',
        amanFloweringNightTempC: aman.floweringNightTempC ?? 'not computed',
        amanNightTrendPerDecade: night ? night.trendPerDecade : 'not computed',
        amanNightTrendSignificant: Boolean(warmingNights),
        ...(k1Heat ? { kharif1HotDays: k1Heat.hotDays, kharif1WindowDays: k1Heat.windowDays } : {}),
      },
      provenance: {
        source: 'NASA POWER daily Tmax, bias-corrected by month against BMD station 41895 Shah Mokhdum (NOAA GSOD); research/explore/heat_windows.py',
        timePeriod: '2001-2025',
        spatialResolution: 'POWER 0.5° x 0.625° cell at the Tanore pilot point',
        measuredOrModeled: 'modeled',
        notesBangla: 'বোরোতে ফুল আসার ১৫ দিনে ৩৫°C এর বেশি, গমে দানা পুষ্ট হওয়ার শেষ ৩০ দিনে ৩০°C এর বেশি দিন গোনা হয়েছে।',
      },
    };
  }

  explain(result: DimensionScoreResult) {
    const m = result.metrics;
    const hot = m.hotDays as number;
    return {
      banglaBullets: [
        hot === 0
          ? 'সংবেদনশীল পর্যায় গরম শুরুর আগেই শেষ হয়।'
          : `সংবেদনশীল ${bnDigits(m.sensitiveWindowDays as number)} দিনের ${bnDigits(hot)} দিন অতিরিক্ত গরম।`,
      ],
      englishBullets: [
        hot === 0
          ? 'The sensitive stage ends before the heat arrives.'
          : `${hot} of ${m.sensitiveWindowDays} sensitive days above ${m.thresholdC} C.`,
      ],
    };
  }
}
