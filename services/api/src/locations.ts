/**
 * Bangladesh district/upazila reference data. The single source is
 * apps/saao-dashboard/public/data/bangladesh-upazilas.json (Open Admin Data, CC BY 4.0, plus BSS-reported
 * additions). Coordinates are approximate administrative-area reference points, not exact farm coordinates.
 * The website and the Android app both read this through GET /api/v1/locations; neither ships its own copy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_FILE = process.env.LOCATIONS_FILE
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/saao-dashboard/public/data/bangladesh-upazilas.json');

export interface UpazilaLocation {
  id: string;
  districtId: string;
  districtEn: string;
  districtBn: string;
  upazilaEn: string;
  upazilaBn: string;
  lat: number;
  lon: number;
  approximate: boolean;
}

export interface LocationsPayload {
  version: string;
  source: string;
  sourceUrl: string;
  license: string;
  note: string;
  districtCount: number;
  upazilaCount: number;
  districts: Array<{
    id: string;
    nameEn: string;
    nameBn: string;
    upazilas: Array<{ id: string; nameEn: string; nameBn: string; lat: number; lon: number; approximate: boolean }>;
  }>;
}

let cached: { flat: UpazilaLocation[]; payload: LocationsPayload } | null = null;

function load() {
  if (cached) return cached;
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const flat: UpazilaLocation[] = (raw.locations as any[]).filter(l =>
    l && typeof l.id === 'string' && Number.isFinite(l.lat) && Number.isFinite(l.lon));
  const byDistrict = new Map<string, LocationsPayload['districts'][number]>();
  for (const l of flat) {
    let d = byDistrict.get(l.districtId);
    if (!d) {
      d = { id: l.districtId, nameEn: l.districtEn, nameBn: l.districtBn, upazilas: [] };
      byDistrict.set(l.districtId, d);
    }
    d.upazilas.push({ id: l.id, nameEn: l.upazilaEn, nameBn: l.upazilaBn, lat: l.lat, lon: l.lon, approximate: l.approximate !== false });
  }
  const districts = [...byDistrict.values()].sort((a, b) => a.nameEn.localeCompare(b.nameEn));
  for (const d of districts) d.upazilas.sort((a, b) => a.nameEn.localeCompare(b.nameEn));
  const stat = fs.statSync(DATA_FILE);
  cached = {
    flat,
    payload: {
      version: `${flat.length}-${Math.floor(stat.mtimeMs / 1000)}`,
      source: String(raw.source || ''),
      sourceUrl: String(raw.sourceUrl || ''),
      license: String(raw.license || ''),
      note: String(raw.locationNote || ''),
      districtCount: districts.length,
      upazilaCount: flat.length,
      districts,
    },
  };
  return cached;
}

export function getLocationsPayload(): LocationsPayload { return load().payload; }
export function getUpazilaById(id: string): UpazilaLocation | undefined { return load().flat.find(l => l.id === id); }

/** Nearest reference point by great-circle distance. Approximate: it is not a point-in-polygon upazila lookup. */
export function nearestLocation(lat: number, lon: number): { location: UpazilaLocation; distanceKm: number } {
  let best: UpazilaLocation | null = null;
  let bestKm = Infinity;
  for (const l of load().flat) {
    const dLat = (l.lat - lat) * Math.PI / 180;
    const dLon = (l.lon - lon) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * Math.PI / 180) * Math.cos(l.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    const km = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    if (km < bestKm) { bestKm = km; best = l; }
  }
  return { location: best as UpazilaLocation, distanceKm: Number(bestKm.toFixed(1)) };
}
