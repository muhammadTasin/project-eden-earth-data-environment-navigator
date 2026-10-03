import type { IEvidenceDimensionPlugin, EvaluationContext, DimensionScoreResult } from '@project-eden/contracts';
import { rabiOf, kharif1Of, clampScore } from '../data/lookup.ts';
import { LOC } from '../data/location.ts';
import { bnDigits, bnDecimal } from '../bn.ts';

export class SoilDimensionPlugin implements IEvidenceDimensionPlugin {
  readonly id = 'soil';
  readonly displayNameBangla = 'মাটি স্বাস্থ্য ও পুষ্টি ভারসাম্য';
  readonly displayNameEnglish = 'Soil Health & Fertilizer Load';
  readonly version = '2.0.0';
  readonly isEnabled = true;

  evaluate(context: EvaluationContext): DimensionScoreResult {
    const { record: rabi, catalog: rabiName } = rabiOf(context);
    const k1 = kharif1Of(context);
    const dose = rabi.fertilizer;
    const rotationUrea = Math.round(LOC.srdi.aman.ureaKgHa + dose.ureaKgHa + (k1?.record.fertilizer.ureaKgHa ?? 0));
    const handbookDose = (dose as { source?: string }).source?.startsWith('BARI');

    // Legumes add nitrogen and cut urea; two rice crops in a year work the soil hardest. A third crop before Aman
    // adds nitrogen if it is a legume, and otherwise draws more nutrients (more still if it is rice).
    const base = rabiName.isLegume ? 0.9 : rabiName.isRice ? 0.45 : 0.7;
    const soilScore = k1 ? clampScore(base + (k1.catalog.isLegume ? 0.05 : k1.catalog.isRice ? -0.15 : -0.05), 0.1, 0.95) : base;
    const k1Bangla = k1
      ? ` আমনের আগে ${k1.catalog.cropBangla}: ${k1.catalog.isLegume ? 'ডাল ফসল, মাটিতে নাইট্রোজেন যোগ করে' : 'বছরে তিন ফসলে মাটির পুষ্টি বেশি লাগে'}।`
      : '';
    const k1English = k1
      ? ` ${k1.catalog.crop} before Aman ${k1.catalog.isLegume ? 'is a legume and adds nitrogen' : 'makes three crops a year, drawing more nutrients'}.`
      : '';
    const why = rabiName.isLegume
      ? 'ডাল ফসল বাতাসের নাইট্রোজেন মাটিতে যোগ করে, তাই ইউরিয়া কম লাগে।'
      : rabiName.isRice
        ? 'বছরে দুবার ধানে মাটির ওপর চাপ ও সারের খরচ সবচেয়ে বেশি।'
        : 'মাটির পুষ্টি ভারসাম্য মোটামুটি বজায় থাকে।';

    return {
      dimensionId: this.id,
      score: soilScore,
      confidence: 'medium',
      summaryBangla: `${why} ${handbookDose ? 'BARI হাতবইয়ে' : `SRDI তালন্দ কার্ডে (${LOC.srdi.soilTypeBangla})`} ${rabiName.cropInBangla} ইউরিয়া ${bnDecimal(dose.ureaKgHa)} কেজি/হেক্টর; আমনসহ পুরো চক্রে ${bnDigits(rotationUrea)} কেজি।${k1Bangla}`,
      summaryEnglish: `${handbookDose ? 'BARI handbook' : 'SRDI Talanda card (Kharia soil)'}: ${rabiName.crop} urea ${dose.ureaKgHa} kg/ha; ${rotationUrea} kg/ha for the whole rotation with Aman.${k1English}`,
      metrics: {
        srdiSoilType: LOC.srdi.soilTypeBangla,
        rabiUreaKgHa: dose.ureaKgHa,
        rabiTspKgHa: dose.tspKgHa,
        rabiMopKgHa: dose.mopKgHa,
        rotationUreaKgHa: rotationUrea,
        legume: rabiName.isLegume,
      },
      provenance: {
        source: LOC.srdi.source + ' — Talanda, medium-high land',
        timePeriod: 'current SRDI card',
        spatialResolution: 'Union (Talanda)',
        measuredOrModeled: 'measured',
        notesBangla: 'SRDI-র মাটি পরীক্ষাভিত্তিক ইউনিয়ন সার সুপারিশ; নিজের জমির মাটি পরীক্ষা হলে সেটিই আগে।',
      },
    };
  }

  explain(result: DimensionScoreResult) {
    const m = result.metrics;
    return {
      banglaBullets: [
        m.legume
          ? 'ডাল ফসলের পরে পরের ফসলে ইউরিয়া কম লাগে।'
          : `পুরো চক্রে ইউরিয়া ${bnDigits(m.rotationUreaKgHa as number)} কেজি/হেক্টর (SRDI কার্ড)।`,
      ],
      englishBullets: [`Rotation urea ${m.rotationUreaKgHa} kg/ha on the SRDI card.`],
    };
  }
}
