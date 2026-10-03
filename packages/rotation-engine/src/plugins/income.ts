import type { IEvidenceDimensionPlugin, EvaluationContext, DimensionScoreResult } from '@project-eden/contracts';
import { rabiOf, kharif1Of, clampScore } from '../data/lookup.ts';
import { ILLUSTRATIVE_AMAN_GROSS_MARGIN_TK_PER_HA } from '../data/crop_catalog.ts';
import { bnNumber } from '../bn.ts';

export class IncomeDimensionPlugin implements IEvidenceDimensionPlugin {
  readonly id = 'income';
  readonly displayNameBangla = 'নিট লাভ (নমুনা হিসাব)';
  readonly displayNameEnglish = 'Net Farm Income (illustrative)';
  readonly version = '2.0.0';
  readonly isEnabled = true;

  evaluate(context: EvaluationContext): DimensionScoreResult {
    const { record: rabi, catalog: rabiName } = rabiOf(context);
    const k1 = kharif1Of(context);
    const rabiMargin = rabiName.illustrativeGrossMarginTkPerHa;
    const k1Margin = k1?.catalog.illustrativeGrossMarginTkPerHa ?? null;

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
    // maize and Aus use the research net returns in crops/crop_parameters.csv (data/crop_choice.ts).
    const total = ILLUSTRATIVE_AMAN_GROSS_MARGIN_TK_PER_HA + rabiMargin + (k1Margin ?? 0);
    const incomeScore = clampScore((total - 40000) / 80000, 0.35, 0.96);
    const seasonsBangla = k1 && k1Margin !== null ? 'তিন মৌসুমে' : 'দুই মৌসুমে';
    const seasonsEnglish = k1 && k1Margin !== null ? 'three seasons' : 'two seasons';
    const k1Bangla = k1 && k1Margin === null ? ` ${k1.catalog.cropBangla}-এর দর-খরচ এখনো নেই, তাই ধরা হয়নি।` : '';
    const k1English = k1 && k1Margin === null ? ` ${k1.catalog.crop} is left out: no price and cost data yet.` : '';

    return {
      dimensionId: this.id,
      score: incomeScore,
      confidence: 'low',
      staleOrMissing: true,
      summaryBangla: `নমুনা হিসাব: ${seasonsBangla} প্রায় ${bnNumber(total)} টাকা/হেক্টর নিট লাভ ধরা হয়েছে (দলের অনুমান; বাজারদর ও খরচ যাচাই বাকি)।${k1Bangla}`,
      summaryEnglish: `Illustrative: about ${total.toLocaleString('en-US')} BDT/ha over ${seasonsEnglish} (team estimate; prices and costs not yet verified).${k1English}`,
      metrics: {
        illustrativeTotalBdtPerHa: total,
        illustrativeRabiBdtPerHa: rabiMargin,
        ...(k1 ? { illustrativeKharif1BdtPerHa: k1Margin ?? 'n/a' } : {}),
        districtYieldTPerHa: rabi.districtYieldTPerHa ?? 'n/a',
      },
      provenance: {
        source: 'Team placeholder estimate. Pending: DAM farm-gate prices and farmer cost interviews. District yield for context: BBS Rajshahi 2024-25',
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
