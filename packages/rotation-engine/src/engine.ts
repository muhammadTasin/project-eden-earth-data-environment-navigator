import type {
  AdviceJSON,
  CandidateRotation,
  CropChoiceResult,
  CropPhase,
  DimensionScoreResult,
  EvaluationContext,
  FarmerCard,
  IpmTip,
  LandType,
  LocalContext,
  MonthTimelineSlot,
  ThisSeasonFit,
} from '@project-eden/contracts';
import { FeatureRegistry } from './registry.ts';
import { RELEASE } from './data/tanore_replay_data.ts';
import { LOC, placeFor, profileData, withPlace } from './data/location.ts';
import { flashFloodExposed, flashFloodRisk, harvestTooLate, landRules, type LandRules } from './data/land.ts';
import { AMAN_CATALOG, RABI_CATALOG } from './data/crop_catalog.ts';
import type { AmanCatalogEntry } from './data/crop_catalog.ts';
import type { AmanRecord, MonthDay, RabiRecord } from './data/release_types.ts';
import type { RabiCatalogEntry } from './data/crop_catalog.ts';
import { IPM_AMAN, IPM_BY_RABI, IPM_GENERAL } from './data/ipm_catalog.ts';
import { stewardshipTips } from './stewardship.ts';
import {
  CHOICE_BY_ID,
  CHOICE_CROPS,
  CROP_GROUPS,
  NOT_MODELLED,
  RICE_IDS,
  TURNAROUND_DAYS,
  addDays,
  catalogFor,
  choiceIdOf,
  choiceReplay,
  isFit,
  kharif1Fit,
  kharif2Keys,
  rabiFit,
  recordFor,
  replayFacts,
  yearDay,
  type ChoiceCrop,
  type Fit,
} from './data/crop_choice.ts';
import {
  LAND_TYPE_BANGLA,
  bnDate,
  bnDateOf,
  bnDecimal,
  bnDigits,
  bnGenitive,
  bnIrrigation,
  bnMonth,
  bnNumber,
  bnOf,
  bnRange,
  enDate,
  enMonth,
  isoDate,
  patternBangla,
  seasonDate,
  seasonDay,
} from './bn.ts';

export interface PlanOptionsRequest {
  unionId: string;
  unionNameBangla: string;
  upazila: string;
  district: string;
  landType: LandType;
  /** True when `landType` is the place's default (data/location.ts) rather than what the farmer said. */
  landTypeAssumed?: boolean;
  /**
   * Today's NASA reading at the place, when the server has one (services/api/src/live.ts): soil wetness ranked against
   * the same date in past years and 30-day rain against normal. From 1 September to 15 December a dry soil changes
   * the winter crop's plan (see DRY_START_MM in plugins/water.ts).
   */
  currentConditions?: {
    date: string;
    soilStatus: string; // 'dry' | 'normal' | 'wet'
    soilRank?: number | null;
    soilYears?: number | null;
    rain30PctOfNormal?: number | null;
    source: string;
  };
  season: string;
  currentAmanCrop?: string;
  today?: string; // ISO date for the crop-stage text; defaults to now
  /**
   * Crops the farmer wants, as data/crop_choice.ts ids ('sunflower', 'lentil', 'mungbean') or groups ('pulses').
   * When set, the year is planned around them: a monsoon crop, a winter crop, then a crop before the next monsoon.
   */
  preferredCrops?: string[];
  /**
   * The farmer's main crop, which every plan must hold (any crop, not only rice). The engine fills the rest of the
   * year from every crop it knows, Aman included unless the farmer avoids it.
   */
  heroCrop?: string;
  /** Crops the farmer will not grow: crop ids, groups, 'rice' (Aman, Boro and Aus) or 'aman'. */
  avoidCrops?: string[];
  farmerPriorities: {
    water?: number;
    income?: number;
    soil?: number;
    fodder?: number;
    heat?: number;
    flood?: number;
    pest?: number;
  };
}

/** The detailed pilot; every upazila in data/national_replay.json is advised too (data/location.ts). */
export const SUPPORTED_UNIONS = ['talanda_tanore'];

export class UnsupportedUnionError extends Error {
  readonly unionId: string;

  constructor(unionId: string) {
    super(`No research data for union "${unionId}" yet; modelled unions: ${SUPPORTED_UNIONS.join(', ')}`);
    this.name = 'UnsupportedUnionError';
    this.unionId = unionId;
  }
}

/** Weight of a score the farmer gave no priority for, so the stated priorities decide the ranking. */
const UNSTATED_PRIORITY_WEIGHT = 0.05;
/** One bigha of 33 decimals, in hectares. */
const BIGHA_HA = 0.1336;
const DAY_MS = 86_400_000;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** Options shown for a crop choice, as many as the five fixed rotations. */
const CHOICE_OPTIONS = 5;
/** The order in which a place's hazards are raised: the most serious first. */
const HAZARD_ORDER = ['flash_flood', 'winter_fallow_salinity', 'dry_start', 'deep_flooding', 'submergence'];
/** A pattern is named among what farmers grow at this share of the cropped land, and taken as current practice at this. */
const PATTERN_NOTE_PCT = 10;
const CURRENT_PRACTICE_PCT = 20;
/** BRRI pattern words for the crops the engine replays. */
const PATTERN_CROP: Record<string, string> = {
  Boro: 'boro', Wheat: 'wheat', Lentil: 'lentil', Mustard: 'mustard', Potato: 'potato', Maize: 'maize', Grasspea: 'grasspea',
  Jute: 'jute', Aus: 'aus',
};
/** The coastal zone's 19 districts (Coastal Zone Policy 2005), where land left empty in winter is often saline. */
const COASTAL_DISTRICTS = new Set(['Bagerhat', 'Barguna', 'Barisal', 'Bhola', 'Chandpur', 'Chittagong', "Cox's Bazar", 'Feni', 'Gopalganj',
  'Jessore', 'Jhalokati', 'Khulna', 'Lakshmipur', 'Narail', 'Noakhali', 'Patuakhali', 'Pirojpur', 'Satkhira', 'Shariatpur']);

interface CandidateSpec {
  id: string;
  aman?: string; // the Aman variety, when Aman rice fills the monsoon slot
  kharif2?: string; // crop-choice key of a non-rice monsoon crop; with neither, the monsoon field stands empty
  rabi: string; // research-release key or crop-choice key ('sunflower@11-25')
  kharif1?: string; // crop-choice key of the crop between the winter crop and the next monsoon
  isBaseline: boolean;
  tagBangla: string;
  tagEnglish: string;
}

const CANDIDATES: CandidateSpec[] = [
  { id: 'rot_dhan71_lentil', aman: 'BRRI dhan71', rabi: 'BARI Masur-8', isBaseline: false, tagBangla: 'পানি সাশ্রয়ী, মাটি সমৃদ্ধকারী', tagEnglish: 'water-saving, soil-building' },
  { id: 'rot_dhan71_mustard', aman: 'BRRI dhan71', rabi: 'BARI Sarisha-14', isBaseline: false, tagBangla: 'কম সেচের তেলফসল', tagEnglish: 'low-irrigation oilseed' },
  { id: 'rot_dhan49_boro_conventional', aman: 'BRRI dhan49', rabi: 'BRRI dhan28', isBaseline: true, tagBangla: 'প্রচলিত, উচ্চ সেচ নির্ভর', tagEnglish: 'current practice, irrigation-heavy' },
  { id: 'rot_dhan49_wheat_early', aman: 'BRRI dhan49', rabi: 'BARI Gom 33 (Early)', isBaseline: false, tagBangla: 'ধান৪৯ রেখে সময়মতো গম', tagEnglish: 'keep dhan49, wheat on time' },
  { id: 'rot_dhan75_wheat_late', aman: 'BRRI dhan75', rabi: 'BARI Gom 33 (Late)', isBaseline: false, tagBangla: 'দেরিতে বোনা গম, তাপ ঝুঁকিপূর্ণ', tagEnglish: 'late-sown wheat, heat risk' },
];

/** Short ids for the research-release Rabi records, for option ids of generated plans. */
const RELEASE_SHORT: Record<string, string> = {
  'BARI Masur-8': 'lentil',
  'BARI Sarisha-14': 'mustard',
  'BARI Gom 33 (Early)': 'wheat_early',
  'BARI Gom 33 (Late)': 'wheat_late',
  'BRRI dhan28': 'boro',
};

function sowWord(rabiName: RabiCatalogEntry): string {
  return rabiName.isRice ? 'রোপণ' : 'বপন';
}

/** The record and crop facts behind a Rabi, Kharif-1 or Kharif-2 key; throws rather than guessing another crop's numbers. */
function cropSlot(key: string): { record: RabiRecord; catalog: RabiCatalogEntry } {
  const record = recordFor(key);
  const catalog = catalogFor(key);
  if (!record || !catalog) throw new Error(`No replay data for "${key}" at ${LOC.id}`);
  return { record, catalog };
}

/** English variety name for a phase: the release key, or the variety in the replay label ('BARI Sunflower-2'). */
function varietyEnglish(key: string, record: RabiRecord): string {
  if (!key.includes('@')) return key;
  return /\(([^)]+)\)/.exec(record.replayLabel)?.[1] ?? record.replayLabel;
}

/** ISO harvest date of a crop sown in this crop year; a Kharif-1 crop may be harvested after 1 July. */
function harvestIso(record: RabiRecord, seasonYear: number): string {
  const sown = seasonDate(record.sowing, seasonYear);
  return isoDate(new Date(sown.getTime() + (record.fieldDays - 1) * DAY_MS));
}

/** The monsoon slot of a plan: Aman rice, a non-rice crop, or an empty field. */
interface MonsoonSlot {
  aman?: AmanRecord;
  amanName?: AmanCatalogEntry;
  k2?: { key: string; record: RabiRecord; catalog: RabiCatalogEntry };
  ready: MonthDay | null; // when the field is ready for the winter crop (null: it stood empty all monsoon)
  start: MonthDay | null; // when the slot needs the field again next year
}

function monsoonOf(spec: CandidateSpec): MonsoonSlot {
  if (spec.aman) {
    const aman = LOC.aman[spec.aman];
    const amanName = AMAN_CATALOG[spec.aman];
    if (!aman || !amanName) throw new Error(`Missing research data for candidate ${spec.id}`);
    return { aman, amanName, ready: aman.fieldFree, start: aman.transplant };
  }
  if (spec.kharif2) {
    const k2 = { key: spec.kharif2, ...cropSlot(spec.kharif2) };
    return { k2, ready: addDays(k2.record.harvest, TURNAROUND_DAYS), start: k2.record.sowing };
  }
  return { ready: null, start: null };
}

/** Month-by-month field use from the replay dates: July to May, or July to June when a Kharif-1 crop follows. */
function buildTimeline(mon: MonsoonSlot, rabi: RabiRecord, rabiName: RabiCatalogEntry, k1?: RabiRecord, k1Name?: RabiCatalogEntry): MonthTimelineSlot[] {
  const aman = mon.aman;
  const k2 = mon.k2;
  const monSow = aman ? seasonDay(aman.transplant) : k2 ? seasonDay(k2.record.sowing) : -100;
  const monHarvest = aman ? seasonDay(aman.maturity) : k2 ? seasonDay(k2.record.harvest) : -100;
  const seedbed = aman ? seasonDay(aman.seedbedWindow[0]) : -100;
  const monBn = aman ? 'আমন' : k2?.catalog.cropBangla ?? '';
  const monEn = aman ? 'Aman' : k2?.catalog.crop ?? '';
  const rabiSow = seasonDay(rabi.sowing);
  const rabiHarvest = seasonDay(rabi.harvest);
  const sowEn = rabiName.isRice ? 'transplanting' : 'sowing';
  const k1Sow = k1 ? seasonDay(k1.sowing) : -1;
  const k1Harvest = k1 ? yearDay(k1.harvest, k1.sowing) : -1;
  const k1SowEn = k1Name?.isRice ? 'transplanting' : 'sowing';
  // The year is a cycle: a Kharif-1 crop harvested after June (jute, Aus) is still in the field next July and August
  const k1WrapEnd = k1Harvest > 364 ? k1Harvest - 365 : -100;
  const months = k1 ? [6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4, 5] : [6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4];

  return months.map(m => {
    const start = seasonDay(`${String(m + 1).padStart(2, '0')}-01`);
    const end = start + DAYS_IN_MONTH[m] - 1;
    const inMonth = (day: number) => day >= start && day <= end;
    const slot = (status: MonthTimelineSlot['status'], cropName: string, cropNameEnglish: string): MonthTimelineSlot => ({
      monthNameBangla: bnMonth(m),
      monthNameEnglish: enMonth(m),
      status,
      cropName,
      cropNameEnglish,
    });

    if (k1 && k1Name && inMonth(k1WrapEnd) && inMonth(monSow)) {
      return slot('transplanting', `${k1Name.cropBangla} কাটা, ${aman ? 'আমন রোপণ' : `${monBn} বপন`}`, `${k1Name.crop} harvest, ${aman ? 'Aman transplanting' : `${monEn.toLowerCase()} sowing`}`);
    }
    if (k1 && k1Name && inMonth(k1WrapEnd)) return slot('harvesting', `${k1Name.cropBangla} কাটা`, `${k1Name.crop} harvest`);
    if (k1 && k1Name && k1WrapEnd >= 0 && start <= k1WrapEnd) return slot('occupied', k1Name.cropBangla, k1Name.crop);
    if (inMonth(monHarvest) && inMonth(rabiSow)) return slot('transplanting', `${monBn} কাটা, ${rabiName.cropBangla} ${sowWord(rabiName)}`, `${monEn} harvest, ${rabiName.crop.toLowerCase()} ${sowEn}`);
    if (inMonth(rabiSow)) return slot('transplanting', `${rabiName.cropBangla} ${sowWord(rabiName)}`, `${rabiName.crop} ${sowEn}`);
    if (inMonth(monHarvest)) return slot('harvesting', `${monBn} কাটা`, `${monEn} harvest`);
    if (inMonth(monSow)) return aman ? slot('transplanting', 'আমন রোপণ', 'Aman transplanting') : slot('transplanting', `${monBn} বপন`, `${monEn} sowing`);
    if (k1 && k1Name && inMonth(rabiHarvest) && inMonth(k1Sow)) {
      return slot('transplanting', `${rabiName.cropBangla} কাটা, ${k1Name.cropBangla} ${sowWord(k1Name)}`, `${rabiName.crop} harvest, ${k1Name.crop.toLowerCase()} ${k1SowEn}`);
    }
    if (inMonth(rabiHarvest)) return slot('harvesting', `${rabiName.cropBangla} কাটা`, `${rabiName.crop} harvest`);
    if (k1 && k1Name && inMonth(k1Sow)) return slot('transplanting', `${k1Name.cropBangla} ${sowWord(k1Name)}`, `${k1Name.crop} ${k1SowEn}`);
    if (k1 && k1Name && inMonth(k1Harvest)) return slot('harvesting', `${k1Name.cropBangla} কাটা`, `${k1Name.crop} harvest`);
    if (monSow >= 0 && end >= monSow && start <= monHarvest) return aman ? slot('occupied', 'আমন ধান', 'Aman rice') : slot('occupied', monBn, monEn);
    if (end >= rabiSow && start <= rabiHarvest) return slot('occupied', rabiName.cropBangla, rabiName.crop);
    if (k1 && k1Name && end >= k1Sow && start <= k1Harvest) return slot('occupied', k1Name.cropBangla, k1Name.crop);
    if (aman && inMonth(seedbed) && start < monSow) return slot('fallow_available', 'আমনের বীজতলা', 'Aman seedbed');
    return slot('fallow_available', 'জমি খালি', 'Field free');
  });
}

/** Where the recommended Aman crop is today, from the replay dates of this season. */
function amanStageBangla(aman: AmanRecord, today: Date, seasonYear: number): string {
  const at = (monthDay: string) => seasonDate(monthDay, seasonYear).getTime();
  const now = today.getTime();
  const flowering = at(aman.flowering);
  if (now < at(aman.transplant)) return 'বীজতলা ও রোপণের প্রস্তুতি';
  if (now < flowering - 35 * DAY_MS) return 'কুশি গজানোর পর্যায়';
  if (now < flowering - 3 * DAY_MS) return 'থোড় আসার পর্যায়';
  if (now <= flowering + 7 * DAY_MS) return 'ফুল আসার পর্যায়';
  if (now < at(aman.maturity)) return 'দানা পুষ্ট হওয়ার পর্যায়';
  if (now < at(aman.fieldFree)) return 'ধান কাটার সময়';
  return 'আমন কাটা শেষ, রবি ফসলের সময়';
}

/**
 * Which Rabi crops still fit their sowing deadline if a given Aman variety is already in the field. Crops the
 * farmer asked for are added to the original four.
 */
export function thisSeasonFit(currentAman: string | undefined, asked: ChoiceCrop[] = []): ThisSeasonFit | null {
  const aman = currentAman ? LOC.aman[currentAman] : undefined;
  const name = currentAman ? AMAN_CATALOG[currentAman] : undefined;
  if (!currentAman || !aman || !name) return null;

  const fieldFree = seasonDay(aman.fieldFree);
  const crops = Object.entries(LOC.rabi)
    .filter(([key, rabi]) => rabi.sowingWindow !== null && key !== 'BARI Gom 33 (Late)')
    .map(([key, rabi]) => ({
      cropBangla: RABI_CATALOG[key].cropBangla,
      cropEnglish: RABI_CATALOG[key].crop,
      sowingDeadlineBangla: bnDate(rabi.sowingWindow![1]),
      sowingDeadlineEnglish: enDate(rabi.sowingWindow![1]),
      fits: fieldFree <= seasonDay(rabi.sowingWindow![1]),
    }));
  for (const crop of asked) {
    const facts = crop.season === 'Rabi' && !crop.releaseKeys ? replayFacts(crop.id) : undefined;
    if (!facts) continue;
    crops.push({
      cropBangla: crop.cropBangla,
      cropEnglish: crop.crop,
      sowingDeadlineBangla: bnDate(facts.window[1]),
      sowingDeadlineEnglish: enDate(facts.window[1]),
      fits: isFit(rabiFit(crop, aman.fieldFree, aman.maturity)),
    });
  }
  const fits = crops.filter(c => c.fits);
  const misses = crops.filter(c => !c.fits);
  const noteBangla = [
    `এ মৌসুমে ${name.varietyBangla} থাকলে জমি খালি হবে ~${bnDate(aman.fieldFree)}।`,
    fits.length ? `সময়মতো বোনা যায়: ${fits.map(c => c.cropBangla).join(', ')}।` : '',
    misses.length ? `সময় পেরিয়ে যায়: ${misses.map(c => `${c.cropBangla} (শেষ সময় ${c.sowingDeadlineBangla})`).join(', ')}।` : '',
  ].filter(Boolean).join(' ');
  const noteEnglish = [
    `With ${currentAman} in the field this season, it is free around ${enDate(aman.fieldFree)}.`,
    fits.length ? `Still on time: ${fits.map(c => c.cropEnglish.toLowerCase()).join(', ')}.` : '',
    misses.length ? `Too late for: ${misses.map(c => `${c.cropEnglish.toLowerCase()} (deadline ${c.sowingDeadlineEnglish})`).join(', ')}.` : '',
  ].filter(Boolean).join(' ');

  return {
    currentAmanVariety: currentAman,
    fieldFreeDateBangla: bnDate(aman.fieldFree),
    fieldFreeDateEnglish: enDate(aman.fieldFree),
    crops,
    noteBangla,
    noteEnglish,
  };
}

function parseSeasonYear(season: string): number {
  const year = Number(/\d{4}/.exec(season)?.[0]);
  return Number.isFinite(year) && year > 2000 ? year : new Date().getUTCFullYear();
}

/** One crop the farmer named: a crop, or a group such as 'pulses' whose best member the engine picks. */
interface Family {
  id: string;
  cropBangla: string;
  cropEnglish: string;
  season: 'Kharif-2' | 'Rabi' | 'Kharif-1';
  members: ChoiceCrop[];
  hero: boolean;
}

/** The named crops as families, the farmer's main crop first. */
function familiesOf(ids: string[], heroId?: string): { families: Family[]; notModelled: typeof NOT_MODELLED } {
  const families: Family[] = [];
  const notModelled: typeof NOT_MODELLED = [];
  const hero = heroId ? String(heroId).trim().toLowerCase() : '';
  for (const raw of [...(hero ? [hero] : []), ...ids]) {
    const id = String(raw).trim().toLowerCase();
    if (families.some(f => f.id === id)) continue;
    const crop = CHOICE_BY_ID[id];
    const group = CROP_GROUPS.find(g => g.id === id);
    const nm = NOT_MODELLED.find(n => n.id === id);
    const isHero = id === hero && !families.length;
    if (crop) {
      const members = [crop, ...(crop.alsoCovers ?? []).map(c => CHOICE_BY_ID[c])].filter(Boolean);
      families.push({ id, cropBangla: crop.cropBangla, cropEnglish: crop.crop, season: crop.season, members, hero: isHero });
    } else if (group) {
      families.push({ id, cropBangla: group.bn, cropEnglish: group.en, season: 'Rabi', members: group.crops.map(c => CHOICE_BY_ID[c]), hero: isHero });
    } else if (nm && !notModelled.includes(nm)) {
      notModelled.push(nm);
    }
  }
  return { families, notModelled };
}

/** Crops the farmer will not grow; 'rice' means Aman, Boro and Aus, and a crop takes its other seasons with it. */
function avoidedIds(list: string[] | undefined, keep: Set<string>): Set<string> {
  const out = new Set<string>();
  const add = (id: string) => {
    if (keep.has(id)) return;
    out.add(id);
    for (const other of CHOICE_BY_ID[id]?.alsoCovers ?? []) if (!keep.has(other)) out.add(other);
  };
  for (const raw of list ?? []) {
    const id = String(raw).trim().toLowerCase();
    if (id === 'rice') RICE_IDS.forEach(add);
    else if (CROP_GROUPS.some(g => g.id === id)) CROP_GROUPS.find(g => g.id === id)!.crops.forEach(add);
    else add(id);
  }
  return out;
}

/** Two crops of one family (sunflower in winter and summer, soybean in winter and the monsoon) never share a year. */
function sameFamily(a: ChoiceCrop, b: ChoiceCrop): boolean {
  return a.id === b.id || Boolean(a.alsoCovers?.includes(b.id)) || Boolean(b.alsoCovers?.includes(a.id));
}

/** 'BRRI dhan71' -> 'dhan71' */
function amanShort(variety: string): string {
  return variety.replace(/^BRRI\s+/, '').replace(/\s+/g, '');
}

/** The farmer card's irrigation class for one crop (unchanged from the five fixed rotations). */
function irrigationClass(mm: number): [string, string] {
  return mm < 150 ? ['কম সেচ', 'low irrigation'] : mm < 400 ? ['মাঝারি সেচ', 'medium irrigation'] : ['বেশি সেচ', 'high irrigation'];
}

/** A generated plan's water tag for the year, in the words of the fixed rotations' tags (Boro needs ~800 mm). */
function planWaterTag(mm: number): [string, string] {
  return mm < 250 ? ['পানি সাশ্রয়ী', 'water-saving'] : mm < 500 ? ['মাঝারি সেচ', 'medium irrigation'] : ['বেশি সেচ', 'irrigation-heavy'];
}

function kindOf(crop: RabiCatalogEntry): [string, string] {
  if (crop.isRice) return ['বোরো ধান', 'Boro rice'];
  if (crop.isLegume) return crop.crop === 'Soybean' ? ['তেলফসল, মাটি সমৃদ্ধকারী', 'oilseed, soil-building'] : ['ডাল ফসল, মাটি সমৃদ্ধকারী', 'pulse, soil-building'];
  if (crop.hostGroup === 'oilseed' || crop.hostGroup === 'brassica') return ['তেলফসল', 'oilseed'];
  if (crop.hostGroup === 'tuber') return ['কন্দ ফসল', 'tuber crop'];
  return ['দানাশস্য', 'grain crop'];
}

type Evaluated = { spec: CandidateSpec; covers: Set<number>; option: CandidateRotation };

export class RotationEngine {
  private registry: FeatureRegistry;
  private landType: LandType = 'medium_high'; // the field's land type for the call in progress

  constructor(registry?: FeatureRegistry) {
    this.registry = registry || new FeatureRegistry();
  }

  getRegistry(): FeatureRegistry {
    return this.registry;
  }

  /** The rotation's crops in field order, with their dates in this crop year. */
  private cropsOf(spec: CandidateSpec, seasonYear: number): EvaluationContext['crops'] {
    const mon = monsoonOf(spec);
    const aman = mon.aman;
    const k2 = mon.k2;
    const { record: rabi, catalog: rabiName } = cropSlot(spec.rabi);
    const k1Slot = spec.kharif1 ? cropSlot(spec.kharif1) : undefined;
    const k1 = k1Slot?.record;
    const k1Name = k1Slot?.catalog;
    const amanDays = aman ? Math.round((aman.durationDays[0] + aman.durationDays[1]) / 2) : 0;
    const rabiDays = seasonDay(rabi.harvest) - seasonDay(rabi.sowing);
    const crops: EvaluationContext['crops'] = [];
    if (aman && spec.aman) {
      crops.push({
        season: 'Aman',
        cropName: 'Aman rice',
        variety: spec.aman,
        sowingDate: isoDate(seasonDate(aman.transplant, seasonYear)),
        harvestDate: isoDate(seasonDate(aman.maturity, seasonYear)),
        durationDays: amanDays,
      });
    } else if (k2) {
      crops.push({
        season: 'Kharif-2',
        cropName: k2.catalog.crop,
        variety: k2.key,
        sowingDate: isoDate(seasonDate(k2.record.sowing, seasonYear)),
        harvestDate: harvestIso(k2.record, seasonYear),
        durationDays: k2.record.fieldDays,
      });
    }
    crops.push({
      season: 'Rabi',
      cropName: rabiName.crop,
      variety: spec.rabi,
      sowingDate: isoDate(seasonDate(rabi.sowing, seasonYear)),
      harvestDate: isoDate(seasonDate(rabi.harvest, seasonYear)),
      durationDays: rabiDays,
    });
    if (k1 && k1Name && spec.kharif1) {
      crops.push({
        season: 'Kharif-1',
        cropName: k1Name.crop,
        variety: spec.kharif1,
        sowingDate: isoDate(seasonDate(k1.sowing, seasonYear)),
        harvestDate: harvestIso(k1, seasonYear),
        durationDays: k1.fieldDays,
      });
    }
    return crops;
  }

  /** Every dimension's score for a rotation and the total weighted by the farmer's priorities. */
  private scoreRotation(spec: CandidateSpec, request: PlanOptionsRequest, seasonYear: number) {
    const activePlugins = this.registry.getActivePlugins();
    const evalContext: EvaluationContext = {
      unionId: request.unionId,
      upazilaId: request.upazila,
      districtId: request.district,
      landType: request.landType,
      seasonYear,
      rotationId: spec.id,
      crops: this.cropsOf(spec, seasonYear),
      farmerPriorities: request.farmerPriorities as Record<string, number>,
    };

    const scores: Record<string, number> = {};
    const dimensionDetails: Record<string, DimensionScoreResult> = {};
    for (const plugin of activePlugins) {
      const result = plugin.evaluate(evalContext) as DimensionScoreResult;
      scores[plugin.id] = result.score;
      dimensionDetails[plugin.id] = result;
    }

    // Weighted by the farmer's stated priorities; scores they did not mention count a little.
    const priorities = request.farmerPriorities as Record<string, number | undefined>;
    let totalWeight = 0;
    let weightedSum = 0;
    for (const plugin of activePlugins) {
      const weight = priorities[plugin.id] ?? UNSTATED_PRIORITY_WEIGHT;
      totalWeight += weight;
      weightedSum += (scores[plugin.id] || 0) * weight;
    }
    const totalWeightedScore = totalWeight > 0 ? Number((weightedSum / totalWeight).toFixed(3)) : 0.5;
    return { scores, dimensionDetails, totalWeightedScore };
  }

  private evaluateRotation(spec: CandidateSpec, request: PlanOptionsRequest, seasonYear: number): CandidateRotation {
    const mon = monsoonOf(spec);
    const aman = mon.aman;
    const amanName = mon.amanName;
    const k2 = mon.k2;
    const { record: rabi, catalog: rabiName } = cropSlot(spec.rabi);
    const k1Slot = spec.kharif1 ? cropSlot(spec.kharif1) : undefined;
    const k1 = k1Slot?.record;
    const k1Name = k1Slot?.catalog;
    const amanDays = aman ? Math.round((aman.durationDays[0] + aman.durationDays[1]) / 2) : 0;
    const rabiDays = seasonDay(rabi.harvest) - seasonDay(rabi.sowing);
    const { scores, dimensionDetails, totalWeightedScore } = this.scoreRotation(spec, request, seasonYear);

    const deadline = rabi.sowingWindow?.[1];
    const withinWindow = !deadline || seasonDay(rabi.sowing) <= seasonDay(deadline);
    const rabiVariety = varietyEnglish(spec.rabi, rabi);
    const rabiVarietyEn = rabiVariety.replace(/ \((Early|Late)\)$/, '');
    const rabiFacts = spec.rabi.includes('@') ? replayFacts(choiceIdOf(spec.rabi)) : undefined;
    const relayDays = aman ? rabiFacts?.relayDays ?? 0 : 0; // grass pea is relayed into standing Aman only
    const k2Variety = k2 ? varietyEnglish(k2.key, k2.record) : '';
    // With no monsoon crop, a summer crop still in the field after June (jute) frees it only after its harvest
    const k1Late = k1 && !aman && !k2 && yearDay(k1.harvest, k1.sowing) > 364 ? addDays(k1.harvest, TURNAROUND_DAYS) : null;

    const monsoonPhase: CropPhase = aman && amanName && spec.aman
      ? {
          crop: 'Aman rice',
          cropBangla: 'আমন ধান',
          variety: spec.aman,
          varietyBangla: amanName.varietyBangla,
          seasonType: 'Aman',
          sowingWindow: `seedbed ${enDate(aman.seedbedWindow[0])}-${enDate(aman.seedbedWindow[1])}, transplant ~${enDate(aman.transplant)}`,
          harvestWindow: `~${enDate(aman.maturity)}`,
          durationDays: amanDays,
          daysToFieldFree: seasonDay(aman.fieldFree) - seasonDay(aman.transplant),
          sowingBangla: bnDate(aman.transplant),
          harvestBangla: bnDate(aman.maturity),
        }
      : k2
        ? {
            crop: k2.catalog.crop,
            cropBangla: k2.catalog.cropBangla,
            variety: k2Variety,
            varietyBangla: k2.catalog.varietyBangla,
            seasonType: 'Kharif-2',
            sowingWindow: `${enDate(k2.record.sowingWindow![0])}-${enDate(k2.record.sowingWindow![1])} (${k2.record.sowingWindowSource}); replay sows ${enDate(k2.record.sowing)}`,
            harvestWindow: `~${enDate(k2.record.harvest)}`,
            durationDays: k2.record.fieldDays,
            daysToFieldFree: k2.record.fieldDays + TURNAROUND_DAYS,
            sowingBangla: bnDate(k2.record.sowing),
            harvestBangla: bnDate(k2.record.harvest),
          }
        : {
            crop: k1Late && k1Name ? `Free after ${k1Name.crop.toLowerCase()}` : 'Monsoon fallow',
            cropBangla: k1Late && k1Name ? `${k1Name.cropBangla} কাটার পর খালি` : 'বর্ষায় জমি খালি',
            variety: 'none',
            varietyBangla: k1Late && k1Name ? `${k1Name.cropBangla} কাটার পর খালি` : 'জমি খালি',
            seasonType: 'Kharif-2',
            fallow: true,
            sowingWindow: '-',
            harvestWindow: '-',
            durationDays: 0,
            daysToFieldFree: 0,
          };
    const cropSequence: CropPhase[] = [
      monsoonPhase,
      {
        crop: rabiName.crop,
        cropBangla: rabiName.cropBangla,
        variety: rabiVariety,
        varietyBangla: rabiName.varietyBangla,
        seasonType: 'Rabi',
        sowingWindow: rabi.sowingWindow
          ? `${enDate(rabi.sowingWindow[0])}-${enDate(rabi.sowingWindow[1])} (${rabi.sowingWindowSource}); replay sows ${enDate(rabi.sowing)}`
          : `transplant ~${enDate(rabi.sowing)}`,
        harvestWindow: `~${enDate(rabi.harvest)}`,
        durationDays: rabiDays,
        daysToFieldFree: rabiDays,
        sowingBangla: bnDate(rabi.sowing),
        harvestBangla: bnDate(rabi.harvest),
      },
    ];
    if (k1 && k1Name && spec.kharif1) {
      cropSequence.push({
        crop: k1Name.crop,
        cropBangla: k1Name.cropBangla,
        variety: varietyEnglish(spec.kharif1, k1),
        varietyBangla: k1Name.varietyBangla,
        seasonType: k1Name.isRice ? 'Aus' : 'Pre-Kharif',
        sowingWindow: `${enDate(k1.sowingWindow![0])}-${enDate(k1.sowingWindow![1])} (${k1.sowingWindowSource}); replay ${k1Name.isRice ? 'transplants' : 'sows'} ${enDate(k1.sowing)}`,
        harvestWindow: `~${enDate(k1.harvest)}`,
        durationDays: k1.fieldDays,
        daysToFieldFree: k1.fieldDays,
        sowingBangla: bnDate(k1.sowing),
        harvestBangla: bnDate(k1.harvest),
      });
    }

    const windowEn = rabi.sowingWindow ? `${enDate(rabi.sowingWindow[0])}-${enDate(rabi.sowingWindow[1])}` : '';
    const rabiActionEn = rabiName.isRice
      ? `Transplant Boro around ${enDate(rabi.sowing)}; it needs about ${rabi.netIrrigationMm} mm of irrigation.`
      : relayDays
        ? `Broadcast ${rabiVarietyEn} into the standing Aman about ${relayDays} days before harvest, around ${enDate(rabi.sowing)}, while the soil is moist.`
        : withinWindow
          ? `Sow ${rabiVarietyEn} around ${enDate(rabi.sowing)} (window ${windowEn}).`
          : `${rabiVarietyEn} is sown around ${enDate(rabi.sowing)}, after the ${windowEn} window: heat risk.`;
    const monsoonActionsEn: string[] = aman && spec.aman
      ? [
          `Seedbed for ${spec.aman} ${enDate(aman.seedbedWindow[0])}-${enDate(aman.seedbedWindow[1])}; transplant around ${enDate(aman.transplant)}.`,
          `Harvest around ${enDate(aman.maturity)}; have the field ready by ${enDate(aman.fieldFree)}.`,
        ]
      : k2
        ? [
            `In the monsoon, sow ${k2Variety} around ${enDate(k2.record.sowing)}, on high land only (standing water kills it).`,
            `Harvest around ${enDate(k2.record.harvest)}; have the field ready by ${enDate(mon.ready!)}.`,
          ]
        : [
            k1Late && k1Name ? `No rice in the monsoon: the field stands empty after the ${k1Name.crop.toLowerCase()} harvest (~${enDate(k1.harvest)}).` : 'No rice or other crop in this field in the monsoon.',
            `Prepare the field for ${rabiName.crop.toLowerCase()} before ${enDate(rabi.sowing)}.`,
          ];
    const actionsEnglish = [...monsoonActionsEn, rabiActionEn];
    const ipmActions: IpmTip[] = [...(IPM_BY_RABI[spec.rabi] ?? []), ...(aman ? IPM_AMAN : []), ...IPM_GENERAL];
    // The research's environment ledger: rice stands flooded from transplanting to two weeks before harvest
    const relayOverlap = relayDays && aman ? Math.max(0, seasonDay(aman.maturity) - seasonDay(rabi.sowing)) : 0;
    const monsoonDays = aman ? aman.fieldDays : k2 ? k2.record.fieldDays : 0;
    const ledger = {
      groundwaterPumpedM3PerHa: rabi.pumpedM3PerHa + (k1?.pumpedM3PerHa ?? 0) + (k2?.record.pumpedM3PerHa ?? 0),
      floodedRiceDays: (aman ? aman.fieldDays - 14 : 0) + (rabiName.isRice ? rabi.fieldDays - 14 : 0) + (k1 && k1Name?.isRice ? k1.fieldDays - 14 : 0),
      ureaKgHa: Math.round((aman ? LOC.srdi.aman.ureaKgHa : 0) + (k2?.record.fertilizer.ureaKgHa ?? 0) + rabi.fertilizer.ureaKgHa + (k1?.fertilizer.ureaKgHa ?? 0)),
      legume: rabiName.isLegume || Boolean(k1Name?.isLegume) || Boolean(k2?.catalog.isLegume),
      bareDays: 365 - monsoonDays - rabi.fieldDays - (k1?.fieldDays ?? 0) + relayOverlap,
    };

    const rabiAction: [string, string] = rabiName.isRice
      ? ['action_boro_transplant', `বোরোর চারা ~${bnDate(rabi.sowing)} রোপণ; সেচ লাগবে প্রায় ${bnDigits(rabi.netIrrigationMm)} মিমি।`]
      : relayDays
        ? ['action_relay_sow', `আমন কাটার ~${bnDigits(relayDays)} দিন আগে, জমিতে রস থাকতে ${rabiName.varietyBangla} ছিটিয়ে বুনুন ~${bnDate(rabi.sowing)}।`]
        : withinWindow
          ? ['action_sow_rabi', `${rabiName.varietyBangla} বুনুন ~${bnDate(rabi.sowing)} (সময়সীমা ${bnRange(rabi.sowingWindow![0], rabi.sowingWindow![1])})।`]
          : ['action_warn_late_sowing', `${rabiName.varietyBangla} বোনা হয় ~${bnDate(rabi.sowing)}, সময়সীমা (${bnRange(rabi.sowingWindow![0], rabi.sowingWindow![1])}) পেরিয়ে: তাপের ঝুঁকি।`];
    const monsoonActions: Array<[string, string]> = aman && amanName
      ? [
          ['action_seedbed', `${amanName.varietyBangla}-এর বীজতলা ${bnDateOf(bnRange(aman.seedbedWindow[0], aman.seedbedWindow[1]))} মধ্যে করুন; চারা রোপণ ~${bnDate(aman.transplant)}।`],
          ['action_harvest', `~${bnDate(aman.maturity)} ধান কাটুন, ${bnDateOf(bnDate(aman.fieldFree))} মধ্যে জমি তৈরি করুন।`],
        ]
      : k2
        ? [
            ['action_sow_kharif2', `বর্ষায় ${k2.catalog.varietyBangla} বুনুন ~${bnDate(k2.record.sowing)}; শুধু উঁচু জমিতে, পানি জমলে গাছ মরে যায়।`],
            ['action_harvest_kharif2', `~${bnDate(k2.record.harvest)} কাটুন, ${bnDateOf(bnDate(mon.ready!))} মধ্যে জমি তৈরি করুন।`],
          ]
        : [
            ['action_monsoon_free', k1Late && k1Name ? `বর্ষায় ধান নেই: ${k1Name.cropBangla} কাটার (~${bnDate(k1.harvest)}) পর জমি খালি থাকে।` : 'বর্ষায় এই জমিতে ধান বা অন্য ফসল নেই।'],
            ['action_ready_rabi', `${rabiName.cropBangla} বোনার জন্য ${bnDateOf(bnDate(rabi.sowing))} আগে জমি তৈরি করুন।`],
          ];
    const actions: Array<[string, string]> = [...monsoonActions, rabiAction];
    if (LOC.conditions.current?.dryStart && !rabiName.isRice) {
      actions.push(['action_dry_start', `এ বছর মাটি শুকনো: আমন কাটার পর দেরি না করে ${rabiName.cropBangla} বুনুন; জমিতে রস না থাকলে বোনার আগে একটি হালকা সেচ দিন।`]);
      actionsEnglish.push(`The soil is dry this year: sow ${rabiName.crop.toLowerCase()} right after the Aman harvest, with a light irrigation before sowing if the topsoil is dry.`);
    }
    if (k1 && k1Name && spec.kharif1) {
      const seedling = replayFacts(choiceIdOf(spec.kharif1))?.seedlingDays;
      const beforeBn = aman ? ', আমন রোপণের আগে' : k2 ? `, বর্ষার ${k2.catalog.cropBangla} বোনার আগে` : '';
      const beforeEn = aman ? ', before Aman' : k2 ? `, before the monsoon ${k2.catalog.crop.toLowerCase()}` : '';
      if (k1Name.isRice && seedling) {
        actions.push(['action_kharif1_transplant', `${k1Name.varietyBangla}-এর বীজতলা ~${bnDate(addDays(k1.sowing, -seedling))}; ${rabiName.cropBangla} কাটার পর চারা রোপণ ~${bnDate(k1.sowing)}, কাটা ~${bnDate(k1.harvest)}${beforeBn}।`]);
        actionsEnglish.push(`Seedbed for ${varietyEnglish(spec.kharif1, k1)} ~${enDate(addDays(k1.sowing, -seedling))}; after the ${rabiName.crop.toLowerCase()} harvest, transplant ~${enDate(k1.sowing)} and harvest ~${enDate(k1.harvest)}${beforeEn}.`);
      } else {
        actions.push(['action_sow_kharif1', `${rabiName.cropBangla} কাটার পর ${k1Name.varietyBangla} বুনুন ~${bnDate(k1.sowing)}; কাটা ~${bnDate(k1.harvest)}${beforeBn}।`]);
        actionsEnglish.push(`After the ${rabiName.crop.toLowerCase()} harvest, sow ${varietyEnglish(spec.kharif1, k1)} ~${enDate(k1.sowing)}; harvest ~${enDate(k1.harvest)}${beforeEn}.`);
      }
    }

    const monsoonBangla = amanName ? amanName.varietyBangla : k2 ? k2.catalog.varietyBangla : monsoonPhase.cropBangla!;
    const monsoonEnglish = spec.aman ?? (k2 ? `${k2Variety} (monsoon)` : monsoonPhase.crop);
    const k1Bangla = k1Name ? ` → ${k1Name.varietyBangla}` : '';
    const k1English = k1 && spec.kharif1 ? ` -> ${varietyEnglish(spec.kharif1, k1)}` : '';
    const fieldFree = mon.ready ?? k1Late;
    const tspKgHa = (aman ? LOC.srdi.aman.tspKgHa : 0) + (k2?.record.fertilizer.tspKgHa ?? 0) + rabi.fertilizer.tspKgHa + (k1?.fertilizer.tspKgHa ?? 0);
    const riceCrops = (aman ? 1 : 0) + (rabiName.isRice ? 1 : 0) + (k1Name?.isRice ? 1 : 0);
    const option: CandidateRotation = {
      id: spec.id,
      nameBangla: `${monsoonBangla} → ${rabiName.varietyBangla}${k1Bangla} (${spec.tagBangla})`,
      nameEnglish: `${monsoonEnglish} -> ${rabiVariety}${k1English} (${spec.tagEnglish})`,
      isBaseline: spec.isBaseline,
      cropSequence,
      scores,
      dimensionDetails,
      totalWeightedScore,
      rank: 0,
      timeline: buildTimeline(mon, rabi, rabiName, k1, k1Name),
      approvedActionIds: actions.map(a => a[0]),
      approvedActionBangla: actions.map(a => a[1]),
      approvedActionEnglish: actionsEnglish,
      fieldFreeDateBangla: fieldFree ? bnDate(fieldFree) : 'সারা বর্ষা',
      fieldFreeDateEnglish: fieldFree ? enDate(fieldFree) : 'all monsoon',
      ipmActions,
      ledger,
    };
    const cropIds = [aman ? 'aman' : spec.kharif2 ? choiceIdOf(spec.kharif2) : '', choiceIdOf(spec.rabi), spec.kharif1 ? choiceIdOf(spec.kharif1) : '']
      .filter(Boolean);
    option.stewardship = stewardshipTips(option, tspKgHa, riceCrops, cropIds);
    return option;
  }

  private rank(specs: CandidateSpec[], request: PlanOptionsRequest, seasonYear: number): CandidateRotation[] {
    const options = specs.map(spec => this.evaluateRotation(spec, request, seasonYear));
    options.sort((a, b) => b.totalWeightedScore - a.totalWeightedScore);
    options.forEach((opt, idx) => {
      opt.rank = idx + 1;
    });
    return options;
  }

  /**
   * Plans for the crops a farmer named. The year has three slots in field order: the monsoon (Aman rice, a non-rice
   * crop, or an empty field), the winter crop, and an optional pre-monsoon crop. A winter crop starts once the field
   * is ready and before its handbook deadline; a Kharif-1 crop starts a week after the winter harvest and leaves the
   * field a week before the next monsoon slot needs it. With a main (hero) crop every plan holds it and the engine
   * fills the rest of the year from every crop it knows; avoided crops (rice, for one) are left out. Plans holding
   * more of the named crops come first, then the higher weighted score.
   */
  private choicePlans(request: PlanOptionsRequest, seasonYear: number, local = false) {
    const { families, notModelled } = familiesOf(request.preferredCrops ?? [], request.heroCrop);
    const heroIndex = families.findIndex(f => f.hero);
    const open = families.length === 0; // only crops to avoid were named: rank everything else by score
    const fill = heroIndex >= 0 || open;
    const askedIds = new Set(families.flatMap(f => f.members.map(m => m.id)));
    const avoid = avoidedIds(request.avoidCrops, askedIds);
    const usable = (c: ChoiceCrop) => !avoid.has(c.id);
    const inPool = (c: ChoiceCrop) => usable(c) && (fill || askedIds.has(c.id));
    const familyOf = (id: string) => families.findIndex(f => f.members.some(m => m.id === id));

    // The field's land type rules some seasons out: no Aman or monsoon crop under deep water, no upland monsoon crop
    // where water stands, and on haor low land no crop harvested after the flash floods in too many springs
    const rules = landRules(request.landType);
    const tooLate = (harvest: MonthDay) => harvestTooLate(request.landType, harvest);
    const heroMembers = heroIndex >= 0 ? families[heroIndex].members : [];
    const heroOnlyWinter = heroMembers.length > 0 && heroMembers.every(m => m.season === 'Rabi');
    const neverWinter = families.some(f => f.members.every(m => m.season !== 'Rabi'));
    let rabiPool = heroOnlyWinter ? heroMembers.filter(usable) : CHOICE_CROPS.filter(c => c.season === 'Rabi' && inPool(c));
    if (!fill && (neverWinter || !rabiPool.length)) rabiPool = CHOICE_CROPS.filter(c => c.season === 'Rabi' && usable(c));
    const k1Pool: Array<ChoiceCrop | null> = [null, ...(rules.kharif1 ? CHOICE_CROPS.filter(c => c.season === 'Kharif-1' && inPool(c)) : [])];
    const amanOk = !avoid.has('aman') && rules.aman;
    // Planning for a place (no crops named) keeps Aman, the monsoon staple, wherever the land allows it: a non-rice
    // monsoon crop or an empty monsoon field comes in when the farmer leaves rice out or names such a crop
    const k2Crops = rules.kharif2 && !(local && amanOk)
      ? CHOICE_CROPS.filter(c => c.season === 'Kharif-2' && usable(c) && (fill || askedIds.has(c.id) || !amanOk))
      : [];
    const fallowOk = !amanOk || askedIds.has('jute');
    const monsoonOptions: Array<{ aman?: string; k2?: string }> = [
      ...(amanOk ? Object.keys(AMAN_CATALOG).filter(a => LOC.aman[a]).map(a => ({ aman: a })) : []),
      ...k2Crops.flatMap(c => kharif2Keys(c).map(k => ({ k2: k }))),
      ...(fallowOk ? [{}] : []),
    ];

    const misses = new Map<string, Fit[]>();
    const noteMiss = (crop: ChoiceCrop, fit: Fit) => {
      if (!isFit(fit)) misses.set(crop.id, [...(misses.get(crop.id) ?? []), fit]);
    };

    const specs: Array<{ spec: CandidateSpec; covers: Set<number> }> = [];
    for (const mon of monsoonOptions) {
      const amanRecord = mon.aman ? LOC.aman[mon.aman] : undefined;
      const k2Record = mon.k2 ? recordFor(mon.k2) : undefined;
      const k2Crop = mon.k2 ? CHOICE_BY_ID[choiceIdOf(mon.k2)] : undefined;
      const ready = amanRecord ? amanRecord.fieldFree : k2Record ? addDays(k2Record.harvest, TURNAROUND_DAYS) : rules.ready;
      for (const rabiCrop of rabiPool) {
        if (k2Crop && sameFamily(k2Crop, rabiCrop)) continue;
        const rFit = rabiFit(rabiCrop, ready, amanRecord?.maturity);
        if (!isFit(rFit)) {
          noteMiss(rabiCrop, rFit);
          continue;
        }
        const rabiRecord = recordFor(rFit.key)!;
        if (tooLate(rabiRecord.harvest)) {
          noteMiss(rabiCrop, { reason: 'flash_flood', deadline: rabiRecord.harvest, ready: ready ?? rabiRecord.sowing });
          continue;
        }
        const nextStart = amanRecord ? amanRecord.transplant : k2Record ? k2Record.sowing : rabiRecord.sowing;
        for (const k1Crop of k1Pool) {
          let k1Key: string | undefined;
          if (k1Crop) {
            if (sameFamily(k1Crop, rabiCrop) || (k2Crop && sameFamily(k1Crop, k2Crop))) continue;
            const kFit = kharif1Fit(k1Crop, rabiRecord.harvest, nextStart);
            if (!isFit(kFit)) {
              noteMiss(k1Crop, kFit);
              continue;
            }
            const k1Harvest = recordFor(kFit.key)!.harvest;
            if (tooLate(k1Harvest)) {
              noteMiss(k1Crop, { reason: 'flash_flood', deadline: k1Harvest, ready: addDays(rabiRecord.harvest, TURNAROUND_DAYS) });
              continue;
            }
            k1Key = kFit.key;
          }
          const covers = new Set([familyOf(rabiCrop.id), k1Crop ? familyOf(k1Crop.id) : -1, k2Crop ? familyOf(k2Crop.id) : -1].filter(i => i >= 0));
          if (!open && !covers.size) continue;
          if (heroIndex >= 0 && !covers.has(heroIndex)) continue;
          const known = mon.aman && !k1Key ? CANDIDATES.find(c => c.aman === mon.aman && c.rabi === rFit.key) : undefined;
          const monsoonId = mon.aman ? amanShort(mon.aman) : k2Crop ? k2Crop.id : 'fallow';
          const rabiId = RELEASE_SHORT[rFit.key] ?? rabiCrop.id;
          const tag = this.choiceTag(rFit.key, k1Key, mon);
          specs.push({
            spec: known ?? {
              id: `rot_${monsoonId}_${rabiId}${k1Crop ? `_${k1Crop.id}` : ''}`,
              aman: mon.aman,
              kharif2: mon.k2,
              rabi: rFit.key,
              kharif1: k1Key,
              isBaseline: false,
              tagBangla: tag[0],
              tagEnglish: tag[1],
            },
            covers,
          });
        }
      }
    }

    // One plan per crop combination: a monsoon crop replayed on several sowing dates keeps its best date. A main
    // crop in its own season (winter sunflower, not summer) ranks before the same crop in another season.
    const heroId = heroIndex >= 0 ? families[heroIndex].members[0].id : null;
    const ownSeason = (e: { spec: CandidateSpec }) => (heroId && [e.spec.kharif2, e.spec.rabi, e.spec.kharif1].some(k => k && choiceIdOf(k) === heroId) ? 1 : 0);
    const better = (a: Evaluated, b: Evaluated) =>
      b.covers.size - a.covers.size || ownSeason(b) - ownSeason(a) || b.option.totalWeightedScore - a.option.totalWeightedScore;
    // Ranked on the scores alone; only the plans shown are written out in full below
    const byId = new Map<string, Evaluated>();
    for (const s of specs) {
      const e = { ...s, option: { id: s.spec.id, ...this.scoreRotation(s.spec, request, seasonYear) } as CandidateRotation };
      const seen = byId.get(e.spec.id);
      if (!seen || better(e, seen) < 0) byId.set(e.spec.id, e);
    }
    const evaluated = [...byId.values()].sort(better);
    const picked: Evaluated[] = [];
    const add = (e: Evaluated | undefined) => {
      if (e && !picked.includes(e) && picked.length < CHOICE_OPTIONS + families.length) picked.push(e);
    };
    const holds = (e: Evaluated, id: string) => [e.spec.kharif2, e.spec.rabi, e.spec.kharif1].some(k => k && choiceIdOf(k) === id);
    families.forEach((f, i) => {
      add(evaluated.find(e => e.covers.has(i)));
      add(evaluated.find(e => holds(e, f.members[0].id)));
    });
    if (request.currentAmanCrop) add(evaluated.find(e => e.spec.aman === request.currentAmanCrop));
    const monsoonKind = (e: Evaluated) => (e.spec.aman ? 'aman' : e.spec.kharif2 ? choiceIdOf(e.spec.kharif2) : 'fallow');
    const pairKey = (e: Evaluated) => `${monsoonKind(e)}|${choiceIdOf(e.spec.rabi)}|${e.spec.kharif1 ? choiceIdOf(e.spec.kharif1) : ''}`;
    for (const limit of [1, 2, CHOICE_OPTIONS]) {
      for (const e of evaluated) {
        if (picked.length >= CHOICE_OPTIONS) break;
        if (picked.filter(p => pairKey(p) === pairKey(e)).length >= limit) continue;
        add(e);
      }
    }
    for (const e of picked) e.option = this.evaluateRotation(e.spec, request, seasonYear);
    picked.sort(better);
    picked.forEach((e, i) => {
      e.option.rank = i + 1;
    });

    const result = this.choiceResult(families, notModelled, picked, misses, avoid);
    return { specs: picked.map(e => e.spec), options: picked.map(e => e.option), result };
  }

  /** Tag for a generated plan from its crops: the year's irrigation, the winter crop's kind, then the other slots. */
  private choiceTag(rabiKey: string, k1Key: string | undefined, mon: { aman?: string; k2?: string }): [string, string] {
    const { record, catalog } = cropSlot(rabiKey);
    const k1 = k1Key ? cropSlot(k1Key) : undefined;
    const k2 = mon.k2 ? cropSlot(mon.k2) : undefined;
    const water = planWaterTag(record.netIrrigationMm + (k1?.record.netIrrigationMm ?? 0) + (k2?.record.netIrrigationMm ?? 0));
    const kind = kindOf(catalog);
    const monsoonBn = mon.aman ? '' : k2 ? `; বর্ষায় ${k2.catalog.cropBangla}` : '; বর্ষায় ধান নেই';
    const monsoonEn = mon.aman ? '' : k2 ? `; monsoon ${k2.catalog.crop.toLowerCase()}` : '; no rice in the monsoon';
    return [
      `${water[0]}, ${kind[0]}${monsoonBn}${k1 ? `; গ্রীষ্মে ${k1.catalog.cropBangla}` : ''}`,
      `${water[1]}, ${kind[1]}${monsoonEn}${k1 ? `; ${k1.catalog.crop.toLowerCase()} before ${mon.aman ? 'Aman' : 'the monsoon'}` : ''}`,
    ];
  }

  private choiceResult(
    families: Family[],
    notModelled: typeof NOT_MODELLED,
    picked: Evaluated[],
    misses: Map<string, Fit[]>,
    avoid: Set<string>,
  ): CropChoiceResult {
    const fits: CropChoiceResult['fits'] = families.map((family, i) => {
      const best = picked.find(e => e.covers.has(i));
      const base = { id: family.id, cropBangla: family.cropBangla, cropEnglish: family.cropEnglish, season: family.season };
      if (best) {
        const key = [best.spec.kharif2, best.spec.rabi, best.spec.kharif1].find(k => k && family.members.some(m => m.id === choiceIdOf(k)))!;
        const { record } = cropSlot(key);
        return {
          ...base, fits: true, bestOptionId: best.option.id,
          sowingBangla: bnDate(record.sowing), sowingEnglish: enDate(record.sowing),
          harvestBangla: bnDate(record.harvest), harvestEnglish: enDate(record.harvest),
          netIrrigationMm: record.netIrrigationMm, reasonBangla: null, reasonEnglish: null,
        };
      }
      const reason = family.members.flatMap(m => misses.get(m.id) ?? []).find(f => !isFit(f)) as Exclude<Fit, { key: string }> | undefined;
      const crop = family.members[0];
      return {
        ...base, fits: false, bestOptionId: null, sowingBangla: null, sowingEnglish: null, harvestBangla: null, harvestEnglish: null,
        netIrrigationMm: null,
        reasonBangla: !reason ? `${bnGenitive(family.cropBangla)} হিসাব এই জায়গার জন্য পাওয়া যায়নি।`
          : reason.reason === 'aman_clash' ? `${crop.cropBangla} কাটার আগেই বর্ষার ফসলের সময় (~${bnDate(reason.deadline)}) এসে যায়।`
          : reason.reason === 'flash_flood' ? `${crop.cropBangla} কাটা হয় ~${bnDate(reason.deadline)}, তার আগেই অনেক বছর হাওরে আগাম বন্যা আসে।`
          : `জমি তৈরি হয় ~${bnDate(reason.ready)}, কিন্তু ${crop.cropBangla} বোনার শেষ সময় ~${bnDate(reason.deadline)}।`,
        reasonEnglish: !reason ? `No replay for ${family.cropEnglish.toLowerCase()} at this place.`
          : reason.reason === 'aman_clash' ? `${crop.crop} would still be in the field when the monsoon crop goes in (~${enDate(reason.deadline)}).`
          : reason.reason === 'flash_flood' ? `${crop.crop} would be harvested around ${enDate(reason.deadline)}, after the haor's flash floods in too many springs.`
          : `The field is ready around ${enDate(reason.ready)}, after the ${crop.crop.toLowerCase()} sowing deadline (~${enDate(reason.deadline)}).`,
      };
    });

    const notesBangla: string[] = [];
    const notesEnglish: string[] = [];
    const hero = families.find(f => f.hero);
    if (hero) {
      notesBangla.push(`প্রধান ফসল ${hero.cropBangla} ধরে বছরের বাকি মৌসুম সাজানো হয়েছে; প্রতিটি চক্রে ${hero.cropBangla} আছে।`);
      notesEnglish.push(`The year is planned around the main crop, ${hero.cropEnglish.toLowerCase()}; every option holds it.`);
    }
    if (avoid.has('aman')) {
      const monsoon = [...new Set(picked.map(e => (e.spec.kharif2 ? catalogFor(e.spec.kharif2)!.cropBangla : 'জমি খালি')))];
      const monsoonEn = [...new Set(picked.map(e => (e.spec.kharif2 ? catalogFor(e.spec.kharif2)!.crop.toLowerCase() : 'an empty field')))];
      notesBangla.push(`কোনো চক্রে ধান রাখা হয়নি। বর্ষায় ধানের বদলে: ${monsoon.join(', ')}; সয়াবিন, মুগ বা তিল শুধু উঁচু জমিতে, যেখানে পানি জমে না।`);
      notesEnglish.push(`No option holds rice. In the monsoon instead: ${monsoonEn.join(', ')}; soybean, mungbean or sesame only on high land where water does not stand.`);
    }
    const both = (season: Family['season'], bn: string, en: string) => {
      const same = families.filter(f => f.season === season);
      if (same.length < 2 || picked.some(e => same.filter(f => e.covers.has(families.indexOf(f))).length > 1)) return;
      const names = same.map(f => f.cropBangla);
      const namesEn = same.map(f => f.cropEnglish.toLowerCase());
      const all = same.length === 2 ? ['দুটোই', 'both'] : ['সবগুলোই', 'all'];
      notesBangla.push(`${names.join(' ও ')} ${all[0]} ${bn} ফসল; একই জমিতে এক মৌসুমে একটিই হয়। জমি ভাগ করে করা যায়, অথবা এক বছর ${names[0]}, পরের বছর ${names[1]}, এতে পোকার চক্রও ভাঙে।`);
      notesEnglish.push(`${namesEn.join(' and ')} are ${all[1]} ${en} crops; one field grows one of them per season. Split the field, or grow ${namesEn[0]} one year and ${namesEn[1]} the next, which also breaks pest cycles.`);
    };
    both('Rabi', 'শীতের (রবি)', 'winter (Rabi)');
    both('Kharif-1', 'গ্রীষ্মের (খরিফ-১)', 'pre-monsoon (Kharif-1)');
    if (notModelled.length) {
      notesBangla.push(`${notModelled.map(n => bnGenitive(n.bn)).join(', ')} হিসাব এখনো যোগ হয়নি; এ নিয়ে উপসহকারী কৃষি কর্মকর্তার সাথে কথা বলুন।`);
      notesEnglish.push(`${notModelled.map(n => n.en).join(', ')} ${notModelled.length > 1 ? 'are' : 'is'} not modelled yet; ask the Sub-Assistant Agriculture Officer.`);
    }
    const noPrice = [...new Map(picked.flatMap(e => [e.spec.kharif2, e.spec.rabi, e.spec.kharif1]).filter((k): k is string => Boolean(k))
      .map(k => catalogFor(k)!).filter(c => c.illustrativeGrossMarginTkPerHa === null).map(c => [c.crop, c] as const)).values()];
    if (noPrice.length) {
      const last = noPrice.length > 1 ? noPrice.slice(0, -1).map(c => c.cropBangla).join(', ') + ' ও ' : '';
      notesBangla.push(`${last}${bnGenitive(noPrice[noPrice.length - 1].cropBangla)} বাজারদর ও খরচের তথ্য এখনো নেই, তাই আয়ের হিসাবে নিচের দিকের রবি ফসলের লাভ ধরা হয়েছে।`);
      notesEnglish.push(`No prices and costs yet for ${noPrice.map(c => c.crop.toLowerCase()).join(', ')}, so a lower-quartile winter crop's return, moved by the district's yield, stands in for ${noPrice.length > 1 ? 'their' : 'its'} income.`);
    }

    // Holding more of the asked crops can cost score (a summer crop meets heat); say what fewer crops score
    const top = picked[0];
    const alone = top ? picked.find(e => e.covers.size < top.covers.size && e.option.totalWeightedScore > top.option.totalWeightedScore + 0.01) : undefined;
    if (top && alone) {
      const pct = (e: Evaluated) => Math.round(e.option.totalWeightedScore * 100);
      notesBangla.push(`এক বছরে ${[...top.covers].map(i => families[i].cropBangla).join(' ও ')} করতে প্রথম চক্রটি (স্কোর ${bnDigits(pct(top))}%)। কম ফসল করলে ${bnDigits(alone.option.rank)} নম্বর চক্রের স্কোর বেশি (${bnDigits(pct(alone))}%)।`);
      notesEnglish.push(`Option 1 grows ${[...top.covers].map(i => families[i].cropEnglish.toLowerCase()).join(' and ')} in one year (score ${pct(top)}%). With fewer of them, option ${alone.option.rank} scores higher (${pct(alone)}%).`);
    }

    // What fits the gap between the top plan's winter harvest and the next monsoon slot
    const gapFillers: CropChoiceResult['gapFillers'] = [];
    if (top && !top.spec.kharif1) {
      const { record: rabi } = cropSlot(top.spec.rabi);
      const mon = monsoonOf(top.spec);
      const nextStart = mon.start ?? rabi.sowing;
      const k1Allowed = landRules(this.landType).kharif1;
      for (const crop of CHOICE_CROPS.filter(c => k1Allowed && c.season === 'Kharif-1' && c.id !== 'sunflower_kharif' && !avoid.has(c.id))) {
        const fit = kharif1Fit(crop, rabi.harvest, nextStart);
        if (!isFit(fit) || harvestTooLate(this.landType, recordFor(fit.key)!.harvest)) continue;
        const { record } = cropSlot(fit.key);
        gapFillers.push({
          id: crop.id, cropBangla: crop.cropBangla, cropEnglish: crop.crop,
          sowingBangla: bnDate(record.sowing), sowingEnglish: enDate(record.sowing),
          harvestBangla: bnDate(record.harvest), harvestEnglish: enDate(record.harvest), netIrrigationMm: record.netIrrigationMm,
        });
      }
      if (gapFillers.length) {
        const until = mon.aman ? 'আমনের' : 'বর্ষার';
        notesBangla.push(`${catalogFor(top.spec.rabi)!.cropBangla} কাটার পর ${until} আগে জমি খালি থাকে; চাইলে ${gapFillers.map(g => `${g.cropBangla} (বপন ~${g.sowingBangla})`).join(', ')} করা যায়।`);
        notesEnglish.push(`After the ${catalogFor(top.spec.rabi)!.crop.toLowerCase()} harvest the field is free until ${mon.aman ? 'Aman' : 'the monsoon'}; ${gapFillers.map(g => `${g.cropEnglish.toLowerCase()} (sow ~${g.sowingEnglish})`).join(', ')} would fit.`);
      }
    }

    return {
      requested: families.map(f => ({ id: f.id, cropBangla: f.cropBangla, cropEnglish: f.cropEnglish, season: f.season })),
      notModelled: notModelled.map(n => ({ id: n.id, bn: n.bn, en: n.en })),
      fits,
      coverage: picked.map(e => ({ optionId: e.option.id, cropIds: [...e.covers].map(i => families[i].id) })),
      gapFillers,
      notesBangla,
      notesEnglish,
      heroCrop: hero ? hero.id : null,
      avoided: [...avoid],
    };
  }

  /**
   * What most farmers at the place grow now (its main BRRI pattern, made flood-safe on haor land) and the same crops
   * with mungbean in the summer gap, added to the ranked plans so a farmer can see what a change gains or costs.
   */
  private withCurrentPractice(specs: CandidateSpec[], options: CandidateRotation[], request: PlanOptionsRequest, seasonYear: number, rules: LandRules) {
    const top = LOC.local.patterns[0];
    const current = top && top[1] >= CURRENT_PRACTICE_PCT ? this.patternSpec(top[0], request.landType, rules) : null;
    if (!current) return { specs, options };
    const pulse = current.kharif1 ? null : this.withSummerCrop(current, request.landType);
    const allSpecs = [...specs];
    const allOptions = [...options];
    for (const spec of [current, pulse]) {
      if (!spec) continue;
      let option = allOptions.find(o => o.id === spec.id);
      if (!option) {
        option = this.evaluateRotation(spec, request, seasonYear);
        allSpecs.push(spec);
        allOptions.push(option);
      }
      if (spec === current) option.currentPractice = true;
    }
    allOptions.sort((a, b) => b.totalWeightedScore - a.totalWeightedScore);
    allOptions.forEach((o, i) => {
      o.rank = i + 1;
    });
    return { specs: allSpecs, options: allOptions };
  }

  /**
   * A BRRI pattern ('Boro-Fallow-T. Aman': winter, summer, monsoon) as a plan when the engine replays each of its crops
   * and they fit this land and calendar. The usual long-duration Aman (BRRI dhan49) comes first, else the first variety
   * after which the winter crop still fits; Boro falls back to the early BRRI dhan88 where the late one meets the
   * flash floods.
   */
  private patternSpec(pattern: string, landType: LandType, rules: LandRules): CandidateSpec | null {
    const [winterWord, summerWord, monsoonWord] = pattern.split('-').map(w => w.trim());
    const winter = CHOICE_BY_ID[PATTERN_CROP[winterWord] ?? ''];
    const summer = summerWord === 'Fallow' ? null : CHOICE_BY_ID[PATTERN_CROP[summerWord] ?? ''];
    const withAman = monsoonWord === 'T. Aman';
    if (!winter || (summerWord !== 'Fallow' && summer?.season !== 'Kharif-1') || (!withAman && monsoonWord !== 'Fallow')) return null;
    if (withAman !== rules.aman) return null; // the farmer's land differs from the upazila's usual land
    const amanOrder = withAman ? ['BRRI dhan49', ...Object.keys(AMAN_CATALOG).filter(a => a !== 'BRRI dhan49')] : [undefined];
    for (const aman of amanOrder) {
      const amanRecord = aman ? LOC.aman[aman] : undefined;
      if (aman && !amanRecord) continue;
      for (const crop of [winter, ...(winter.alsoCovers ?? []).map(id => CHOICE_BY_ID[id]).filter(c => c?.season === 'Rabi')]) {
        const fit = rabiFit(crop, amanRecord ? amanRecord.fieldFree : rules.ready, amanRecord?.maturity);
        if (!isFit(fit)) continue;
        const rabi = recordFor(fit.key)!;
        if (harvestTooLate(landType, rabi.harvest)) continue;
        let k1Key: string | undefined;
        if (summer) {
          const kFit = kharif1Fit(summer, rabi.harvest, amanRecord ? amanRecord.transplant : rabi.sowing);
          if (!isFit(kFit) || harvestTooLate(landType, recordFor(kFit.key)!.harvest)) continue;
          k1Key = kFit.key;
        }
        const known = aman && !k1Key ? CANDIDATES.find(c => c.aman === aman && c.rabi === fit.key) : undefined;
        return known ?? {
          id: `rot_${aman ? amanShort(aman) : 'fallow'}_${RELEASE_SHORT[fit.key] ?? choiceIdOf(fit.key)}${k1Key ? `_${choiceIdOf(k1Key)}` : ''}`,
          aman,
          rabi: fit.key,
          kharif1: k1Key,
          isBaseline: false,
          tagBangla: 'এখানে সবচেয়ে বেশি যা চাষ হয় (BRRI ২০১৪-১৫)',
          tagEnglish: 'what most farmers here grow (BRRI 2014-15)',
        };
      }
    }
    return null;
  }

  /**
   * The current plan with a crop in the summer gap after the winter crop: mungbean first (a pulse), else sesame, jute
   * or Aus, whichever fits the calendar; Boro moves to the early BRRI dhan88 when that makes room.
   */
  private withSummerCrop(current: CandidateSpec, landType: LandType): CandidateSpec | null {
    if (!landRules(landType).kharif1) return null;
    const mon = monsoonOf(current);
    const winters = choiceIdOf(current.rabi) === 'boro' ? [current.rabi, ...this.earlyBoro(mon)] : [current.rabi];
    for (const crop of ['mungbean', 'sesame', 'jute', 'aus'].map(id => CHOICE_BY_ID[id])) {
      for (const rabiKey of winters) {
        const rabi = recordFor(rabiKey);
        if (!rabi || harvestTooLate(landType, rabi.harvest) || (crop.isRice && catalogFor(rabiKey)?.isRice)) continue;
        const fit = kharif1Fit(crop, rabi.harvest, mon.start ?? rabi.sowing);
        if (!isFit(fit) || harvestTooLate(landType, recordFor(fit.key)!.harvest)) continue;
        return {
          id: `rot_${current.aman ? amanShort(current.aman) : 'fallow'}_${RELEASE_SHORT[rabiKey] ?? choiceIdOf(rabiKey)}_${crop.id}`,
          aman: current.aman,
          rabi: rabiKey,
          kharif1: fit.key,
          isBaseline: false,
          tagBangla: `প্রচলিত ফসলের সাথে গ্রীষ্মে ${crop.cropBangla}`,
          tagEnglish: `the usual crops with ${crop.crop.toLowerCase()} in summer`,
        };
      }
    }
    return null;
  }

  /** The early Boro's replay key after a monsoon slot, when it fits. */
  private earlyBoro(mon: MonsoonSlot): string[] {
    const fit = rabiFit(CHOICE_BY_ID.boro_early, mon.ready, mon.aman?.maturity);
    return isFit(fit) ? [fit.key] : [];
  }

  /**
   * The place's land type and the evidence behind it, what its farmers grow now (BRRI's 2014-15 survey), and the
   * hazards that shaped the plan: deep monsoon water, submergence, the haor's flash floods and, on the coast, winter
   * fallow that is often salinity. One short line of it goes into the farmer's summary.
   */
  private localContext(request: PlanOptionsRequest, rules: LandRules, options: CandidateRotation[]) {
    const local = LOC.local;
    const land = local.land;
    const landBn = LAND_TYPE_BANGLA[request.landType] ?? '';
    const landEn = request.landType.replace('_', '-');
    const assumed = Boolean(request.landTypeAssumed);
    const pct = (x: number) => Math.round(x * 100);
    const hazards: string[] = [];
    const notesBangla: string[] = [];
    const notesEnglish: string[] = [];
    let farmerLineBangla = '';
    let farmerLineEnglish = '';

    // Why this land type
    let evidenceBn: string;
    let evidenceEn: string;
    if (!assumed) {
      evidenceBn = `জমির ধরন কৃষকের কথামতো: ${landBn} জমি।`;
      evidenceEn = `Land type as the farmer gave it: ${landEn} land.`;
    } else if (LOC.kind === 'pilot') {
      evidenceBn = `${landBn} জমি ধরা হয়েছে (SRDI তালন্দ কার্ড); আপনার জমি অন্যরকম হলে জানান।`;
      evidenceEn = `${landEn[0].toUpperCase()}${landEn.slice(1)} land assumed (SRDI Talanda card); say so if the field is different.`;
    } else {
      const bn: string[] = [];
      const en: string[] = [];
      if (land?.basis.includes('water')) {
        bn.push(`ল্যান্ডস্যাট উপগ্রহে (JRC, ২০২১) এই উপজেলার ${bnDigits(pct(land.seasonalWater))}% জমি বছরে ৩–৬ মাস পানির নিচে`);
        en.push(`Landsat (JRC surface water, 2021) shows ${pct(land.seasonalWater)}% of the upazila under water 3-6 months a year`);
      }
      if (land?.basis.includes('pattern') && local.boroFallowFallowPct !== null) {
        bn.push(`BRRI-র ২০১৪-১৫ জরিপে চাষের জমির ${bnDigits(Math.round(local.boroFallowFallowPct))}%-এ শুধু বোরো, বর্ষায় জমি পতিত`);
        en.push(`BRRI's 2014-15 survey found Boro-Fallow-Fallow (no monsoon crop) on ${Math.round(local.boroFallowFallowPct)}% of its cropped land`);
      }
      if (land?.basis.includes('elevation')) {
        bn.push(`নাসার NASADEM উচ্চতায় এখানকার সবচেয়ে নিচু এক-দশমাংশ জমিও ${bnDigits(land.elevP10M)} মিটার উঁচু, ল্যান্ডস্যাটে প্রায় কখনো পানি দেখা যায়নি`);
        en.push(`NASA NASADEM puts even the lowest tenth of the land ${land.elevP10M} m above sea level, and Landsat almost never saw water there`);
      }
      if (!en.length) {
        bn.push(land ? 'নাসার NASADEM উচ্চতা, ল্যান্ডস্যাটের পানি বা BRRI জরিপে গভীর বা দীর্ঘ বন্যার চিহ্ন নেই' : 'এই উপজেলার জমির মানচিত্র এখনো নেই');
        en.push(land ? "NASA NASADEM elevation, Landsat surface water and BRRI's survey show no deep or long flooding" : 'No land layers cover this upazila yet');
      }
      evidenceBn = `${bn.join('; ')}: তাই ${landBn} জমি ধরা হয়েছে; আপনার জমি অন্যরকম হলে জানান।`;
      evidenceEn = `${en.join('; ')}, so ${landEn} land is assumed; say so if the field is different.`;
      farmerLineBangla = `${landBn} জমি ধরে হিসাব; আপনার জমি অন্যরকম হলে জানান।`;
      farmerLineEnglish = `Planned for ${landEn} land, this upazila's usual land; say so if the field is different.`;
    }
    notesBangla.push(evidenceBn);
    notesEnglish.push(evidenceEn);

    // What farmers grow here now: patterns on a tenth of the cropped land or more
    const patterns = local.patterns
      .filter(([, share]) => share >= PATTERN_NOTE_PCT)
      .map(([pattern, share]) => ({ pattern, patternBangla: patternBangla(pattern), pctOfCroppedLand: share }));
    if (patterns.length) {
      notesBangla.push(`এখন এখানে যা চাষ হয় (BRRI জরিপ, ২০১৪-১৫): ${patterns.map(p => `${p.patternBangla} ${bnDigits(Math.round(p.pctOfCroppedLand))}%`).join(', ')}।`);
      notesEnglish.push(`What farmers here grow now (BRRI survey, 2014-15): ${patterns.map(p => `${p.pattern} ${Math.round(p.pctOfCroppedLand)}%`).join(', ')}.`);
    }

    // Deep water, or standing water in the monsoon
    const alerts: LocalContext['alerts'] = [];
    const hazard = (id: string, title: [string, string]) => {
      hazards.push(id);
      alerts.push({ hazard: id, titleBangla: title[0], titleEnglish: title[1], textBangla: notesBangla[notesBangla.length - 1], textEnglish: notesEnglish[notesEnglish.length - 1] });
    };
    if (!rules.aman) {
      notesBangla.push(`${landBn} জমিতে জুন থেকে নভেম্বর পানি থাকে: আমন বা গ্রীষ্মের ফসল হয় না; পানি নামলে (~${bnDate(rules.ready!)}) রবি ফসল।`);
      notesEnglish.push(`On ${landEn} land water stands from June to November: no Aman or summer crop; the winter crop goes in once the water leaves (~${enDate(rules.ready!)}, after BRRI's haor seedbed dates).`);
      hazard('deep_flooding', ['নিচু জমি: বর্ষায় গভীর পানি', 'Low land: deep monsoon water']);
    } else if (request.landType === 'medium_low') {
      notesBangla.push('মাঝারি নিচু জমিতে বর্ষায় পানি জমে: সয়াবিন, মুগ বা তিল টেকে না; আমনে BRRI-র জলমগ্নতা সহনশীল জাত (ব্রি ধান৫১, ৫২, ৭৯) নিরাপদ।');
      notesEnglish.push("On medium-low land water stands in the monsoon: soybean, mungbean and sesame do not survive; for Aman, BRRI's submergence-tolerant varieties (BRRI dhan51, dhan52, dhan79) are the safe choice.");
      hazard('submergence', ['বর্ষায় জলমগ্নতা', 'Submergence in the monsoon']);
    }

    // The haor's flash floods
    if (flashFloodExposed(request.landType)) {
      const boro = LOC.rabi['BRRI dhan28'];
      const late = boro ? flashFloodRisk(boro.harvest) : null;
      const flood = options[0]?.dimensionDetails.flood?.metrics;
      const top = flood?.flashFloodCaught !== undefined
        ? { caught: flood.flashFloodCaught as number, seasons: flood.flashFloodSeasons as number, harvest: flood.flashFloodHarvest as string }
        : null;
      const data = profileData().haorFlashFlood;
      const years = data ? data.floodYears.join(', ') : '';
      notesBangla.push([
        `হাওরের আগাম বন্যা: বন্যা পূর্বাভাস কেন্দ্রের জানানো প্রতিটি আগাম বন্যার (${bnDigits(years)}) আগে মেঘালয় পাহাড়ে ৩ দিনে ১০০ মিমি বা বেশি বৃষ্টি হয়েছিল (নাসার GPM IMERG)।`,
        top ? `প্রথম পছন্দের ফসল কাটা হয় ~${bnDate(top.harvest)}: ${bnDigits(top.seasons)} বছরের ${bnDigits(top.caught)}টিতে তার আগে এমন বৃষ্টি এসেছে।` : '',
        late && boro ? `১ ফেব্রুয়ারি রোপণ করা ব্রি ধান২৮ (কাটা ~${bnDate(boro.harvest)}) ${bnDigits(late.caught)}টিতে ধরা পড়ত, তাই এত দেরির ফসল দেওয়া হয়নি।` : '',
        'বোরোর বীজতলা হাওরে ২৫ অক্টোবর–৭ নভেম্বরে দিন (ব্রি ধান১০২, ১১৮), যাতে এপ্রিলের শুরুতে কাটা যায়।',
      ].filter(Boolean).join(' '));
      notesEnglish.push([
        `Haor flash floods: every flash flood FFWC reported (${years}) followed a burst of 100 mm or more in 3 days over the Meghalaya hills (NASA GPM IMERG).`,
        top ? `The first option is harvested ~${enDate(top.harvest)}: such a burst came before it in ${top.caught} of ${top.seasons} springs.` : '',
        late && boro ? `BRRI dhan28 transplanted on 1 February (harvest ~${enDate(boro.harvest)}) would have been caught in ${late.caught}, so crops cut that late are not offered.` : '',
        "BRRI's haor guidance moves the Boro seedbed to 25 October-7 November (BRRI dhan102, dhan118) so the crop is cut in early April.",
      ].filter(Boolean).join(' '));
      hazard('flash_flood', ['হাওরের আগাম বন্যা', "The haor's flash floods"]);
      farmerLineBangla = [farmerLineBangla, 'হাওরের আগাম বন্যার আগে, এপ্রিলের শুরুতে কাটা যায় এমন সময়ে বোরো লাগান।'].filter(Boolean).join(' ');
      farmerLineEnglish = [farmerLineEnglish, "Plant Boro so it is cut in early April, before the haor's flash floods."].filter(Boolean).join(' ');
    }

    // Today's NASA reading: a dry start before the winter sowing
    const current = LOC.conditions.current;
    const topWinter = options[0]?.cropSequence.find(p => p.seasonType === 'Rabi');
    // A dry start matters for a winter crop sown on the soil water Aman leaves, not for irrigated Boro
    if (current?.dryStart && topWinter && topWinter.crop !== 'Boro rice') {
      const rain = typeof current.rain30PctOfNormal === 'number' ? current.rain30PctOfNormal : null;
      notesBangla.push(`আজকের নাসা তথ্য (POWER, ${bnDate(current.date.slice(5))}): মাটির রস এই সময়ের গত ${bnDigits(current.soilYears ?? 10)} বছরের ${current.soilRank === 0 ? 'সবচেয়ে কম' : 'তুলনায় কম'}${rain !== null ? `, গত ৩০ দিনে বৃষ্টি স্বাভাবিকের ${bnDigits(rain)}%` : ''}। রবি ফসল আমন কাটার পরপরই বুনুন, দরকারে বোনার আগে হালকা সেচ দিন।`);
      notesEnglish.push(`Today's NASA reading (POWER, ${enDate(current.date.slice(5))}): soil moisture ${current.soilRank === 0 ? 'the lowest' : 'lower than most'} of the last ${current.soilYears ?? 10} years for the date${rain !== null ? `, rain in the last 30 days at ${rain}% of normal` : ''}. Sow the winter crop right after the Aman harvest, with a light irrigation first if needed; the plan counts about 50 mm more irrigation this year.`);
      hazard('dry_start', ['রবির আগে মাটি শুকনো', 'Dry soil before the winter sowing']);
      farmerLineBangla = [farmerLineBangla, 'এ বছর মাটি শুকনো: রবি ফসল দেরি না করে বুনুন।'].filter(Boolean).join(' ');
      farmerLineEnglish = [farmerLineEnglish, 'The soil is dry this year: sow the winter crop without delay.'].filter(Boolean).join(' ');
    }

    // Winter fallow on the coast: usually salinity, which the plan does not model
    const top = local.patterns[0];
    if (COASTAL_DISTRICTS.has(LOC.district) && top && top[1] >= CURRENT_PRACTICE_PCT && /^Fallow-Fallow/.test(top[0])) {
      notesBangla.push(`এখানে বেশিরভাগ জমি শীতে খালি থাকে (BRRI ২০১৪-১৫: ${patternBangla(top[0])} ${bnDigits(Math.round(top[1]))}%); উপকূলে কারণ প্রায়ই মাটির লবণাক্ততা, যা এই হিসাবে এখনো নেই। বোনার আগে জমির লবণাক্ততা মাপান; গবেষণার তালিকায় লবণসহিষ্ণু জাত: বারি সরিষা-১১ ও ১৯, বারি আলু-৭২, বোরোতে ব্রি ধান৬৭, ৯৭ ও ৯৯।`);
      notesEnglish.push(`Most land here stays empty in winter (BRRI 2014-15: ${top[0]} on ${Math.round(top[1])}%); on the coast that is usually soil salinity, which this plan does not model yet. Have the field's salinity measured before sowing; salt-tolerant varieties in the research tables: BARI Mustard-11 and -19, BARI Potato-72, and BRRI dhan67, dhan97 and dhan99 for Boro.`);
      hazard('winter_fallow_salinity', ['শীতে জমি খালি: লবণাক্ততা?', 'Winter fallow: salinity?']);
      farmerLineBangla = [farmerLineBangla, 'শীতে জমি লবণাক্ত হলে আগে মাটি পরীক্ষা করান।'].filter(Boolean).join(' ');
      farmerLineEnglish = [farmerLineEnglish, 'If the field turns salty in winter, have the soil tested first.'].filter(Boolean).join(' ');
    }

    const context: LocalContext = {
      landType: request.landType,
      landTypeAssumed: assumed,
      landEvidenceBangla: evidenceBn,
      landEvidenceEnglish: evidenceEn,
      patterns,
      patternsSource: patterns.length ? profileData().sources.patterns ?? null : null,
      croppingIntensityPct: local.intensityPct,
      hazards,
      alerts: alerts.sort((a, b) => HAZARD_ORDER.indexOf(a.hazard) - HAZARD_ORDER.indexOf(b.hazard)),
      notesBangla,
      notesEnglish,
    };
    return { context, hazards, notesBangla, notesEnglish, farmerLineBangla, farmerLineEnglish };
  }

  private farmerCard(best: CandidateSpec, alt: CandidateSpec | undefined, stageBangla: string): FarmerCard {
    const mon = monsoonOf(best);
    const aman = mon.aman;
    const amanName = mon.amanName;
    const k2 = mon.k2;
    const { record: rabi, catalog: rabiName } = cropSlot(best.rabi);
    const boro = LOC.rabi['BRRI dhan28'];
    const dose = rabi.fertilizer;
    const perBigha = (kgHa: number) => bnDecimal(kgHa * BIGHA_HA);
    const deadlineText = rabi.sowingWindow ? ` (শেষ সময় ${bnDate(rabi.sowingWindow[1])})` : '';
    const savedM3 = boro.pumpedM3PerHa - rabi.pumpedM3PerHa;
    const doseSource = (dose as { source?: string }).source?.startsWith('BARI') ? 'BARI হাতবই' : 'SRDI তালন্দ কার্ড';
    const k1 = best.kharif1 ? cropSlot(best.kharif1) : undefined;

    const altSlot = alt ? cropSlot(alt.rabi) : undefined;
    const altRabi = altSlot?.record;
    const altName = altSlot?.catalog;
    const altMonsoon = alt ? (alt.aman ? `আমন ${AMAN_CATALOG[alt.aman]?.varietyBangla}` : alt.kharif2 ? `বর্ষায় ${catalogFor(alt.kharif2)?.cropBangla}` : 'বর্ষায় জমি খালি') : '';
    const irrigationClassBangla = (mm: number) => irrigationClass(mm)[0];
    const until = aman ? 'আমনের' : 'বর্ষার';

    const k1Text = k1
      ? ` ${rabiName.cropBangla} কাটার পর ${until} আগে ${k1.catalog.cropBangla} (${sowWord(k1.catalog)} ~${bnDate(k1.record.sowing)}, কাটা ~${bnDate(k1.record.harvest)}); ${bnIrrigation(k1.record.netIrrigationMm)}।`
      : '';
    const monsoonTitle = aman ? 'আমন ধান' : k2 ? k2.catalog.cropBangla : 'বর্ষায় জমি খালি';
    const opening = rabiName.isRice
      ? aman && amanName
        ? `${amanName.varietyBangla} কেটে বোরো করলে সেচ লাগে প্রায় ${bnDigits(rabi.netIrrigationMm)} মিমি।`
        : `বোরো করলে সেচ লাগে প্রায় ${bnDigits(rabi.netIrrigationMm)} মিমি।`
      : aman && amanName
        ? `${amanName.varietyBangla} ${bnDateOf(bnDate(aman.fieldFree))} মধ্যে জমি খালি করে, তাই ${rabiName.cropBangla} সময়মতো বোনা যায়। বোরোর বদলে ${rabiName.cropBangla} করলে হেক্টরে প্রায় ${bnNumber(savedM3)} ঘনমিটার ভূগর্ভস্থ পানি বাঁচে।`
        : `${k2 ? `বর্ষার ${k2.catalog.cropBangla} ~${bnDate(k2.record.harvest)} কাটা হয়` : 'বর্ষায় ধান নেই'}, তাই ${rabiName.cropBangla} সময়মতো বোনা যায়। বোরোর বদলে ${rabiName.cropBangla} করলে হেক্টরে প্রায় ${bnNumber(savedM3)} ঘনমিটার ভূগর্ভস্থ পানি বাঁচে।`;
    return {
      rotationTitleBangla: `${monsoonTitle} → ${rabiName.cropBangla}${k1 ? ` → ${k1.catalog.cropBangla}` : ''}`,
      rotationSubtitleBangla: amanName
        ? `${amanName.varietyBangla} কেটে ${rabiName.varietyBangla}: ${best.tagBangla}`
        : k2
          ? `${k2.catalog.varietyBangla} কেটে ${rabiName.varietyBangla}: ${best.tagBangla}`
          : `${rabiName.varietyBangla}: ${best.tagBangla}`,
      season1: aman && amanName
        ? {
            name: 'আমন ধান',
            variety: amanName.varietyBangla,
            windowBangla: `রোপণ: ~${bnDate(aman.transplant)} • কাটা: ~${bnDate(aman.maturity)}`,
            stageBangla,
            irrigationBangla: `${bnDigits(aman.totalSeasons)} মৌসুমের ${bnDigits(aman.rescueSeasons)}টিতে ফুল আসার সময় সম্পূরক সেচ লেগেছে`,
          }
        : k2
          ? {
              name: `বর্ষা: ${k2.catalog.cropBangla}`,
              variety: k2.catalog.varietyBangla,
              windowBangla: `বপন: ~${bnDate(k2.record.sowing)} • কাটা: ~${bnDate(k2.record.harvest)}`,
              stageBangla: 'শুধু উঁচু জমিতে, পানি জমলে গাছ মরে যায়',
              irrigationBangla: bnIrrigation(k2.record.netIrrigationMm),
            }
          : { name: 'বর্ষা', variety: 'জমি খালি', windowBangla: 'বর্ষায় ধান বা অন্য ফসল নেই', stageBangla: '', irrigationBangla: 'বর্ষায় সেচ লাগে না' },
      season2: {
        name: rabiName.cropBangla,
        variety: rabiName.varietyBangla,
        windowBangla: `${sowWord(rabiName)}: ~${bnDate(rabi.sowing)}${deadlineText} • কাটা: ~${bnDate(rabi.harvest)}`,
        notesBangla: `সেচ লাগে প্রায় ${bnDigits(rabi.netIrrigationMm)} মিমি${rabiName.isLegume ? '; ডাল ফসল মাটিতে নাইট্রোজেন যোগ করে' : ''}`,
        fertilizerBangla: `প্রতি বিঘায় (৩৩ শতক) ইউরিয়া ${perBigha(dose.ureaKgHa)}, টিএসপি ${perBigha(dose.tspKgHa)}, এমওপি ${perBigha(dose.mopKgHa)} কেজি (${doseSource})`,
      },
      alternative: altRabi && altName && alt
        ? {
            name: `${altName.cropBangla} (${altName.varietyBangla})`,
            categoryBangla: irrigationClassBangla(altRabi.netIrrigationMm),
            sowingBangla: `~${bnDate(altRabi.sowing)}${altRabi.sowingWindow ? ` (শেষ সময় ${bnDate(altRabi.sowingWindow[1])})` : ''}`,
            yieldBangla: altRabi.districtYieldTPerHa ? `জেলার গড় ${bnDecimal(altRabi.districtYieldTPerHa)} টন/হেক্টর (BBS)` : 'তথ্য পাওয়া যায়নি',
            noteBangla: `${altMonsoon}; সেচ প্রায় ${bnDigits(altRabi.netIrrigationMm)} মিমি`,
            marketPriceBangla: 'তথ্য পাওয়া যায়নি',
          }
        : !landRules(this.landType).aman
          ? { name: 'বিকল্প নেই', categoryBangla: '', sowingBangla: '', yieldBangla: '', noteBangla: 'নিচু জমিতে পানি নামার পর বোরোই প্রধান ফসল; অন্য ফসল চাইলে নাম বলুন', marketPriceBangla: 'তথ্য পাওয়া যায়নি' }
          : { name: 'তথ্য পাওয়া যায়নি', categoryBangla: '', sowingBangla: '', yieldBangla: '', noteBangla: '', marketPriceBangla: 'তথ্য পাওয়া যায়নি' },
      narrativeBangla: opening + k1Text,
      provenanceBangla: `তথ্যসূত্র: নাসা POWER ও GPM IMERG দিয়ে ${bnDigits(aman?.totalSeasons ?? 25)} মৌসুমের পানির হিসাব, SRDI তালন্দ কার্ড, BRRI/BARI সময়সূচি। রিলিজ ${RELEASE.id}।`,
      audioScriptBangla: '',
      audioDurationSeconds: 0,
    };
  }

  generateAdvice(request: PlanOptionsRequest): AdviceJSON {
    const place = placeFor(request.unionId);
    if (!place) {
      throw new UnsupportedUnionError(request.unionId);
    }
    // A dry soil counts only in the run-up to and during the winter sowing (1 September-15 December)
    const today = request.today ? new Date(request.today) : new Date();
    const day = seasonDay(isoDate(today).slice(5));
    const sowingTime = day >= seasonDay('09-01') && day <= seasonDay('12-15');
    const current = request.currentConditions
      ? { ...request.currentConditions, dryStart: sowingTime && request.currentConditions.soilStatus === 'dry' }
      : null;
    return withPlace({ ...place, conditions: { ...place.conditions, current } }, () => this.adviseHere(request));
  }

  /** Advice for the place `LOC` currently points at (see data/location.ts). */
  private adviseHere(request: PlanOptionsRequest): AdviceJSON {
    const seasonYear = parseSeasonYear(request.season);
    const today = request.today ? new Date(request.today) : new Date();

    const rules = landRules(request.landType);
    const wantsChoice = Boolean(request.preferredCrops?.length || request.heroCrop || request.avoidCrops?.length);
    // Outside the pilot, and wherever the land rules Aman out, the year is planned from every crop the engine knows
    // that fits this place's land and calendar; the pilot keeps its five researched rotations.
    const planLocally = !wantsChoice && (LOC.kind !== 'pilot' || !rules.aman);
    this.landType = request.landType;
    // Land under deep monsoon water grows Boro (BRRI's survey: Boro-Fallow-Fallow on most of it), so the plan holds
    // Boro, the haor-safe early one where the flash floods come; other winter crops come in when the farmer names them
    const choice = wantsChoice ? this.choicePlans(request, seasonYear)
      : planLocally ? this.choicePlans(rules.aman ? request : { ...request, heroCrop: 'boro' }, seasonYear, true)
        : null;
    const useChoice = Boolean(choice && choice.options.length);
    let specs = useChoice ? choice!.specs : CANDIDATES;
    let options = useChoice ? choice!.options : this.rank(CANDIDATES, request, seasonYear);
    if (planLocally && useChoice) ({ specs, options } = this.withCurrentPractice(specs, options, request, seasonYear, rules));

    const bestSpec = specs.find(c => c.id === options[0].id)!;
    const altSpec = options[1] ? specs.find(c => c.id === options[1].id) : undefined;
    const mon = monsoonOf(bestSpec);
    const aman = mon.aman;
    const amanName = mon.amanName;
    const k2 = mon.k2;
    const { record: rabi, catalog: rabiName } = cropSlot(bestSpec.rabi);
    const k1 = bestSpec.kharif1 ? cropSlot(bestSpec.kharif1) : undefined;
    const boro = LOC.rabi['BRRI dhan28'];
    const smap = LOC.conditions.smap;
    const landBangla = LAND_TYPE_BANGLA[request.landType] ?? '';
    const asked = useChoice && wantsChoice ? choice!.result.requested : [];
    const hero = useChoice && wantsChoice ? choice!.result.heroCrop : null;
    const local = this.localContext(request, rules, options);
    const heroName = hero ? asked.find(a => a.id === hero) : undefined;

    const monsoonLineBangla = aman && amanName
      ? `${amanName.varietyBangla} ${bnDateOf(bnDate(aman.fieldFree))} মধ্যে জমি খালি করে; ${bnDigits(aman.totalSeasons)} মৌসুমের ${bnDigits(aman.rescueSeasons)}টিতে ফুল আসার সময় সম্পূরক সেচ লেগেছে।`
      : k2
        ? `বর্ষায় ${k2.catalog.cropBangla} (বপন ~${bnDate(k2.record.sowing)}, কাটা ~${bnDate(k2.record.harvest)}); ${bnIrrigation(k2.record.netIrrigationMm)}।`
        : 'বর্ষায় এই জমিতে ধান নেই।';
    const monsoonLineEnglish = aman
      ? `${bestSpec.aman} frees the field by ${enDate(aman.fieldFree)}; it needed rescue irrigation at flowering in ${aman.rescueSeasons} of ${aman.totalSeasons} seasons.`
      : k2
        ? `Monsoon ${k2.catalog.crop.toLowerCase()} (sow ~${enDate(k2.record.sowing)}, harvest ~${enDate(k2.record.harvest)}) needs ${k2.record.netIrrigationMm < 20 ? 'almost no irrigation' : `about ${k2.record.netIrrigationMm} mm`}.`
        : 'No rice in this field in the monsoon.';
    const farmerSummary = [
      `${bnOf(request.unionNameBangla)} ${landBangla} জমির জন্য শীর্ষে: ${options[0].nameBangla}।`,
      monsoonLineBangla,
      `রবিতে ${rabiName.cropInBangla} সেচ লাগে প্রায় ${bnDigits(rabi.netIrrigationMm)} মিমি।`,
      rabiName.isLegume ? `${rabiName.cropBangla} মাটিতে নাইট্রোজেন যোগ করে।` : '',
      k1 ? `তারপর ${aman ? 'আমনের' : 'বর্ষার'} আগে ${k1.catalog.cropInBangla} ${bnIrrigation(k1.record.netIrrigationMm)}।` : '',
      heroName ? `প্রধান ফসল ${heroName.cropBangla} ধরে পুরো বছর সাজানো হয়েছে।` : '',
      asked.length && !heroName ? `আপনার পছন্দ (${asked.map(a => a.cropBangla).join(', ')}) ধরে হিসাব করা হয়েছে।` : '',
      local.farmerLineBangla,
    ].filter(Boolean).join(' ');

    const farmerSummaryEnglish = [
      `Top option for ${request.landType.replace('_', '-')} land in ${LOC.nameEnglish}: ${options[0].nameEnglish}.`,
      monsoonLineEnglish,
      `${rabiName.crop} needs about ${rabi.netIrrigationMm} mm of irrigation.`,
      rabiName.isLegume ? `${rabiName.crop} adds nitrogen to the soil.` : '',
      k1 ? `Then ${k1.catalog.crop.toLowerCase()} before ${aman ? 'Aman' : 'the monsoon'} needs ${k1.record.netIrrigationMm < 20 ? 'almost no irrigation' : `about ${k1.record.netIrrigationMm} mm`}.` : '',
      heroName ? `The whole year is planned around the main crop, ${heroName.cropEnglish.toLowerCase()}.` : '',
      asked.length && !heroName ? `Planned around the farmer's choice: ${asked.map(a => a.cropEnglish.toLowerCase()).join(', ')}.` : '',
      local.farmerLineEnglish,
    ].filter(Boolean).join(' ');

    const choiceNote = (key: string | undefined) => {
      if (!key?.includes('@')) return '';
      const { record, catalog } = cropSlot(key);
      const facts = replayFacts(choiceIdOf(key))!;
      const heat = record.heat ? `, ${record.heat.hotDays} of ${record.heat.windowDays} days above ${record.heat.thresholdC} C at ${record.heat.stage}${facts.heat?.assumed ? ' (assumed limit)' : ''}` : '';
      return `${catalog.crop} sown ${enDate(record.sowing)} (crop-choice replay, ${choiceReplay().seasons}): net irrigation ~${record.netIrrigationMm} mm (p10-p90 ${record.netIrrigationRangeMm[0]}-${record.netIrrigationRangeMm[1]})${heat}; fertilizer from the ${(record.fertilizer as { source?: string }).source ?? 'SRDI Talanda card'}.`;
    };
    const saaoNotes = [
      aman
        ? `${LOC.kind === 'pilot' ? 'Talanda (Tanore)' : `${LOC.district} district`} replay ${RELEASE.seasons} with NASA POWER ET0 and GPM IMERG Final rain: ${bestSpec.aman} flowers ~${enDate(aman.flowering)} and needed rescue irrigation at flowering in ${aman.rescueSeasons} of ${aman.totalSeasons} seasons; field free ~${enDate(aman.fieldFree)}.`
        : 'No Aman in the top option: the monsoon slot holds another crop or stands empty.',
      `${rabiName.crop} net irrigation ~${rabi.netIrrigationMm} mm (p10-p90 ${rabi.netIrrigationRangeMm[0]}-${rabi.netIrrigationRangeMm[1]}) against ~${boro.netIrrigationMm} mm for Boro.`,
      choiceNote(bestSpec.kharif2),
      choiceNote(bestSpec.rabi),
      choiceNote(bestSpec.kharif1),
      smap ? `SMAP L4 root zone around 10 Nov (${smap.nov10Years.join(', ')}): ${smap.nov10TypicalM3M3} m3/m3.` : '',
      LOC.conditions.groundwater ? `GLDAS-2.2 groundwater at ${LOC.upazila}: ${LOC.conditions.groundwater.trendMmPerYear} mm/yr (${LOC.conditions.groundwater.changeMm} mm, ${LOC.conditions.groundwater.period}).` : '',
      LOC.kind === 'pilot' ? '' : LOC.dataNote,
      ...local.notesEnglish,
      `Income scores are illustrative team estimates moved by district yields. Release ${RELEASE.id} (research ${RELEASE.researchCommit}).`,
    ].filter(Boolean).join(' ');

    const stale: AdviceJSON['stale_or_missing_inputs'] = [
      { dataset: 'DAM farm-gate prices and farmer cost survey', issue: 'Not collected yet; income uses illustrative team estimates', affectedDimension: 'income' },
      { dataset: 'Farmer interviews in Talanda', issue: 'Priority weights are defaults until interviews', affectedDimension: 'all' },
      LOC.kind === 'pilot'
        ? { dataset: 'Flood model for Barind land', issue: 'Not modelled; land-type assumption from the SRDI card', affectedDimension: 'flood' }
        : { dataset: 'River flood model', issue: request.landTypeAssumed ? 'Not modelled; the land type is the upazila default from NASA NASADEM, Landsat and BRRI\'s survey, and a farm may differ' : 'Not modelled; the land type is the farmer\'s', affectedDimension: 'flood' },
    ];
    if (LOC.kind !== 'pilot') {
      stale.push({ dataset: 'SRDI union fertilizer card', issue: 'Talanda card used as a stand-in until this upazila\'s card is added', affectedDimension: 'soil' });
    }
    if (local.hazards.includes('winter_fallow_salinity')) {
      stale.push({ dataset: 'Soil salinity', issue: 'Not modelled; most land here stays fallow in winter, often because of salinity', affectedDimension: 'all' });
    }
    if (useChoice) {
      stale.push({ dataset: 'Heat limits for crops outside crop_parameters.csv', issue: 'Literature values, marked as assumed in the crop-choice replay', affectedDimension: 'heat' });
    }

    const askedCrops = [...(request.heroCrop ? [request.heroCrop] : []), ...(request.preferredCrops ?? [])]
      .map(id => CHOICE_BY_ID[String(id).toLowerCase()]).filter(Boolean);
    return {
      schema_version: '1.0',
      advice_id: `adv_${Date.now()}_${request.unionId}`,
      created_at: new Date().toISOString(),
      scope: {
        union_id: request.unionId,
        union_name_bangla: request.unionNameBangla,
        upazila: request.upazila,
        district: request.district,
        land_type: request.landType,
        season: request.season,
      },
      data_release: RELEASE.id,
      release: { id: RELEASE.id, generatedOn: RELEASE.generatedOn, researchCommit: RELEASE.researchCommit },
      farmer_priorities: request.farmerPriorities as Record<string, number>,
      active_plugins: this.registry.getActivePlugins().map(p => p.id),
      options,
      stale_or_missing_inputs: stale,
      farmer_summary_bangla: farmerSummary,
      farmer_summary_english: farmerSummaryEnglish,
      saao_technical_notes: saaoNotes,
      verification: null,
      this_season: rules.aman ? thisSeasonFit(request.currentAmanCrop, askedCrops) : null, // no Aman stands on low land
      this_season_option_id: request.currentAmanCrop
        ? options.find(o => o.cropSequence[0].variety === request.currentAmanCrop)?.id ?? null
        : null,
      farmer_card: this.farmerCard(bestSpec, altSpec, aman ? amanStageBangla(aman, today, seasonYear) : ''),
      ...(choice && wantsChoice ? { crop_choice: choice.result } : {}),
      local_context: local.context,
    };
  }
}
