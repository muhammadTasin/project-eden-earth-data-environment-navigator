/**
 * What a field's land type allows in the year, and how often the haor's flash floods came before a harvest.
 *
 * Land types follow SRDI's classes by normal monsoon flood depth: high land stays above the flood, medium high land
 * floods 0-90 cm, medium low 90-180 cm, low 180-300 cm and very low deeper. Where water stands over 180 cm from June
 * to November, T. Aman and every other monsoon crop drown, a crop sown before the monsoon is caught by the rising water,
 * and the field is free only when the water leaves. BRRI's haor guidance puts Boro seedbeds on 25 October-7 November
 * with 30-40-day seedlings (BRRI dhan102 and dhan118 factsheets, research/crops/brri_rice_varieties.csv), so low land
 * is taken as free from 1 December and very low land from 15 December.
 *
 * Where NASA's OPERA radar saw the monsoon water cover at least a tenth of the upazila in 2025, low land is free when
 * 80% of that water had drained and very low land when 90% had (research/explore/opera_water.py), kept between
 * 1 November and 31 January. Elsewhere the radar's "monsoon water" is mostly flooded paddy, so the defaults stay.
 */
import type { LandType } from '@project-eden/contracts';
import type { MonthDay } from './release_types.ts';
import { LOC, profileData } from './location.ts';
import { seasonDay } from '../bn.ts';

export interface LandRules {
  aman: boolean; // T. Aman can be transplanted
  kharif2: boolean; // an upland monsoon crop (soybean, mungbean, sesame) survives: high land only, where no water stands
  kharif1: boolean; // a crop between the winter crop and the monsoon is harvested before the land floods
  ready: MonthDay | null; // when the water leaves a field that stood under it all monsoon; null on land that drains
}

/** The OPERA share of the upazila the monsoon water must cover before its drain date stands for the land's. */
export const OPERA_MIN_EXTRA = 0.1;

/** When NASA OPERA radar saw this upazila's low (or very low) land drain in 2025, or null to keep the default. */
export function radarReady(landType: LandType): MonthDay | null {
  const w = LOC.local.opera;
  const iso = landType === 'very_low' ? w?.drained90 : landType === 'low' ? w?.drained80 : null;
  if (!w || !iso || w.extra < OPERA_MIN_EXTRA) return null;
  const md = iso.slice(5) as MonthDay;
  const day = seasonDay(md);
  return day < seasonDay('11-01') ? '11-01' : day > seasonDay('01-31') ? '01-31' : md;
}

export function landRules(landType: LandType): LandRules {
  const deep = landType === 'low' || landType === 'very_low';
  return {
    aman: !deep,
    kharif2: landType === 'high',
    kharif1: !deep,
    ready: radarReady(landType) ?? (landType === 'very_low' ? '12-15' : landType === 'low' ? '12-01' : null),
  };
}

/** The seven haor districts, whose low land the flash floods from the Meghalaya hills reach in April and May. */
export const HAOR_DISTRICTS = new Set(['Sunamganj', 'Netrakona', 'Kishoreganj', 'Habiganj', 'Sylhet', 'Maulvibazar', 'Brahamanbaria']);

/** A crop harvested after the first upstream burst in this share of springs or more is not offered on haor low land. */
export const FLASH_FLOOD_LIMIT = 0.4;

export function flashFloodExposed(landType: LandType): boolean {
  return HAOR_DISTRICTS.has(LOC.district) && (landType === 'medium_low' || landType === 'low' || landType === 'very_low');
}

/** True when a crop harvested on `harvest` met the haor's flash floods in too many springs to offer on this land. */
export function harvestTooLate(landType: LandType, harvest: MonthDay): boolean {
  const risk = flashFloodExposed(landType) ? flashFloodRisk(harvest) : null;
  return Boolean(risk && risk.caught / risk.seasons >= FLASH_FLOOD_LIMIT);
}

export interface FlashFloodRisk {
  caught: number; // springs in which the first upstream burst came before the harvest
  seasons: number;
  years: number[];
  burstMm: number;
  floodYears: number[]; // years FFWC reported flash floods before mid-May
  source: string;
}

/**
 * In how many springs of 2001-2025 the first upstream burst (100 mm or more in 3 days over the Meghalaya hills, GPM
 * IMERG) came before a crop harvested on `harvest`; every flash flood FFWC reported in those years followed one.
 * A harvest from October to mid-March is outside the flash-flood season (null); one from June to September comes
 * after every burst of the spring.
 */
export function flashFloodRisk(harvest: MonthDay): FlashFloodRisk | null {
  const data = profileData().haorFlashFlood;
  const month = Number(harvest.slice(0, 2));
  if (!data || month >= 10 || month < 3 || (month === 3 && Number(harvest.slice(3)) < 15)) return null;
  const years = Object.entries(data.firstBurst)
    .filter(([, burst]) => burst !== null && (month >= 6 || seasonDay(burst) <= seasonDay(harvest)))
    .map(([year]) => Number(year));
  return {
    caught: years.length,
    seasons: Object.keys(data.firstBurst).length,
    years,
    burstMm: data.burstMm,
    floodYears: data.floodYears,
    source: data.source,
  };
}
