/**
 * Which place the engine is advising. Talanda union (Tanore) uses the detailed pilot release; every other upazila
 * uses its district's 25-season replay (research/explore/national_replay.py), with "not available yet" where a
 * dataset exists only for the pilots. Every place also carries its upazila's local profile
 * (research/export/upazila_profile.py): the land type from NASA NASADEM and Landsat surface water with BRRI's survey
 * of what farmers grow, those cropping patterns, and its district's BBS yields. `LOC` always holds the current place;
 * `withPlace` switches it for one call.
 */
import fs from 'node:fs';
import type { LandType } from '@project-eden/contracts';
import { TALANDA_SRDI, TANORE_ADVISORIES, TANORE_AMAN_REPLAY, TANORE_CONDITIONS, TANORE_RABI_REPLAY } from './tanore_replay_data.ts';

/** An upazila's land, what its farmers grow now, and its district's yields. */
export interface LocalProfile {
  /** Default land type and the evidence behind it; null where the land layers do not cover the upazila. */
  land: {
    type: LandType;
    seasonalWater: number; // share of the upazila under water 3-6 months a year (Landsat, 2021)
    wetAllYear: number; // under water longer: rivers, ponds, shrimp ghers
    neverWet: number;
    elevP10M: number;
    elevMedianM: number;
    basis: string[]; // 'water', 'pattern', 'elevation'
  } | null;
  /** The upazila's top cropping patterns and their share of its cropped land (BRRI survey, 2014-15). */
  patterns: Array<[string, number]>;
  boroFallowFallowPct: number | null;
  intensityPct: number | null;
  /** District yields: crop id -> [t/ha, or null where the district grows too little to say; hectares in the latest year]. */
  yields: Record<string, [number | null, number]>;
  /** SRDI's May 2009 salinity survey (coastal upazilas only): shares of the cultivated land in classes S1-S5. */
  salinity: { cultivatedHa: number; salineShare: number; strongShare: number; classShares: number[] } | null;
}

interface ProfileFile {
  sources: Record<string, string>;
  landRule: string;
  upazilas: Record<string, {
    land?: LocalProfile['land']; patterns?: Array<[string, number]>; boroFallowFallowPct?: number; intensityPct?: number;
    salinity?: LocalProfile['salinity'];
  }>;
  salinityClassesDsM: number[];
  saltTolerance: Record<string, { threshold: number; slope: number; rating: string; basis: string; note: string }>;
  districts: Record<string, Record<string, [number | null, number]>>;
  national: Record<string, {
    yield: number; lowYield: number | null; priceLowRatio: number | null; value: number | null; valueSource: string | null;
    years: string; areaHa: number;
  }>;
  haorFlashFlood: { burstMm: number; firstBurst: Record<string, string | null>; floodYears: number[]; noFloodYears: number[]; floodYearsCaught: string; source: string } | null;
}

let profile: ProfileFile | null = null;
export function profileData(): ProfileFile {
  if (!profile) {
    const file = new URL('./upazila_profile.json', import.meta.url);
    profile = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, 'utf8'))
      : { sources: {}, landRule: '', upazilas: {}, districts: {}, national: {}, haorFlashFlood: null, salinityClassesDsM: [], saltTolerance: {} };
  }
  return profile!;
}

export function localProfile(upazilaId: string, district: string): LocalProfile {
  const data = profileData();
  const u = data.upazilas[upazilaId] ?? {};
  return {
    land: u.land ?? null,
    patterns: u.patterns ?? [],
    boroFallowFallowPct: u.boroFallowFallowPct ?? null,
    intensityPct: u.intensityPct ?? null,
    yields: data.districts[district] ?? {},
    salinity: u.salinity ?? null,
  };
}

export interface Place {
  id: string;
  kind: 'pilot' | 'upazila';
  nameEnglish: string;
  nameBangla: string;
  upazila: string;
  district: string;
  aman: Record<string, any>;
  rabi: Record<string, any>;
  srdi: Record<string, any>;
  conditions: Record<string, any>;
  advisories: Record<string, any> | null;
  dataNote: string;
  local: LocalProfile;
  /** The land type assumed when the farmer does not say: the SRDI card for the pilot, the land layers elsewhere. */
  defaultLandType: LandType;
}

export const PILOT_ID = 'talanda_tanore';

const PILOT: Place = {
  id: PILOT_ID, kind: 'pilot', nameEnglish: 'Talanda union', nameBangla: 'তালন্দ ইউনিয়ন', upazila: 'Tanore', district: 'Rajshahi',
  aman: TANORE_AMAN_REPLAY, rabi: TANORE_RABI_REPLAY, srdi: TALANDA_SRDI, conditions: TANORE_CONDITIONS, advisories: TANORE_ADVISORIES,
  dataNote: 'Pilot release: the replay at the Talanda point, the SRDI Talanda card, SMAP and MODIS checks.',
  local: localProfile('ADM3_Tanore', 'Rajshahi'),
  defaultLandType: 'medium_high',
};

export const LOC: Place = { ...PILOT };

let national: any = null;
function nationalData() {
  if (!national) national = JSON.parse(fs.readFileSync(new URL('./national_replay.json', import.meta.url), 'utf8'));
  return national;
}

/** NASA MODIS winter greenness and crops a year at each upazila's centre (research/explore/national_greenness.py). */
let greenness: any = null;
function greennessFor(id: string) {
  if (!greenness) {
    const file = new URL('./greenness_upazila.json', import.meta.url);
    greenness = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).upazilas : {};
  }
  return greenness[id] ?? null;
}

/** NASA GLDAS-2.2 (GRACE-assimilated) groundwater decline across the districts, mm a year: the median and the steepest. */
let decline: { median: number; steepest: number } | null = null;
export function groundwaterDeclineRange(): { median: number; steepest: number } {
  if (!decline) {
    const falls = Object.values(nationalData().districts as Record<string, any>)
      .map(d => d.conditions?.groundwater?.trendMmPerYear)
      .filter((t): t is number => typeof t === 'number')
      .map(t => Math.max(0, -t))
      .sort((x, y) => x - y);
    const mid = falls.length / 2;
    decline = {
      median: falls.length % 2 ? falls[Math.floor(mid)] : (falls[mid - 1] + falls[mid]) / 2,
      steepest: falls[falls.length - 1],
    };
  }
  return decline;
}

/** Every upazila the engine can advise: id, name and district. */
export function listPlaces(): Array<{ id: string; name: string; district: string }> {
  return nationalData().upazilas;
}

/** The pilot, or any upazila by its id (e.g. ADM3_Godagari); null when there is no data for it. */
export function placeFor(id: string | undefined | null): Place | null {
  if (!id || id === PILOT_ID || id === 'ADM3_Tanore') return PILOT;
  const n = nationalData();
  const u = n.upazilas.find((x: any) => x.id === id);
  const d = u && n.districts[u.district];
  if (!d) return null;
  const local = localProfile(u.id, u.district);
  const top = local.patterns[0];
  return {
    id: u.id, kind: 'upazila', nameEnglish: `${u.name} upazila`, nameBangla: `${u.name} উপজেলা`, upazila: u.name, district: u.district,
    aman: d.aman, rabi: d.rabi, srdi: TALANDA_SRDI,
    conditions: {
      lat: d.lat, lon: d.lon, groundwater: d.conditions.groundwater, cattlePerKm2: d.conditions.cattlePerKm2,
      bmdStation: d.station?.name ?? null, bmdStationKm: d.station?.km ?? null,
      smap: null, rainLast30Days: null, winterGreenness: greennessFor(u.id), rootZoneGldasMm: null,
      landUse: top ? { year: '2014-15', croppingIntensityPct: local.intensityPct, topPattern: top[0], topPatternPct: top[1] } : null,
    },
    advisories: null,
    dataNote: `District replay for ${u.district} (NASA POWER + GPM IMERG at the district's point, 2001-2025); land type from NASA NASADEM and Landsat surface water with BRRI's 2014-15 cropping survey; BBS district yields; fertilizer from the SRDI Talanda card until this upazila's card is added.`,
    local,
    defaultLandType: local.land?.type ?? 'medium_high',
  };
}

/** Run `fn` with the engine pointed at `place`, then put the previous place back. */
export function withPlace<T>(place: Place, fn: () => T): T {
  const saved = { ...LOC };
  Object.assign(LOC, place);
  try {
    return fn();
  } finally {
    Object.assign(LOC, saved);
  }
}
