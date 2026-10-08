/**
 * This week in the field: crop-stage alerts from the daily NASA update and a 7-day forecast.
 *
 * The numbers come from research/live/field_weather.py (one `field` record per upazila in the daily file): NASA
 * POWER reference evapotranspiration, GPM IMERG rain, a rainfed paddy's standing water from the replay's water balance,
 * and Open-Meteo's forecast (a weather model, not NASA). Each rule below fires only while its crop is at the stage
 * it guards, taken from the crop calendar the advice uses:
 *   - Aman dry spell: 5 or more days with no standing water from 20 days before to 10 days after flowering is the
 *     replay's rescue-irrigation season; counted here over the last 14 days and the next 7.
 *   - Heat at rice flowering: 35 C or more from about 9 days before to 7 days after flowering (spikelet sterility,
 *     Yoshida 1981; BRRI); keep 5-7 cm of water until the grain hardens (DAE heat-wave advisories).
 *   - Cold on Boro seedbeds, 15 November to 15 February: a night at 10 C or below (13 C to watch); cover the seedbed
 *     with clear polythene at night and keep 3-5 cm of water in it (BRRI and DAE cold-wave advice).
 *   - Heat at wheat grain filling: 30 C or more in the 5 weeks before harvest (Wardlaw and Wrigley 1994).
 *   - Boro alternate wetting and drying (AWD): from 10 days after transplanting to 2 weeks before harvest, except a
 *     week either side of flowering; irrigate only when the water in the field pipe is 15 cm below the surface (IRRI).
 *   - Flood water now (NASA OPERA DSWx-HLS, research/live/flood_now.py), 1 July to 31 October where Aman is grown:
 *     10% of the land seen under water where it is normally dry in winter is watch, 25% high. Until 10 September: replant
 *     photoperiod-sensitive BR22, BR23, BRRI dhan46 or 54 by 15 September once the water leaves, from floating or
 *     tray seedbeds or spare tillers; ordinary Aman dies after about 5 days under water, BRRI dhan51, 52 and 79
 *     survive about 2 weeks (DAE agromet advisories, 2020 and 2024; BRRI). Later, plan the winter crop instead.
 */
import { bnDate, bnDigits, enDate } from './bn.ts';

export interface FieldWeather {
  through: string; // the last day in the paddy balance (yesterday when the forecast filled POWER's lag)
  observedTo: string; // the last day of NASA POWER
  rainSource: string | null;
  rain7: number | null;
  rain14: number | null;
  et0Mm7: number | null;
  tmax3: number | null;
  tmin3: number | null;
  paddyWaterMm: number | null;
  /** '1' for a day ending with no standing water, oldest first, ending on `through`. */
  paddyDry14: string | null;
  forecast: { from: string; tmax: Array<number | null>; tmin: Array<number | null>; rain: Array<number | null>; et0: Array<number | null> } | null;
  /** The same for the next 7 days with the forecast's rain and no irrigation. */
  paddyDryNext7: string | null;
}

/** The crops in the field this year, with their calendar days ('MM-DD'). */
export interface FieldCrops {
  aman?: { variety: string; varietyBangla: string; flowering: string } | null;
  boro?: { variety: string; varietyBangla: string; transplant: string; harvest: string } | null;
  wheat?: { sowing: string; harvest: string } | null;
  /** Boro is grown here, so its seedbeds stand from mid-November to mid-February. */
  boroSeedbed?: boolean;
}

export type FieldAlertId = 'flood_now' | 'aman_dry_spell' | 'rice_heat' | 'cold_seedbed' | 'wheat_heat' | 'boro_awd';

/** Flood water now from NASA OPERA DSWx-HLS (research/live/flood_now.py). */
export interface FloodNow {
  date: string | null; // the mean date of the latest clear looks
  seenShare: number; // the share of the upazila seen clear both now and in February
  floodShare: number | null; // water now on land normally dry in winter (not water in both December and February), of the land seen
  waterNow: number | null;
  waterDry: number | null;
  /** OPERA radar, 2025: water above the dry-season share around the same date a year earlier (reads higher than optical). */
  lastYearRadar?: number | null;
}
export type FieldAlertLevel = 'high' | 'watch' | 'advice' | 'clear';
export interface FieldAlert {
  id: FieldAlertId;
  level: FieldAlertLevel;
  crop: 'aman' | 'boro' | 'wheat';
  titleBangla: string;
  titleEnglish: string;
  textBangla: string;
  textEnglish: string;
  /** One short line for the SMS and the call; empty when there is nothing to do. */
  smsBangla: string;
  numbers: Record<string, number | string | null>;
}

export const FIELD_ALERT_ORDER: FieldAlertId[] = ['flood_now', 'aman_dry_spell', 'rice_heat', 'cold_seedbed', 'wheat_heat', 'boro_awd'];
const LEVEL_ORDER: FieldAlertLevel[] = ['high', 'watch', 'advice', 'clear'];

export const DRY_DAYS_RESCUE = 5;
const FLOWER_BEFORE = 20, FLOWER_AFTER = 10;
export const RICE_HEAT_C = 35, RICE_HEAT_WATCH_C = 34;
export const COLD_C = 10, COLD_WATCH_C = 13;
export const WHEAT_HEAT_C = 30;
export const FLOOD_WATCH = 0.10, FLOOD_HIGH = 0.25;
const KC_RICE = 1.2, SEEPAGE = 2;
const RAIN_HOLD_MM = 20; // rain in the next 3 days that is worth waiting for

export const FIELD_ALERT_METHOD = {
  amanDrySpell: `A dry day ends with no standing water in the replay's rainfed paddy (Kc 1.2, 2 mm/day seepage, 10 cm bunds); ${DRY_DAYS_RESCUE} or more from ${FLOWER_BEFORE} days before to ${FLOWER_AFTER} days after flowering, over the last 14 days and the forecast's next 7, means a rescue irrigation (high when the field is dry now or within 3 days); 2-4 is watch.`,
  riceHeat: `Rice from about 9 days before to 7 days after flowering: ${RICE_HEAT_C} C or more in the last 3 days or the next 5 is high, ${RICE_HEAT_WATCH_C} C watch (spikelet sterility, Yoshida 1981; BRRI). Keep 5-7 cm of water until the grain hardens (DAE heat-wave advisories).`,
  coldSeedbed: `Boro seedbeds, 15 November to 15 February: a minimum of ${COLD_C} C or less in the last 3 days or the next 3 is high, ${COLD_WATCH_C} C watch. Cover the seedbed with clear polythene at night and keep 3-5 cm of water in it (BRRI and DAE cold-wave advice, as reported).`,
  wheatHeat: `Wheat in the 5 weeks before harvest: ${WHEAT_HEAT_C} C or more in the last 3 days or the next 5 (grain-filling heat, Wardlaw and Wrigley 1994). Irrigation helps less than sowing on time, so this is a watch.`,
  boroAwd: 'Boro from 10 days after transplanting to 2 weeks before harvest, except a week either side of flowering: irrigate only when the water in a perforated field pipe is 15 cm below the soil surface (IRRI safe AWD, up to about 30% less water without yield loss). Daily loss = 1.2 x reference ET + 2 mm seepage.',
  floodNow: `NASA OPERA DSWx-HLS (Landsat and Sentinel-2, 30 m read at 120 m): each pixel's latest clear look in the last 24 days against December 2025 and February 2026 (lasting water is water in both, so Boro paddies do not count); ${FLOOD_WATCH * 100}% of the land seen under water where it is normally dry in winter is watch, ${FLOOD_HIGH * 100}% high, 1 July to 31 October where Aman is grown. Replanting: BR22, BR23, BRRI dhan46 or 54 until 15 September (DAE agromet advisories 2020 and 2024); ordinary Aman dies after about 5 days under water, BRRI dhan51, 52 and 79 survive about 2 weeks (BRRI). Cloud hides the monsoon from optical satellites, and OPERA's radar maps over Bangladesh stop on 16 July 2026.`,
  temperatures: 'NASA POWER (0.5 degree) for past days and Open-Meteo for the forecast are grid values; a field can be 1-2 C hotter or colder.',
};

const DAY = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const md = (t: number) => new Date(t).toISOString().slice(5, 10);
const r0 = (x: number) => Math.round(x);
const sum = (xs: Array<number | null> | undefined, n = xs?.length ?? 0) => (xs ? xs.slice(0, n).reduce<number>((a, b) => a + (b ?? 0), 0) : 0);
const maxOf = (xs: Array<number | null | undefined>) => {
  const v = xs.filter((x): x is number => typeof x === 'number');
  return v.length ? Math.max(...v) : null;
};
const minOf = (xs: Array<number | null | undefined>) => {
  const v = xs.filter((x): x is number => typeof x === 'number');
  return v.length ? Math.min(...v) : null;
};

/** The occurrence of a calendar day nearest to `t`. */
function nearest(monthDay: string, t: number): number {
  const [m, d] = monthDay.split('-').map(Number);
  const y = new Date(t).getUTCFullYear();
  return [y - 1, y, y + 1].map(yy => Date.UTC(yy, m - 1, d)).reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a));
}
/** The first occurrence of a calendar day on or after `t`. */
function onOrAfter(monthDay: string, t: number): number {
  const [m, d] = monthDay.split('-').map(Number);
  const y = new Date(t).getUTCFullYear();
  return [y, y + 1].map(yy => Date.UTC(yy, m - 1, d)).find(x => x >= t)!;
}
/** The day of the hottest or coldest forecast value in the first n days. */
function dayOf(values: Array<number | null> | undefined, from: string | undefined, n: number, pick: 'max' | 'min'): string | null {
  if (!values || !from) return null;
  let best = -1;
  values.slice(0, n).forEach((v, k) => {
    if (typeof v !== 'number') return;
    if (best < 0 || (pick === 'max' ? v > (values[best] as number) : v < (values[best] as number))) best = k;
  });
  return best < 0 ? null : md(utc(from) + best * DAY);
}

function amanDrySpell(t: number, aman: NonNullable<FieldCrops['aman']>, w: FieldWeather): FieldAlert | null {
  const F = nearest(aman.flowering, t);
  const start = F - FLOWER_BEFORE * DAY, end = F + FLOWER_AFTER * DAY;
  if (t < start - 7 * DAY || t > end || !w.paddyDry14) return null;
  const through = utc(w.through);
  const past = [...w.paddyDry14];
  const pastIn = past.filter((f, k) => {
    const day = through - (past.length - 1 - k) * DAY;
    return f === '1' && day >= start && day <= end;
  }).length;
  const next = w.paddyDryNext7 ? [...w.paddyDryNext7] : [];
  const nextIn = next.filter((f, k) => {
    const day = utc(w.forecast!.from) + k * DAY;
    return f === '1' && day >= start && day <= end;
  }).length;
  const total = pastIn + nextIn;
  const dryNow = (w.paddyWaterMm ?? 1) <= 0;
  const drySoon = next.slice(0, 3).includes('1');
  const level: FieldAlertLevel = total >= DRY_DAYS_RESCUE && (dryNow || drySoon) ? 'high' : total >= 2 ? 'watch' : 'clear';
  const dryPast = past.filter(f => f === '1').length;
  const rain7 = w.forecast ? r0(sum(w.forecast.rain, 7)) : null;
  const stage = t < F - 7 * DAY ? { bn: 'থোড় আসার পর্যায়ে', en: 'at booting' } : t <= F + 7 * DAY ? { bn: 'ফুল আসার পর্যায়ে', en: 'at flowering' } : { bn: 'দানা পুষ্ট হওয়ার পর্যায়ে', en: 'filling grain' };
  const when = { bn: bnDate(md(F)), en: enDate(md(F)) };
  const water = w.paddyWaterMm ?? 0;
  const rainBy = w.rainSource?.includes('IMERG') ? 'GPM IMERG' : 'NASA POWER';
  const numbers = { floweringDate: md(F), dryDaysInWindow: total, dryDaysPast: pastIn, dryDaysAhead: nextIn, paddyWaterMm: w.paddyWaterMm, rain14: w.rain14, forecastRain7: rain7, rainSource: w.rainSource };
  const head = { bn: `${aman.varietyBangla} এখন ${stage.bn} (ফুল আসে ~${when.bn})।`, en: `${aman.variety} is ${stage.en} now (flowering ~${when.en}).` };
  const fc = rain7 !== null ? { bn: ` পূর্বাভাসে সামনের ৭ দিনে বৃষ্টি ${bnDigits(rain7)} মিমি।`, en: ` The forecast brings ${rain7} mm of rain in the next 7 days.` } : { bn: '', en: '' };
  if (level === 'high') {
    return {
      id: 'aman_dry_spell', level, crop: 'aman', numbers,
      titleBangla: 'আমনে খরা: এই সপ্তাহে একবার সেচ', titleEnglish: 'Aman dry spell: one irrigation this week',
      textBangla: `${head.bn} নাসার বৃষ্টি (${rainBy}) ও পানির হিসাবে গত ১৪ দিনের ${bnDigits(dryPast)} দিন খেতে দাঁড়ানো পানি ছিল না।${fc.bn} এই সপ্তাহে একবার সেচ দিন (প্রায় ৫ সেমি), নইলে ধান চিটা হতে পারে।`,
      textEnglish: `${head.en} By NASA rain (${rainBy}) and the field's water balance, the paddy had no standing water on ${dryPast} of the last 14 days.${fc.en} Give one irrigation of about 5 cm this week, before the grains go empty.`,
      smsBangla: `আমন ${stage.bn}: খেত শুকনো, এই সপ্তাহে একবার সেচ দিন।`,
    };
  }
  if (level === 'watch') {
    return {
      id: 'aman_dry_spell', level, crop: 'aman', numbers,
      titleBangla: 'আমনের খেত শুকাচ্ছে', titleEnglish: 'The Aman field is drying',
      textBangla: `${head.bn} হিসাবে খেতের পানি ${water > 0 ? `প্রায় ${bnDigits(r0(water))} মিমি` : 'শেষ'}।${fc.bn} খেতে পানি আছে কি না দেখুন; পানি না থাকলে আর ২–৩ দিনে বৃষ্টি না হলে একবার সেচ দিন।`,
      textEnglish: `${head.en} The water balance puts the field's standing water at ${water > 0 ? `about ${r0(water)} mm` : 'none'}.${fc.en} Check the field; if the water has gone and no rain comes in 2-3 days, give one irrigation.`,
      smsBangla: `আমন ${stage.bn}: খেতে পানি না থাকলে সেচ দিন।`,
    };
  }
  return {
    id: 'aman_dry_spell', level, crop: 'aman', numbers,
    titleBangla: 'আমনে সেচ লাগবে না', titleEnglish: 'No Aman irrigation needed',
    textBangla: `${head.bn} বৃষ্টি ও খেতের পানি যথেষ্ট; এই সপ্তাহে সেচ লাগবে না।`,
    textEnglish: `${head.en} Rain and the field's water are enough; no irrigation is needed this week.`,
    smsBangla: '',
  };
}

function riceHeat(t: number, crop: 'aman' | 'boro', F: number, name: { bn: string; en: string }, w: FieldWeather): FieldAlert | null {
  if (t + 4 * DAY < F - 9 * DAY || t > F + 7 * DAY) return null;
  const ahead = w.forecast?.tmax.slice(0, 5) ?? [];
  const hot = maxOf([...ahead, w.tmax3]);
  if (hot === null || hot < RICE_HEAT_WATCH_C) return null;
  const level: FieldAlertLevel = hot >= RICE_HEAT_C ? 'high' : 'watch';
  const day = maxOf(ahead) === hot ? dayOf(w.forecast?.tmax, w.forecast?.from, 5, 'max') : null;
  const when = day ? { bn: ` (${bnDate(day)})`, en: ` (${enDate(day)})` } : { bn: '', en: '' };
  return {
    id: 'rice_heat', level, crop,
    numbers: { tmaxC: hot, day, floweringDate: md(F) },
    titleBangla: `${name.bn} ফুলে গরম`, titleEnglish: `Heat at ${name.en} flowering`,
    textBangla: `${name.bn} ফুল আসার সময় (~${bnDate(md(F))}) তাপমাত্রা ${bnDigits(r0(hot))}° সে.${when.bn}; ৩৫°-এর বেশি হলে ধান চিটা হয়। খেতে ৫–৭ সেমি পানি রাখুন, দানা শক্ত হওয়া পর্যন্ত খেত শুকাতে দেবেন না।`,
    textEnglish: `${name.en} flowers around ${enDate(md(F))} and the temperature reaches ${r0(hot)} C${when.en}; above 35 C rice flowers go empty. Keep 5-7 cm of water in the field and do not let it dry until the grain hardens.`,
    smsBangla: 'গরম: ধানখেতে ৫-৭ সেমি পানি রাখুন।',
  };
}

function coldSeedbed(t: number, w: FieldWeather): FieldAlert | null {
  const d = md(t);
  if (!(d >= '11-15' || d <= '02-15')) return null;
  const ahead = w.forecast?.tmin.slice(0, 3) ?? [];
  const cold = minOf([...ahead, w.tmin3]);
  if (cold === null || cold > COLD_WATCH_C) return null;
  const level: FieldAlertLevel = cold <= COLD_C ? 'high' : 'watch';
  const day = minOf(ahead) === cold ? dayOf(w.forecast?.tmin, w.forecast?.from, 3, 'min') : null;
  const when = day ? { bn: ` (${bnDate(day)})`, en: ` (${enDate(day)})` } : { bn: '', en: '' };
  return {
    id: 'cold_seedbed', level, crop: 'boro',
    numbers: { tminC: cold, day },
    titleBangla: 'শীতে বোরোর বীজতলা', titleEnglish: 'Cold on Boro seedbeds',
    textBangla: `রাতের তাপমাত্রা ${bnDigits(r0(cold))}° সে. পর্যন্ত${when.bn}। ${level === 'high' ? 'বোরোর বীজতলা রাতে স্বচ্ছ পলিথিনে ঢেকে দিন, শীত বেশি দিন থাকলে দিনেও ঢেকে রাখুন; বীজতলায় ৩–৫ সেমি পানি রাখুন। শৈত্যপ্রবাহ না কাটা পর্যন্ত চারা রোপণ করবেন না; চারা হলুদ হলে কৃষি কর্মকর্তার পরামর্শ নিন।' : 'বীজতলার চারা হলুদ হচ্ছে কি না দেখুন; আরও ঠান্ডা এলে রাতে পলিথিনে ঢেকে দিন।'}`,
    textEnglish: `Night temperature down to ${r0(cold)} C${when.en}. ${level === 'high' ? 'Cover the Boro seedbed with clear polythene at night, day and night if the cold lasts, and keep 3-5 cm of water in it. Do not transplant until the cold spell passes; if seedlings turn yellow, ask the agriculture officer.' : 'Watch the seedlings for yellowing; cover the seedbed at night if it turns colder.'}`,
    smsBangla: level === 'high' ? 'শীত: রাতে বোরোর বীজতলা পলিথিনে ঢাকুন।' : '',
  };
}

function wheatHeat(t: number, wheat: NonNullable<FieldCrops['wheat']>, w: FieldWeather): FieldAlert | null {
  const H = onOrAfter(wheat.harvest, nearest(wheat.sowing, t));
  if (t + 4 * DAY < H - 35 * DAY || t > H - 7 * DAY) return null;
  const ahead = w.forecast?.tmax.slice(0, 5) ?? [];
  const hot = maxOf([...ahead, w.tmax3]);
  if (hot === null || hot < WHEAT_HEAT_C) return null;
  return {
    id: 'wheat_heat', level: 'watch', crop: 'wheat',
    numbers: { tmaxC: hot, harvestDate: md(H) },
    titleBangla: 'গমের দানায় গরম', titleEnglish: 'Heat while wheat fills grain',
    textBangla: `গমের দানা পুষ্ট হওয়ার সময়ে তাপমাত্রা ${bnDigits(r0(hot))}° সে.; ৩০°-এর বেশি হলে দানা চুপসে যায়। শেষ সেচ বাকি থাকলে এখনই দিন, মাটি শুকাতে দেবেন না। আগামী বছর ৩০ নভেম্বরের মধ্যে বুনলে দানা গরমের আগে পুষ্ট হয়।`,
    textEnglish: `Wheat is filling grain and the temperature reaches ${r0(hot)} C; above 30 C the grain shrivels. If the last irrigation is still due, give it now and keep the soil moist. Sowing by 30 November next year fills the grain before the heat.`,
    smsBangla: 'গমে গরম: শেষ সেচ বাকি থাকলে এখনই দিন।',
  };
}

function boroAwd(t: number, boro: NonNullable<FieldCrops['boro']>, w: FieldWeather): FieldAlert | null {
  const T = nearest(boro.transplant, t);
  const H = onOrAfter(boro.harvest, T);
  const F = H - 30 * DAY;
  if (t < T + 10 * DAY || t > H - 14 * DAY) return null;
  const et0 = w.forecast ? sum(w.forecast.et0, 7) / 7 : w.et0Mm7;
  const loss = et0 !== null && et0 !== undefined ? KC_RICE * et0 + SEEPAGE : null;
  const rain3 = w.forecast ? r0(sum(w.forecast.rain, 3)) : null;
  const rain7 = w.forecast ? r0(sum(w.forecast.rain, 7)) : null;
  const numbers = { lossMmPerDay: loss !== null ? Math.round(loss * 10) / 10 : null, forecastRain3: rain3, forecastRain7: rain7, floweringDate: md(F) };
  if (Math.abs(t - F) <= 7 * DAY) {
    return {
      id: 'boro_awd', level: 'advice', crop: 'boro', numbers,
      titleBangla: 'বোরোতে ফুল: খেতে পানি রাখুন', titleEnglish: 'Boro flowering: keep water standing',
      textBangla: `${boro.varietyBangla}-এ ফুল আসার সময় (~${bnDate(md(F))})। ফুলের এক সপ্তাহ আগে থেকে এক সপ্তাহ পর পর্যন্ত খেতে প্রায় ৫ সেমি পানি রাখুন; এ সময় পানি শুকিয়ে সেচ (AWD) নয়।`,
      textEnglish: `${boro.variety} flowers around ${enDate(md(F))}. From a week before to a week after flowering keep about 5 cm of water standing; no alternate wetting and drying now.`,
      smsBangla: 'বোরোতে ফুল: খেতে ৫ সেমি পানি রাখুন।',
    };
  }
  const hold = rain3 !== null && rain3 >= RAIN_HOLD_MM;
  return {
    id: 'boro_awd', level: 'advice', crop: 'boro', numbers,
    titleBangla: hold ? 'বৃষ্টি আসছে: বোরোতে সেচ পিছিয়ে দিন' : 'বোরোতে পানি সাশ্রয় (AWD)', titleEnglish: hold ? 'Rain coming: hold the Boro irrigation' : 'Boro: alternate wetting and drying',
    textBangla: `${loss !== null ? `এই সপ্তাহে বোরো খেতের পানি দিনে প্রায় ${bnDigits(r0(loss))} মিমি কমবে` : 'বোরো খেতে পানি সাশ্রয় করুন'}${rain7 !== null ? `; পূর্বাভাসে ৭ দিনে বৃষ্টি ${bnDigits(rain7)} মিমি` : ''}। খেতে বসানো ছিদ্রযুক্ত পাইপে পানি মাটির ১৫ সেমি নিচে নামলে তবেই সেচ দিন, প্রায় ৫ সেমি পর্যন্ত; এতে ফলন না কমিয়ে প্রায় ৩০% পর্যন্ত পানি বাঁচে।${hold ? ` সামনের ৩ দিনে ${bnDigits(rain3!)} মিমি বৃষ্টির সম্ভাবনা: সেচ পিছিয়ে দিন।` : ''}`,
    textEnglish: `${loss !== null ? `This week the Boro field loses about ${r0(loss)} mm of water a day` : 'Save water in Boro'}${rain7 !== null ? `; the forecast brings ${rain7} mm of rain in 7 days` : ''}. Irrigate only when the water in the perforated field pipe is 15 cm below the soil surface, back to about 5 cm; IRRI finds up to about 30% less water without yield loss.${hold ? ` ${rain3} mm of rain is forecast in the next 3 days: hold the irrigation.` : ''}`,
    smsBangla: hold ? 'বৃষ্টি আসছে: বোরোতে সেচ পিছিয়ে দিন।' : 'বোরো: পাইপে পানি ১৫ সেমি নামলে তবেই সেচ দিন।',
  };
}

function floodNow(t: number, f: FloodNow, drained80: string | null | undefined): FieldAlert | null {
  const d = md(t);
  if (d < '07-01' || d > '10-31' || f.floodShare === null || f.floodShare < FLOOD_WATCH) return null;
  // About as much water as the same weeks of 2025 (radar, which reads higher) is the season, not an unusual flood
  const usual = typeof f.lastYearRadar === 'number' && f.floodShare <= f.lastYearRadar + 0.05;
  const level: FieldAlertLevel = f.floodShare >= FLOOD_HIGH && !usual ? 'high' : 'watch';
  const pct = r0(f.floodShare * 100);
  const lastYear = typeof f.lastYearRadar === 'number' ? r0(f.lastYearRadar * 100) : null;
  const when = f.date ? { bn: ` (${bnDate(f.date.slice(5))})`, en: ` (${enDate(f.date.slice(5))})` } : { bn: '', en: '' };
  const head = {
    bn: `নাসার OPERA উপগ্রহে${when.bn} উপজেলার দেখা জমির ${bnDigits(pct)}% পানির নিচে, যেখানে শীতে সাধারণত পানি থাকে না${lastYear !== null ? ` (গত বছর এই সময়ে রাডারে ${bnDigits(lastYear)}%${usual ? ', অর্থাৎ মৌসুমের স্বাভাবিক পানি' : ''})` : ''}।`,
    en: `NASA OPERA${when.en}: ${pct}% of the upazila's land seen is under water where it is normally dry in winter${lastYear !== null ? ` (${lastYear}% by radar at this time last year${usual ? ', so about the usual seasonal water' : ''})` : ''}.`,
  };
  const numbers = { floodSharePct: pct, seenSharePct: r0(f.seenShare * 100), lastYearRadarPct: lastYear, date: f.date, drained80: drained80 ?? null };
  const base = { id: 'flood_now' as const, level, crop: 'aman' as const, numbers, titleBangla: 'বন্যার পানি', titleEnglish: 'Flood water' };
  if (d <= '09-10') {
    return {
      ...base, titleBangla: 'বন্যার পর আমন', titleEnglish: 'Aman after the flood',
      textBangla: `${head.bn} সাধারণ আমন ৫ দিনের বেশি ডুবে থাকলে মরে যায়; ব্রি ধান৫১, ৫২ ও ৭৯ প্রায় ২ সপ্তাহ টেকে। ধান নষ্ট হলে পানি নামার পর ১৫ সেপ্টেম্বরের মধ্যে বিআর২২, বিআর২৩, ব্রি ধান৪৬ বা ৫৪ রোপণ করুন; উঁচু জমি না থাকলে ভাসমান বা ট্রে বীজতলায় চারা করুন, অথবা না-ডোবা খেতের গোছা থেকে ২-৩টি কুশি রেখে বাকিগুলো তুলে লাগান।`,
      textEnglish: `${head.en} Ordinary Aman dies after about 5 days under water; BRRI dhan51, 52 and 79 survive about 2 weeks. Where the crop is lost, replant once the water leaves with BR22, BR23, BRRI dhan46 or 54 by 15 September, raising seedlings in floating or tray seedbeds where no high land is free, or taking spare tillers from unflooded fields (leave 2-3 a hill).`,
      smsBangla: 'বন্যার পর: পানি নামলে বিআর২২, বিআর২৩ বা ব্রি ধান৪৬ রোপণ করুন।',
    };
  }
  if (d <= '09-30') {
    return {
      ...base,
      textBangla: `${head.bn} আমন আবার রোপণের সময় প্রায় শেষ (বিআর২২ ও ২৩ শুধু ১৫ সেপ্টেম্বর পর্যন্ত)। আমন নষ্ট হলে পানি নামামাত্র আগাম রবি ফসলের প্রস্তুতি নিন। যে ধান বেঁচে আছে, পানি নামার ৭ দিন পর পাতার পলি পরিষ্কার পানি ছিটিয়ে ধুয়ে দিন।`,
      textEnglish: `${head.en} It is late to replant Aman (BR22 and BR23 only until 15 September). Where the Aman is lost, prepare an early winter crop as soon as the land drains. Where the rice survived, spray clean water to wash the silt off the leaves a week after the water leaves.`,
      smsBangla: 'বন্যায় আমন নষ্ট হলে আগাম রবি ফসলের প্রস্তুতি নিন।',
    };
  }
  const drain = drained80
    ? { bn: ` ২০২৫ মৌসুমে এই উপজেলার বর্ষার পানির ৮০% নেমেছিল ~${bnDate(drained80.slice(5))} (নাসার OPERA রাডার)।`, en: ` In the 2025 season, 80% of this upazila's monsoon water had drained by ~${enDate(drained80.slice(5))} (NASA OPERA radar).` }
    : { bn: '', en: '' };
  return {
    ...base,
    textBangla: `${head.bn} জমির পানি নামলেই রবি ফসল বুনুন, রস থাকতে থাকতে।${drain.bn}`,
    textEnglish: `${head.en} Sow the winter crop as each field drains, while the soil still holds water.${drain.en}`,
    smsBangla: 'জমির পানি নামলেই রবি ফসল বুনুন।',
  };
}

/** This week's alerts for the crops in the field, the most serious first; an empty list outside every crop's window. */
export function fieldAlerts(todayIso: string, crops: FieldCrops, w: FieldWeather | null | undefined,
  extra: { flood?: FloodNow | null; drained80?: string | null } = {}): FieldAlert[] {
  const t = utc(todayIso);
  const out: FieldAlert[] = [];
  if (crops.aman && extra.flood) {
    const f = floodNow(t, extra.flood, extra.drained80);
    if (f) out.push(f);
  }
  if (!w) return out;
  if (crops.aman) {
    let a = amanDrySpell(t, crops.aman, w);
    // Flood water on part of the upazila and a dry paddy at the district point: low fields are wet, so only the higher
    // fields that have dried need the irrigation, and it is a watch rather than an order
    if (a && (a.level === 'high' || a.level === 'watch') && out.some(x => x.id === 'flood_now')) {
      a = {
        ...a, level: 'watch',
        textBangla: `${a.textBangla} উপজেলার নিচু জমিতে বন্যার পানি আছে (নাসার OPERA); শুধু যে উঁচু খেত শুকিয়ে গেছে সেখানে সেচ দিন।`,
        textEnglish: `${a.textEnglish} Low land in the upazila is under flood water (NASA OPERA); irrigate only the higher fields that have dried.`,
        smsBangla: 'উঁচু খেত শুকিয়ে গেলে একবার সেচ দিন।',
      };
    }
    if (a) out.push(a);
    const h = riceHeat(t, 'aman', nearest(crops.aman.flowering, t), { bn: 'আমন', en: 'Aman' }, w);
    if (h) out.push(h);
  }
  if (crops.boro) {
    const T = nearest(crops.boro.transplant, t);
    const h = riceHeat(t, 'boro', onOrAfter(crops.boro.harvest, T) - 30 * DAY, { bn: 'বোরো', en: 'Boro' }, w);
    if (h) out.push(h);
  }
  if (crops.boroSeedbed || crops.boro) {
    const c = coldSeedbed(t, w);
    if (c) out.push(c);
  }
  if (crops.wheat) {
    const h = wheatHeat(t, crops.wheat, w);
    if (h) out.push(h);
  }
  if (crops.boro) {
    const a = boroAwd(t, crops.boro, w);
    if (a) out.push(a);
  }
  return out.sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) || FIELD_ALERT_ORDER.indexOf(a.id) - FIELD_ALERT_ORDER.indexOf(b.id));
}

/** The most serious level among alerts with this id, for the map; null when the rule is silent. */
export function worstLevel(alerts: FieldAlert[], id: FieldAlertId): FieldAlertLevel | null {
  const levels = alerts.filter(a => a.id === id).map(a => a.level);
  return levels.length ? LEVEL_ORDER.find(l => levels.includes(l)) ?? null : null;
}
