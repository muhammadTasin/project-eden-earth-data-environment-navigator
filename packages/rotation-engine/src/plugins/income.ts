import type { IEvidenceDimensionPlugin, EvaluationContext, DimensionScoreResult } from '@project-eden/contracts';
import { amanOrNull, rabiOf, kharif1Of, kharif2Of, clampScore } from '../data/lookup.ts';
import { ILLUSTRATIVE_AMAN_GROSS_MARGIN_TK_PER_HA } from '../data/crop_catalog.ts';
import { bnNumber } from '../bn.ts';

export class IncomeDimensionPlugin implements IEvidenceDimensionPlugin {
  readonly id = 'income';
  readonly displayNameBangla = 'নিট লাভ (নমুনা হিসাব)';
  readonly displayNameEnglish = 'Net Farm Income (illustrative)';
  readonly version = '2.1.0';
  readonly isEnabled = true;

  evaluate(context: EvaluationContext): DimensionScoreResult {
    const { record: rabi, catalog: rabiName } = rabiOf(context);
    const k1 = kharif1Of(context);
    const k2 = kharif2Of(context);
    const hasAman = Boolean(amanOrNull(context));
    const rabiMargin = rabiName.illustrativeGrossMarginTkPerHa;
    const k1Margin = k1?.catalog.illustrativeGrossMarginTkPerHa ?? null;
    const k2Margin = k2?.catalog.illustrativeGrossMarginTkPerHa ?? null;

    // A crop without price and cost data keeps the score at the midpoint instead of a guessed number
    if (rabiMargin === null) {
      return {
        dimensionId: this.id,
        score: 0.5,
        confidence: 'uncertain',
        staleOrMissing: true,
        summaryBangla: `${rabiName.cropBangla}-এর বাজারদর ও খরচের তথ্য এখনো নেই, তাই আয়ের স্কোর মাঝামাঝি (৫০%) ধরা হয়েছে।`,
        summaryEnglish: `No price and cost data for ${rabiName.crop.toLowerCase()} yet, so the income score is held at the midpoint (50%).`,
        metrics: { illustrativeTotalBdtPerHa: 'n/a', illustrativeRabiBdtPerHa: 'n/a', districtYieldTPerHa: rabi.districtYieldTPerHa ?? 'n/a' },
        provenance: {
          source: 'No DAM farm-gate price or farmer cost for this crop yet',
          timePeriod: 'pending',
          spatialResolution: '-',
          measuredOrModeled: 'assumed',
          notesBangla: 'দর ও খরচের তথ্য এলে এই স্কোর হিসাব হবে।',
        },
      };
    }

    // Team placeholders until DAM farm-gate prices and farmer cost interviews are in (see crop_catalog.ts); potato,
    // maize, Aus and jute use the research net returns in crops/crop_parameters.csv, and chickpea, grass pea, sweet
    // potato, mungbean and sesame the BBS price x yield estimate in crops/minor_crop_returns.csv (data/crop_choice.ts).
    const sources = [...new Set([hasAman ? { incomeSource: 'team estimate (crop_catalog.ts) for Aman' } : null, rabiName, k1?.catalog, k2?.catalog].filter(Boolean)
      .map(c => (c as { incomeSource?: string }).incomeSource ?? 'team estimate (crop_catalog.ts)'))];
    const total = (hasAman ? ILLUSTRATIVE_AMAN_GROSS_MARGIN_TK_PER_HA : 0) + (k2Margin ?? 0) + rabiMargin + (k1Margin ?? 0);
    const incomeScore = clampScore((total - 40000) / 80000, 0.35, 0.96);
    const counted = [hasAman, Boolean(k2 && k2Margin !== null), true, Boolean(k1 && k1Margin !== null)].filter(Boolean).length;
    const seasonsBangla = ['এক মৌসুমে', 'দুই মৌসুমে', 'তিন মৌসুমে', 'চার মৌসুমে'][counted - 1];
    const seasonsEnglish = ['one season', 'two seasons', 'three seasons', 'four seasons'][counted - 1];
    const left = [k2 && k2Margin === null ? k2 : null, k1 && k1Margin === null ? k1 : null].filter(Boolean) as Array<NonNullable<typeof k1>>;
    const k1Bangla = left.map(x => ` ${x.catalog.cropBangla}-এর দর-খরচ এখনো নেই, তাই ধরা হয়নি।`).join('');
    const k1English = left.map(x => ` ${x.catalog.crop} is left out: no price and cost data yet.`).join('');

    return {
      dimensionId: this.id,
      score: incomeScore,
      confidence: 'low',
      staleOrMissing: true,
      summaryBangla: `নমুনা হিসাব: ${seasonsBangla} প্রায় ${bnNumber(total)} টাকা/হেক্টর নিট লাভ ধরা হয়েছে (দলের অনুমান ও BBS দর-ফলনের হিসাব; কৃষকের খরচ যাচাই বাকি)।${k1Bangla}`,
      summaryEnglish: `Illustrative: about ${total.toLocaleString('en-US')} BDT/ha over ${seasonsEnglish} (team estimates and BBS price-and-yield estimates; farmer costs not yet verified).${k1English}`,
      metrics: {
        illustrativeTotalBdtPerHa: total,
        illustrativeRabiBdtPerHa: rabiMargin,
        ...(k1 ? { illustrativeKharif1BdtPerHa: k1Margin ?? 'n/a' } : {}),
        ...(k2 ? { illustrativeKharif2BdtPerHa: k2Margin ?? 'n/a' } : {}),
        districtYieldTPerHa: rabi.districtYieldTPerHa ?? 'n/a',
      },
      provenance: {
        source: `Net return per hectare: ${sources.join('; ')}. Pending: farmer cost interviews. District yield for context: BBS Rajshahi 2024-25`,
        timePeriod: 'demo placeholder',
        spatialResolution: 'Tanore',
        measuredOrModeled: 'assumed',
        notesBangla: 'এই সংখ্যা যাচাই করা বাজারদর নয়; কৃষক সাক্ষাৎকার ও DAM দর পাওয়ার পর বদলাবে।',
      },
    };
  }

  explain(result: DimensionScoreResult) {
    return {
      banglaBullets: [`নমুনা হিসাব: প্রায় ${bnNumber(result.metrics.illustrativeTotalBdtPerHa as number)} টাকা/হেক্টর (যাচাই বাকি)।`],
      englishBullets: [`Illustrative ${result.metrics.illustrativeTotalBdtPerHa} BDT/ha, not yet verified.`],
    };
  }
}
