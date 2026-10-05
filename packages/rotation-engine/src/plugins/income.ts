import type { IEvidenceDimensionPlugin, EvaluationContext, DimensionScoreResult } from '@project-eden/contracts';
import { amanOrNull, rabiOf, kharif1Of, kharif2Of, clampScore } from '../data/lookup.ts';
import { ILLUSTRATIVE_AMAN_GROSS_MARGIN_TK_PER_HA } from '../data/crop_catalog.ts';
import { CHOICE_CROPS, choiceIdOf } from '../data/crop_choice.ts';
import { LOC, profileData } from '../data/location.ts';
import { salinityEffect } from '../data/salinity.ts';
import { rainfedFacts } from '../data/rainfed.ts';
import { bnDecimal, bnDigits, bnNumber, enNumber } from '../bn.ts';

/** A district grows less than this of a crop: seed and buyers may be harder to find there. */
const FEW_HA = 500;

/** The q-th quantile of a list, linear between the nearest values. */
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (s.length - 1) * q;
  const lo = Math.floor(at);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (at - lo);
};
const yieldIdOf = (cropId: string) => cropId.replace(/_(k2|kharif|early)$/, '');

/**
 * What stands in for a winter crop without price data (soybean, sunflower, barley): the lower-quartile return of the
 * priced winter crops with the median crop value and price swing, moved by the district's own yield of the crop like
 * any other, so a crop with no price does not win on a guess.
 */
let stand: { margin: number; value: number; lowRatio: number } | null = null;
function standIn() {
  if (!stand) {
    const national = profileData().national;
    const winter = CHOICE_CROPS.filter(c => c.season === 'Rabi' && c.illustrativeGrossMarginTkPerHa !== null);
    const values = winter.map(c => national[yieldIdOf(c.id)]?.value).filter((v): v is number => typeof v === 'number');
    const ratios = Object.values(national).map(n => n.priceLowRatio).filter((r): r is number => typeof r === 'number');
    stand = { margin: quantile(winter.map(c => c.illustrativeGrossMarginTkPerHa!), 0.25), value: quantile(values, 0.5), lowRatio: quantile(ratios, 0.5) };
  }
  return stand;
}

interface LocalReturn {
  id: string;
  saltYield: number | null; // share of the yield the upazila's soil salinity leaves (winter and pre-monsoon crops)
  margin: number; // net return in a typical year at this place
  badYear: number; // the same at the worst harvest price of the last four years
  adjustment: number;
  districtYield: number | null;
  nationalYield: number | null;
  areaHa: number;
  assumedLow: boolean; // the district grows too little to say: the lower tenth of district yields was taken
  standIn: boolean; // no price data: the median winter crop stands in
}

/**
 * A crop's net return at this place: the national figure moved by the district's yield, (district / national yield
 * - 1) x the national crop value per hectare, with the yield ratio held within 0.6-1.4. Where the district grows too
 * little of the crop to give a yield, the lower tenth of district yields stands in: no local evidence that it does
 * well there. In a bad price year the crop value falls to its worst BBS harvest price of 2021-22 to 2024-25. BBS
 * district tables 2022-23 to 2024-25 and harvest prices (research/export/upazila_profile.py); costs as everywhere.
 */
export function localReturn(cropId: string, margin: number | null, salty = false, recordKey?: string): LocalReturn {
  const id = yieldIdOf(cropId);
  const nat = profileData().national[id];
  const here = LOC.local.yields[id];
  const areaHa = here?.[1] ?? 0;
  // On saline coastal land a winter or pre-monsoon crop loses part of its yield. A district yield already carries the
  // salt of the district's saline upazilas, so it moves by this upazila's salt against the district's; a national
  // stand-in yield takes the upazila's salt loss in full.
  const salt = salty ? salinityEffect(cropId) : null;
  const saltYield = salt ? salt.relativeYield : null;
  // Without irrigation a dry-season upland crop makes only its rain-fed share of the yield (rainfed_yield.py)
  const rain = salty && recordKey && LOC.conditions.irrigation === 'none' ? rainfedFacts(recordKey) : null;
  const saltFactor = (salt ? (here?.[0] != null ? salt.againstDistrict : salt.relativeYield) : 1) * (rain ? rain.againstPractice : 1);
  const saltLoss = (value: number) => Math.round(((1 - saltFactor) * value) / 100) * 100;
  if (margin === null) {
    const s = standIn();
    const yieldHere = here?.[0] ?? nat?.lowYield ?? null;
    const ratio = nat && yieldHere !== null ? Math.min(1.4, Math.max(0.6, yieldHere / nat.yield)) : 1;
    const adjustment = Math.round(((ratio - 1) * s.value) / 100) * 100 - saltLoss(s.value * ratio);
    const standMargin = Math.round(s.margin / 100) * 100 + adjustment;
    return { id, saltYield, margin: standMargin, badYear: Math.round(standMargin - (1 - s.lowRatio) * s.value * ratio * saltFactor), adjustment,
      districtYield: yieldHere, nationalYield: nat?.yield ?? null, areaHa, assumedLow: here?.[0] == null && yieldHere !== null, standIn: true };
  }
  const lowRatio = nat?.priceLowRatio ?? standIn().lowRatio;
  const districtYield = here?.[0] ?? nat?.lowYield ?? null;
  if (!nat?.value || districtYield === null) {
    const value = nat?.value ?? standIn().value;
    const adjustment = -saltLoss(value);
    return { id, saltYield, margin: margin + adjustment, badYear: Math.round(margin + adjustment - (1 - lowRatio) * value * saltFactor), adjustment,
      districtYield: null, nationalYield: nat?.yield ?? null, areaHa, assumedLow: false, standIn: false };
  }
  const ratio = Math.min(1.4, Math.max(0.6, districtYield / nat.yield));
  const adjustment = Math.round(((ratio - 1) * nat.value) / 100) * 100 - saltLoss(nat.value * ratio);
  const local = margin + adjustment;
  return { id, saltYield, margin: local, badYear: Math.round(local - (1 - lowRatio) * nat.value * ratio * saltFactor), adjustment, districtYield,
    nationalYield: nat.yield, areaHa, assumedLow: here?.[0] == null, standIn: false };
}

export class IncomeDimensionPlugin implements IEvidenceDimensionPlugin {
  readonly id = 'income';
  readonly displayNameBangla = 'নিট লাভ (নমুনা হিসাব)';
  readonly displayNameEnglish = 'Net Farm Income (illustrative)';
  readonly version = '3.0.0';
  readonly isEnabled = true;

  evaluate(context: EvaluationContext): DimensionScoreResult {
    const { crop: rabiCrop, catalog: rabiName } = rabiOf(context);
    const k1 = kharif1Of(context);
    const k2 = kharif2Of(context);
    const hasAman = Boolean(amanOrNull(context));
    const k1Margin = k1?.catalog.illustrativeGrossMarginTkPerHa ?? null;
    const k2Margin = k2?.catalog.illustrativeGrossMarginTkPerHa ?? null;

    // Team placeholders until DAM farm-gate prices and farmer cost interviews are in (see crop_catalog.ts); potato,
    // maize, Aus and jute use the research net returns in crops/crop_parameters.csv, and chickpea, grass pea, sweet
    // potato, mungbean and sesame the BBS price x yield estimate in crops/minor_crop_returns.csv (data/crop_choice.ts).
    const sources = [...new Set([hasAman ? { incomeSource: 'team estimate (crop_catalog.ts) for Aman' } : null, rabiName, k1?.catalog, k2?.catalog].filter(Boolean)
      .map(c => (c as { incomeSource?: string }).incomeSource ?? 'team estimate (crop_catalog.ts)'))];
    // Each crop's return moves with its district's yield; a summer or monsoon crop without price data is left out
    const rabiLocal = localReturn(choiceIdOf(rabiCrop.variety), rabiName.illustrativeGrossMarginTkPerHa, true, rabiCrop.variety);
    const k1Local = k1 && k1Margin !== null ? localReturn(choiceIdOf(k1.crop.variety), k1Margin, true, k1.crop.variety) : null;
    const k2Local = k2 && k2Margin !== null ? localReturn(choiceIdOf(k2.crop.variety), k2Margin) : null;
    const local = [hasAman ? localReturn('aman', ILLUSTRATIVE_AMAN_GROSS_MARGIN_TK_PER_HA) : null, k2Local, rabiLocal, k1Local]
      .filter((r): r is LocalReturn => r !== null);
    const total = local.reduce((sum, r) => sum + r.margin, 0);
    const badYear = local.reduce((sum, r) => sum + r.badYear, 0);
    // The score takes the middle of a typical and a bad price year: 0.2 at 20,000 Tk/ha or less, 0.96 near 180,000
    const incomeScore = clampScore(((total + badYear) / 2 - 20000) / 160000, 0.2, 0.96);

    const names = new Map<LocalReturn, { bn: string; en: string }>([
      ...local.filter(r => r.id === 'aman').map(r => [r, { bn: 'আমন', en: 'Aman' }] as const),
      [rabiLocal, { bn: rabiName.cropBangla, en: rabiName.crop.toLowerCase() }],
      ...(k1Local && k1 ? [[k1Local, { bn: k1.catalog.cropBangla, en: k1.catalog.crop.toLowerCase() }] as const] : []),
      ...(k2Local && k2 ? [[k2Local, { bn: k2.catalog.cropBangla, en: k2.catalog.crop.toLowerCase() }] as const] : []),
    ]);
    const shown = local.filter(r => r.districtYield !== null && r.nationalYield !== null && (r === rabiLocal || Math.abs(r.adjustment) >= 2000));
    const yieldBangla = (r: LocalReturn) => (r.id === 'jute'
      ? `জাতীয় গড়ের ${bnDigits(Math.round((100 * r.districtYield!) / r.nationalYield!))}%`
      : `${bnDecimal(r.districtYield!, 2)} টন/হেক্টর, দেশে গড়ে ${bnDecimal(r.nationalYield!, 2)}`) + (r.assumedLow ? ', চাষ কম বলে নিচের দিকের ফলন ধরা' : '');
    const yieldEnglish = (r: LocalReturn) => (r.id === 'jute'
      ? `${Math.round((100 * r.districtYield!) / r.nationalYield!)}% of the national yield`
      : `${r.districtYield} t/ha against ${r.nationalYield} nationally`) + (r.assumedLow ? ', the lower tenth of districts, as little is grown here' : '');
    const sign = (n: number) => (n >= 0 ? '+' : '-');
    const localBangla = shown.length
      ? ` ${LOC.district} জেলার ফলন (BBS ২০২২-২৫): ${shown.map(r => `${names.get(r)!.bn} ${yieldBangla(r)} (${sign(r.adjustment)}${bnNumber(Math.abs(r.adjustment))} টাকা)`).join('; ')}।`
      : '';
    const localEnglish = shown.length
      ? ` ${LOC.district} yields (BBS 2022-25): ${shown.map(r => `${names.get(r)!.en} ${yieldEnglish(r)} (${sign(r.adjustment)}${enNumber(Math.abs(r.adjustment))} Tk)`).join('; ')}.`
      : '';
    const standBangla = rabiLocal.standIn ? ` ${rabiName.cropBangla}-এর বাজারদরের তথ্য এখনো নেই, তাই নিচের দিকের রবি ফসলের লাভ ধরে জেলার ফলনে মিলিয়ে ${bnNumber(rabiLocal.margin)} টাকা ধরা হয়েছে।` : '';
    const standEnglish = rabiLocal.standIn ? ` No price data for ${rabiName.crop.toLowerCase()} yet, so a lower-quartile winter crop's return, moved by the district's yield, stands in (${enNumber(rabiLocal.margin)} Tk).` : '';
    const saltNames = local.filter(r => r.saltYield !== null && r.saltYield < 0.995).map(r => ({ r, n: names.get(r)! }));
    const sal = LOC.local.salinity;
    const saltBangla = saltNames.length && sal
      ? ` লবণাক্ততা (SRDI ২০০৯: চাষের জমির ${bnDigits(Math.round(sal.salineShare * 100))}% লবণাক্ত): ${saltNames.map(({ r, n }) => `${n.bn} ফলনের প্রায় ${bnDigits(Math.round(r.saltYield! * 100))}% পায়`).join(', ')} (FAO-61)।`
      : '';
    const saltEnglish = saltNames.length && sal
      ? ` Salt (SRDI 2009: ${Math.round(sal.salineShare * 100)}% of the cultivated land saline): ${saltNames.map(({ r, n }) => `${n.en} keeps about ${Math.round(r.saltYield! * 100)}% of its yield`).join(', ')} (FAO-61 salt tolerance).`
      : '';
    const few = rabiLocal.areaHa < FEW_HA;
    const fewBangla = few
      ? ` এই জেলায় ${rabiName.cropBangla} চাষ কম (BBS ২০২৪-২৫: ${bnNumber(rabiLocal.areaHa)} হেক্টর): বীজ ও বাজার উপসহকারী কৃষি কর্মকর্তার সাথে মিলিয়ে নিন।`
      : '';
    const fewEnglish = few
      ? ` Few farms in ${LOC.district} grow ${rabiName.crop.toLowerCase()} (BBS 2024-25: ${enNumber(rabiLocal.areaHa)} ha): check seed and buyers with the SAAO.`
      : '';
    const badBangla = ` বাজারদর খারাপ বছরে (২০২১-২২ থেকে ২০২৪-২৫-এর সবচেয়ে কম দাম) প্রায় ${bnNumber(badYear)} টাকা।`;
    const badEnglish = ` In a bad price year (the lowest BBS harvest prices of 2021-22 to 2024-25) about ${enNumber(badYear)} Tk.`;
    const counted = [hasAman, Boolean(k2Local), true, Boolean(k1Local)].filter(Boolean).length;
    const seasonsBangla = ['এক মৌসুমে', 'দুই মৌসুমে', 'তিন মৌসুমে', 'চার মৌসুমে'][counted - 1];
    const seasonsEnglish = ['one season', 'two seasons', 'three seasons', 'four seasons'][counted - 1];
    const left = [k2 && k2Margin === null ? k2 : null, k1 && k1Margin === null ? k1 : null].filter(Boolean) as Array<NonNullable<typeof k1>>;
    const leftBangla = left.map(x => ` ${x.catalog.cropBangla}-এর দর-খরচ এখনো নেই, তাই ধরা হয়নি।`).join('');
    const leftEnglish = left.map(x => ` ${x.catalog.crop} is left out: no price and cost data yet.`).join('');

    return {
      dimensionId: this.id,
      score: incomeScore,
      confidence: rabiLocal.standIn ? 'uncertain' : 'low',
      staleOrMissing: true,
      summaryBangla: `নমুনা হিসাব: ${seasonsBangla} প্রায় ${bnNumber(total)} টাকা/হেক্টর নিট লাভ ধরা হয়েছে (দলের অনুমান ও BBS দর-ফলনের হিসাব; কৃষকের খরচ যাচাই বাকি)।${badBangla}${standBangla}${leftBangla}${localBangla}${saltBangla}${fewBangla}`,
      summaryEnglish: `Illustrative: about ${enNumber(total)} BDT/ha over ${seasonsEnglish} (team estimates and BBS price-and-yield estimates; farmer costs not yet verified).${badEnglish}${standEnglish}${leftEnglish}${localEnglish}${saltEnglish}${fewEnglish}`,
      metrics: {
        illustrativeTotalBdtPerHa: total,
        badPriceYearBdtPerHa: badYear,
        illustrativeRabiBdtPerHa: rabiLocal.standIn ? 'n/a' : rabiLocal.margin,
        ...(k1 ? { illustrativeKharif1BdtPerHa: k1Local?.margin ?? 'n/a' } : {}),
        ...(k2 ? { illustrativeKharif2BdtPerHa: k2Local?.margin ?? 'n/a' } : {}),
        districtYieldTPerHa: rabiLocal.districtYield ?? 'n/a',
        nationalYieldTPerHa: rabiLocal.nationalYield ?? 'n/a',
        districtYieldAdjustmentBdtPerHa: local.reduce((sum, r) => sum + r.adjustment, 0),
        districtAreaHa: rabiLocal.areaHa,
        ...(rabiLocal.saltYield !== null ? { winterSaltYieldShare: rabiLocal.saltYield } : {}),
      },
      provenance: {
        source: `Net return per hectare: ${sources.join('; ')}; moved by ${LOC.district}'s BBS 2022-25 yields against the national yields; a bad price year at each crop's lowest BBS harvest price of 2021-22 to 2024-25. Pending: farmer cost interviews`,
        timePeriod: 'BBS yields 2022-23 to 2024-25; harvest prices 2021-22 to 2024-25',
        spatialResolution: `District (${LOC.district})`,
        measuredOrModeled: 'assumed',
        notesBangla: 'এই সংখ্যা যাচাই করা বাজারদর নয়; কৃষক সাক্ষাৎকার ও DAM দর পাওয়ার পর বদলাবে।',
      },
    };
  }

  explain(result: DimensionScoreResult) {
    return {
      banglaBullets: [`নমুনা হিসাব: প্রায় ${bnNumber(result.metrics.illustrativeTotalBdtPerHa as number)} টাকা/হেক্টর (যাচাই বাকি); খারাপ দামের বছরে ${bnNumber(result.metrics.badPriceYearBdtPerHa as number)}।`],
      englishBullets: [`Illustrative ${result.metrics.illustrativeTotalBdtPerHa} BDT/ha (${result.metrics.badPriceYearBdtPerHa} in a bad price year), not yet verified.`],
    };
  }
}
