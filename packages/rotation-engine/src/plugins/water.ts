import type { IEvidenceDimensionPlugin, EvaluationContext, DimensionScoreResult } from '@project-eden/contracts';
import { amanOrNull, rabiOf, kharif1Of, kharif2Of, clampScore } from '../data/lookup.ts';
import { bnDigits, bnIrrigation, bnNumber } from '../bn.ts';

export class WaterDimensionPlugin implements IEvidenceDimensionPlugin {
  readonly id = 'water';
  readonly displayNameBangla = 'পানির নিরাপত্তা ও সেচ সাশ্রয়';
  readonly displayNameEnglish = 'Water Security & Irrigation Demand';
  readonly version = '2.0.0';
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
    const waterScore = clampScore(1.0 - rescueShare * 0.35 - ((rabi.netIrrigationMm + k1Mm + k2Mm) / 1000) * 0.55, 0.1, 0.98);
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
      summaryBangla: `${monsoonBangla} রবিতে ${rabiName.cropInBangla} সেচ লাগে প্রায় ${bnDigits(rabi.netIrrigationMm)} মিমি (হেক্টরে ${bnNumber(pumpedM3PerHa)} ঘনমিটার ভূগর্ভস্থ পানি)।${k1Bangla}`,
      summaryEnglish: `${monsoonEnglish} ${rabiName.crop} needs about ${rabi.netIrrigationMm} mm of irrigation (${pumpedM3PerHa.toLocaleString('en-US')} m3/ha of groundwater).${k1English}`,
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
      },
      provenance: {
        source: 'NASA POWER (FAO-56 Penman-Monteith ET0) + GPM IMERG Final daily rain; 25-season paddy water balance (research/explore/connect_check.py)'
          + (choice ? '; crops the farmer chose: the same FAO-56 method per sowing date (research/explore/crop_choice_replay.py)' : ''),
        timePeriod: '2001-2025',
        spatialResolution: 'Tanore pilot point: IMERG 0.1° (~10 km), POWER 0.5° x 0.625°',
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
