import type { IEvidenceDimensionPlugin, EvaluationContext, DimensionScoreResult } from '@project-eden/contracts';
import { amanOrNull, rabiOf, kharif1Of, kharif2Of, clampScore } from '../data/lookup.ts';
import { LOC, groundwaterDeclineRange } from '../data/location.ts';
import { bnDecimal, bnDigits, bnIrrigation, bnNumber, enNumber } from '../bn.ts';

/**
 * How much a millimetre of irrigation counts at this place: 1 where NASA GLDAS-2.2 (GRACE-assimilated) groundwater
 * falls no faster than in the median district, rising to 1.5 at the steepest decline. It never drops below 1: a flat
 * trend on the coast can mean little pumping because the water is saline, not plenty to spare.
 */
/**
 * The replay counts 50 mm of soil water left by Aman (or the monsoon) for an upland winter crop (connect_check.py,
 * crop_choice_replay.py). When today's NASA reading finds the soil dry before the sowing, that water may not be there.
 */
export const DRY_START_MM = 50;

export function groundwaterWeight(): { fallMmPerYear: number; weight: number } {
  const gw = LOC.conditions.groundwater as { trendMmPerYear: number } | null | undefined;
  const fall = gw ? Math.max(0, -gw.trendMmPerYear) : 0;
  const { median, steepest } = groundwaterDeclineRange();
  const stress = steepest > median ? Math.min(1, Math.max(0, (fall - median) / (steepest - median))) : 0;
  return { fallMmPerYear: fall, weight: Math.round((1 + 0.5 * stress) * 100) / 100 };
}

export class WaterDimensionPlugin implements IEvidenceDimensionPlugin {
  readonly id = 'water';
  readonly displayNameBangla = 'পানির নিরাপত্তা ও সেচ সাশ্রয়';
  readonly displayNameEnglish = 'Water Security & Irrigation Demand';
  readonly version = '2.1.0';
  readonly isEnabled = true;

  evaluate(context: EvaluationContext): DimensionScoreResult {
    const amanSlot = amanOrNull(context);
    const aman = amanSlot?.record;
    const { record: rabi, catalog: rabiName } = rabiOf(context);

    const k1 = kharif1Of(context);
    const k1Mm = k1?.record.netIrrigationMm ?? 0;
    const k2 = kharif2Of(context);
    const k2Mm = k2?.record.netIrrigationMm ?? 0;

    const rescueShare = aman ? aman.rescueSeasons / aman.totalSeasons : 0;
    const gw = groundwaterWeight();
    const deep = context.landType === 'low' || context.landType === 'very_low'; // haor and beel land: often river or beel water
    const current = LOC.conditions.current as { dryStart?: boolean; date?: string } | null | undefined;
    const dryStart = Boolean(current?.dryStart) && !rabiName.isRice;
    const rabiMm = rabi.netIrrigationMm + (dryStart ? DRY_START_MM : 0);
    const waterScore = clampScore(1.0 - rescueShare * 0.35 - ((rabiMm + k1Mm + k2Mm) / 1000) * 0.55 * gw.weight, 0.1, 0.98);
    const dryBangla = dryStart
      ? ` এখন মাটি স্বাভাবিকের চেয়ে শুকনো (নাসা POWER): আমনের পর জমিতে যে ${bnDigits(DRY_START_MM)} মিমি রস ধরা হয় তা না-ও থাকতে পারে, তাই এ বছর প্রায় ${bnDigits(rabiMm)} মিমি সেচ ধরা হয়েছে।`
      : '';
    const dryEnglish = dryStart
      ? ` The soil is drier than usual now (NASA POWER): the ${DRY_START_MM} mm of soil water the replay counts on after Aman may not be there, so about ${rabiMm} mm is counted this year.`
      : '';
    const gwBangla = gw.weight >= 1.1
      ? ` নাসার GRACE-GLDAS তথ্যে এখানে ভূগর্ভস্থ পানি বছরে ${bnDecimal(gw.fallMmPerYear)} মিমি নামছে, বেশিরভাগ জেলার চেয়ে দ্রুত; তাই সেচের ভার ${bnDecimal(gw.weight, 2)} গুণ ধরা হয়েছে।`
      : '';
    const gwEnglish = gw.weight >= 1.1
      ? ` NASA GRACE-GLDAS shows groundwater here falling ${gw.fallMmPerYear} mm a year, faster than in most districts, so irrigation counts ${gw.weight} times.`
      : '';
    const monsoonBangla = aman && amanSlot
      ? `${amanSlot.catalog.varietyBangla}: ${bnDigits(aman.totalSeasons)} মৌসুমের ${bnDigits(aman.rescueSeasons)}টিতে ফুল আসার সময় সম্পূরক সেচ লেগেছে।`
      : k2 ? `বর্ষায় ${k2.catalog.cropInBangla} ${bnIrrigation(k2Mm)}।` : 'বর্ষায় ধান নেই, তাই আমনের সম্পূরক সেচও নেই।';
    const monsoonEnglish = aman
      ? `${aman.variety} needed rescue irrigation at flowering in ${aman.rescueSeasons} of ${aman.totalSeasons} seasons.`
      : k2 ? `${k2.catalog.crop} in the monsoon needs ${k2Mm < 20 ? 'almost no irrigation' : `about ${k2Mm} mm`}.` : 'No rice in the monsoon, so no rescue irrigation for Aman.';
    const pumpedM3PerHa = rabi.pumpedM3PerHa;
    const k1Bangla = k1 ? ` তারপর ${aman ? 'আমনের' : 'বর্ষার'} আগে ${k1.catalog.cropInBangla} ${bnIrrigation(k1Mm)}।` : '';
    const k1English = k1 ? ` Then ${k1.catalog.crop.toLowerCase()} before ${aman ? 'Aman' : 'the monsoon'} needs ${k1Mm < 20 ? 'almost no irrigation' : `about ${k1Mm} mm more`}.` : '';
    const choice = context.crops.some(c => c.season !== 'Aman' && c.variety.includes('@'));
    const before = aman ? 'আমনের' : 'বর্ষার';

    return {
      dimensionId: this.id,
      score: waterScore,
      confidence: 'medium',
      summaryBangla: `${monsoonBangla} রবিতে ${rabiName.cropInBangla} সেচ লাগে প্রায় ${bnDigits(rabi.netIrrigationMm)} মিমি (হেক্টরে ${bnNumber(pumpedM3PerHa)} ঘনমিটার ${deep ? 'সেচের পানি' : 'ভূগর্ভস্থ পানি'})।${k1Bangla}${gwBangla}${dryBangla}`,
      summaryEnglish: `${monsoonEnglish} ${rabiName.crop} needs about ${rabi.netIrrigationMm} mm of irrigation (${enNumber(pumpedM3PerHa)} m3/ha of ${deep ? 'irrigation water' : 'groundwater'}).${k1English}${gwEnglish}${dryEnglish}`,
      metrics: {
        ...(aman
          ? {
              amanRescueIrrigationSeasons: aman.rescueSeasons,
              totalSeasonsSimulated: aman.totalSeasons,
              rescueYears: aman.rescueYears.join(', '),
              amanCropWaterUseMm: aman.cropWaterUseMm,
            }
          : { totalSeasonsSimulated: rabi.seasons, noAman: true }),
        ...(k2 ? { kharif2NetIrrigationMm: k2Mm, kharif2Crop: k2.catalog.crop } : {}),
        rabiNetIrrigationMm: rabi.netIrrigationMm,
        rabiNetIrrigationRange: `${rabi.netIrrigationRangeMm[0]}-${rabi.netIrrigationRangeMm[1]} mm (p10-p90)`,
        groundwaterPumpedM3PerHa: pumpedM3PerHa,
        ...(k1 ? { kharif1NetIrrigationMm: k1Mm, kharif1Crop: k1.catalog.crop } : {}),
        groundwaterFallMmPerYear: gw.fallMmPerYear,
        groundwaterWeight: gw.weight,
        ...(dryStart ? { dryStartExtraMm: DRY_START_MM } : {}),
      },
      provenance: {
        source: `NASA POWER (FAO-56 Penman-Monteith ET0) + GPM IMERG Final daily rain; 25-season paddy water balance (research/explore/${LOC.kind === 'pilot' ? 'connect_check.py' : 'national_replay.py'})`
          + (choice ? '; other crops: the same FAO-56 method per sowing date (research/explore/crop_choice_replay.py)' : '')
          + '; irrigation weighted by the NASA GLDAS-2.2 (GRACE-assimilated) groundwater trend',
        timePeriod: '2001-2025',
        spatialResolution: `${LOC.kind === 'pilot' ? 'Tanore pilot point' : `${LOC.district} district point`}: IMERG 0.1° (~10 km), POWER 0.5° x 0.625°`,
        measuredOrModeled: 'modeled',
        notesBangla: 'বৃষ্টি, বাষ্পীভবন ও ২ মিমি/দিন চুয়ানো ধরে ধানক্ষেতের পানির হিসাব; ফুল আসার আগে-পরে ৫ দিন বা বেশি পানি না থাকলে সম্পূরক সেচ ধরা হয়েছে।',
      },
    };
  }

  explain(result: DimensionScoreResult) {
    const m = result.metrics;
    if (m.amanRescueIrrigationSeasons === undefined) {
      return {
        banglaBullets: ['বর্ষায় আমন ধান নেই, তাই সম্পূরক সেচও নেই।', `রবি মৌসুমে সেচ লাগে প্রায় ${bnDigits(m.rabiNetIrrigationMm as number)} মিমি।`],
        englishBullets: ['No Aman rice, so no rescue irrigation in the monsoon.', `Rabi net irrigation about ${m.rabiNetIrrigationMm} mm, ${m.rabiNetIrrigationRange}.`],
      };
    }
    return {
      banglaBullets: [
        `${bnDigits(m.totalSeasonsSimulated as number)} মৌসুমের ${bnDigits(m.amanRescueIrrigationSeasons as number)}টিতে ফুল আসার সময় সম্পূরক সেচ লেগেছে (বছর: ${bnDigits(m.rescueYears as string)})।`,
        `রবি মৌসুমে সেচ লাগে প্রায় ${bnDigits(m.rabiNetIrrigationMm as number)} মিমি।`,
      ],
      englishBullets: [
        `Rescue irrigation at flowering in ${m.amanRescueIrrigationSeasons} of ${m.totalSeasonsSimulated} seasons (${m.rescueYears}).`,
        `Rabi net irrigation about ${m.rabiNetIrrigationMm} mm, ${m.rabiNetIrrigationRange}.`,
      ],
    };
  }
}
