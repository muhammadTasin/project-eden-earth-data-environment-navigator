/**
 * Daily NASA conditions for every upazila, written by research/live/daily_update.py
 * (NASA POWER for all of Bangladesh, GPM IMERG at 0.1 degree when an Earthdata Login is set).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.env.EDEN_LIVE_FILE || path.resolve(__dirname, '../data/live/upazila_conditions.json');

interface LiveFile {
  summary: Record<string, any>;
  upazilas: Array<Record<string, any>>;
}

let cache: { mtime: number; data: LiveFile } | null = null;

function load(): LiveFile | null {
  try {
    const mtime = fs.statSync(FILE).mtimeMs;
    if (!cache || cache.mtime !== mtime) cache = { mtime, data: JSON.parse(fs.readFileSync(FILE, 'utf8')) };
    return cache.data;
  } catch {
    return null;
  }
}

const daysSince = (iso: string | null | undefined) =>
  iso ? Math.floor((Date.now() - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000) : null;

/** When the file was made, which NASA sources it holds and how old each one is today. */
export function liveStatus() {
  const d = load();
  if (!d) return null;
  return {
    ...d.summary,
    sources: d.summary.sources.map((s: any) => ({ ...s, ageDays: daysSince(s.latestDate) })),
  };
}

/** Compact rows for one district (or all of Bangladesh), for lists and maps. */
export function liveUpazilas(district?: string) {
  const d = load();
  if (!d) return null;
  const rows = district ? d.upazilas.filter(u => u.district.toLowerCase() === district.toLowerCase()) : d.upazilas;
  return rows.map(u => ({
    id: u.id, name: u.name, district: u.district,
    soilStatus: u.power.soilStatus, rainStatus: u.power.rainStatus, rain30PctOfNormal: u.power.rain30PctOfNormal,
    rain7: u.imerg?.rain7 ?? u.power.rain7, tmax: u.power.tmax, hotDays7: u.power.hotDays7,
  }));
}

/** One upazila by id, by name, or the nearest to a point. */
export function liveUpazila(q: { id?: string | null; name?: string | null; lat?: number; lon?: number }) {
  const d = load();
  if (!d) return null;
  let u = q.id ? d.upazilas.find(x => x.id === q.id) : undefined;
  if (!u && q.name) u = d.upazilas.find(x => x.name.toLowerCase() === q.name!.toLowerCase());
  if (!u && Number.isFinite(q.lat) && Number.isFinite(q.lon)) {
    const k = Math.cos((q.lat! * Math.PI) / 180);
    u = d.upazilas.reduce((best, x) =>
      ((x.lat - q.lat!) ** 2 + ((x.lon - q.lon!) * k) ** 2) < ((best.lat - q.lat!) ** 2 + ((best.lon - q.lon!) * k) ** 2) ? x : best);
  }
  if (!u) return null;
  return {
    ...u,
    ageDays: { power: daysSince(u.power.date), imerg: daysSince(u.imerg?.date) },
    method: d.summary.method,
    generatedAt: d.summary.generatedAt,
  };
}

/** Today's haor flash-flood reading: upstream 3-day IMERG rain and the MODIS flood map, with their ages. */
export function liveHaor() {
  const d = load();
  const h = d?.summary?.haor;
  if (!h || !h.available) return null;
  return { ...h, ageDays: daysSince(h.date), modisAgeDays: daysSince(h.modisFlood?.date) };
}
