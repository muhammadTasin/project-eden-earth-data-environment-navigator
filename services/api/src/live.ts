/**
 * Daily NASA conditions for every upazila, written by research/live/daily_update.py
 * (NASA POWER for all of Bangladesh, GPM IMERG at 0.1 degree when an Earthdata Login is set).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.env.EDEN_LIVE_FILE || path.resolve(__dirname, '../data/live/upazila_conditions.json');
/** NASA SMAP L4 root-zone soil moisture per upazila, written by research/live/smap_now.py. */
const SMAP_FILE = process.env.EDEN_SMAP_FILE || path.resolve(__dirname, '../data/live/smap_upazila.json');
/** Flood water now per upazila from NASA OPERA DSWx-HLS, written by research/live/flood_now.py. */
const FLOOD_FILE = process.env.EDEN_FLOOD_FILE || path.resolve(__dirname, '../data/live/flood_now.json');
/** Where last year's Aman land is not green this year, from NASA HLS (research/live/crop_loss.py). */
const CROP_LOSS_FILE = process.env.EDEN_CROP_LOSS_FILE || path.resolve(__dirname, '../data/live/crop_loss.json');
/** A flood reading older than this is not used for advice. */
const FLOOD_MAX_AGE_DAYS = 21;

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

let smapCache: { mtime: number; byId: Map<string, Record<string, any>>; date: string; validTime: string; source: string } | null = null;
function smap() {
  try {
    const mtime = fs.statSync(SMAP_FILE).mtimeMs;
    if (!smapCache || smapCache.mtime !== mtime) {
      const d = JSON.parse(fs.readFileSync(SMAP_FILE, 'utf8'));
      smapCache = { mtime, byId: new Map(d.upazilas.map((u: any) => [u.id, u])), date: d.date, validTime: d.validTime, source: d.source };
    }
    return smapCache;
  } catch {
    return null;
  }
}
/** One upazila's SMAP reading with its date, or null. */
function smapFor(id: string) {
  const s = smap();
  const r = s?.byId.get(id);
  return r ? { date: s!.date, validTime: s!.validTime, rootzonePctl: r.rootzonePctl, rootzone: r.rootzone, surface: r.surface, status: r.status } : null;
}

let floodCache: { mtime: number; data: Record<string, any> } | null = null;
function flood() {
  try {
    const mtime = fs.statSync(FLOOD_FILE).mtimeMs;
    if (!floodCache || floodCache.mtime !== mtime) floodCache = { mtime, data: JSON.parse(fs.readFileSync(FLOOD_FILE, 'utf8')) };
    return floodCache.data;
  } catch {
    return null;
  }
}
/** One upazila's OPERA flood reading (date, seen share, flood share), or null when there is none or it is old. */
export function floodFor(id: string) {
  const d = flood();
  const r = d?.upazilas?.[id];
  if (!r || (daysSince(r.date) ?? 99) > FLOOD_MAX_AGE_DAYS) return null;
  return { date: r.date, seenShare: r.seenShare, floodShare: r.floodShare, waterNow: r.waterNow, waterDry: r.waterDry, lastYearRadar: r.lastYearRadar ?? null };
}
let lossCache: { mtime: number; data: Record<string, any> } | null = null;
function cropLoss() {
  try {
    const mtime = fs.statSync(CROP_LOSS_FILE).mtimeMs;
    if (!lossCache || lossCache.mtime !== mtime) lossCache = { mtime, data: JSON.parse(fs.readFileSync(CROP_LOSS_FILE, 'utf8')) };
    return lossCache.data;
  } catch {
    return null;
  }
}
/** One upazila's HLS greenness on last year's Aman land: shares not green, under water and weaker this year. */
export function cropLossFor(id: string) {
  const r = cropLoss()?.upazilas?.[id];
  return r ? { notGreenShare: r.notGreenShare, waterShare: r.waterShare, weakerShare: r.weakerShare, meanChange: r.meanChange, amanLandShare: r.amanLandShare, seenShare: r.seenShare } : null;
}
/** When the crop-loss file was made and the weeks it compares. */
export function cropLossStatus() {
  const d = cropLoss();
  return d ? { source: d.source, made: d.made, year: d.year, windows: d.windows, thresholds: d.thresholds, summary: d.summary } : null;
}

/** When the flood file was made, its window and how many upazilas it saw. */
export function floodStatus() {
  const d = flood();
  return d ? { source: d.source, made: d.made, window: d.window, baseline: d.baseline, passes: d.passes, summary: d.summary } : null;
}

const daysSince = (iso: string | null | undefined) =>
  iso ? Math.floor((Date.now() - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000) : null;

/** When the file was made, which NASA sources it holds and how old each one is today. */
export function liveStatus() {
  const d = load();
  if (!d) return null;
  return {
    ...d.summary,
    sources: [
      ...d.summary.sources.map((s: any) => ({ ...s, ageDays: daysSince(s.latestDate) })),
      ...(smap() ? [{ name: 'NASA SMAP L4 root-zone soil moisture', latestDate: smap()!.date, ageDays: daysSince(smap()!.date), note: smap()!.source }] : []),
      ...(flood() ? [{ id: 'opera_flood', name: 'NASA OPERA DSWx-HLS flood water', latestDate: flood()!.window?.[1] ?? null, ageDays: daysSince(flood()!.window?.[1]), note: flood()!.source }] : []),
    ],
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
    smapStatus: smapFor(u.id)?.status ?? null, smapPctl: smapFor(u.id)?.rootzonePctl ?? null,
    blastDays7: u.disease?.riceBlast?.days7 ?? null, blastStatus: u.disease?.riceBlast?.status ?? null,
    lateBlightDays7: u.disease?.lateBlight?.days7 ?? null, lateBlightStatus: u.disease?.lateBlight?.status ?? null,
  }));
}

/** Every upazila's field record (field water, weather and the 7-day forecast) by id, for the map's field alerts. */
export function liveFields(): Map<string, Record<string, any>> {
  const d = load();
  return new Map((d?.upazilas ?? []).filter(u => u.field).map(u => [u.id, u.field]));
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
  const sm = smapFor(u.id);
  return {
    ...u,
    smap: sm,
    ageDays: { power: daysSince(u.power.date), imerg: daysSince(u.imerg?.date), smap: daysSince(sm?.date) },
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
