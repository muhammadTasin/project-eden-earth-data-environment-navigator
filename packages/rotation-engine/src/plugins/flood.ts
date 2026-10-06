import type { IEvidenceDimensionPlugin, EvaluationContext, DimensionScoreResult } from '@project-eden/contracts';
import { kharif1Of, kharif2Of } from '../data/lookup.ts';
import { LOC } from '../data/location.ts';
import { bnDigits, seasonDay } from '../bn.ts';
import { heavyRainDays, waterloggedDays, yearDay } from '../data/crop_choice.ts';

export class FloodDimensionPlugin implements IEvidenceDimensionPlugin {
  readonly id = 'flood';
  readonly displayNameBangla = 'বন্যা ও জলাবদ্ধতা ঝুঁকি';
  readonly displayNameEnglish = 'Flood & Waterlogging Hazard';
  readonly version = '2.1.0';
  readonly isEnabled = true;

  evaluate(context: EvaluationContext): DimensionScoreResult {
    // Not modelled for the Barind pilot yet: the score follows the SRDI land-type class.
    // The haor flash-flood model (Dharmapasha pilot) is the next step.
    const isUpland = context.landType === 'high' || context.landType === 'medium_high';
    // A Kharif-1 crop still in a low field after mid-June meets the first monsoon floods (an assumption, not a model)
    const k1 = kharif1Of(context);
    const k1Late = Boolean(k1 && yearDay(k1.record.harvest, k1.record.sowing) >= seasonDay('06-15'));
    const k1AtRisk = !isUpland && k1Late;
    // An upland crop in the monsoon (sesame, mungbean, soybean) rots in saturated soil and drowns where water stands.
    // Its score starts from the land type and falls with the share of its days with the topsoil near saturation in the
    // replayed seasons (NASA POWER soil wetness from MERRA-2): land type x (1 - half that share).
    const k2 = kharif2Of(context);
    const k2Rain = k2 ? heavyRainDays(k2.crop.variety) : null;
    const k2Soaked = k2 ? waterloggedDays(k2.crop.variety) : null;
    const k2Days = k2?.record.fieldDays ?? 0;
    const soakedShare = k2Soaked !== null && k2Days > 0 ? Math.min(1, k2Soaked / k2Days) : null;
    const landBase = context.landType === 'high' ? 0.85 : context.landType === 'medium_high' ? 0.55 : 0.3;
    const k2Score = Math.max(0.1, Math.round(landBase * (1 - 0.5 * (soakedShare ?? 0)) * 100) / 100);
    const floodScore = k2 ? Math.min(k2Score, isUpland ? 0.95 : k1AtRisk ? 0.5 : 0.65) : isUpland ? 0.95 : k1AtRisk ? 0.5 : 0.65;
    const soakedBangla = k2Soaked !== null ? `; নাসা POWER-এর মাটির রসে (MERRA-2) এই ফসলের ${bnDigits(k2Days)} দিনের মধ্যে গড়ে ${bnDigits(k2Soaked)} দিন ওপরের মাটি প্রায় পানিতে ভরা থাকে` : '';
    const soakedEnglish = k2Soaked !== null ? `; NASA POWER soil wetness (MERRA-2) has the topsoil near saturation on ${k2Soaked} of the crop's ${k2Days} days in a median season` : '';
    const soggy = (soakedShare ?? 0) > 0.3;
    const highBangla = soggy ? 'উঁচু জমিতেও উঁচু বেড ও নালা করে পানি সরান' : 'উঁচু জমিতে চলে';
    const highEnglish = soggy ? 'on high land too, grow it on raised beds with drains' : 'fine on high land';
    const k2Bangla = k2
      ? ` বর্ষায় ${k2.catalog.cropBangla}: ${context.landType === 'high' ? highBangla : 'পানি জমলে গাছ মরে যায়, শুধু উঁচু জমিতে করুন'}${soakedBangla}${k2Rain !== null ? `; ${bnDigits(k2Rain)} দিন ৫০ মিমির বেশি বৃষ্টি (নাসা IMERG)` : ''}।`
      : '';
    const k2English = k2
      ? ` Monsoon ${k2.catalog.crop.toLowerCase()}: ${context.landType === 'high' ? highEnglish : 'standing water kills it, so grow it on high land only'}${soakedEnglish}${k2Rain !== null ? `; ${k2Rain} day${k2Rain === 1 ? '' : 's'} of 50 mm+ rain (NASA IMERG)` : ''}.`
      : '';
    const k1Bangla = k1AtRisk && k1 ? ` ${k1.catalog.cropBangla} জুনের মাঝামাঝির পরেও জমিতে থাকে; নিচু জমিতে প্রথম বর্ষার পানিতে ডোবার ঝুঁকি।` : '';
    const k1English = k1AtRisk && k1 ? ` ${k1.catalog.crop} is still in the field after mid-June; on low land the first monsoon water can drown it.` : '';

    return {
      dimensionId: this.id,
      score: floodScore,
      confidence: 'low',
      summaryBangla: isUpland
        ? `${context.landType === 'high' ? 'উঁচু' : 'মাঝারি উঁচু'} জমি ${LOC.srdi ? '(SRDI শ্রেণি)' : '(আপনার বাছাই করা ধরন, মাটির কার্ড ছাড়া)'}: রবি ফসলের সময় বন্যার ঝুঁকি কম ধরা হয়েছে; নদীর বন্যা এখনো মডেল করা হয়নি।${k2Bangla}`
        : `নিচু জমি: বর্ষার শেষে জলাবদ্ধতার ঝুঁকি ধরা হয়েছে; নদীর বন্যা এখনো মডেল করা হয়নি।${k1Bangla}${k2Bangla}`,
      summaryEnglish: isUpland
        ? `${context.landType === 'high' ? 'High' : 'Medium-high'} land ${LOC.srdi ? '(SRDI class)' : '(the type you chose; no soil card here)'}: low flood exposure for Rabi crops is assumed; river floods are not modelled yet.${k2English}`
        : `Lower land: late-monsoon waterlogging risk is assumed; river floods are not modelled yet.${k1English}${k2English}`,
      metrics: {
        landTypeClass: context.landType,
        floodModelled: false,
        ...(k1 ? { kharif1InFieldAfterMidJune: k1Late } : {}),
        ...(k2 ? { kharif2HeavyRainDays: k2Rain ?? 'n/a', kharif2WaterloggedDays: k2Soaked ?? 'n/a', kharif2FieldDays: k2Days } : {}),
      },
      provenance: {
        source: k2
          ? `${LOC.srdi ? 'SRDI land-type class' : 'Land type as chosen (no SRDI soil card here)'}; NASA POWER topsoil wetness (MERRA-2) and GPM IMERG rain in the replayed seasons of the crop (waterlogging, not a river-flood model)`
          : LOC.srdi ? 'Land-type class from the SRDI Talanda union card (assumption, not a flood model)' : 'Land type as chosen; no SRDI soil card for this area (assumption, not a flood model)',
        timePeriod: k2 ? '2001-2024 monsoons' : 'static',
        spatialResolution: k2 ? 'Land-type class; 0.5 degree soil wetness at the district point' : 'Union land-type class',
        measuredOrModeled: k2 ? 'modeled' : 'assumed',
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
