import type { IEvidenceDimensionPlugin, EvaluationContext, DimensionScoreResult } from '@project-eden/contracts';
import { kharif1Of } from '../data/lookup.ts';
import { seasonDay } from '../bn.ts';
import { yearDay } from '../data/crop_choice.ts';

export class FloodDimensionPlugin implements IEvidenceDimensionPlugin {
  readonly id = 'flood';
  readonly displayNameBangla = 'বন্যা ও জলাবদ্ধতা ঝুঁকি';
  readonly displayNameEnglish = 'Flood & Waterlogging Hazard';
  readonly version = '2.0.0';
  readonly isEnabled = true;

  evaluate(context: EvaluationContext): DimensionScoreResult {
    // Not modelled for the Barind pilot yet: the score follows the SRDI land-type class.
    // The haor flash-flood model (Dharmapasha pilot) is the next step.
    const isUpland = context.landType === 'high' || context.landType === 'medium_high';
    // A Kharif-1 crop still in a low field after mid-June meets the first monsoon floods (an assumption, not a model)
    const k1 = kharif1Of(context);
    const k1Late = Boolean(k1 && yearDay(k1.record.harvest, k1.record.sowing) >= seasonDay('06-15'));
    const k1AtRisk = !isUpland && k1Late;
    const floodScore = isUpland ? 0.95 : k1AtRisk ? 0.5 : 0.65;
    const k1Bangla = k1AtRisk && k1 ? ` ${k1.catalog.cropBangla} জুনের মাঝামাঝির পরেও জমিতে থাকে; নিচু জমিতে প্রথম বর্ষার পানিতে ডোবার ঝুঁকি।` : '';
    const k1English = k1AtRisk && k1 ? ` ${k1.catalog.crop} is still in the field after mid-June; on low land the first monsoon water can drown it.` : '';

    return {
      dimensionId: this.id,
      score: floodScore,
      confidence: 'low',
      summaryBangla: isUpland
        ? 'মাঝারি উঁচু বরেন্দ্র জমি (SRDI শ্রেণি): রবি ফসলের সময় বন্যার ঝুঁকি কম ধরা হয়েছে; বন্যা এখনো মডেল করা হয়নি।'
        : `নিচু জমি: বর্ষার শেষে জলাবদ্ধতার ঝুঁকি ধরা হয়েছে; বন্যা এখনো মডেল করা হয়নি।${k1Bangla}`,
      summaryEnglish: isUpland
        ? 'Medium-high Barind land (SRDI class): low flood exposure for Rabi crops is assumed; floods are not modelled yet.'
        : `Lower land: late-monsoon waterlogging risk is assumed; floods are not modelled yet.${k1English}`,
      metrics: {
        landTypeClass: context.landType,
        floodModelled: false,
        ...(k1 ? { kharif1InFieldAfterMidJune: k1Late } : {}),
      },
      provenance: {
        source: 'Land-type class from the SRDI Talanda union card (assumption, not a flood model)',
        timePeriod: 'static',
        spatialResolution: 'Union land-type class',
        measuredOrModeled: 'assumed',
        notesBangla: 'হাওরের আকস্মিক বন্যার মডেল (ধর্মপাশা পাইলট) পরবর্তী ধাপে যুক্ত হবে।',
      },
    };
  }

  explain(result: DimensionScoreResult) {
    return {
      banglaBullets: ['বরেন্দ্র পাইলটে বন্যার স্কোর জমির শ্রেণি থেকে ধরা; আলাদা বন্যা মডেল নয়।'],
      englishBullets: ['For the Barind pilot the flood score comes from the land-type class, not a flood model.'],
    };
  }
}
