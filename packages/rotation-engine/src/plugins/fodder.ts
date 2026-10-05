import type { IEvidenceDimensionPlugin, EvaluationContext, DimensionScoreResult } from '@project-eden/contracts';
import { amanOrNull, rabiOf, kharif1Of, kharif2Of } from '../data/lookup.ts';
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
    const k2 = kharif2Of(context);
    const hasAman = Boolean(amanOrNull(context));
    const cattle = Math.round(LOC.conditions.cattlePerKm2);
    // Aman straw is assumed in every rotation with Aman, so the score follows the other crops' residue: the best
    // class, plus a little for each extra crop; without Aman the rice straw is missing.
    const extras = [k1, k2].filter(Boolean) as Array<NonNullable<typeof k1>>;
    const best = Math.max(FODDER_SCORE[rabiName.fodderValue], ...extras.map(x => FODDER_SCORE[x.catalog.fodderValue]));
    const score = Math.max(0.3, Math.min(0.95, best + 0.02 * extras.length - (hasAman ? 0 : 0.1)));
    const noStrawBangla = hasAman ? '' : ' আমন নেই, তাই ধানের খড়ও নেই।';
    const noStrawEnglish = hasAman ? '' : ' No Aman, so no rice straw.';

    return {
      dimensionId: this.id,
      score: Number(score.toFixed(2)),
      confidence: 'medium',
      summaryBangla: `${rabiName.fodderNoteBangla}${extras.map(x => ` ${x.catalog.fodderNoteBangla}`).join('')}${noStrawBangla} ${LOC.kind === 'pilot' ? 'রাজশাহী' : 'এই'} জেলায় প্রতি বর্গকিমিতে প্রায় ${bnDigits(cattle)}টি গরু (FAO GLW4)।`,
      summaryEnglish: `Residue class "${rabiName.fodderValue}" for ${rabiName.crop};${noStrawEnglish} ${LOC.district} has about ${cattle} cattle per km2 (FAO GLW4, 2015).`,
      metrics: {
        residueClass: rabiName.fodderValue,
        ...(k1 ? { kharif1ResidueClass: k1.catalog.fodderValue } : {}),
        ...(k2 ? { kharif2ResidueClass: k2.catalog.fodderValue } : {}),
        riceStraw: hasAman,
        districtCattlePerKm2: LOC.conditions.cattlePerKm2,
        district: LOC.district,
      },
      provenance: {
        source: 'FAO Gridded Livestock of the World v4, cattle 2015 (Gilbert et al. 2018); residue classes are team estimates',
        timePeriod: '2015',
        spatialResolution: `District (${LOC.district})`,
        measuredOrModeled: 'assumed',
        notesBangla: 'গরুর ঘনত্ব মাপা তথ্য; খড়ের শ্রেণি দলের অনুমান।',
      },
    };
  }

  explain(result: DimensionScoreResult) {
    return {
      banglaBullets: [`জেলায় প্রতি বর্গকিমিতে প্রায় ${bnDigits(Math.round(result.metrics.districtCattlePerKm2 as number))}টি গরু।`],
      englishBullets: [`About ${Math.round(result.metrics.districtCattlePerKm2 as number)} cattle per km2 in ${result.metrics.district}.`],
    };
  }
}
