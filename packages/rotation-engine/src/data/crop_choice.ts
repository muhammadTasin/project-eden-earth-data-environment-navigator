/**
 * Crops a farmer can ask for, beyond the five fixed rotations. The hand-written facts live here: names, crop family,
 * residue class, income source and the words farmers use for each crop. The per-place numbers come from
 * research/explore/crop_choice_replay.py (crop_choice_replay.json): sowing dates, irrigation, heat, heavy rain and
 * fertilizer. A year has three slots in field order: the monsoon (Kharif-2: Aman rice, a non-rice crop, or nothing),
 * the winter (Rabi) and the pre-monsoon (Kharif-1) before the next monsoon. Lentil, mustard, wheat and Boro keep
 * their research-release records (data/location.ts).
 *
 * Income: the team estimates already in crop_catalog.ts for the original crops; research net returns (BBS 2024-25
 * harvest prices and yields, Agriculture Census 2019 costs; crops/crop_parameters.csv) for potato, maize and Aus;
 * null for crops with no price and cost data yet, whose income score then stays neutral.
 */
import fs from 'node:fs';
import type { AmanRecord, FertilizerDose, HeatExposure, MonthDay, RabiRecord } from './release_types.ts';
import { AMAN_CATALOG, RABI_CATALOG, type RabiCatalogEntry } from './crop_catalog.ts';
import { LOC } from './location.ts';
import { enDate, seasonDay } from '../bn.ts';

export type ChoiceSeason = 'Kharif-2' | 'Rabi' | 'Kharif-1';

export interface ChoiceCrop extends RabiCatalogEntry {
  id: string;
  season: ChoiceSeason;
  /** The research-release records behind the original crops; other crops come from the crop-choice replay. */
  releaseKeys?: string[];
  /** A request for this id also covers these (sunflower also grows in Kharif-1, soybean in the monsoon). */
  alsoCovers?: string[];
  /** Words for this crop in Bangla, Banglish and English, for spoken or typed requests. */
  aliases: string[];
  incomeSource: string;
}

const TEAM = 'team estimate (crop_catalog.ts)';
const RESEARCH_RETURN = 'research net return: BBS 2024-25 prices and yields, Agriculture Census 2019 costs';
const NO_PRICE = 'no price and cost data yet';

function release(id: string, key: string, aliases: string[], extra: Partial<ChoiceCrop> = {}): ChoiceCrop {
  return { ...RABI_CATALOG[key], id, season: 'Rabi', releaseKeys: [key], aliases, incomeSource: TEAM, ...extra };
}

export const CHOICE_CROPS: ChoiceCrop[] = [
  release('lentil', 'BARI Masur-8', ['মসুর', 'মশুর', 'মুসুর', 'masur', 'mosur', 'moshur', 'lentil']),
  release('mustard', 'BARI Sarisha-14', ['সরিষা', 'সরষে', 'সর্ষে', 'সরিসা', 'shorisha', 'sorisha', 'sarisha', 'mustard']),
  release('wheat', 'BARI Gom 33 (Early)', ['গম', 'gom', 'wheat'], { releaseKeys: ['BARI Gom 33 (Early)', 'BARI Gom 33 (Late)'] }),
  release('boro', 'BRRI dhan28', ['বোরো', 'boro']),
  {
    id: 'potato', season: 'Rabi', crop: 'Potato', cropBangla: 'আলু', cropInBangla: 'আলুতে', varietyBangla: 'বারি আলু-২৫',
    isLegume: false, isRice: false, hostGroup: 'tuber', fodderValue: 'low', fodderNoteBangla: 'আলুর গাছ গোখাদ্য হিসেবে খুব কম কাজে লাগে।',
    illustrativeGrossMarginTkPerHa: 177038, incomeSource: RESEARCH_RETURN, aliases: ['আলু', 'alu', 'aloo', 'potato'],
  },
  {
    id: 'maize', season: 'Rabi', crop: 'Maize', cropBangla: 'ভুট্টা', cropInBangla: 'ভুট্টায়', varietyBangla: 'বারি হাইব্রিড ভুট্টা-১৩',
    isLegume: false, isRice: false, hostGroup: 'cereal', fodderValue: 'high', fodderNoteBangla: 'ভুট্টার গাছ ও পাতা ভালো গোখাদ্য, সাইলেজও করা যায়।',
    illustrativeGrossMarginTkPerHa: 80042, incomeSource: RESEARCH_RETURN, aliases: ['ভুট্টা', 'ভূট্টা', 'ভুটা', 'bhutta', 'vutta', 'maize', 'corn'],
  },
  {
    id: 'sunflower', season: 'Rabi', crop: 'Sunflower', cropBangla: 'সূর্যমুখী', cropInBangla: 'সূর্যমুখীতে', varietyBangla: 'বারি সূর্যমুখী-২',
    isLegume: false, isRice: false, hostGroup: 'oilseed', fodderValue: 'low', fodderNoteBangla: 'সূর্যমুখীর গাছ গোখাদ্য নয়; বীজের খৈল গরুর খাবার।',
    illustrativeGrossMarginTkPerHa: null, incomeSource: NO_PRICE, alsoCovers: ['sunflower_kharif'],
    aliases: ['সূর্যমুখী', 'সূর্যমুখি', 'সুর্যমুখী', 'সুর্যমুখি', 'সূর্যমূখী', 'surjomukhi', 'surjamukhi', 'shurjomukhi', 'sunflower'],
  },
  {
    id: 'chickpea', season: 'Rabi', crop: 'Chickpea', cropBangla: 'ছোলা', cropInBangla: 'ছোলায়', varietyBangla: 'বারি ছোলা-১০',
    isLegume: true, isRice: false, hostGroup: 'legume', fodderValue: 'medium', fodderNoteBangla: 'ছোলার গাছ ও ভুসি গরুর আমিষসমৃদ্ধ খাবার।',
    illustrativeGrossMarginTkPerHa: null, incomeSource: NO_PRICE, aliases: ['ছোলা', 'chola', 'chhola', 'chickpea'],
  },
  {
    id: 'grasspea', season: 'Rabi', crop: 'Grass pea', cropBangla: 'খেসারি', cropInBangla: 'খেসারিতে', varietyBangla: 'বারি খেসারি-৩',
    isLegume: true, isRice: false, hostGroup: 'legume', fodderValue: 'high', fodderNoteBangla: 'খেসারির গাছ ভালো সবুজ গোখাদ্য।',
    illustrativeGrossMarginTkPerHa: null, incomeSource: NO_PRICE, aliases: ['খেসারি', 'খেসারী', 'খেশারি', 'kheshari', 'khesari', 'grasspea', 'grass pea'],
  },
  {
    id: 'sweetpotato', season: 'Rabi', crop: 'Sweet potato', cropBangla: 'মিষ্টি আলু', cropInBangla: 'মিষ্টি আলুতে', varietyBangla: 'বারি মিষ্টি আলু-১২',
    isLegume: false, isRice: false, hostGroup: 'tuber', fodderValue: 'medium', fodderNoteBangla: 'মিষ্টি আলুর লতা গরু-ছাগলের খাবার।',
    illustrativeGrossMarginTkPerHa: null, incomeSource: NO_PRICE, aliases: ['মিষ্টি আলু', 'মিষ্টিআলু', 'misti alu', 'mishti alu', 'sweet potato', 'sweetpotato'],
  },
  {
    id: 'barley', season: 'Rabi', crop: 'Barley', cropBangla: 'যব', cropInBangla: 'যবে', varietyBangla: 'বারি বার্লি-৭',
    isLegume: false, isRice: false, hostGroup: 'cereal', fodderValue: 'high', fodderNoteBangla: 'যবের খড় ভালো শুকনা গোখাদ্য।',
    illustrativeGrossMarginTkPerHa: null, incomeSource: NO_PRICE, aliases: ['যব', 'বার্লি', 'barley'],
  },
  {
    id: 'soybean', season: 'Rabi', crop: 'Soybean', cropBangla: 'সয়াবিন', cropInBangla: 'সয়াবিনে', varietyBangla: 'বারি সয়াবিন-৬',
    isLegume: true, isRice: false, hostGroup: 'legume', fodderValue: 'medium', fodderNoteBangla: 'সয়াবিনের খড় ও খৈল গোখাদ্য।',
    illustrativeGrossMarginTkPerHa: null, incomeSource: NO_PRICE, alsoCovers: ['soybean_k2'], aliases: ['সয়াবিন', 'সয়াবীন', 'soybean', 'soyabean', 'soya'],
  },
  {
    id: 'mungbean', season: 'Kharif-1', crop: 'Mungbean', cropBangla: 'মুগ', cropInBangla: 'মুগে', varietyBangla: 'বারি মুগ-৬',
    isLegume: true, isRice: false, hostGroup: 'legume', fodderValue: 'medium',
    fodderNoteBangla: 'ফল তোলার পর মুগের গাছ মাটিতে মিশালে সবুজ সার হয়, বা গরুকে খাওয়ানো যায়।',
    illustrativeGrossMarginTkPerHa: null, incomeSource: NO_PRICE, alsoCovers: ['mungbean_k2'], aliases: ['মুগ', 'মুগডাল', 'mug', 'mung', 'moong', 'mungbean'],
  },
  {
    id: 'sesame', season: 'Kharif-1', crop: 'Sesame', cropBangla: 'তিল', cropInBangla: 'তিলে', varietyBangla: 'বারি তিল-৪',
    isLegume: false, isRice: false, hostGroup: 'oilseed', fodderValue: 'low', fodderNoteBangla: 'তিলের গাছ গোখাদ্য নয়; তিলের খৈল গরুর খাবার।',
    illustrativeGrossMarginTkPerHa: null, incomeSource: NO_PRICE, alsoCovers: ['sesame_k2'], aliases: ['তিল', 'til', 'sesame'],
  },
  {
    id: 'aus', season: 'Kharif-1', crop: 'Aus rice', cropBangla: 'আউশ ধান', cropInBangla: 'আউশ ধানে', varietyBangla: 'ব্রি ধান৪৮',
    isLegume: false, isRice: true, hostGroup: 'rice', fodderValue: 'high', fodderNoteBangla: 'আউশের খড় শুকনা গোখাদ্য।',
    illustrativeGrossMarginTkPerHa: 38067, incomeSource: RESEARCH_RETURN, aliases: ['আউশ', 'আউস', 'aus', 'aush'],
  },
  {
    id: 'jute', season: 'Kharif-1', crop: 'Jute', cropBangla: 'পাট', cropInBangla: 'পাটে', varietyBangla: 'বিজেআরআই তোষা পাট-৪',
    isLegume: false, isRice: false, hostGroup: 'fibre', fodderValue: 'low', fodderNoteBangla: 'পাটের কচি পাতা শাক হিসেবে খাওয়া যায়; গাছ গোখাদ্য নয়।',
    illustrativeGrossMarginTkPerHa: 69624, incomeSource: RESEARCH_RETURN, aliases: ['পাট', 'jute'],
  },
  {
    id: 'soybean_k2', season: 'Kharif-2', crop: 'Soybean', cropBangla: 'সয়াবিন', cropInBangla: 'সয়াবিনে', varietyBangla: 'বারি সয়াবিন-৬ (বর্ষা)',
    isLegume: true, isRice: false, hostGroup: 'legume', fodderValue: 'medium', fodderNoteBangla: 'সয়াবিনের খড় ও খৈল গোখাদ্য।',
    illustrativeGrossMarginTkPerHa: null, incomeSource: NO_PRICE, aliases: [],
  },
  {
    id: 'mungbean_k2', season: 'Kharif-2', crop: 'Mungbean', cropBangla: 'মুগ', cropInBangla: 'মুগে', varietyBangla: 'বারি মুগ-৬ (বর্ষা)',
    isLegume: true, isRice: false, hostGroup: 'legume', fodderValue: 'medium',
    fodderNoteBangla: 'ফল তোলার পর মুগের গাছ মাটিতে মিশালে সবুজ সার হয়, বা গরুকে খাওয়ানো যায়।',
    illustrativeGrossMarginTkPerHa: null, incomeSource: NO_PRICE, aliases: [],
  },
  {
    id: 'sesame_k2', season: 'Kharif-2', crop: 'Sesame', cropBangla: 'তিল', cropInBangla: 'তিলে', varietyBangla: 'বারি তিল-৪ (বর্ষা)',
    isLegume: false, isRice: false, hostGroup: 'oilseed', fodderValue: 'low', fodderNoteBangla: 'তিলের গাছ গোখাদ্য নয়; তিলের খৈল গরুর খাবার।',
    illustrativeGrossMarginTkPerHa: null, incomeSource: NO_PRICE, aliases: [],
  },
  {
    id: 'sunflower_kharif', season: 'Kharif-1', crop: 'Sunflower', cropBangla: 'সূর্যমুখী', cropInBangla: 'সূর্যমুখীতে',
    varietyBangla: 'বারি সূর্যমুখী-২ (গ্রীষ্ম)', isLegume: false, isRice: false, hostGroup: 'oilseed', fodderValue: 'low',
    fodderNoteBangla: 'সূর্যমুখীর গাছ গোখাদ্য নয়; বীজের খৈল গরুর খাবার।', illustrativeGrossMarginTkPerHa: null, incomeSource: NO_PRICE, aliases: [],
  },
];

export const CHOICE_BY_ID: Record<string, ChoiceCrop> = Object.fromEntries(CHOICE_CROPS.map(c => [c.id, c]));

/** Crops farmers name that the engine does not replay yet, so a request for them is answered honestly. */
export const NOT_MODELLED: Array<{ id: string; bn: string; en: string; aliases: string[] }> = [
  { id: 'onion', bn: 'পেঁয়াজ', en: 'onion', aliases: ['পেঁয়াজ', 'পিঁয়াজ', 'পেয়াজ', 'piyaj', 'peyaj', 'onion'] },
  { id: 'garlic', bn: 'রসুন', en: 'garlic', aliases: ['রসুন', 'roshun', 'rosun', 'garlic'] },
  { id: 'groundnut', bn: 'চীনাবাদাম', en: 'groundnut', aliases: ['চীনাবাদাম', 'চিনাবাদাম', 'বাদাম', 'badam', 'groundnut', 'peanut'] },
  { id: 'vegetables', bn: 'সবজি', en: 'vegetables', aliases: ['সবজি', 'শাকসবজি', 'shobji', 'sobji', 'vegetable'] },
  { id: 'tomato', bn: 'টমেটো', en: 'tomato', aliases: ['টমেটো', 'tomato'] },
  { id: 'brinjal', bn: 'বেগুন', en: 'brinjal', aliases: ['বেগুন', 'begun', 'brinjal', 'eggplant'] },
  { id: 'chilli', bn: 'মরিচ', en: 'chilli', aliases: ['মরিচ', 'morich', 'chilli', 'chili'] },
  { id: 'sugarcane', bn: 'আখ', en: 'sugarcane', aliases: ['আখ', 'sugarcane'] },
];

/** Rice in a request to avoid it: 'rice' stands for Aman, Boro and Aus; 'aman' for the monsoon rice alone. */
export const RICE_WORDS: Array<{ id: string; aliases: string[] }> = [
  { id: 'aman', aliases: ['আমন', 'aman'] },
  { id: 'rice', aliases: ['ধান', 'dhan', 'rice', 'paddy'] },
];
export const RICE_IDS = ['aman', 'boro', 'aus'];

/** A spoken group word that stands for several crops; the engine picks the best of them. */
export const CROP_GROUPS: Array<{ id: string; bn: string; en: string; crops: string[]; aliases: string[] }> = [
  { id: 'pulses', bn: 'ডাল', en: 'pulses', crops: ['lentil', 'chickpea', 'grasspea'], aliases: ['ডাল', 'ডালের', 'dal', 'daal', 'pulse'] },
  { id: 'oilseeds', bn: 'তেলফসল', en: 'oilseeds', crops: ['mustard', 'sunflower'], aliases: ['তেলফসল', 'তেলবীজ', 'oilseed'] },
];

// ---------------------------------------------------------------------------
// Per-place replay (research/explore/crop_choice_replay.py)
// ---------------------------------------------------------------------------

type Row = [MonthDay, MonthDay, number, number, number, number, number | null, number?];

interface ReplayCrop {
  season: ChoiceSeason;
  label: string;
  window: [MonthDay, MonthDay];
  windowSource: string;
  fieldDays: number;
  daysSource: string;
  seedlingDays: number | null;
  relayDays: number;
  kcSource: string;
  kcAssumed?: boolean;
  waterMethod: 'upland' | 'paddy';
  heat: (Omit<HeatExposure, 'hotDays'> & { source: string; assumed: boolean }) | null;
  fertilizer: FertilizerDose & { source: string };
}

interface Replay {
  generatedOn: string;
  seasons: string;
  seasonCount: number;
  method: string;
  crops: Record<string, ReplayCrop>;
  places: Record<string, Record<string, Row[]>>;
}

let replay: Replay | null = null;
export function choiceReplay(): Replay {
  if (!replay) replay = JSON.parse(fs.readFileSync(new URL('./crop_choice_replay.json', import.meta.url), 'utf8')) as Replay;
  return replay;
}

function placeRows(id: string): Row[] {
  return choiceReplay().places[LOC.kind === 'pilot' ? 'talanda_tanore' : LOC.district]?.[id] ?? [];
}

/** Research-release key ('BARI Masur-8') or crop-choice key ('sunflower@11-25') -> the replay record at this place. */
export function recordFor(key: string): RabiRecord | undefined {
  const at = key.indexOf('@');
  if (at < 0) return LOC.rabi[key];
  const id = key.slice(0, at);
  const sow = key.slice(at + 1);
  const crop = choiceReplay().crops[id];
  const row = placeRows(id).find(r => r[0] === sow);
  if (!crop || !row) return undefined;
  return {
    key,
    replayLabel: `${crop.label}, sown ${enDate(sow)}`,
    sowing: row[0],
    harvest: row[1],
    sowingWindow: crop.window,
    sowingWindowSource: crop.windowSource,
    seasons: choiceReplay().seasonCount,
    netIrrigationMm: row[2],
    netIrrigationRangeMm: [row[3], row[4]],
    pumpedM3PerHa: row[2] * 10,
    fieldDays: crop.fieldDays,
    cropWaterUseMm: row[5],
    heat: crop.heat
      ? { stage: crop.heat.stage, stageBangla: crop.heat.stageBangla, thresholdC: crop.heat.thresholdC, windowDays: crop.heat.windowDays, hotDays: row[6] ?? 0 }
      : null,
    fertilizer: crop.fertilizer,
    districtYieldTPerHa: null,
  };
}

/** The crop facts behind a record key. */
export function catalogFor(key: string): ChoiceCrop | RabiCatalogEntry | undefined {
  const at = key.indexOf('@');
  return at < 0 ? RABI_CATALOG[key] : CHOICE_BY_ID[key.slice(0, at)];
}

export function choiceIdOf(key: string): string {
  const at = key.indexOf('@');
  if (at >= 0) return key.slice(0, at);
  return CHOICE_CROPS.find(c => c.releaseKeys?.includes(key))?.id ?? key;
}

/** Replay facts a crop's text needs: window source, seedling age (Aus), relay sowing (grass pea), heat source. */
export function replayFacts(id: string): ReplayCrop | undefined {
  return choiceReplay().crops[id];
}

// ---------------------------------------------------------------------------
// Fitting a crop into the year
// ---------------------------------------------------------------------------

/** Days from harvest to the next sowing, as in the research replay (connect_check.py). */
export const TURNAROUND_DAYS = 7;

export function addDays(monthDay: MonthDay, days: number): MonthDay {
  const [m, d] = monthDay.split('-').map(Number);
  const t = new Date(Date.UTC(2001, m - 1, d) + days * 86_400_000);
  return `${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** Field order inside one crop year (1 July to 30 June), with July-October harvests of a Kharif-1 crop after June. */
export function yearDay(monthDay: MonthDay, laterThan?: MonthDay): number {
  const day = seasonDay(monthDay);
  return laterThan !== undefined && day < seasonDay(laterThan) ? day + 365 : day;
}

/** A crop that fits gets a record key; one that does not says why: its window closes first, or it clashes with Aman. */
export type Fit = { key: string } | { reason: 'window_closed' | 'aman_clash' | 'no_data'; deadline: MonthDay; ready: MonthDay };

/**
 * The winter crop once the field is ready (`ready`: Aman's field-free date, a week after a monsoon crop's harvest,
 * or null when the monsoon field stands empty). Original crops keep their release record when the field is ready by
 * the handbook deadline (wheat falls back to the late sowing, as the five fixed rotations do). Other crops start on
 * the first replayed sowing date after that; relay crops (grass pea) go into standing Aman before its harvest.
 */
export function rabiFit(crop: ChoiceCrop, ready: MonthDay | null, amanMaturity?: MonthDay): Fit {
  if (crop.releaseKeys) {
    for (const key of crop.releaseKeys) {
      const r = LOC.rabi[key];
      if (!r) continue;
      const last = key === 'BARI Gom 33 (Late)' ? r.sowing : r.sowingWindow?.[1] ?? r.sowing;
      if (!ready || seasonDay(ready) <= seasonDay(last)) return { key };
    }
    const r = LOC.rabi[crop.releaseKeys[crop.releaseKeys.length - 1]];
    const deadline = r?.sowingWindow?.[1] ?? r?.sowing ?? ready ?? '11-30';
    return { reason: 'window_closed', deadline, ready: ready ?? deadline };
  }
  const facts = replayFacts(crop.id);
  const rows = placeRows(crop.id);
  if (!facts || !rows.length) return { reason: 'no_data', deadline: ready ?? '11-30', ready: ready ?? '11-30' };
  const from = facts.relayDays && amanMaturity ? addDays(amanMaturity, -facts.relayDays) : ready;
  const row = from ? rows.find(r => seasonDay(r[0]) >= seasonDay(from)) : rows[0];
  return row ? { key: `${crop.id}@${row[0]}` } : { reason: 'window_closed', deadline: facts.window[1], ready: from ?? facts.window[0] };
}

/**
 * A Kharif-1 crop between the winter crop's harvest and the next monsoon slot: `nextStart` is when the field is
 * needed again (the next Aman's transplanting, a monsoon crop's sowing, or the next winter sowing when the monsoon
 * field stands empty).
 */
export function kharif1Fit(crop: ChoiceCrop, rabiHarvest: MonthDay, nextStart: MonthDay): Fit {
  const ready = addDays(rabiHarvest, TURNAROUND_DAYS);
  const rows = placeRows(crop.id);
  const facts = replayFacts(crop.id);
  if (!facts || !rows.length) return { reason: 'no_data', deadline: ready, ready };
  const limit = seasonDay(nextStart) + 365;
  const row = rows.find(r => yearDay(r[0]) >= yearDay(ready) && yearDay(addDays(r[1], TURNAROUND_DAYS), r[0]) <= limit);
  if (row) return { key: `${crop.id}@${row[0]}` };
  return rows.some(r => yearDay(r[0]) >= yearDay(ready))
    ? { reason: 'aman_clash', deadline: nextStart, ready }
    : { reason: 'window_closed', deadline: facts.window[1], ready };
}

/** Every replayed sowing of a monsoon (Kharif-2) crop at this place, as record keys. */
export function kharif2Keys(crop: ChoiceCrop): string[] {
  return placeRows(crop.id).map(r => `${crop.id}@${r[0]}`);
}

/** Days with 50 mm or more of rain while the crop is in the field (median of the replayed seasons), or null. */
export function heavyRainDays(key: string): number | null {
  const at = key.indexOf('@');
  if (at < 0) return null;
  const row = placeRows(key.slice(0, at)).find(r => r[0] === key.slice(at + 1));
  return row && row.length > 7 ? (row[7] as number) : null;
}

export function isFit(fit: Fit): fit is { key: string } {
  return 'key' in fit;
}

/**
 * Every crop a farmer can ask for at the current place: its window, and after which Aman varieties it fits with
 * its irrigation need on the first sowing date (winter crops), or its own irrigation need (Kharif-1 crops).
 */
export function cropMenu() {
  return CHOICE_CROPS.filter(c => c.aliases.length).map(crop => {
    const facts = replayFacts(crop.id);
    const base = {
      id: crop.id,
      season: crop.season,
      cropBangla: crop.cropBangla,
      cropEnglish: crop.crop,
      varietyBangla: crop.varietyBangla,
      isLegume: crop.isLegume,
      alsoSummer: Boolean(crop.alsoCovers?.length),
      incomeData: crop.illustrativeGrossMarginTkPerHa !== null,
    };
    if (crop.season !== 'Rabi') {
      const row = placeRows(crop.id)[0];
      return { ...base, window: facts?.window ?? null, netIrrigationMm: row ? row[2] : null, afterAman: [] as Array<{ aman: string; sowing: MonthDay }> };
    }
    const afterAman = Object.keys(AMAN_CATALOG).flatMap(aman => {
      const record = LOC.aman[aman];
      const fit = record ? rabiFit(crop, record.fieldFree, record.maturity) : null;
      return fit && isFit(fit) ? [{ aman, sowing: recordFor(fit.key)!.sowing, netIrrigationMm: recordFor(fit.key)!.netIrrigationMm }] : [];
    });
    const window = facts?.window ?? (crop.releaseKeys ? LOC.rabi[crop.releaseKeys[0]]?.sowingWindow ?? null : null);
    return { ...base, window, netIrrigationMm: afterAman[0]?.netIrrigationMm ?? null, afterAman };
  });
}
