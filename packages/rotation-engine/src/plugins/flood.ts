import type { IEvidenceDimensionPlugin, EvaluationContext, DimensionScoreResult } from '@project-eden/contracts';
import { kharif1Of, kharif2Of, rabiOf } from '../data/lookup.ts';
import { bnDate, bnDigits, enDate, seasonDay } from '../bn.ts';
import { heavyRainDays, waterloggedDays, yearDay } from '../data/crop_choice.ts';
import { flashFloodExposed, flashFloodRisk, landRules } from '../data/land.ts';
import { LOC } from '../data/location.ts';

export class FloodDimensionPlugin implements IEvidenceDimensionPlugin {
  readonly id = 'flood';
  readonly displayNameBangla = 'বন্যা ও জলাবদ্ধতা ঝুঁকি';
  readonly displayNameEnglish = 'Flood & Waterlogging Hazard';
  readonly version = '2.2.0';
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
    // Low land holds no crop in the monsoon (data/land.ts), so its winter crop is out of the monsoon water; on haor low
    // land the flash floods decide: the score falls with the share of springs whose first upstream burst (NASA GPM
    // IMERG over the Meghalaya hills) came before the winter or summer crop's harvest.
    const deep = !landRules(context.landType).aman;
    const { record: rabi, catalog: rabiName } = rabiOf(context);
    const flash = flashFloodExposed(context.landType)
      ? [{ name: rabiName, harvest: rabi.harvest }, ...(k1 ? [{ name: k1.catalog, harvest: k1.record.harvest }] : [])]
        .map(c => ({ ...c, risk: flashFloodRisk(c.harvest) }))
        .filter((c): c is typeof c & { risk: NonNullable<typeof c.risk> } => c.risk !== null)
        .sort((a, b) => b.risk.caught - a.risk.caught)[0] ?? null
      : null;
    const landScore = isUpland || deep ? 0.95 : k1AtRisk ? 0.5 : 0.65;
    const flashScore = flash ? Math.max(0.1, Math.round((0.95 - flash.risk.caught / flash.risk.seasons) * 100) / 100) : 0.95;
    const floodScore = Math.min(k2 ? Math.min(k2Score, landScore) : landScore, flashScore);
    const floodYears = flash ? flash.risk.floodYears.join(', ') : '';
    const flashBangla = flash
      ? ` হাওরের আগাম বন্যা: মেঘালয় পাহাড়ে ৩ দিনে ${bnDigits(flash.risk.burstMm)} মিমি বা বেশি বৃষ্টি (নাসার GPM IMERG) ${bnDigits(flash.risk.seasons)} বছরের ${bnDigits(flash.risk.caught)}টিতে ${flash.name.cropBangla} কাটার (~${bnDate(flash.harvest)}) আগে এসেছে; বন্যা পূর্বাভাস কেন্দ্রের জানানো প্রতিটি আগাম বন্যার (${bnDigits(floodYears)}) আগে এমন বৃষ্টি হয়েছিল।`
      : '';
    const flashEnglish = flash
      ? ` Haor flash floods: a burst of ${flash.risk.burstMm} mm or more in 3 days over the Meghalaya hills (NASA GPM IMERG) came before the ${flash.name.crop.toLowerCase()} harvest (~${enDate(flash.harvest)}) in ${flash.risk.caught} of ${flash.risk.seasons} springs; one came before every flash flood FFWC reported (${floodYears}).`
      : '';
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
      summaryBangla: (isUpland
        ? `${context.landType === 'high' ? 'উঁচু' : 'মাঝারি উঁচু'} জমি: রবি ফসলের সময় বন্যার ঝুঁকি কম ধরা হয়েছে; নদীর বন্যা এখনো মডেল করা হয়নি।${k2Bangla}`
        : deep
          ? 'নিচু জমি: বর্ষায় জমিতে কোনো ফসল থাকে না; পানি নামার পর রবি ফসল।'
          : `নিচু জমি: বর্ষার শেষে জলাবদ্ধতার ঝুঁকি ধরা হয়েছে; নদীর বন্যা এখনো মডেল করা হয়নি।${k1Bangla}${k2Bangla}`) + flashBangla,
      summaryEnglish: (isUpland
        ? `${context.landType === 'high' ? 'High' : 'Medium-high'} land: low flood exposure for Rabi crops is assumed; river floods are not modelled yet.${k2English}`
        : deep
          ? 'Low land: no crop stands in the monsoon water; the winter crop goes in after it leaves.'
          : `Lower land: late-monsoon waterlogging risk is assumed; river floods are not modelled yet.${k1English}${k2English}`) + flashEnglish,
      metrics: {
        landTypeClass: context.landType,
        floodModelled: Boolean(flash),
        ...(flash ? { flashFloodHarvest: flash.harvest, flashFloodCaught: flash.risk.caught, flashFloodSeasons: flash.risk.seasons, flashFloodYears: flash.risk.years.join(', ') } : {}),
        ...(k1 ? { kharif1InFieldAfterMidJune: k1Late } : {}),
        ...(k2 ? { kharif2HeavyRainDays: k2Rain ?? 'n/a', kharif2WaterloggedDays: k2Soaked ?? 'n/a', kharif2FieldDays: k2Days } : {}),
      },
      provenance: {
        source: [
          LOC.kind === 'pilot'
            ? 'Land-type class from the SRDI Talanda union card'
            : "Land-type class: the farmer's, or the upazila default from NASA NASADEM, Landsat surface water and BRRI's 2014-15 survey",
          k2 ? 'NASA POWER topsoil wetness (MERRA-2) and GPM IMERG rain in the replayed seasons of the crop (waterlogging, not a river-flood model)' : '',
          flash ? flash.risk.source : '',
        ].filter(Boolean).join('; '),
        timePeriod: flash ? '2001-2025 springs' : k2 ? '2001-2024 monsoons' : 'static',
        spatialResolution: flash ? 'Upstream IMERG cell (Sohra, Meghalaya) for the haor districts' : k2 ? 'Land-type class; 0.5 degree soil wetness at the district point' : 'Land-type class',
        measuredOrModeled: flash || k2 ? 'modeled' : 'assumed',
        notesBangla: flash
          ? 'উজানের বৃষ্টি থেকে আগাম বন্যার ঝুঁকি; নদীর পানির মাপ (FFWC) মিলিয়ে তবেই সতর্কবার্তা।'
          : 'নদীর বন্যার মডেল এখনো যুক্ত হয়নি; হাওরের আগাম বন্যা শুধু হাওরের সাত জেলায় হিসাব হয়।',
      },
    };
  }

  explain(result: DimensionScoreResult) {
    return {
      banglaBullets: result.metrics.flashFloodCaught !== undefined
        ? [`হাওরের আগাম বন্যা: ${bnDigits(result.metrics.flashFloodSeasons as number)} বছরের ${bnDigits(result.metrics.flashFloodCaught as number)}টিতে ফসল কাটার আগে উজানে ভারী বৃষ্টি।`]
        : ['বন্যার স্কোর জমির শ্রেণি থেকে ধরা; আলাদা বন্যা মডেল নয়।'],
      englishBullets: result.metrics.flashFloodCaught !== undefined
        ? [`Haor flash floods: an upstream burst before the harvest in ${result.metrics.flashFloodCaught} of ${result.metrics.flashFloodSeasons} springs.`]
        : ['The flood score comes from the land-type class, not a flood model.'],
    };
  }
}
