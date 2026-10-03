import type { IEvidenceDimensionPlugin, EvaluationContext, DimensionScoreResult } from '@project-eden/contracts';
import { rabiOf, kharif1Of } from '../data/lookup.ts';
import { LOC } from '../data/location.ts';
import { bnDigits } from '../bn.ts';

const FODDER_SCORE = { high: 0.88, medium: 0.82, low: 0.65 };

export class FodderDimensionPlugin implements IEvidenceDimensionPlugin {
  readonly id = 'fodder';
  readonly displayNameBangla = 'গবাদিপশুর খাদ্য ও খড় প্রাপ্যতা';
  readonly displayNameEnglish = 'Livestock Fodder & Crop Residue';
  readonly version = '2.0.0';
  readonly isEnabled = true;

  evaluate(context: EvaluationContext): DimensionScoreResult {
    const { catalog: rabiName } = rabiOf(context);
    const k1 = kharif1Of(context);
    const cattle = Math.round(LOC.conditions.cattlePerKm2);
    // A crop before Aman adds a second residue: the better of the two classes, plus a little
    const score = k1
      ? Math.min(0.95, Math.max(FODDER_SCORE[rabiName.fodderValue], FODDER_SCORE[k1.catalog.fodderValue]) + 0.02)
      : FODDER_SCORE[rabiName.fodderValue];

    return {
      dimensionId: this.id,
      score: Number(score.toFixed(2)),
      confidence: 'medium',
      summaryBangla: `${rabiName.fodderNoteBangla}${k1 ? ` ${k1.catalog.fodderNoteBangla}` : ''} রাজশাহীতে প্রতি বর্গকিমিতে প্রায় ${bnDigits(cattle)}টি গরু (FAO GLW4)।`,
      summaryEnglish: `Residue class "${rabiName.fodderValue}" for ${rabiName.crop}; Rajshahi has about ${cattle} cattle per km2 (FAO GLW4, 2015).`,
      metrics: {
        residueClass: rabiName.fodderValue,
        ...(k1 ? { kharif1ResidueClass: k1.catalog.fodderValue } : {}),
        districtCattlePerKm2: LOC.conditions.cattlePerKm2,
      },
      provenance: {
        source: 'FAO Gridded Livestock of the World v4, cattle 2015 (Gilbert et al. 2018); residue classes are team estimates',
        timePeriod: '2015',
        spatialResolution: 'District (Rajshahi)',
        measuredOrModeled: 'assumed',
        notesBangla: 'গরুর ঘনত্ব মাপা তথ্য; খড়ের শ্রেণি দলের অনুমান।',
      },
    };
  }

  explain(result: DimensionScoreResult) {
    return {
      banglaBullets: [`রাজশাহীতে প্রতি বর্গকিমিতে প্রায় ${bnDigits(Math.round(result.metrics.districtCattlePerKm2 as number))}টি গরু।`],
      englishBullets: [`About ${Math.round(result.metrics.districtCattlePerKm2 as number)} cattle per km2 in Rajshahi.`],
    };
  }
}
