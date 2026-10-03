/**
 * Soil-and-water tips beside a rotation: what the plan saves against the usual Aman-Boro rotation at the same place,
 * and what to watch for. Numbers come from the plan's own records (SRDI fertilizer cards, the NASA POWER + IMERG water
 * replay, NASA GLDAS groundwater) and the SRDI soil fertility atlas for the upazila. Satellites cannot measure lead,
 * mercury or arsenic in soil, so the metal tips are sourced safe-practice guidance tied to the plan's irrigation and
 * phosphate use, not a measurement.
 */
import fs from 'node:fs';
import type { CandidateRotation, StewardshipTip } from '@project-eden/contracts';
import { LOC } from './data/location.ts';
import { bnDecimal, bnDigits, bnNumber } from './bn.ts';

const BIGHA_HA = 0.1336;

interface AtlasClasses {
  ph: string | null;
  organicMatter: string | null;
  phosphorus: string | null;
  potassium: string | null;
  sulphur: string | null;
  zinc: string | null;
  boron: string | null;
}

let atlas: { source: string; classes: Record<string, AtlasClasses> } | null = null;
function soilAtlas() {
  if (!atlas) atlas = JSON.parse(fs.readFileSync(new URL('./data/soil_atlas.json', import.meta.url), 'utf8'));
  return atlas!;
}

/** The upazila the advice is for: the pilot is Tanore. */
function upazilaId(): string {
  return LOC.kind === 'pilot' ? 'ADM3_Tanore' : LOC.id;
}

const LOW = new Set(['Low', 'Very Low']);
const ACID = new Set(['Strongly Acidic', 'Very Strongly Acidic']);

/** What the usual Aman-Boro rotation (BRRI dhan49 then BRRI dhan28) takes at this place, from the same records. */
function baseline() {
  const boro = LOC.rabi['BRRI dhan28'];
  return {
    pumpedM3PerHa: boro.pumpedM3PerHa,
    ureaKgHa: LOC.srdi.aman.ureaKgHa + boro.fertilizer.ureaKgHa,
    tspKgHa: LOC.srdi.aman.tspKgHa + boro.fertilizer.tspKgHa,
  };
}

const perBigha = (kgHa: number) => kgHa * BIGHA_HA;

/**
 * Tips for one option. `tspKgHa` is the plan's phosphate per hectare; `riceCrops` how many rice crops the year holds.
 */
export function stewardshipTips(option: CandidateRotation, tspKgHa: number, riceCrops: number): StewardshipTip[] {
  const base = baseline();
  const ledger = option.ledger!;
  const tips: StewardshipTip[] = [];
  const isBaseline = option.isBaseline || (riceCrops >= 2 && ledger.groundwaterPumpedM3PerHa >= base.pumpedM3PerHa * 0.95);

  // Water: groundwater pumped against the usual rotation, and NASA's groundwater trend here
  const savedM3 = base.pumpedM3PerHa - ledger.groundwaterPumpedM3PerHa;
  const gw = LOC.conditions.groundwater;
  const trendBn = gw ? ` নাসার GRACE-GLDAS তথ্যে এখানে ভূগর্ভস্থ পানি ${bnDigits(gw.period.replace(/-/g, '–').replace(' to ', ' থেকে '))} সময়ে ${bnDigits(Math.abs(Math.round(gw.changeMm)))} মিমি ${gw.changeMm < 0 ? 'কমেছে' : 'বেড়েছে'}।` : '';
  const trendEn = gw ? ` NASA GRACE-GLDAS shows groundwater here ${gw.changeMm < 0 ? 'down' : 'up'} ${Math.abs(Math.round(gw.changeMm))} mm (${gw.period}).` : '';
  if (!isBaseline && savedM3 > 0) {
    tips.push({
      kind: 'water',
      bn: `প্রচলিত আমন–বোরো চক্রের চেয়ে বছরে বিঘাপ্রতি প্রায় ${bnNumber(perBigha(savedM3))} ঘনমিটার কম ভূগর্ভস্থ পানি তুলতে হয়।${trendBn}`,
      en: `About ${Math.round(perBigha(savedM3)).toLocaleString('en-US')} m3 less groundwater pumped per bigha each year than the usual Aman-Boro rotation.${trendEn}`,
      source: 'NASA POWER + GPM IMERG water replay; NASA GLDAS-2.2 (GRACE-assimilated) groundwater',
    });
  } else {
    tips.push({
      kind: 'water',
      bn: `এই চক্রে বছরে বিঘাপ্রতি প্রায় ${bnNumber(perBigha(ledger.groundwaterPumpedM3PerHa))} ঘনমিটার ভূগর্ভস্থ পানি লাগে; সেচে ভেজানো-শুকানো (AWD) পদ্ধতিতে পানি বাঁচে।${trendBn}`,
      en: `This rotation pumps about ${Math.round(perBigha(ledger.groundwaterPumpedM3PerHa)).toLocaleString('en-US')} m3 of groundwater per bigha a year; alternate wetting and drying saves water.${trendEn}`,
      source: 'NASA POWER + GPM IMERG water replay; BRRI alternate wetting and drying guidance',
    });
  }

  // Fertilizer: urea and phosphate against the usual rotation; legumes fix nitrogen; extra urea ends up in water
  const ureaLess = perBigha(base.ureaKgHa - ledger.ureaKgHa);
  const tspLess = perBigha(base.tspKgHa - tspKgHa);
  const legume = ledger.legume;
  tips.push({
    kind: 'fertilizer',
    bn: [
      ureaLess > 0.5
        ? `প্রচলিত চক্রের চেয়ে বছরে বিঘাপ্রতি প্রায় ${bnDecimal(ureaLess)} কেজি কম ইউরিয়া${tspLess > 0.5 ? ` ও ${bnDecimal(tspLess)} কেজি কম টিএসপি` : ''} লাগে।`
        : `এই চক্রে বছরে বিঘাপ্রতি ইউরিয়া প্রায় ${bnDecimal(perBigha(ledger.ureaKgHa))} কেজি লাগে।`,
      legume ? 'ডাল ফসলের শিকড়ের গুটি বাতাসের নাইট্রোজেন মাটিতে ধরে রাখে।' : '',
      'কার্ডের মাত্রার বেশি ইউরিয়া দিলে বাড়তি নাইট্রোজেন নাইট্রেট হয়ে পানিতে মেশে।',
    ].filter(Boolean).join(' '),
    en: [
      ureaLess > 0.5
        ? `About ${ureaLess.toFixed(1)} kg less urea${tspLess > 0.5 ? ` and ${tspLess.toFixed(1)} kg less TSP` : ''} per bigha a year than the usual rotation.`
        : `About ${perBigha(ledger.ureaKgHa).toFixed(1)} kg of urea per bigha a year.`,
      legume ? 'The legume fixes nitrogen from the air in its root nodules.' : '',
      'Urea above the card dose leaves as nitrate in the water.',
    ].filter(Boolean).join(' '),
    source: 'SRDI Fertilizer Recommendation cards (Talanda stand-in); FAO fertilizer guidance',
  });

  // Pesticide: the rice-pest cycle, and safe use
  tips.push({
    kind: 'pesticide',
    bn: [
      riceCrops === 0
        ? 'সারা বছর ধান নেই: মাজরা পোকা ও বাদামি গাছফড়িং খাবার পায় না, ধানের কীটনাশক লাগে না।'
        : riceCrops === 1
          ? 'ধানের পর ধান নেই: ধানের পোকার চক্র ভাঙে, বোরো চক্রের চেয়ে কীটনাশক স্প্রে কম লাগে।'
          : 'ধানের পর ধান: পোকা সারা বছর খাবার পায়; আলোক ফাঁদ ও পার্চিং দিন, মাঠ ঘুরে পোকা গুনে তবেই স্প্রে।',
      'স্প্রের পর ফসল তোলার নির্ধারিত অপেক্ষার সময় মানুন; খালি বোতল পুকুর বা খালে ফেলবেন না।',
    ].join(' '),
    en: [
      riceCrops === 0
        ? 'No rice all year: stem borers and planthoppers find no host, so no rice pesticide.'
        : riceCrops === 1
          ? 'No rice after rice: the rice-pest cycle breaks and fewer sprays are needed than in the Boro rotation.'
          : 'Rice after rice keeps pests fed all year: use light traps and perches, and spray only after counting pests.',
      'Keep the waiting time between spraying and harvest, and never throw empty bottles into ponds or canals.',
    ].join(' '),
    source: 'BRRI rice IPM guidance; FAO/WHO International Code of Conduct on Pesticide Management (2014)',
  });

  // Soil: the SRDI atlas classes for this upazila
  const soil = soilAtlas().classes[upazilaId()];
  if (soil) {
    const bn: string[] = [];
    const en: string[] = [];
    if (soil.organicMatter && LOW.has(soil.organicMatter)) {
      bn.push(`এই উপজেলার মাটিতে জৈব পদার্থ কম: গোবর বা কম্পোস্ট দিন, ধৈঞ্চা সবুজ সার করুন, খড় পোড়াবেন না${legume ? '; এই চক্রের ডাল ফসলও সাহায্য করে' : ''}।`);
      en.push(`Organic matter is low in this upazila: add manure or compost, grow dhaincha as green manure and do not burn straw${legume ? '; the legume in this rotation helps' : ''}.`);
    }
    if (soil.ph && ACID.has(soil.ph)) {
      bn.push('মাটি বেশ অম্লীয়: কৃষি কর্মকর্তার পরামর্শে ডলোচুন দিন।');
      en.push('The soil is strongly acidic: apply dolomite lime on the officer\'s advice.');
    }
    if (soil.zinc && LOW.has(soil.zinc)) {
      bn.push('দস্তা (জিংক) কম: কার্ডের মাত্রায় জিংক সালফেট দিন, বেশি নয়।');
      en.push('Zinc is low: apply zinc sulphate at the card dose, no more.');
    }
    if (soil.boron && LOW.has(soil.boron)) {
      bn.push('বোরন কম: ডাল, সরিষা ও সূর্যমুখীতে কার্ডের মাত্রায় বোরিক এসিড দিন।');
      en.push('Boron is low: give pulses, mustard and sunflower boric acid at the card dose.');
    }
    if (bn.length) {
      tips.push({ kind: 'soil', bn: bn.join(' '), en: en.join(' '), source: `${soilAtlas().source}; upazila classes` });
    }
  }

  // Metals: arsenic rides on irrigation water, cadmium on phosphate, lead, chromium and mercury on waste water
  const share = base.pumpedM3PerHa > 0 ? Math.round((100 * ledger.groundwaterPumpedM3PerHa) / base.pumpedM3PerHa) : 100;
  const lessWater = share < 90;
  tips.push({
    kind: 'metals',
    bn: lessWater
      ? `নলকূপের পানিতে আর্সেনিক থাকলে প্রতিবার সেচে তা মাটি ও চালে জমে; এই চক্রে সেচের পানি প্রচলিত বোরো চক্রের প্রায় ${bnDigits(share)}%, তাই সে ঝুঁকিও তত কম। নলকূপের পানি জনস্বাস্থ্য প্রকৌশল অধিদপ্তরে পরীক্ষা করান।`
      : 'নলকূপের পানিতে আর্সেনিক থাকলে প্রতিবার সেচে তা মাটি ও চালে জমে; বোরোতে সেচ সবচেয়ে বেশি, তাই ঝুঁকিও বেশি: ভেজানো-শুকানো (AWD) পদ্ধতিতে সেচ কমান। নলকূপের পানি জনস্বাস্থ্য প্রকৌশল অধিদপ্তরে পরীক্ষা করান।',
    en: lessWater
      ? `Arsenic in well water builds up in soil and rice with every irrigation; this rotation pumps about ${share}% of the usual Boro rotation's water, so that risk falls with it. Have the well tested by the Department of Public Health Engineering.`
      : 'Arsenic in well water builds up in soil and rice with every irrigation; Boro takes the most water and so the most risk: cut irrigation with alternate wetting and drying. Have the well tested by the Department of Public Health Engineering.',
    source: 'BGS/DPHE (2001) groundwater arsenic survey; Meharg and Rahman (2003) on arsenic in paddy soils',
  });
  tips.push({
    kind: 'metals',
    bn: `টিএসপির মতো ফসফেট সারে অল্প ক্যাডমিয়াম থাকে: এই চক্রে বছরে বিঘাপ্রতি টিএসপি প্রায় ${bnDecimal(perBigha(tspKgHa))} কেজি, কার্ডের বেশি দেবেন না। কলকারখানা, ট্যানারি বা ব্যাটারি ভাঙার জায়গার বর্জ্য পানি দিয়ে সেচ দেবেন না, শহরের স্লাজ জমিতে দেবেন না: সীসা, ক্রোমিয়াম ও পারদ মাটিতে থেকে যায়। উপগ্রহ এগুলো মাপতে পারে না; সন্দেহ হলে SRDI-তে মাটি পরীক্ষা করান।`,
    en: `Phosphate fertilizers such as TSP carry some cadmium: this rotation uses about ${perBigha(tspKgHa).toFixed(1)} kg of TSP per bigha a year; do not exceed the card. Do not irrigate with waste water from factories, tanneries or battery-breaking sites, or spread city sludge: lead, chromium and mercury stay in the soil. Satellites cannot measure them; test suspect soil at SRDI.`,
    source: 'EU Regulation 2019/1009 (cadmium in phosphate fertilizers); WHO (2006) guidelines for the safe use of wastewater in agriculture',
  });
  return tips;
}
