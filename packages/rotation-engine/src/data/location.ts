/**
 * Which place the engine is advising. Talanda union (Tanore) uses the detailed pilot release; every other upazila
 * uses its district's 25-season replay (research/explore/national_replay.py), with "not available yet" where a
 * dataset exists only for the pilots. `LOC` always holds the current place; `withPlace` switches it for one call.
 */
import fs from 'node:fs';
import { TALANDA_SRDI, TANORE_ADVISORIES, TANORE_AMAN_REPLAY, TANORE_CONDITIONS, TANORE_RABI_REPLAY } from './tanore_replay_data.ts';

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
}

export const PILOT_ID = 'talanda_tanore';

const PILOT: Place = {
  id: PILOT_ID, kind: 'pilot', nameEnglish: 'Talanda union', nameBangla: 'তালন্দ ইউনিয়ন', upazila: 'Tanore', district: 'Rajshahi',
  aman: TANORE_AMAN_REPLAY, rabi: TANORE_RABI_REPLAY, srdi: TALANDA_SRDI, conditions: TANORE_CONDITIONS, advisories: TANORE_ADVISORIES,
  dataNote: 'Pilot release: the replay at the Talanda point, the SRDI Talanda card, SMAP and MODIS checks.',
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
  return {
    id: u.id, kind: 'upazila', nameEnglish: `${u.name} upazila`, nameBangla: `${u.name} উপজেলা`, upazila: u.name, district: u.district,
    aman: d.aman, rabi: d.rabi, srdi: TALANDA_SRDI,
    conditions: {
      lat: d.lat, lon: d.lon, groundwater: d.conditions.groundwater, cattlePerKm2: d.conditions.cattlePerKm2,
      bmdStation: d.station?.name ?? null, bmdStationKm: d.station?.km ?? null,
      smap: null, rainLast30Days: null, landUse: null, winterGreenness: greennessFor(u.id), rootZoneGldasMm: null,
    },
    advisories: null,
    dataNote: `District replay for ${u.district} (NASA POWER + GPM IMERG at the district's point, 2001-2025); fertilizer from the SRDI Talanda card until this upazila's card is added.`,
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
